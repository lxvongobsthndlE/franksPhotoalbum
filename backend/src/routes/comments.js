// Comments Routes
import { createNotification } from '../utils/notifications.js';
export default async function commentsRoutes(fastify) {
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

  async function canModerateGroupContent(groupId, userId) {
    if (await isGroupOwner(groupId, userId)) return true;
    if (await isGroupDeputy(groupId, userId)) return true;
    const role = await getUserRole(userId);
    if (role === 'admin') {
      return isGroupMember(groupId, userId);
    }
    return false;
  }

  async function canAccessGroup(groupId, userId) {
    const role = await getUserRole(userId);
    if (role === 'admin') return true;
    return isGroupMember(groupId, userId);
  }

  // POST /api/comments (Neuer Kommentar, protected)
  fastify.post('/', async (request, reply) => {
    try {
      await request.jwtVerify();

      const { photoId, content } = request.body;
      if (!photoId || !content) {
        return reply.code(400).send({ error: 'photoId und content erforderlich' });
      }

      const photo = await fastify.prisma.photo.findUnique({
        where: { id: photoId },
        select: { uploaderId: true, groupId: true },
      });
      if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

      if (!(await canAccessGroup(photo.groupId, request.user.id))) {
        return reply.code(403).send({
          error: 'Du bist nicht Mitglied dieser Gruppe',
          code: 'not_group_member',
        });
      }

      const comment = await fastify.prisma.comment.create({
        data: {
          photoId,
          userId: request.user.id,
          content,
        },
        include: { user: true },
      });

      // Foto-Owner benachrichtigen (nicht sich selbst)
      if (photo && photo.uploaderId !== request.user.id) {
        const commenterName = comment.user?.name || comment.user?.username || 'Jemand';
        createNotification(fastify.prisma, {
          userId: photo.uploaderId,
          type: 'photoCommented',
          title: 'Neuer Kommentar auf dein Foto',
          body: `${commenterName}: „${content.length > 80 ? content.slice(0, 80) + '…' : content}"`,
          entityId: photoId,
          entityType: 'photo',
        }).catch(() => {});
      }

      return comment;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Kommentar konnte nicht erstellt werden' });
    }
  });

  // DELETE /api/comments/:id (protected)
  fastify.delete('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();

      const comment = await fastify.prisma.comment.findUnique({
        where: { id: request.params.id },
        include: { photo: { select: { groupId: true } } },
      });

      if (!comment) {
        return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      }

      if (!(await canAccessGroup(comment.photo.groupId, request.user.id))) {
        return reply.code(403).send({
          error: 'Du bist nicht Mitglied dieser Gruppe',
          code: 'not_group_member',
        });
      }

      if (comment.userId !== request.user.id) {
        const canModerate = await canModerateGroupContent(comment.photo.groupId, request.user.id);
        if (!canModerate) {
          return reply
            .code(403)
            .send({ error: 'Du kannst nur eigene Kommentare oder als Moderator löschen' });
        }
      }

      await fastify.prisma.comment.delete({ where: { id: request.params.id } });
      return { status: 'deleted' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Löschen fehlgeschlagen' });
    }
  });
}
