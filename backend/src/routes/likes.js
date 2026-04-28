// Likes Routes
import { createNotification } from '../utils/notifications.js';
export default async function likesRoutes(fastify) {
  // POST /api/likes (Like hinzufügen, protected)
  fastify.post('/', async (request, reply) => {
    try {
      await request.jwtVerify();

      const { photoId } = request.body;
      if (!photoId) {
        return reply.code(400).send({ error: 'photoId erforderlich' });
      }

      // Prüfe, ob bereits geliked
      const existing = await fastify.prisma.like.findUnique({
        where: {
          photoId_userId: {
            photoId,
            userId: request.user.id,
          },
        },
      });

      if (existing) {
        return reply.code(409).send({ error: 'Bereits geliked' });
      }

      const like = await fastify.prisma.like.create({
        data: {
          photoId,
          userId: request.user.id,
        },
      });

      // Foto-Owner benachrichtigen (nicht sich selbst)
      const photo = await fastify.prisma.photo.findUnique({
        where: { id: photoId },
        select: { uploaderId: true },
      });
      if (photo && photo.uploaderId !== request.user.id) {
        const liker = await fastify.prisma.user.findUnique({
          where: { id: request.user.id },
          select: { name: true, username: true },
        });
        const likerName = liker?.name || liker?.username || 'Jemand';
        createNotification(fastify.prisma, {
          userId: photo.uploaderId,
          type: 'photoLiked',
          title: 'Jemand mag dein Foto',
          body: `${likerName} hat dein Foto geliked.`,
          entityId: photoId,
          entityType: 'photo',
        }).catch(() => {});
      }

      return { status: 'liked', like };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Like fehlgeschlagen' });
    }
  });

  // DELETE /api/likes/:photoId (Like entfernen, protected)
  fastify.delete('/:photoId', async (request, reply) => {
    try {
      await request.jwtVerify();

      const { photoId } = request.params;

      const like = await fastify.prisma.like.findUnique({
        where: {
          photoId_userId: {
            photoId,
            userId: request.user.id,
          },
        },
      });

      if (!like) {
        return reply.code(404).send({ error: 'Like nicht gefunden' });
      }

      await fastify.prisma.like.deleteMany({
        where: {
          photoId,
          userId: request.user.id,
        },
      });

      return { status: 'unliked' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Entfernen fehlgeschlagen' });
    }
  });
}
