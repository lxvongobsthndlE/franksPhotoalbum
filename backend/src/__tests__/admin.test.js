import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';

vi.mock('../utils/storage.js', () => ({
  deleteAvatar: vi.fn().mockResolvedValue(undefined),
  deleteGroupPhotoObjects: vi.fn().mockResolvedValue(undefined),
}));

describe('admin routes', () => {
  let routes;
  let prisma;
  let fastify;

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
    routes = (await import('../routes/admin.js')).default;
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });
    await routes(fastify);
  });

  it('rejects admin delete without reason', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ role: 'admin' });

    const { reply } = await callRoute('DELETE', '/users/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'user-1' },
      body: { irreversibleConfirmed: true },
    });

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.payload).toEqual({ error: 'Löschgrund ist erforderlich.' });
  });

  it('rejects admin delete without irreversible confirmation', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ role: 'admin' });

    const { reply } = await callRoute('DELETE', '/users/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'user-1' },
      body: { reason: 'DSGVO Anfrage' },
    });

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.payload).toEqual({
      error: 'Finale Bestätigung für irreversible Löschung fehlt.',
    });
  });

  it('deletes user and writes admin action log with reason', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ role: 'user', name: 'Test User', username: 'testuser' });
    prisma.photo.findMany.mockResolvedValue([{ id: 'photo-1', path: 'groups/a/photo.jpg' }]);
    prisma.$transaction.mockImplementation(async (cb) => cb(prisma));

    const { result, reply } = await callRoute('DELETE', '/users/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'user-1' },
      body: { reason: 'Manueller Admin-Eingriff', irreversibleConfirmed: true },
    });

    expect(reply.code).not.toHaveBeenCalledWith(400);
    expect(result).toEqual({ ok: true });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(prisma.adminActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin-1',
        actionType: 'user.delete.permanent',
        targetType: 'user',
        targetId: 'user-1',
        reason: 'Manueller Admin-Eingriff',
      }),
    });
  });

  it('blocks login identity when requested during delete', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ role: 'admin' }).mockResolvedValueOnce({
      role: 'user',
      name: 'Blocked User',
      username: 'blockeduser',
      email: 'blocked@example.com',
      auth_source: 'authentik',
    });
    prisma.photo.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (cb) => cb(prisma));

    const { result } = await callRoute('DELETE', '/users/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'user-1' },
      body: {
        reason: 'Wiederholter Regelverstoß',
        irreversibleConfirmed: true,
        blockAuthIdentity: true,
      },
    });

    expect(result).toEqual({ ok: true });
    expect(prisma.blockedLoginIdentity.upsert).toHaveBeenCalledWith({
      where: {
        emailNormalized_authSource: {
          emailNormalized: 'blocked@example.com',
          authSource: 'authentik',
        },
      },
      create: expect.objectContaining({
        email: 'blocked@example.com',
        emailNormalized: 'blocked@example.com',
        authSource: 'authentik',
        reason: 'Wiederholter Regelverstoß',
        blockedByUserId: 'admin-1',
      }),
      update: expect.objectContaining({
        email: 'blocked@example.com',
        reason: 'Wiederholter Regelverstoß',
        blockedByUserId: 'admin-1',
      }),
    });
    expect(prisma.adminActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          blockedLoginIdentity: true,
          blockedAuthSource: 'authentik',
        }),
      }),
    });
  });

  it('keeps last-admin deletion protection', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ role: 'admin', name: 'Only Admin', username: 'root' });
    prisma.user.count.mockResolvedValue(1);

    const { reply } = await callRoute('DELETE', '/users/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-2' },
      params: { id: 'admin-1' },
      body: { reason: 'Cleanup', irreversibleConfirmed: true },
    });

    expect(reply.code).toHaveBeenCalledWith(409);
    expect(reply.payload).toEqual({ error: 'Letzter Admin kann nicht gelöscht werden.' });
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('allows admin removing a user from their last group membership when not owner', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ id: 'user-1' });
    prisma.group.findUnique.mockResolvedValue({ id: 'group-1', createdBy: 'owner-1' });
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'user-1', groupId: 'group-1' });

    const { result, reply } = await callRoute('DELETE', '/users/:id/groups/:groupId', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'user-1', groupId: 'group-1' },
    });

    expect(reply.code).not.toHaveBeenCalledWith(409);
    expect(result).toEqual({ ok: true });
    expect(prisma.groupMember.delete).toHaveBeenCalledWith({
      where: { userId_groupId: { userId: 'user-1', groupId: 'group-1' } },
    });
  });

  it('still blocks removing owner from own group via admin endpoint', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ id: 'user-1' });
    prisma.group.findUnique.mockResolvedValue({ id: 'group-1', createdBy: 'user-1' });
    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'user-1', groupId: 'group-1' });

    const { reply } = await callRoute('DELETE', '/users/:id/groups/:groupId', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'admin-1' },
      params: { id: 'user-1', groupId: 'group-1' },
    });

    expect(reply.code).toHaveBeenCalledWith(409);
    expect(reply.payload).toEqual({
      error: 'Owner kann nicht direkt aus seiner Gruppe entfernt werden',
    });
    expect(prisma.groupMember.delete).not.toHaveBeenCalled();
  });
});
