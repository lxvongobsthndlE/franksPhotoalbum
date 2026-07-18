import { createNotification } from '../utils/notifications.js';

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 50;
const MAX_MENTIONS_PER_COMMENT = 5;
const COMMENT_RATE_LIMIT_PER_MINUTE = 10;
const LIKE_NOTIFICATION_DELAY_MS =
  Number.parseInt(process.env.LIKE_NOTIFICATION_DELAY_MS || '2500', 10) || 2500;
const pendingCommentLikeNotifications = new Map();

function getSafeLimit(limit) {
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Number.parseInt(limit, 10) || DEFAULT_PAGE_SIZE));
}

function trimContent(value) {
  return String(value || '').trim();
}

function sanitizeForNotification(text, max = 100) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function buildCommentLikeKey(commentId, likerUserId) {
  return `${commentId}:${likerUserId}`;
}

function extractMentionUsernames(content) {
  const usernames = new Set();
  const regex = /(^|\s)@([a-zA-Z0-9_.-]{2,32})\b/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    usernames.add(match[2].toLowerCase());
  }
  return [...usernames];
}

function serializeComment(comment, currentUserId) {
  const likes = Array.isArray(comment.likes) ? comment.likes : [];
  const mentionIds = Array.isArray(comment.mentions)
    ? comment.mentions.filter((entry) => typeof entry === 'string' && entry)
    : [];
  const deleted = !!comment.deletedAt;

  return {
    id: comment.id,
    postId: comment.postId,
    groupId: comment.groupId,
    userId: comment.userId,
    parentCommentId: comment.parentCommentId,
    content: deleted ? null : comment.content,
    deleted,
    deletedAt: comment.deletedAt,
    deletedById: comment.deletedById,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    edited: !!comment._count?.historyEntries,
    historyCount: comment._count?.historyEntries || 0,
    mentionIds,
    user: comment.user
      ? {
          id: comment.user.id,
          name: comment.user.name,
          username: comment.user.username,
          displayNameField: comment.user.displayNameField,
          avatar: comment.user.avatar,
          color: comment.user.color,
        }
      : null,
    likesCount: likes.length,
    likedByMe: likes.some((entry) => entry.userId === currentUserId),
    repliesCount: comment._count?.replies || 0,
  };
}

export default async function groupFeedCommentsRoutes(fastify) {
  function scheduleCommentLikeNotification({ comment, likerUserId }) {
    if (!comment?.id || !comment?.userId || comment.userId === likerUserId) return;

    const key = buildCommentLikeKey(comment.id, likerUserId);
    const previousTimeout = pendingCommentLikeNotifications.get(key);
    if (previousTimeout) clearTimeout(previousTimeout);

    const timeout = setTimeout(async () => {
      pendingCommentLikeNotifications.delete(key);

      try {
        const existing = await fastify.prisma.groupFeedCommentLike.findUnique({
          where: {
            commentId_userId: {
              commentId: comment.id,
              userId: likerUserId,
            },
          },
          select: { commentId: true },
        });
        if (!existing) return;

        const liker = await fastify.prisma.user.findUnique({
          where: { id: likerUserId },
          select: { name: true, username: true },
        });
        const likerName = liker?.name || liker?.username || 'Jemand';

        await createNotification(fastify.prisma, {
          userId: comment.userId,
          type: 'feedCommentLiked',
          title: 'Like auf deinen Feed-Kommentar',
          body: `${likerName} hat deinen Kommentar geliked.`,
          entityId: comment.postId,
          entityType: 'groupFeedPost',
        });
      } catch (err) {
        fastify.log.error(err);
      }
    }, LIKE_NOTIFICATION_DELAY_MS);

    if (typeof timeout.unref === 'function') timeout.unref();
    pendingCommentLikeNotifications.set(key, timeout);
  }

  function cancelCommentLikeNotification(commentId, likerUserId) {
    const key = buildCommentLikeKey(commentId, likerUserId);
    const timeout = pendingCommentLikeNotifications.get(key);
    if (!timeout) return;
    clearTimeout(timeout);
    pendingCommentLikeNotifications.delete(key);
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
    if (await isGroupOwner(groupId, userId)) return true;
    if (await isGroupDeputy(groupId, userId)) return true;
    return isSystemAdmin(userId);
  }

  async function ensureGroupAccess(reply, groupId, userId) {
    if (await isGroupMember(groupId, userId)) return true;
    if (await isSystemAdmin(userId)) return true;
    reply.code(403).send({
      error: 'Du bist nicht Mitglied dieser Gruppe',
      code: 'not_group_member',
    });
    return false;
  }

  async function findPostForGroup(postId) {
    return fastify.prisma.groupFeedPost.findUnique({
      where: { id: postId },
      select: {
        id: true,
        groupId: true,
        createdById: true,
      },
    });
  }

  async function resolveComment(commentId) {
    return fastify.prisma.groupFeedComment.findUnique({
      where: { id: commentId },
      include: {
        post: {
          select: {
            id: true,
            groupId: true,
            createdById: true,
          },
        },
      },
    });
  }

  function buildCursorWhere(baseWhere, cursorComment) {
    if (!cursorComment) return baseWhere;
    return {
      ...baseWhere,
      OR: [
        { createdAt: { lt: cursorComment.createdAt } },
        {
          AND: [{ createdAt: cursorComment.createdAt }, { id: { lt: cursorComment.id } }],
        },
      ],
    };
  }

  async function checkCommentRateLimit(groupId, userId) {
    const windowStart = new Date(Date.now() - 60 * 1000);
    const count = await fastify.prisma.groupFeedComment.count({
      where: {
        groupId,
        userId,
        createdAt: { gte: windowStart },
      },
    });
    return count < COMMENT_RATE_LIMIT_PER_MINUTE;
  }

  async function resolveMentionedGroupMembers(groupId, mentionUsernames, authorUserId) {
    if (!mentionUsernames.length) return [];

    const memberships = await fastify.prisma.groupMember.findMany({
      where: {
        groupId,
        user: {
          username: {
            in: mentionUsernames,
          },
        },
      },
      select: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    const byUsername = new Map();
    for (const row of memberships) {
      if (!row?.user?.username || !row.user.id) continue;
      byUsername.set(row.user.username.toLowerCase(), row.user.id);
    }

    const resolvedIds = [];
    for (const username of mentionUsernames) {
      const userId = byUsername.get(username);
      if (!userId || userId === authorUserId) continue;
      resolvedIds.push(userId);
    }

    return [...new Set(resolvedIds)];
  }

  async function emitMentionNotifications({
    groupId,
    postId,
    commentContent,
    mentionedUserIds,
    actorUserId,
  }) {
    if (!mentionedUserIds.length) return;

    const actor = await fastify.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { name: true, username: true },
    });
    const actorName = actor?.name || actor?.username || 'Jemand';

    await Promise.all(
      mentionedUserIds.map((targetUserId) =>
        createNotification(fastify.prisma, {
          userId: targetUserId,
          type: 'feedCommentMentioned',
          title: 'Du wurdest in einem Feed-Kommentar erwähnt',
          body: `${actorName}: „${sanitizeForNotification(commentContent, 90)}"`,
          entityId: postId,
          entityType: 'groupFeedPost',
        }).catch(() => {})
      )
    );
  }

  async function emitPostOwnerNotification({ post, commenterUserId, commentContent }) {
    if (!post?.createdById || post.createdById === commenterUserId) return;

    const commenter = await fastify.prisma.user.findUnique({
      where: { id: commenterUserId },
      select: { name: true, username: true },
    });
    const commenterName = commenter?.name || commenter?.username || 'Jemand';

    createNotification(fastify.prisma, {
      userId: post.createdById,
      type: 'feedPostCommented',
      title: 'Neuer Kommentar auf deinen Feed-Post',
      body: `${commenterName}: „${sanitizeForNotification(commentContent, 90)}"`,
      entityId: post.id,
      entityType: 'groupFeedPost',
    }).catch(() => {});
  }

  async function emitParentCommentOwnerNotification({
    parentComment,
    replierUserId,
    replyContent,
    postId,
  }) {
    if (!parentComment?.userId || parentComment.userId === replierUserId) return;

    const replier = await fastify.prisma.user.findUnique({
      where: { id: replierUserId },
      select: { name: true, username: true },
    });
    const replierName = replier?.name || replier?.username || 'Jemand';

    createNotification(fastify.prisma, {
      userId: parentComment.userId,
      type: 'feedCommentReplied',
      title: 'Neue Antwort auf deinen Kommentar',
      body: `${replierName}: „${sanitizeForNotification(replyContent, 90)}"`,
      entityId: postId,
      entityType: 'groupFeedPost',
    }).catch(() => {});
  }

  fastify.get('/:postId/comments', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { postId } = request.params;
      const { cursor, limit } = request.query;

      const post = await findPostForGroup(postId);
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      let cursorComment = null;
      if (cursor) {
        cursorComment = await fastify.prisma.groupFeedComment.findUnique({
          where: { id: cursor },
          select: { id: true, postId: true, parentCommentId: true, createdAt: true },
        });
        if (!cursorComment || cursorComment.postId !== post.id || cursorComment.parentCommentId) {
          return reply.code(400).send({ error: 'Ungültiger Cursor' });
        }
      }

      const safeLimit = getSafeLimit(limit);
      const where = buildCursorWhere(
        {
          postId: post.id,
          parentCommentId: null,
        },
        cursorComment
      );

      const rows = await fastify.prisma.groupFeedComment.findMany({
        where,
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
          likes: {
            select: { userId: true },
          },
          _count: {
            select: { replies: true, historyEntries: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: safeLimit + 1,
      });

      const hasMore = rows.length > safeLimit;
      const page = hasMore ? rows.slice(0, safeLimit) : rows;
      const nextCursor = hasMore ? page[page.length - 1]?.id || null : null;

      return {
        comments: page.map((row) => serializeComment(row, userId)),
        paging: {
          limit: safeLimit,
          hasMore,
          nextCursor,
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Kommentare konnten nicht geladen werden' });
    }
  });

  fastify.get('/comments/:commentId/replies', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { commentId } = request.params;
      const { cursor, limit } = request.query;

      const parent = await fastify.prisma.groupFeedComment.findUnique({
        where: { id: commentId },
        select: {
          id: true,
          postId: true,
          groupId: true,
          parentCommentId: true,
        },
      });
      if (!parent) return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      if (parent.parentCommentId) {
        return reply.code(400).send({ error: 'Nur Hauptkommentare können Antworten haben' });
      }
      if (!(await ensureGroupAccess(reply, parent.groupId, userId))) return;

      let cursorComment = null;
      if (cursor) {
        cursorComment = await fastify.prisma.groupFeedComment.findUnique({
          where: { id: cursor },
          select: { id: true, parentCommentId: true, createdAt: true },
        });
        if (!cursorComment || cursorComment.parentCommentId !== parent.id) {
          return reply.code(400).send({ error: 'Ungültiger Cursor' });
        }
      }

      const safeLimit = getSafeLimit(limit);
      const where = buildCursorWhere(
        {
          parentCommentId: parent.id,
        },
        cursorComment
      );

      const rows = await fastify.prisma.groupFeedComment.findMany({
        where,
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
          likes: {
            select: { userId: true },
          },
          _count: {
            select: { replies: true, historyEntries: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: safeLimit + 1,
      });

      const hasMore = rows.length > safeLimit;
      const pageDesc = hasMore ? rows.slice(0, safeLimit) : rows;
      const pageAsc = [...pageDesc].reverse();
      const nextCursor = hasMore ? pageDesc[pageDesc.length - 1]?.id || null : null;

      return {
        replies: pageAsc.map((row) => serializeComment(row, userId)),
        paging: {
          limit: safeLimit,
          hasMore,
          nextCursor,
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Antworten konnten nicht geladen werden' });
    }
  });

  fastify.post('/:postId/comments', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { postId } = request.params;
      const content = trimContent(request.body?.content);

      if (!content) return reply.code(400).send({ error: 'content erforderlich' });

      const post = await findPostForGroup(postId);
      if (!post) return reply.code(404).send({ error: 'Feed-Post nicht gefunden' });
      if (!(await ensureGroupAccess(reply, post.groupId, userId))) return;

      if (!(await checkCommentRateLimit(post.groupId, userId))) {
        return reply.code(429).send({
          error: 'Zu viele Kommentare in kurzer Zeit. Bitte warte kurz.',
          code: 'comment_rate_limited',
        });
      }

      const mentionUsernames = extractMentionUsernames(content);
      if (mentionUsernames.length > MAX_MENTIONS_PER_COMMENT) {
        return reply.code(400).send({
          error: `Maximal ${MAX_MENTIONS_PER_COMMENT} Erwähnungen pro Kommentar erlaubt`,
          code: 'too_many_mentions',
        });
      }

      const mentionedUserIds = await resolveMentionedGroupMembers(
        post.groupId,
        mentionUsernames,
        userId
      );

      const created = await fastify.prisma.groupFeedComment.create({
        data: {
          postId: post.id,
          groupId: post.groupId,
          userId,
          content,
          mentions: mentionedUserIds,
        },
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
          likes: {
            select: { userId: true },
          },
          _count: {
            select: { replies: true, historyEntries: true },
          },
        },
      });

      await Promise.all([
        emitPostOwnerNotification({ post, commenterUserId: userId, commentContent: content }),
        emitMentionNotifications({
          groupId: post.groupId,
          postId: post.id,
          commentContent: content,
          mentionedUserIds,
          actorUserId: userId,
        }),
      ]);

      return { comment: serializeComment(created, userId) };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Kommentar konnte nicht erstellt werden' });
    }
  });

  fastify.post('/comments/:commentId/replies', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { commentId } = request.params;
      const content = trimContent(request.body?.content);
      if (!content) return reply.code(400).send({ error: 'content erforderlich' });

      const parent = await fastify.prisma.groupFeedComment.findUnique({
        where: { id: commentId },
        select: {
          id: true,
          postId: true,
          groupId: true,
          userId: true,
          parentCommentId: true,
          deletedAt: true,
        },
      });
      if (!parent) return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      if (parent.parentCommentId) {
        return reply.code(400).send({ error: 'Antworten auf Antworten sind nicht erlaubt' });
      }
      if (parent.deletedAt) {
        return reply.code(400).send({ error: 'Auf gelöschte Kommentare kann nicht geantwortet werden' });
      }
      if (!(await ensureGroupAccess(reply, parent.groupId, userId))) return;

      if (!(await checkCommentRateLimit(parent.groupId, userId))) {
        return reply.code(429).send({
          error: 'Zu viele Kommentare in kurzer Zeit. Bitte warte kurz.',
          code: 'comment_rate_limited',
        });
      }

      const mentionUsernames = extractMentionUsernames(content);
      if (mentionUsernames.length > MAX_MENTIONS_PER_COMMENT) {
        return reply.code(400).send({
          error: `Maximal ${MAX_MENTIONS_PER_COMMENT} Erwähnungen pro Kommentar erlaubt`,
          code: 'too_many_mentions',
        });
      }

      const mentionedUserIds = await resolveMentionedGroupMembers(
        parent.groupId,
        mentionUsernames,
        userId
      );

      const created = await fastify.prisma.groupFeedComment.create({
        data: {
          postId: parent.postId,
          groupId: parent.groupId,
          userId,
          parentCommentId: parent.id,
          content,
          mentions: mentionedUserIds,
        },
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
          likes: {
            select: { userId: true },
          },
          _count: {
            select: { replies: true, historyEntries: true },
          },
        },
      });

      await Promise.all([
        emitParentCommentOwnerNotification({
          parentComment: parent,
          replierUserId: userId,
          replyContent: content,
          postId: parent.postId,
        }),
        emitMentionNotifications({
          groupId: parent.groupId,
          postId: parent.postId,
          commentContent: content,
          mentionedUserIds,
          actorUserId: userId,
        }),
      ]);

      return { comment: serializeComment(created, userId) };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Antwort konnte nicht erstellt werden' });
    }
  });

  fastify.patch('/comments/:commentId', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { commentId } = request.params;
      const content = trimContent(request.body?.content);
      if (!content) return reply.code(400).send({ error: 'content erforderlich' });

      const comment = await resolveComment(commentId);
      if (!comment) return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      if (!(await ensureGroupAccess(reply, comment.groupId, userId))) return;
      if (comment.userId !== userId) {
        return reply.code(403).send({ error: 'Du darfst nur eigene Kommentare bearbeiten' });
      }
      if (comment.deletedAt) {
        return reply.code(400).send({ error: 'Gelöschte Kommentare können nicht bearbeitet werden' });
      }

      const mentionUsernames = extractMentionUsernames(content);
      if (mentionUsernames.length > MAX_MENTIONS_PER_COMMENT) {
        return reply.code(400).send({
          error: `Maximal ${MAX_MENTIONS_PER_COMMENT} Erwähnungen pro Kommentar erlaubt`,
          code: 'too_many_mentions',
        });
      }

      const mentionedUserIds = await resolveMentionedGroupMembers(
        comment.groupId,
        mentionUsernames,
        userId
      );

      const updated = await fastify.prisma.$transaction(async (tx) => {
        await tx.groupFeedCommentHistory.create({
          data: {
            commentId: comment.id,
            editedById: userId,
            previousContent: comment.content,
          },
        });

        return tx.groupFeedComment.update({
          where: { id: comment.id },
          data: {
            content,
            mentions: mentionedUserIds,
          },
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
            likes: {
              select: { userId: true },
            },
            _count: {
              select: { replies: true, historyEntries: true },
            },
          },
        });
      });

      await emitMentionNotifications({
        groupId: comment.groupId,
        postId: comment.postId,
        commentContent: content,
        mentionedUserIds,
        actorUserId: userId,
      });

      return { comment: serializeComment(updated, userId) };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Kommentar konnte nicht bearbeitet werden' });
    }
  });

  fastify.get('/comments/:commentId/history', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { commentId } = request.params;

      const comment = await resolveComment(commentId);
      if (!comment) return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      if (!(await ensureGroupAccess(reply, comment.groupId, userId))) return;

      const entries = await fastify.prisma.groupFeedCommentHistory.findMany({
        where: { commentId: comment.id },
        include: {
          editedBy: {
            select: {
              id: true,
              name: true,
              username: true,
              displayNameField: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        history: entries,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Historie konnte nicht geladen werden' });
    }
  });

  fastify.delete('/comments/:commentId', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { commentId } = request.params;

      const comment = await resolveComment(commentId);
      if (!comment) return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      if (!(await ensureGroupAccess(reply, comment.groupId, userId))) return;

      const isOwner = comment.userId === userId;
      const canModerate = await hasGroupAdminRights(comment.groupId, userId);
      if (!isOwner && !canModerate) {
        return reply.code(403).send({
          error: 'Du kannst nur eigene Kommentare oder als Moderator löschen',
        });
      }

      await fastify.prisma.groupFeedComment.update({
        where: { id: comment.id },
        data: {
          deletedAt: new Date(),
          deletedById: userId,
        },
      });

      return { status: 'deleted' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Kommentar konnte nicht gelöscht werden' });
    }
  });

  fastify.get('/comments/:commentId/likes', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { commentId } = request.params;

      const comment = await resolveComment(commentId);
      if (!comment) return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      if (!(await ensureGroupAccess(reply, comment.groupId, userId))) return;

      const likes = await fastify.prisma.groupFeedCommentLike.findMany({
        where: { commentId },
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

  fastify.post('/comments/:commentId/like', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { commentId } = request.params;

      const comment = await resolveComment(commentId);
      if (!comment) return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      if (!(await ensureGroupAccess(reply, comment.groupId, userId))) return;

      if (comment.deletedAt) {
        return reply.code(400).send({ error: 'Gelöschte Kommentare können nicht geliked werden' });
      }

      const existingLike = await fastify.prisma.groupFeedCommentLike.findUnique({
        where: {
          commentId_userId: {
            commentId,
            userId,
          },
        },
      });

      if (!existingLike) {
        await fastify.prisma.groupFeedCommentLike.create({
          data: {
            commentId,
            userId,
          },
        });
        scheduleCommentLikeNotification({ comment, likerUserId: userId });
      }

      const likesCount = await fastify.prisma.groupFeedCommentLike.count({
        where: { commentId },
      });

      return {
        liked: true,
        likesCount,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Like konnte nicht gesetzt werden' });
    }
  });

  fastify.delete('/comments/:commentId/like', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { commentId } = request.params;

      const comment = await resolveComment(commentId);
      if (!comment) return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      if (!(await ensureGroupAccess(reply, comment.groupId, userId))) return;

      await fastify.prisma.groupFeedCommentLike.deleteMany({
        where: {
          commentId,
          userId,
        },
      });

      cancelCommentLikeNotification(commentId, userId);

      const likesCount = await fastify.prisma.groupFeedCommentLike.count({
        where: { commentId },
      });

      return {
        liked: false,
        likesCount,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Like konnte nicht entfernt werden' });
    }
  });
}
