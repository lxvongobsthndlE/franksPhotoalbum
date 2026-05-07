import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
    })),
  },
}));

vi.mock('../utils/storage.js', () => ({
  deleteAvatar: vi.fn().mockResolvedValue(undefined),
  deleteGroupPhotoObjects: vi.fn().mockResolvedValue(undefined),
  deleteUserExportObject: vi.fn().mockResolvedValue(undefined),
}));

describe('account deletion routes', () => {
  let routes;
  let prisma;
  let fastify;
  let helpers;

  async function callRoute(method, path, requestOverrides = {}) {
    const handler = fastify.routes[method].get(path);
    const request = createMockRequest(requestOverrides);
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    helpers = await import('../routes/account-deletion.js');
    routes = helpers.default;
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });
    await routes(fastify);
  });

  it('requests a deletion code for authenticated user', async () => {
    process.env.SMTP_HOST = '';
    process.env.SMTP_USER = '';
    process.env.NODE_ENV = 'development';

    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@test.dev' });
    prisma.accountDeletionRequest.findUnique.mockResolvedValue(null);
    prisma.accountDeletionRequest.upsert.mockResolvedValue({ id: 'req-1' });

    const { result } = await callRoute('POST', '/request', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      body: {},
    });

    expect(prisma.accountDeletionRequest.upsert).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Bestätigungscode');
  });

  it('blocks deletion code request for the last active admin', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@test.dev',
      role: 'admin',
    });
    prisma.user.findMany.mockResolvedValue([]);

    const { reply } = await callRoute('POST', '/request', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      body: {},
    });

    expect(reply.code).toHaveBeenCalledWith(409);
    expect(reply.payload).toEqual({
      error:
        'Der letzte aktive Admin kann nicht deaktiviert oder gelöscht werden. Bitte ernennen Sie zuerst einen weiteren Admin.',
    });
    expect(prisma.accountDeletionRequest.upsert).not.toHaveBeenCalled();
  });

  it('confirms deletion and schedules purge in 14 days', async () => {
    const now = new Date();
    const expires = new Date(now.getTime() + 5 * 60 * 1000);
    const correctCode = '123456';
    const hash = crypto.createHash('sha256').update(correctCode).digest('hex');

    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      status: 'pending',
      codeHash: hash,
      codeExpiresAt: expires,
    });
    prisma.accountDeletionRequest.update.mockResolvedValue({ id: 'req-1' });

    const { result, reply } = await callRoute('POST', '/confirm', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      body: { code: correctCode, keepContent: true },
    });

    expect(reply.clearCookie).toHaveBeenCalled();
    expect(prisma.accountDeletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1' },
        data: expect.objectContaining({ status: 'confirmed', keepContent: true }),
      })
    );
    expect(result.ok).toBe(true);
  });

  it('blocks confirm for the last active admin', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    prisma.user.findMany.mockResolvedValue([]);

    const { reply } = await callRoute('POST', '/confirm', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      body: { code: '123456', keepContent: true },
    });

    expect(reply.code).toHaveBeenCalledWith(409);
    expect(reply.payload).toEqual({
      error:
        'Der letzte aktive Admin kann nicht deaktiviert oder gelöscht werden. Bitte ernennen Sie zuerst einen weiteren Admin.',
    });
    expect(prisma.accountDeletionRequest.findUnique).not.toHaveBeenCalled();
    expect(prisma.accountDeletionRequest.update).not.toHaveBeenCalled();
  });

  it('returns scheduled status when deletion is confirmed', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      status: 'confirmed',
      codeExpiresAt: new Date(),
      keepContent: true,
      successorUserId: null,
      purgeAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });

    const { result } = await callRoute('GET', '/status', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
    });

    expect(result.status).toBe('scheduled');
    expect(result.daysRemaining).toBeGreaterThan(0);
  });

  it('reactivates deletion on login helper', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      status: 'confirmed',
      purgeAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    prisma.accountDeletionRequest.update.mockResolvedValue({ id: 'req-1' });

    const out = await helpers.reactivateDeletionOnLogin(prisma, 'user-1');

    expect(out).toEqual({ reactivated: true });
    expect(prisma.accountDeletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req-1' } })
    );
  });

  it('detects active deletion for confirmed users with future purge date', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      status: 'confirmed',
      purgeAt: new Date(Date.now() + 60_000),
    });

    const out = await helpers.hasActiveAccountDeletion(prisma, 'user-1');

    expect(out).toBe(true);
  });

  it('blocks protected api access for confirmed users via deletion guard', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({
      status: 'confirmed',
      purgeAt: new Date(Date.now() + 60_000),
    });

    const guard = helpers.createActiveDeletionGuard({
      prisma,
      jwt: {
        verify: vi.fn().mockReturnValue({ id: 'user-1', type: 'access' }),
      },
    });
    const request = createMockRequest({
      url: '/api/groups/my',
      headers: { authorization: 'Bearer valid-access-token' },
    });
    const reply = createMockReply();

    await guard(request, reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toEqual({ error: 'Account ist deaktiviert. Bitte neu einloggen.' });
  });

  it('allows account deletion endpoints to bypass the deletion guard', async () => {
    const guard = helpers.createActiveDeletionGuard({
      prisma,
      jwt: {
        verify: vi.fn().mockReturnValue({ id: 'user-1', type: 'access' }),
      },
    });
    const request = createMockRequest({
      url: '/api/account-deletion/status',
      headers: { authorization: 'Bearer valid-access-token' },
    });
    const reply = createMockReply();

    await guard(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
    expect(prisma.accountDeletionRequest.findUnique).not.toHaveBeenCalled();
  });

  it('purges due accounts and reports removed count', async () => {
    prisma.accountDeletionRequest.findMany.mockResolvedValue([
      {
        id: 'req-1',
        userId: 'user-1',
        keepContent: false,
        successorUserId: null,
      },
    ]);

    prisma.userExport.findMany.mockResolvedValue([]);
    prisma.photo.findMany.mockResolvedValue([]);
    prisma.photo.deleteMany.mockResolvedValue({ count: 0 });
    prisma.album.deleteMany.mockResolvedValue({ count: 0 });
    prisma.group.updateMany.mockResolvedValue({ count: 0 });
    prisma.like.deleteMany.mockResolvedValue({ count: 0 });
    prisma.comment.deleteMany.mockResolvedValue({ count: 0 });
    prisma.albumContributor.deleteMany.mockResolvedValue({ count: 0 });
    prisma.groupDeputy.deleteMany.mockResolvedValue({ count: 0 });
    prisma.groupMember.deleteMany.mockResolvedValue({ count: 0 });
    prisma.notificationPreference.deleteMany.mockResolvedValue({ count: 0 });
    prisma.user.delete.mockResolvedValue({ id: 'user-1' });

    const result = await helpers.purgeDueDeletedAccounts(fastify);

    expect(result).toEqual({ scanned: 1, removed: 1, errors: 0 });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });
});
