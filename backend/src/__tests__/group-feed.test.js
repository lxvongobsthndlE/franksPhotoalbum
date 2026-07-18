import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';

describe('group feed routes', () => {
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
    routes = (await import('../routes/group-feed.js')).default;
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });

    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'user-1', groupId: 'group-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });
    prisma.photo.findMany.mockResolvedValue([]);
    prisma.groupFeedPostSave.findMany.mockResolvedValue([]);
    prisma.groupFeedPostLike.findMany.mockResolvedValue([]);
    prisma.groupFeedPost.deleteMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));

    await routes(fastify);
  });

  it('loads a single feed post with saved and edited metadata', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({
      id: 'post-1',
      groupId: 'group-1',
      createdById: 'user-2',
      title: 'Titel',
      body: 'Text',
      entityType: null,
      entityId: null,
      imageUrl: null,
      metadata: null,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
      createdBy: {
        id: 'user-2',
        name: 'Autor',
        username: 'autor',
        displayNameField: 'name',
        avatar: null,
        color: '#333',
      },
      likes: [{ userId: 'user-1' }],
      _count: { historyEntries: 2 },
    });
    prisma.groupFeedPost.count.mockResolvedValue(7);
    prisma.groupFeedPostSave.findMany.mockResolvedValue([{ postId: 'post-1' }]);

    const { result } = await callRoute('GET', '/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'post-1' },
    });

    expect(result.newerPostsCount).toBe(7);
    expect(result.post.id).toBe('post-1');
    expect(result.post.isSaved).toBe(true);
    expect(result.post.isEdited).toBe(true);
    expect(result.post.historyCount).toBe(2);
    expect(result.post.likesCount).toBe(1);
    expect(result.post.likedByMe).toBe(true);
  });

  it('filters saved posts on the backend for the saved view', async () => {
    prisma.groupFeedPost.findMany.mockResolvedValue([
      {
        id: 'post-1',
        groupId: 'group-1',
        createdById: 'user-2',
        title: null,
        body: 'Gespeichert',
        entityType: null,
        entityId: null,
        imageUrl: null,
        metadata: null,
        createdAt: new Date('2026-07-01T10:00:00.000Z'),
        updatedAt: new Date('2026-07-01T10:00:00.000Z'),
        createdBy: {
          id: 'user-2',
          name: 'Autor',
          username: 'autor',
          displayNameField: 'name',
          avatar: null,
          color: '#333',
        },
        _count: { historyEntries: 0 },
      },
    ]);
    prisma.groupFeedPost.count.mockResolvedValue(1);
    prisma.groupFeedPostSave.findMany.mockResolvedValue([{ postId: 'post-1' }]);

    const { result } = await callRoute('GET', '/', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      query: { groupId: 'group-1', view: 'saved', skip: '0', limit: '20' },
    });

    expect(prisma.groupFeedPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          groupId: 'group-1',
          savedBy: { some: { userId: 'user-1' } },
        }),
      })
    );
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].isSaved).toBe(true);
  });

  it('saves and unsaves a feed post for the current user', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({ id: 'post-1', groupId: 'group-1' });

    await callRoute('POST', '/:id/save', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'post-1' },
    });

    expect(prisma.groupFeedPostSave.upsert).toHaveBeenCalledWith({
      where: { userId_postId: { userId: 'user-1', postId: 'post-1' } },
      update: {},
      create: { userId: 'user-1', postId: 'post-1' },
    });

    const { reply } = await callRoute('DELETE', '/:id/save', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'post-1' },
    });

    expect(prisma.groupFeedPostSave.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', postId: 'post-1' },
    });
    expect(reply.statusCode).toBe(204);
  });

  it('edits own post and writes a history entry', async () => {
    prisma.groupFeedPost.findUnique
      .mockResolvedValueOnce({
        id: 'post-1',
        groupId: 'group-1',
        createdById: 'user-1',
        title: 'Alt',
        body: 'Vorher',
        metadata: { test: true },
      })
      .mockResolvedValueOnce({
        id: 'post-1',
        groupId: 'group-1',
        createdById: 'user-1',
        title: 'Neu',
        body: 'Nachher',
        entityType: null,
        entityId: null,
        imageUrl: null,
        metadata: { test: true },
        createdAt: new Date('2026-07-01T10:00:00.000Z'),
        updatedAt: new Date('2026-07-02T10:00:00.000Z'),
        createdBy: {
          id: 'user-1',
          name: 'Ich',
          username: 'ich',
          displayNameField: 'name',
          avatar: null,
          color: '#333',
        },
        _count: { historyEntries: 1 },
      });
    prisma.groupFeedPost.update.mockResolvedValue({
      id: 'post-1',
      groupId: 'group-1',
      createdById: 'user-1',
      title: 'Neu',
      body: 'Nachher',
      entityType: null,
      entityId: null,
      imageUrl: null,
      metadata: { test: true },
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
      createdBy: {
        id: 'user-1',
        name: 'Ich',
        username: 'ich',
        displayNameField: 'name',
        avatar: null,
        color: '#333',
      },
      _count: { historyEntries: 1 },
    });

    const { result } = await callRoute('PATCH', '/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'post-1' },
      body: { title: 'Neu', body: 'Nachher' },
    });

    expect(prisma.groupFeedPostHistory.create).toHaveBeenCalledWith({
      data: {
        postId: 'post-1',
        editedById: 'user-1',
        previousTitle: 'Alt',
        previousBody: 'Vorher',
        previousMetadata: { test: true },
      },
    });
    expect(prisma.groupFeedPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'post-1' },
        data: { title: 'Neu', body: 'Nachher' },
      })
    );
    expect(result.post.isEdited).toBe(true);
  });

  it('rejects editing a foreign post', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({
      id: 'post-1',
      groupId: 'group-1',
      createdById: 'user-2',
      title: 'Alt',
      body: 'Vorher',
      metadata: null,
    });

    const { reply } = await callRoute('PATCH', '/:id', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'post-1' },
      body: { body: 'Nachher' },
    });

    expect(reply.statusCode).toBe(403);
    expect(prisma.groupFeedPost.update).not.toHaveBeenCalled();
    expect(prisma.groupFeedPostHistory.create).not.toHaveBeenCalled();
  });

  it('returns post edit history for group members', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({ id: 'post-1', groupId: 'group-1' });
    prisma.groupFeedPostHistory.findMany.mockResolvedValue([
      {
        id: 'hist-1',
        postId: 'post-1',
        editedById: 'user-1',
        previousTitle: 'Alt',
        previousBody: 'Vorher',
        previousMetadata: null,
        createdAt: new Date('2026-07-02T10:00:00.000Z'),
        editedBy: {
          id: 'user-1',
          name: 'Ich',
          username: 'ich',
          displayNameField: 'name',
          avatar: null,
          color: '#333',
        },
      },
    ]);

    const { result } = await callRoute('GET', '/:id/history', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'post-1' },
    });

    expect(prisma.groupFeedPostHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { postId: 'post-1' } })
    );
    expect(result.history).toHaveLength(1);
    expect(result.history[0].previousBody).toBe('Vorher');
  });

  it('loads users who liked a feed post', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({ id: 'post-1', groupId: 'group-1' });
    prisma.groupFeedPostLike.findMany.mockResolvedValue([
      {
        postId: 'post-1',
        userId: 'user-2',
        createdAt: new Date('2026-07-18T18:00:00.000Z'),
        user: {
          id: 'user-2',
          name: 'Anna',
          username: 'anna',
          displayNameField: 'name',
          avatar: null,
          color: '#123',
        },
      },
    ]);

    const { result } = await callRoute('GET', '/:id/likes', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'post-1' },
    });

    expect(prisma.groupFeedPostLike.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { postId: 'post-1' } })
    );
    expect(result.total).toBe(1);
    expect(result.likes[0]).toEqual(
      expect.objectContaining({
        userId: 'user-2',
        user: expect.objectContaining({ id: 'user-2', username: 'anna' }),
      })
    );
  });

  it('likes and unlikes a feed post idempotently', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({
      id: 'post-1',
      groupId: 'group-1',
      createdById: 'user-2',
    });
    prisma.groupFeedPostLike.findUnique.mockResolvedValueOnce(null);
    prisma.groupFeedPostLike.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const { result: likeResult } = await callRoute('POST', '/:id/like', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'post-1' },
    });
    expect(prisma.groupFeedPostLike.create).toHaveBeenCalledWith({
      data: { postId: 'post-1', userId: 'user-1' },
    });
    expect(likeResult).toEqual({ liked: true, likesCount: 1 });

    const { result: unlikeResult } = await callRoute('DELETE', '/:id/like', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { id: 'post-1' },
    });
    expect(prisma.groupFeedPostLike.deleteMany).toHaveBeenCalledWith({
      where: { postId: 'post-1', userId: 'user-1' },
    });
    expect(unlikeResult).toEqual({ liked: false, likesCount: 0 });
  });
});
