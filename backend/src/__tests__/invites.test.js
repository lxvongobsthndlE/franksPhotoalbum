import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';

vi.mock('../utils/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
}));

describe('invite routes', () => {
  let invitesRoutes;
  let fastify;
  let prisma;

  async function callRoute(method, path, requestOverrides = {}) {
    const handler = fastify.routes[method].get(path);
    const request = createMockRequest({
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      headers: { host: 'localhost:3000' },
      protocol: 'http',
      ...requestOverrides,
    });
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    invitesRoutes = (await import('../routes/invites.js')).default;
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });
    await invitesRoutes(fastify);
  });

  it('prevents owner from creating multi-group invites', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'owner-1', role: 'user' });

    const { reply } = await callRoute('POST', '/', {
      user: { id: 'owner-1' },
      body: { groupIds: ['group-1', 'group-2'] },
    });

    expect(reply.statusCode).toBe(403);
    expect(reply.payload.code).toBe('owner_single_group_only');
  });

  it('creates a single-group invite for owner with preset notification', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'owner-1', role: 'user' });
    prisma.group.findMany.mockResolvedValue([{ id: 'group-1', createdBy: 'owner-1' }]);
    prisma.groupInviteGroup.findMany.mockResolvedValue([]);
    prisma.groupInvite.findUnique.mockResolvedValue(null);
    prisma.groupInvite.create.mockResolvedValue({
      id: 'invite-1',
      token: 'ABCDEFGH12345678',
      createdAt: new Date('2026-05-03T12:00:00Z'),
      expiresAt: null,
      maxUses: 3,
      useCount: 0,
      isActive: true,
      notificationText: 'Willkommen in der Gruppe!',
      groups: [{ group: { id: 'group-1', name: 'Familie' } }],
    });

    const { result } = await callRoute('POST', '/', {
      user: { id: 'owner-1' },
      body: { groupIds: ['group-1'], maxUses: 3, notificationText: true },
    });

    expect(prisma.groupInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdBy: 'owner-1',
          notificationText: 'Willkommen in der Gruppe!',
        }),
      })
    );
    expect(result.invite.url).toContain('/?invite=');
  });

  it('returns already_member without incrementing usage when redeem is idempotent', async () => {
    prisma.groupInvite.findUnique.mockResolvedValue({
      id: 'invite-1',
      token: 'ABCDEFGH12345678',
      isActive: true,
      expiresAt: null,
      maxUses: null,
      useCount: 0,
      notificationText: null,
      groups: [
        { group: { id: 'group-1', name: 'Familie', createdBy: 'owner-1', maxMembers: null } },
      ],
    });
    prisma.groupMember.findMany.mockResolvedValue([{ groupId: 'group-1' }]);

    const { result } = await callRoute('POST', '/redeem/:token', {
      user: { id: 'member-1' },
      params: { token: 'ABCDEFGH12345678' },
    });

    expect(result.status).toBe('already_member');
    expect(prisma.groupInvite.update).not.toHaveBeenCalled();
  });

  it('returns 410 for expired invite preview', async () => {
    prisma.groupInvite.findUnique.mockResolvedValue({
      token: 'ABCDEFGH12345678',
      isActive: true,
      expiresAt: new Date('2020-01-01T00:00:00Z'),
      maxUses: null,
      useCount: 0,
      groups: [{ group: { id: 'group-1', name: 'Familie' } }],
    });

    const { reply } = await callRoute('GET', '/preview/:token', {
      params: { token: 'ABCDEFGH12345678' },
    });

    expect(reply.statusCode).toBe(410);
    expect(reply.payload.code).toBe('invite_expired');
  });
});
