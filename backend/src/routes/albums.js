// Albums Routes: GET, POST, PATCH, DELETE /api/albums
export default async function albumsRoutes(fastify) {
  // GET /api/albums - Liste Alben für eine Gruppe
  fastify.get('/', async (request, reply) => {
    try {
      const { groupId } = request.query;
      
      if (!groupId) {
        return reply.code(400).send({ error: 'groupId erforderlich' });
      }
      
      const albums = await fastify.prisma.album.findMany({
        where: { groupId },
        orderBy: { createdAt: 'asc' },
        include: { 
          _count: { select: { photos: true } }
        }
      });
      
      return { albums };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Abrufen von Alben' });
    }
  });

  // POST /api/albums (Neues Album, protected)
  fastify.post('/', async (request, reply) => {
    try {
      await request.jwtVerify();
      
      const { name, groupId } = request.body;
      
      if (!name || !groupId) {
        return reply.code(400).send({ error: 'name und groupId erforderlich' });
      }
      
      const album = await fastify.prisma.album.create({
        data: {
          name,
          groupId,
          createdBy: request.user.id
        }
      });
      
      return album;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Album-Erstellung fehlgeschlagen' });
    }
  });

  // PATCH /api/albums/:id (Album umbenennen, protected)
  fastify.patch('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      
      const { name } = request.body;
      
      if (!name) {
        return reply.code(400).send({ error: 'name erforderlich' });
      }
      
      const album = await fastify.prisma.album.findUnique({
        where: { id: request.params.id }
      });
      
      if (!album) {
        return reply.code(404).send({ error: 'Album nicht gefunden' });
      }
      
      // Nur Creator kann umbenennen
      if (album.createdBy !== request.user.id) {
        return reply.code(403).send({ error: 'Du kannst nur deine eigenen Alben umbenennen' });
      }
      
      const updated = await fastify.prisma.album.update({
        where: { id: request.params.id },
        data: { name }
      });
      
      return updated;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Umbenennung fehlgeschlagen' });
    }
  });

  // DELETE /api/albums/:id (protected)
  fastify.delete('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      
      const album = await fastify.prisma.album.findUnique({
        where: { id: request.params.id }
      });
      
      if (!album) {
        return reply.code(404).send({ error: 'Album nicht gefunden' });
      }
      
      // Nur Creator kann löschen
      if (album.createdBy !== request.user.id) {
        return reply.code(403).send({ error: 'Du kannst nur deine eigenen Alben löschen' });
      }
      
      // Entferne alle Fotos aus diesem Album (nicht löschen, nur detach)
      await fastify.prisma.photo.updateMany({
        where: { albumId: request.params.id },
        data: { albumId: null }
      });
      
      // Lösche Album
      await fastify.prisma.album.delete({ where: { id: request.params.id } });
      
      return { status: 'deleted' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Löschen fehlgeschlagen' });
    }
  });
}
