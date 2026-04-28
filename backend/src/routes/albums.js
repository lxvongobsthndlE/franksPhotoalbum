// Albums Routes: GET, POST, PATCH, DELETE /api/albums
import { createNotification } from '../utils/notifications.js';
export default async function albumsRoutes(fastify) {
  // Helper: prüft ob User Admin ist
  async function isAdmin(userId) {
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role === 'admin';
  }

  // Helper: prüft ob User Gruppen-Ersteller ist (oder Admin)
  async function isGroupOwner(groupId, userId) {
    if (await isAdmin(userId)) return true;
    const group = await fastify.prisma.group.findUnique({
      where: { id: groupId },
      select: { createdBy: true },
    });
    return group?.createdBy === userId;
  }

  // Helper: prüft ob User Gruppen-Vertreter ist
  async function isGroupDeputy(groupId, userId) {
    const deputy = await fastify.prisma.groupDeputy.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    return !!deputy;
  }

  // Helper: volle Gruppen-Admin-Rechte (Owner, Deputy oder App-Admin)
  async function hasGroupAdminRights(groupId, userId) {
    return (await isGroupOwner(groupId, userId)) || (await isGroupDeputy(groupId, userId));
  }

  // GET /api/albums - Liste Alben für eine Gruppe (inkl. contributors)
  fastify.get('/', async (request, reply) => {
    try {
      const { groupId } = request.query;
      if (!groupId) return reply.code(400).send({ error: 'groupId erforderlich' });

      const albums = await fastify.prisma.album.findMany({
        where: { groupId },
        orderBy: { createdAt: 'asc' },
        include: {
          _count: { select: { photos: true } },
          contributors: {
            include: {
              user: { select: { id: true, name: true, username: true, color: true, avatar: true } },
            },
          },
        },
      });

      const result = albums.map((a) => ({
        ...a,
        contributors: a.contributors.map((c) => ({
          ...c.user,
          avatar:
            c.user.avatar && !c.user.avatar.startsWith('/api/')
              ? `/api/auth/avatar/${c.user.id}`
              : c.user.avatar,
        })),
      }));

      return { albums: result };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Abrufen von Alben' });
    }
  });

  // POST /api/albums - Neues Album erstellen (jedes Gruppenmitglied)
  fastify.post('/', async (request, reply) => {
    try {
      await request.jwtVerify();
      const { name, groupId } = request.body;
      if (!name || !groupId)
        return reply.code(400).send({ error: 'name und groupId erforderlich' });

      const membership = await fastify.prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: request.user.id, groupId } },
      });
      if (!membership && !(await isAdmin(request.user.id))) {
        return reply.code(403).send({ error: 'Nur Gruppenmitglieder können Alben erstellen' });
      }

      const album = await fastify.prisma.album.create({
        data: { name, groupId, createdBy: request.user.id },
        include: { _count: { select: { photos: true } }, contributors: true },
      });

      // Alle Gruppenmitglieder außer dem Ersteller benachrichtigen
      const members = await fastify.prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      const group = await fastify.prisma.group.findUnique({
        where: { id: groupId },
        select: { name: true },
      });
      const creator = await fastify.prisma.user.findUnique({
        where: { id: request.user.id },
        select: { name: true, username: true },
      });
      const creatorName = creator?.name || creator?.username || 'Jemand';
      for (const { userId } of members) {
        if (userId !== request.user.id) {
          createNotification(fastify.prisma, {
            userId,
            type: 'newAlbum',
            title: `Neues Album in „${group?.name || groupId}"`,
            body: `${creatorName} hat das Album „${name}" erstellt.`,
            entityId: album.id,
            entityType: 'album',
          }).catch(() => {});
        }
      }

      return { ...album, contributors: [] };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Album-Erstellung fehlgeschlagen' });
    }
  });

  // PATCH /api/albums/:id - Album umbenennen (Creator oder Admin)
  fastify.patch('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      const { name } = request.body;
      if (!name) return reply.code(400).send({ error: 'name erforderlich' });

      const album = await fastify.prisma.album.findUnique({ where: { id: request.params.id } });
      if (!album) return reply.code(404).send({ error: 'Album nicht gefunden' });

      if (
        album.createdBy !== request.user.id &&
        !(await hasGroupAdminRights(album.groupId, request.user.id))
      ) {
        return reply.code(403).send({ error: 'Nur der Ersteller kann das Album umbenennen' });
      }

      const updated = await fastify.prisma.album.update({
        where: { id: request.params.id },
        data: { name },
      });
      return updated;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Umbenennung fehlgeschlagen' });
    }
  });

  // DELETE /api/albums/:id - Album löschen (nur Creator oder Admin)
  fastify.delete('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();

      const album = await fastify.prisma.album.findUnique({ where: { id: request.params.id } });
      if (!album) return reply.code(404).send({ error: 'Album nicht gefunden' });

      if (
        album.createdBy !== request.user.id &&
        !(await hasGroupAdminRights(album.groupId, request.user.id))
      ) {
        return reply.code(403).send({ error: 'Nur der Ersteller kann das Album löschen' });
      }

      await fastify.prisma.album.delete({ where: { id: request.params.id } });
      return { status: 'deleted' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Löschen fehlgeschlagen' });
    }
  });

  // ── CONTRIBUTOR MANAGEMENT ────────────────────────────────

  // GET /api/albums/:id/contributors
  fastify.get('/:id/contributors', async (request, reply) => {
    try {
      await request.jwtVerify();

      const album = await fastify.prisma.album.findUnique({ where: { id: request.params.id } });
      if (!album) return reply.code(404).send({ error: 'Album nicht gefunden' });

      const contributors = await fastify.prisma.albumContributor.findMany({
        where: { albumId: request.params.id },
        include: {
          user: { select: { id: true, name: true, username: true, color: true, avatar: true } },
        },
      });

      return {
        contributors: contributors.map((c) => ({
          ...c.user,
          avatar:
            c.user.avatar && !c.user.avatar.startsWith('/api/')
              ? `/api/auth/avatar/${c.user.id}`
              : c.user.avatar,
        })),
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Laden der Contributors' });
    }
  });

  // POST /api/albums/:id/contributors - Contributor hinzufügen
  // Erlaubt: Album-Creator, Gruppen-Creator, Admin
  fastify.post('/:id/contributors', async (request, reply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.body;
      if (!userId) return reply.code(400).send({ error: 'userId erforderlich' });

      const album = await fastify.prisma.album.findUnique({ where: { id: request.params.id } });
      if (!album) return reply.code(404).send({ error: 'Album nicht gefunden' });

      const canManage =
        album.createdBy === request.user.id ||
        (await hasGroupAdminRights(album.groupId, request.user.id));
      if (!canManage) return reply.code(403).send({ error: 'Keine Berechtigung' });

      const membership = await fastify.prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId: album.groupId } },
      });
      if (!membership)
        return reply.code(400).send({ error: 'User ist kein Mitglied dieser Gruppe' });

      if (userId === album.createdBy) {
        return reply.code(400).send({ error: 'Der Album-Ersteller ist bereits berechtigt' });
      }

      await fastify.prisma.albumContributor.upsert({
        where: { albumId_userId: { albumId: album.id, userId } },
        create: { albumId: album.id, userId },
        update: {},
      });

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, username: true, color: true, avatar: true },
      });

      // Notification an neuen Contributor
      createNotification(fastify.prisma, {
        userId,
        type: 'contributorAdded',
        title: `Du kannst jetzt zum Album „${album.name}" beitragen`,
        body: `Du wurdest als Contributor hinzugefügt.`,
        entityId: album.id,
        entityType: 'album',
      }).catch(() => {});

      return {
        ...user,
        avatar:
          user.avatar && !user.avatar.startsWith('/api/')
            ? `/api/auth/avatar/${user.id}`
            : user.avatar,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Contributor hinzufügen fehlgeschlagen' });
    }
  });

  // DELETE /api/albums/:id/contributors/:userId - Contributor entfernen
  // Erlaubt: Album-Creator, Gruppen-Creator, Admin
  fastify.delete('/:id/contributors/:userId', async (request, reply) => {
    try {
      await request.jwtVerify();

      const album = await fastify.prisma.album.findUnique({ where: { id: request.params.id } });
      if (!album) return reply.code(404).send({ error: 'Album nicht gefunden' });

      const canManage =
        album.createdBy === request.user.id ||
        (await hasGroupAdminRights(album.groupId, request.user.id));
      if (!canManage) return reply.code(403).send({ error: 'Keine Berechtigung' });

      await fastify.prisma.albumContributor.deleteMany({
        where: { albumId: album.id, userId: request.params.userId },
      });

      // Notification an entfernten Contributor
      createNotification(fastify.prisma, {
        userId: request.params.userId,
        type: 'contributorRemoved',
        title: `Contributor-Zugang zu „${album.name}" entzogen`,
        body: `Du kannst nicht mehr zum Album beitragen.`,
        entityId: album.id,
        entityType: 'album',
      }).catch(() => {});

      return { status: 'removed' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Contributor entfernen fehlgeschlagen' });
    }
  });
}
