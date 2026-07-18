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

describe('group feed comment routes', () => {
  let routes;
  let prisma;
  let fastify;
  let createNotificationMock;

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
    process.env.LIKE_NOTIFICATION_DELAY_MS = '25';
    routes = (await import('../routes/group-feed-comments.js')).default;
    ({ createNotification: createNotificationMock } = await import('../utils/notifications.js'));
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });

    prisma.groupMember.findUnique.mockResolvedValue({ userId: 'user-1', groupId: 'group-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    prisma.group.findUnique.mockResolvedValue({ id: 'group-1', createdBy: 'owner-1' });
    prisma.groupFeedComment.count.mockResolvedValue(0);

    await routes(fastify);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.LIKE_NOTIFICATION_DELAY_MS;
  });

  it('loads top-level comments with pagination metadata', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({
      id: 'post-1',
      groupId: 'group-1',
      createdById: 'user-1',
    });

    const rows = Array.from({ length: 16 }).map((_, idx) => ({
      id: `c-${idx}`,
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'user-2',
      parentCommentId: null,
      content: `Kommentar ${idx}`,
      mentions: [],
      deletedAt: null,
      deletedById: null,
      createdAt: new Date(Date.now() - idx * 1000),
      updatedAt: new Date(Date.now() - idx * 1000),
      user: {
        id: 'user-2',
        name: 'Test',
        username: 'tester',
        displayNameField: 'name',
        avatar: null,
        color: '#333',
      },
      likes: [],
      _count: { replies: 0, historyEntries: 0 },
    }));

    prisma.groupFeedComment.findMany.mockResolvedValue(rows);

    const { result } = await callRoute('GET', '/:postId/comments', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { postId: 'post-1' },
      query: { limit: '15' },
    });

    expect(result.comments).toHaveLength(15);
    expect(result.paging.hasMore).toBe(true);
    expect(result.paging.nextCursor).toBe('c-14');
  });

  it('rejects comments with too many mentions', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({
      id: 'post-1',
      groupId: 'group-1',
      createdById: 'user-1',
    });

    const { reply } = await callRoute('POST', '/:postId/comments', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { postId: 'post-1' },
      body: {
        content: '@a1 @a2 @a3 @a4 @a5 @a6 Hallo',
      },
    });

    expect(reply.statusCode).toBe(400);
    expect(prisma.groupFeedComment.create).not.toHaveBeenCalled();
  });

  it('blocks delete for non-owner without moderator rights', async () => {
    prisma.groupFeedComment.findUnique.mockResolvedValue({
      id: 'comment-1',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'other-user',
      content: 'x',
      deletedAt: null,
      post: {
        id: 'post-1',
        groupId: 'group-1',
        createdById: 'other-user',
      },
    });

    const { reply } = await callRoute('DELETE', '/comments/:commentId', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'comment-1' },
    });

    expect(reply.statusCode).toBe(403);
    expect(prisma.groupFeedComment.update).not.toHaveBeenCalled();
  });

  it('returns replies oldest-first and exposes next cursor', async () => {
    prisma.groupFeedComment.findUnique
      .mockResolvedValueOnce({
        id: 'root-1',
        postId: 'post-1',
        groupId: 'group-1',
        parentCommentId: null,
      })
      .mockResolvedValueOnce(null);

    const replyRows = Array.from({ length: 16 }).map((_, idx) => ({
      id: `r-${idx}`,
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'user-2',
      parentCommentId: 'root-1',
      content: `Antwort ${idx}`,
      mentions: [],
      deletedAt: null,
      deletedById: null,
      createdAt: new Date(Date.now() - idx * 1000),
      updatedAt: new Date(Date.now() - idx * 1000),
      user: {
        id: 'user-2',
        name: 'Antworter',
        username: 'antworter',
        displayNameField: 'name',
        avatar: null,
        color: '#333',
      },
      likes: [],
      _count: { replies: 0, historyEntries: 0 },
    }));
    prisma.groupFeedComment.findMany.mockResolvedValue(replyRows);

    const { result } = await callRoute('GET', '/comments/:commentId/replies', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'root-1' },
      query: { limit: '15' },
    });

    expect(result.replies).toHaveLength(15);
    expect(result.replies[0].id).toBe('r-14');
    expect(result.replies[14].id).toBe('r-0');
    expect(result.paging.hasMore).toBe(true);
    expect(result.paging.nextCursor).toBe('r-14');
  });

  it('rejects nested replies beyond level 2', async () => {
    prisma.groupFeedComment.findUnique.mockResolvedValue({
      id: 'child-1',
      postId: 'post-1',
      groupId: 'group-1',
      parentCommentId: 'root-1',
      deletedAt: null,
    });

    const { reply } = await callRoute('POST', '/comments/:commentId/replies', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'child-1' },
      body: { content: 'Nicht erlaubt' },
    });

    expect(reply.statusCode).toBe(400);
    expect(prisma.groupFeedComment.create).not.toHaveBeenCalled();
  });

  it('returns 429 when comment rate limit is exceeded', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({
      id: 'post-1',
      groupId: 'group-1',
      createdById: 'user-1',
    });
    prisma.groupFeedComment.count.mockResolvedValue(10);

    const { reply } = await callRoute('POST', '/:postId/comments', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { postId: 'post-1' },
      body: { content: 'Zu viele Kommentare' },
    });

    expect(reply.statusCode).toBe(429);
    expect(reply.payload.code).toBe('comment_rate_limited');
    expect(prisma.groupFeedComment.create).not.toHaveBeenCalled();
  });

  it('soft deletes own comment by setting deleted fields', async () => {
    prisma.groupFeedComment.findUnique.mockResolvedValue({
      id: 'comment-own',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'user-1',
      content: 'x',
      deletedAt: null,
      post: {
        id: 'post-1',
        groupId: 'group-1',
        createdById: 'other-user',
      },
    });
    prisma.groupFeedComment.update.mockResolvedValue({
      id: 'comment-own',
      deletedAt: new Date(),
      deletedById: 'user-1',
    });

    const { result } = await callRoute('DELETE', '/comments/:commentId', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'comment-own' },
    });

    expect(prisma.groupFeedComment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'comment-own' },
        data: expect.objectContaining({ deletedById: 'user-1', deletedAt: expect.any(Date) }),
      })
    );
    expect(result).toEqual({ status: 'deleted' });
  });

  it('likes a comment idempotently via create-if-missing', async () => {
    prisma.groupFeedComment.findUnique.mockResolvedValue({
      id: 'comment-like',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'other-user',
      content: 'x',
      deletedAt: null,
      post: {
        id: 'post-1',
        groupId: 'group-1',
        createdById: 'other-user',
      },
    });
    prisma.groupFeedCommentLike.findUnique.mockResolvedValue({
      commentId: 'comment-like',
      userId: 'user-1',
    });
    prisma.groupFeedCommentLike.count.mockResolvedValue(2);

    const { result } = await callRoute('POST', '/comments/:commentId/like', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'comment-like' },
    });

    expect(prisma.groupFeedCommentLike.create).not.toHaveBeenCalled();
    expect(result).toEqual({ liked: true, likesCount: 2 });
  });

  it('loads users who liked a comment', async () => {
    prisma.groupFeedComment.findUnique.mockResolvedValue({
      id: 'comment-like-list',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'other-user',
      content: 'x',
      deletedAt: null,
      post: {
        id: 'post-1',
        groupId: 'group-1',
        createdById: 'other-user',
      },
    });
    prisma.groupFeedCommentLike.findMany.mockResolvedValue([
      {
        commentId: 'comment-like-list',
        userId: 'user-2',
        createdAt: new Date('2026-07-18T17:40:00.000Z'),
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

    const { result } = await callRoute('GET', '/comments/:commentId/likes', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'comment-like-list' },
    });

    expect(prisma.groupFeedCommentLike.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { commentId: 'comment-like-list' } })
    );
    expect(result.total).toBe(1);
    expect(result.likes[0]).toEqual(
      expect.objectContaining({
        userId: 'user-2',
        user: expect.objectContaining({ id: 'user-2', username: 'anna' }),
      })
    );
  });

  it('notifies comment owner when like remains after delay', async () => {
    vi.useFakeTimers();
    prisma.groupFeedComment.findUnique.mockResolvedValue({
      id: 'comment-like-notif',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'comment-owner',
      content: 'x',
      deletedAt: null,
      post: {
        id: 'post-1',
        groupId: 'group-1',
        createdById: 'other-user',
      },
    });
    prisma.groupFeedCommentLike.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ commentId: 'comment-like-notif', userId: 'user-1' });
    prisma.groupFeedCommentLike.create.mockResolvedValue({
      commentId: 'comment-like-notif',
      userId: 'user-1',
    });
    prisma.groupFeedCommentLike.count.mockResolvedValue(1);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      name: 'Liker',
      username: 'liker',
    });

    await callRoute('POST', '/comments/:commentId/like', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'comment-like-notif' },
    });

    await vi.advanceTimersByTimeAsync(30);

    expect(createNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'comment-owner',
        type: 'feedCommentLiked',
        entityId: 'post-1',
      })
    );
  });

  it('does not notify comment owner when like is removed quickly', async () => {
    vi.useFakeTimers();
    prisma.groupFeedComment.findUnique.mockResolvedValue({
      id: 'comment-like-cancel',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'comment-owner',
      content: 'x',
      deletedAt: null,
      post: {
        id: 'post-1',
        groupId: 'group-1',
        createdById: 'other-user',
      },
    });
    prisma.groupFeedCommentLike.findUnique.mockResolvedValueOnce(null);
    prisma.groupFeedCommentLike.create.mockResolvedValue({
      commentId: 'comment-like-cancel',
      userId: 'user-1',
    });
    prisma.groupFeedCommentLike.count.mockResolvedValue(1);

    await callRoute('POST', '/comments/:commentId/like', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'comment-like-cancel' },
    });

    prisma.groupFeedCommentLike.count.mockResolvedValue(0);
    await callRoute('DELETE', '/comments/:commentId/like', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'comment-like-cancel' },
    });

    await vi.advanceTimersByTimeAsync(30);
    expect(createNotificationMock).not.toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ type: 'feedCommentLiked' })
    );
  });

  it('notifies post owner when someone comments on their post', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({
      id: 'post-1',
      groupId: 'group-1',
      createdById: 'owner-2',
    });
    prisma.groupFeedComment.create.mockResolvedValue({
      id: 'comment-1',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'user-1',
      parentCommentId: null,
      content: 'Hallo Welt',
      mentions: [],
      deletedAt: null,
      deletedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: 'user-1',
        name: 'Kommentator',
        username: 'kommentator',
        displayNameField: 'name',
        avatar: null,
        color: '#333',
      },
      likes: [],
      _count: { replies: 0, historyEntries: 0 },
    });
    prisma.groupMember.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Kommentator',
      username: 'kommentator',
    });

    await callRoute('POST', '/:postId/comments', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { postId: 'post-1' },
      body: { content: 'Hallo Welt' },
    });

    expect(createNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ userId: 'owner-2', type: 'feedPostCommented', entityId: 'post-1' })
    );
  });

  it('notifies mentioned members in feed comments', async () => {
    prisma.groupFeedPost.findUnique.mockResolvedValue({
      id: 'post-1',
      groupId: 'group-1',
      createdById: 'user-1',
    });
    prisma.groupMember.findMany.mockResolvedValue([
      {
        user: { id: 'mentioned-1', username: 'targetuser' },
      },
    ]);
    prisma.groupFeedComment.create.mockResolvedValue({
      id: 'comment-2',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'user-1',
      parentCommentId: null,
      content: '@targetuser ping',
      mentions: ['mentioned-1'],
      deletedAt: null,
      deletedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: 'user-1',
        name: 'Autor',
        username: 'autor',
        displayNameField: 'name',
        avatar: null,
        color: '#333',
      },
      likes: [],
      _count: { replies: 0, historyEntries: 0 },
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', name: 'Autor', username: 'autor' });

    await callRoute('POST', '/:postId/comments', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { postId: 'post-1' },
      body: { content: '@targetuser ping' },
    });

    expect(createNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'mentioned-1',
        type: 'feedCommentMentioned',
        entityId: 'post-1',
      })
    );
  });

  it('notifies original commenter when a reply is posted', async () => {
    prisma.groupFeedComment.findUnique.mockResolvedValue({
      id: 'root-1',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'comment-owner-1',
      parentCommentId: null,
      deletedAt: null,
    });
    prisma.groupMember.findMany.mockResolvedValue([]);
    prisma.groupFeedComment.create.mockResolvedValue({
      id: 'reply-1',
      postId: 'post-1',
      groupId: 'group-1',
      userId: 'user-1',
      parentCommentId: 'root-1',
      content: 'Antwort',
      mentions: [],
      deletedAt: null,
      deletedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: 'user-1',
        name: 'Antworter',
        username: 'antworter',
        displayNameField: 'name',
        avatar: null,
        color: '#333',
      },
      likes: [],
      _count: { replies: 0, historyEntries: 0 },
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Antworter',
      username: 'antworter',
    });

    await callRoute('POST', '/comments/:commentId/replies', {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { id: 'user-1' },
      params: { commentId: 'root-1' },
      body: { content: 'Antwort' },
    });

    expect(createNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'comment-owner-1',
        type: 'feedCommentReplied',
        entityId: 'post-1',
      })
    );
  });
});
