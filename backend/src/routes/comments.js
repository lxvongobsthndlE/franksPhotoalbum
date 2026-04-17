// Comments Routes
export default async function commentsRoutes(fastify) {
  // POST /api/comments (Neuer Kommentar, protected)
  fastify.post('/', async (request, reply) => {
    try {
      await request.jwtVerify();
      
      const { photoId, content } = request.body;
      if (!photoId || !content) {
        return reply.code(400).send({ error: 'photoId und content erforderlich' });
      }
      
      const comment = await fastify.prisma.comment.create({
        data: {
          photoId,
          userId: request.user.id,
          content
        },
        include: { user: true }
      });
      
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
        where: { id: request.params.id }
      });
      
      if (!comment) {
        return reply.code(404).send({ error: 'Kommentar nicht gefunden' });
      }

      if (comment.userId !== request.user.id) {
        const caller = await fastify.prisma.user.findUnique({ where: { id: request.user.id } });
        if (!caller || caller.role !== 'admin') {
          return reply.code(403).send({ error: 'Du kannst nur deine eigenen Kommentare löschen' });
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
