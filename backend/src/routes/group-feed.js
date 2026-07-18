import { createNotification } from '../utils/notifications.js';

const LIKE_NOTIFICATION_DELAY_MS =
  Number.parseInt(process.env.LIKE_NOTIFICATION_DELAY_MS || '2500', 10) || 2500;
const pendingFeedPostLikeNotifications = new Map();

function buildFeedPostLikeKey(postId, likerUserId) {
  return `${postId}:${likerUserId}`;
}

export default async function groupFeedRoutes(fastify) {
  function getFeedPostInclude() {
    return {
      createdBy: {
        select: {
          id: true,
          name: true,
          username: true,
          displayNameField: true,
          avatar: true,
          color: true,
        },
      },
      _count: {
        select: {
          historyEntries: true,
          comments: true,
        },
      },
      likes: {
        select: {
          userId: true,
        },
      },
    };
  }

  function scheduleFeedPostLikeNotification({ post, likerUserId }) {
    if (!post?.id || !post?.createdById || post.createdById === likerUserId) return;

    const key = buildFeedPostLikeKey(post.id, likerUserId);
    const previousTimeout = pendingFeedPostLikeNotifications.get(key);
    if (previousTimeout) clearTimeout(previousTimeout);

    const timeout = setTimeout(async () => {
      pendingFeedPostLikeNotifications.delete(key);

      try {
        const existing = await fastify.prisma.groupFeedPostLike.findUnique({
          where: {
            postId_userId: {
              postId: post.id,
              userId: likerUserId,
            },
          },
          select: { postId: true },
        });
        if (!existing) return;

        const liker = await fastify.prisma.user.findUnique({
          where: { id: likerUserId },
          select: { name: true, username: true },
        });
        const likerName = liker?.name || liker?.username || 'Jemand';

        await createNotification(fastify.prisma, {
          userId: post.createdById,
          type: 'feedPostLiked',
          title: 'Like auf deinen Feed-Post',
          body: `${likerName} hat deinen Feed-Post geliked.`,
          entityId: post.id,
          entityType: 'groupFeedPost',
        });
      } catch (err) {
        fastify.log.error(err);
      }
    }, LIKE_NOTIFICATION_DELAY_MS);

    if (typeof timeout.unref === 'function') timeout.unref();
    pendingFeedPostLikeNotifications.set(key, timeout);
  }

  function cancelFeedPostLikeNotification(postId, likerUserId) {
    const key = buildFeedPostLikeKey(postId, likerUserId);
    const timeout = pendingFeedPostLikeNotifications.get(key);
    if (!timeout) return;
    clearTimeout(timeout);
    pendingFeedPostLikeNotifications.delete(key);
  }

  async function getUserRole(userId) {
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role || null;
  }

  async function isGroupMember(groupId, userId) {
    const membership = await fastify.prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
    });
    return !!membership;
  }

  async function isSystemAdmin(userId) {
    const role = await getUserRole(userId);
    return role === 'admin';
  }

  async function isGroupOwner(groupId, userId) {
    const group = await fastify.prisma.group.findUnique({
      where: { id: groupId },
      select: { createdBy: true },
    });
    return group?.createdBy === userId;
  }

  async function isGroupDeputy(groupId, userId) {
    const deputy = await fastify.prisma.groupDeputy.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    return !!deputy;
  }

  async function hasGroupAdminRights(groupId, userId) {
    return (await isGroupOwner(groupId, userId)) || (await isGroupDeputy(groupId, userId));
  }

  async function ensureGroupAccess(reply, groupId, userId) {
    const member = await isGroupMember(groupId, userId);
    if (member) return true;

    if (await isSystemAdmin(userId)) return true;

    reply.code(403).send({
      error: 'Du bist nicht Mitglied dieser Gruppe',
      code: 'not_group_member',
    });
    return false;
  }

  async function canPostInGroupFeed(group, userId) {
    const hasAdminRights = await hasGroupAdminRights(group.id, userId);
    if (hasAdminRights) return true;

    const isAdmin = await isSystemAdmin(userId);
    if (isAdmin) return true;

    if (group.feedPostingRestrictedToModerators) return false;

    return isGroupMember(group.id, userId);
  }

  async function normalizeFeedPosts(posts, userId) {
    const list = Array.isArray(posts) ? posts : [];
    if (!list.length) return [];

    const referencedPhotoIds = new Set();
    for (const post of list) {
      if (post.entityType === 'photo' && post.entityId) referencedPhotoIds.add(post.entityId);
      const md = post.metadata && typeof post.metadata === 'object' ? post.metadata : null;
      const uploadedItems = Array.isArray(md?.uploadedItems)
        ? md.uploadedItems
        : Array.isArray(md?.uploadedIds)
          ? md.uploadedIds.map((id) => ({ id }))
          : [];
      for (const item of uploadedItems) {
        if (item?.id) referencedPhotoIds.add(item.id);
      }
    }

    const [linkedPhotos, savedRows] = await Promise.all([
      referencedPhotoIds.size
        ? fastify.prisma.photo.findMany({
            where: { id: { in: [...referencedPhotoIds] } },
            select: { id: true, mediaType: true, videoDuration: true },
          })
        : [],
      userId
        ? fastify.prisma.groupFeedPostSave.findMany({
            where: {
              userId,
              postId: { in: list.map((post) => post.id) },
            },
            select: { postId: true },
          })
        : [],
    ]);

    const mediaByPhotoId = new Map(linkedPhotos.map((photo) => [photo.id, photo]));
    const savedPostIds = new Set(savedRows.map((row) => row.postId));
    const stalePostIds = [];
    const normalizedPosts = [];

    for (const post of list) {
      const postPhotoRefs = new Set();
      if (post.entityType === 'photo' && post.entityId) postPhotoRefs.add(post.entityId);

      const metadata =
        post.metadata && typeof post.metadata === 'object' ? { ...post.metadata } : null;
      const existingItems = Array.isArray(metadata?.uploadedItems)
        ? metadata.uploadedItems
        : Array.isArray(metadata?.uploadedIds)
          ? metadata.uploadedIds.map((id) => ({ id }))
          : [];
      const normalizedItems = existingItems.map((item) => {
        const id = item?.id || null;
        if (id) postPhotoRefs.add(id);
        const media = id ? mediaByPhotoId.get(id) : null;
        const mediaType = media?.mediaType || item?.mediaType || null;
        const videoDuration =
          media?.videoDuration !== null && media?.videoDuration !== undefined
            ? media.videoDuration
            : (item?.videoDuration ?? null);
        const exists = !!(id && mediaByPhotoId.has(id));
        return {
          ...(item && typeof item === 'object' ? item : {}),
          id,
          mediaType,
          videoDuration,
          exists,
        };
      });

      const hasMediaRefs = postPhotoRefs.size > 0;
      const allMissing = hasMediaRefs && [...postPhotoRefs].every((id) => !mediaByPhotoId.has(id));
      if (allMissing) {
        stalePostIds.push(post.id);
        continue;
      }

      const entityMissing =
        post.entityType === 'photo' && post.entityId ? !mediaByPhotoId.has(post.entityId) : false;
      const historyCount = post?._count?.historyEntries || 0;
      const commentsCount = post?._count?.comments || 0;
      const likes = Array.isArray(post?.likes) ? post.likes : [];
      const likesCount = likes.length;
      const likedByMe = userId ? likes.some((entry) => entry?.userId === userId) : false;

      normalizedPosts.push({
        ...post,
        metadata: metadata
          ? {
              ...metadata,
              uploadedItems: normalizedItems,
            }
          : post.metadata,
        entityMediaType:
          post.entityType === 'photo' && post.entityId
            ? mediaByPhotoId.get(post.entityId)?.mediaType || null
            : null,
        entityVideoDuration:
          post.entityType === 'photo' && post.entityId
            ? (mediaByPhotoId.get(post.entityId)?.videoDuration ?? null)
            : null,
        entityMissing,
        historyCount,
        commentsCount,
        likesCount,
        likedByMe,
        isEdited: historyCount > 0,
        editedAt: historyCount > 0 ? post.updatedAt : null,
        isSaved: savedPostIds.has(post.id),
      });
    }

    if (stalePostIds.length) {
      await fastify.prisma.groupFeedPost.deleteMany({
        where: { id: { in: stalePostIds } },
      });
    }

    return normalizedPosts;
  }

  fastify.get('/', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { groupId, view = 'all', skip = 0, limit = 20 } = request.query;

      if (!groupId) return reply.code(400).send({ error: 'groupId erforderlich' });
      if (!(await ensureGroupAccess(reply, groupId, userId))) return;

      const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 20));
      const safeSkip = Math.max(0, Number.parseInt(skip, 10) || 0);
      const where = { groupId };

      if (view === 'mine') {
        where.createdById = userId;
      } else if (view === 'saved') {
        where.savedBy = {
          some: { userId },
        };
      } else if (view === 'mentions') {
        const me = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { username: true, name: true },
        });
        const tokens = new Set();
        if (me?.username) tokens.add(`@${me.username}`);
        if (me?.name) tokens.add(`@${me.name}`);
        const tokenList = [...tokens];
        if (!tokenList.length) {
          return { posts: [], total: 0, hasMore: false };
        }
        where.OR = tokenList.flatMap((token) => [
          { body: { contains: token, mode: 'insensitive' } },
          { title: { contains: token, mode: 'insensitive' } },
        ]);
      }

      const [posts, total] = await Promise.all([
        fastify.prisma.groupFeedPost.findMany({
          where,
          include: getFeedPostInclude(),
          orderBy: { createdAt: 'desc' },
          skip: safeSkip,
          take: safeLimit,
        }),
        fastify.prisma.groupFeedPost.count({ where }),
      ]);
      const normalizedPosts = await normalizeFeedPosts(posts, userId);

      return {
        posts: normalizedPosts,
        total: Math.max(0, total - (posts.length - normalizedPosts.length)),
        hasMore:
          safeSkip + normalizedPosts.length <
          Math.max(0, total - (posts.length - normalizedPosts.length)),
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Laden des Feeds' });
    }
  });

  fastify.get('/:id/history', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const postId = request.params.id;

      const post = await fastify.prisma.groupFeedPost.findUnique({
        where: { id: postId },
        select: { id: true, groupId: true },
      });
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      const history = await fastify.prisma.groupFeedPostHistory.findMany({
        where: { postId },
        include: {
          editedBy: {
            select: {
              id: true,
              name: true,
              username: true,
              displayNameField: true,
              avatar: true,
              color: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { history };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Historie konnte nicht geladen werden' });
    }
  });

  fastify.get('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const postId = request.params.id;

      const post = await fastify.prisma.groupFeedPost.findUnique({
        where: { id: postId },
        include: getFeedPostInclude(),
      });
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      const [normalizedPosts, newerPostsCount] = await Promise.all([
        normalizeFeedPosts([post], userId),
        fastify.prisma.groupFeedPost.count({
          where: {
            groupId: post.groupId,
            createdAt: { gt: post.createdAt },
          },
        }),
      ]);

      const normalizedPost = normalizedPosts[0];
      if (!normalizedPost) {
        return reply.code(404).send({ error: 'Feed-Post nicht mehr verfügbar' });
      }

      return { post: normalizedPost, newerPostsCount };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Feed-Post konnte nicht geladen werden' });
    }
  });

  fastify.post('/', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const {
        groupId,
        contentType = 'post',
        title = null,
        body,
        entityType = null,
        entityId = null,
        imageUrl = null,
        metadata = null,
      } = request.body || {};

      if (!groupId) return reply.code(400).send({ error: 'groupId erforderlich' });
      if (!body || !String(body).trim()) {
        return reply.code(400).send({ error: 'body erforderlich' });
      }

      const group = await fastify.prisma.group.findUnique({ where: { id: groupId } });
      if (!group) return reply.code(404).send({ error: 'Gruppe nicht gefunden' });
      if (!(await ensureGroupAccess(reply, groupId, userId))) return;

      const canPost = await canPostInGroupFeed(group, userId);
      if (!canPost) {
        return reply.code(403).send({ error: 'Posten im Feed ist für Mitglieder gesperrt' });
      }

      const post = await fastify.prisma.groupFeedPost.create({
        data: {
          groupId,
          createdById: userId,
          contentType: String(contentType || 'post').slice(0, 40),
          title: title ? String(title).trim().slice(0, 160) : null,
          body: String(body).trim().slice(0, 3000),
          entityType: entityType ? String(entityType).slice(0, 40) : null,
          entityId: entityId ? String(entityId).slice(0, 80) : null,
          imageUrl: imageUrl ? String(imageUrl).slice(0, 500) : null,
          metadata: metadata && typeof metadata === 'object' ? metadata : null,
        },
        include: getFeedPostInclude(),
      });

      const [normalizedPost] = await normalizeFeedPosts([post], userId);
      return { post: normalizedPost || post };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Feed-Post konnte nicht erstellt werden' });
    }
  });

  fastify.post('/:id/save', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const postId = request.params.id;

      const post = await fastify.prisma.groupFeedPost.findUnique({
        where: { id: postId },
        select: { id: true, groupId: true },
      });
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      await fastify.prisma.groupFeedPostSave.upsert({
        where: { userId_postId: { userId, postId } },
        update: {},
        create: { userId, postId },
      });

      return { ok: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Feed-Post konnte nicht gespeichert werden' });
    }
  });

  fastify.get('/:id/likes', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const postId = request.params.id;

      const post = await fastify.prisma.groupFeedPost.findUnique({
        where: { id: postId },
        select: { id: true, groupId: true },
      });
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      const likes = await fastify.prisma.groupFeedPostLike.findMany({
        where: { postId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              displayNameField: true,
              avatar: true,
              color: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { userId: 'asc' }],
      });

      return {
        likes: likes.map((entry) => ({
          userId: entry.userId,
          createdAt: entry.createdAt,
          user: entry.user,
        })),
        total: likes.length,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Likes konnten nicht geladen werden' });
    }
  });

  fastify.post('/:id/like', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const postId = request.params.id;

      const post = await fastify.prisma.groupFeedPost.findUnique({
        where: { id: postId },
        select: { id: true, groupId: true, createdById: true },
      });
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      const existingLike = await fastify.prisma.groupFeedPostLike.findUnique({
        where: { postId_userId: { postId, userId } },
      });

      if (!existingLike) {
        await fastify.prisma.groupFeedPostLike.create({
          data: { postId, userId },
        });
        scheduleFeedPostLikeNotification({ post, likerUserId: userId });
      }

      const likesCount = await fastify.prisma.groupFeedPostLike.count({ where: { postId } });

      return {
        liked: true,
        likesCount,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Like konnte nicht gesetzt werden' });
    }
  });

  fastify.delete('/:id/like', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const postId = request.params.id;

      const post = await fastify.prisma.groupFeedPost.findUnique({
        where: { id: postId },
        select: { id: true, groupId: true },
      });
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      await fastify.prisma.groupFeedPostLike.deleteMany({
        where: { postId, userId },
      });

      cancelFeedPostLikeNotification(postId, userId);

      const likesCount = await fastify.prisma.groupFeedPostLike.count({ where: { postId } });

      return {
        liked: false,
        likesCount,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Like konnte nicht entfernt werden' });
    }
  });

  fastify.delete('/:id/save', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const postId = request.params.id;

      const post = await fastify.prisma.groupFeedPost.findUnique({
        where: { id: postId },
        select: { id: true, groupId: true },
      });
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      await fastify.prisma.groupFeedPostSave.deleteMany({
        where: { userId, postId },
      });

      return reply.code(204).send();
    } catch (err) {
      fastify.log.error(err);
      return reply
        .code(500)
        .send({ error: 'Gespeicherter Feed-Post konnte nicht entfernt werden' });
    }
  });

  fastify.patch('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const postId = request.params.id;
      const payload = request.body || {};

      if (payload.title === undefined && payload.body === undefined) {
        return reply.code(400).send({ error: 'Keine Änderungen übergeben' });
      }

      const post = await fastify.prisma.groupFeedPost.findUnique({
        where: { id: postId },
        select: {
          id: true,
          groupId: true,
          createdById: true,
          title: true,
          body: true,
          metadata: true,
        },
      });
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;
      if (post.createdById !== userId) {
        return reply.code(403).send({ error: 'Du darfst nur deine eigenen Feed-Posts bearbeiten' });
      }

      const nextTitle =
        payload.title === undefined
          ? post.title
          : String(payload.title || '')
              .trim()
              .slice(0, 160) || null;
      const nextBody =
        payload.body === undefined
          ? post.body
          : String(payload.body || '')
              .trim()
              .slice(0, 3000);

      if (!nextBody) {
        return reply.code(400).send({ error: 'body erforderlich' });
      }
      if (nextTitle === post.title && nextBody === post.body) {
        const currentPost = await fastify.prisma.groupFeedPost.findUnique({
          where: { id: postId },
          include: getFeedPostInclude(),
        });
        const [normalizedCurrentPost] = await normalizeFeedPosts([currentPost], userId);
        return { post: normalizedCurrentPost || currentPost };
      }

      const updatedPost = await fastify.prisma.$transaction(async (tx) => {
        await tx.groupFeedPostHistory.create({
          data: {
            postId,
            editedById: userId,
            previousTitle: post.title,
            previousBody: post.body,
            previousMetadata:
              post.metadata && typeof post.metadata === 'object' ? post.metadata : null,
          },
        });

        return tx.groupFeedPost.update({
          where: { id: postId },
          data: {
            title: nextTitle,
            body: nextBody,
          },
          include: getFeedPostInclude(),
        });
      });

      const [normalizedUpdatedPost] = await normalizeFeedPosts([updatedPost], userId);
      return { post: normalizedUpdatedPost || updatedPost };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Feed-Post konnte nicht bearbeitet werden' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const postId = request.params.id;

      const post = await fastify.prisma.groupFeedPost.findUnique({
        where: { id: postId },
        select: { id: true, groupId: true, createdById: true },
      });
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      const isOwner = post.createdById === userId;
      const canModerate = await hasGroupAdminRights(post.groupId, userId);
      const isAdmin = await isSystemAdmin(userId);
      if (!isOwner && !canModerate && !isAdmin) {
        return reply.code(403).send({ error: 'Du darfst diesen Feed-Post nicht löschen' });
      }

      await fastify.prisma.groupFeedPost.delete({ where: { id: postId } });
      return reply.code(204).send();
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Feed-Post konnte nicht gelöscht werden' });
    }
  });
}
