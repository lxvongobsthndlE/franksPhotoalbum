import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';

vi.mock('../utils/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
}));

describe('likes routes', () => {
  let routes;
  let prisma;
  let fastify;
  let createNotificationMock;

  async function callRoute(method, path, requestOverrides = {}) {
    const handler = fastify.routes[method].get(path);
    const request = createMockRequest({
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      ...requestOverrides,
    });
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.LIKE_NOTIFICATION_DELAY_MS = '25';
    routes = (await import('../routes/likes.js')).default;
    ({ createNotification: createNotificationMock } = await import('../utils/notifications.js'));
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });

    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'user-1', groupId: 'group-1' });
    prisma.user.findUnique.mockImplementation(async ({ select }) => {
      if (select?.role) return { role: 'user' };
      return { name: 'Liker', username: 'liker' };
    });

    await routes(fastify);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.LIKE_NOTIFICATION_DELAY_MS;
  });

  it('notifies uploader when like remains after delay', async () => {
    vi.useFakeTimers();
    prisma.photo.findUnique.mockResolvedValue({
      id: 'photo-1',
      uploaderId: 'owner-1',
      groupId: 'group-1',
    });
    prisma.like.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ photoId: 'photo-1', userId: 'user-1' });
    prisma.like.create.mockResolvedValue({ photoId: 'photo-1', userId: 'user-1' });

    await callRoute('POST', '/', {
      user: { id: 'user-1' },
      body: { photoId: 'photo-1' },
    });

    await vi.advanceTimersByTimeAsync(30);

    expect(createNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'owner-1',
        type: 'photoLiked',
        entityId: 'photo-1',
      })
    );
  });

  it('does not notify uploader when photo is unliked quickly', async () => {
    vi.useFakeTimers();
    prisma.photo.findUnique.mockResolvedValue({
      id: 'photo-1',
      uploaderId: 'owner-1',
      groupId: 'group-1',
    });
    prisma.like.findUnique.mockResolvedValue({ photoId: 'photo-1', userId: 'user-1' });
    prisma.like.create.mockResolvedValue({ photoId: 'photo-1', userId: 'user-1' });

    await callRoute('POST', '/', {
      user: { id: 'user-1' },
      body: { photoId: 'photo-1' },
    });

    await callRoute('DELETE', '/:photoId', {
      user: { id: 'user-1' },
      params: { photoId: 'photo-1' },
    });

    await vi.advanceTimersByTimeAsync(30);

    expect(createNotificationMock).not.toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ type: 'photoLiked', entityId: 'photo-1' })
    );
  });
});
