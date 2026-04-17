// Groups Routes
import { createGroupBackupZip, deleteGroupPhotoObjects, getBackupStream, getBackupStat } from '../utils/storage.js';

export default async function groupsRoutes(fastify) {
  // GET /api/groups/my - Gibt die Gruppen des eingeloggten Users zurück.
  // Falls keine existiert, wird automatisch eine erstellt.
  fastify.get('/my', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;

      let memberships = await fastify.prisma.groupMember.findMany({
        where: { userId },
        include: { group: true },
      });

      // Auto-create default group on first login
      if (memberships.length === 0) {
        const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
        const groupName = `${user?.name || user?.username || 'Mein'} Fotoalbum`;
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();

        const group = await fastify.prisma.group.create({
          data: {
            name: groupName,
            code,
            members: { create: { userId } },
          },
        });

        return { groups: [group] };
      }

      return { groups: memberships.map(m => m.group) };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Laden der Gruppen' });
    }
  });

  // GET /api/groups/:id/members - Mitglieder einer Gruppe
  fastify.get('/:id/members', async (request, reply) => {
    try {
      await request.jwtVerify();

      const members = await fastify.prisma.groupMember.findMany({
        where: { groupId: request.params.id },
        include: {
          user: {
            select: { id: true, name: true, username: true, color: true, avatar: true },
          },
        },
      });

      return { members: members.map(m => ({
        ...m.user,
        avatar: m.user.avatar && !m.user.avatar.startsWith('/api/')
          ? `/api/auth/avatar/${m.user.id}`
          : m.user.avatar,
      })) };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Laden der Mitglieder' });
    }
  });

  // POST /api/groups/join - Gruppe per Code beitreten
  fastify.post('/join', async (request, reply) => {
    try {
      await request.jwtVerify();
      const { code } = request.body;
      if (!code) return reply.code(400).send({ error: 'code erforderlich' });

      const group = await fastify.prisma.group.findUnique({ where: { code: code.toUpperCase() } });
      if (!group) return reply.code(404).send({ error: 'Gruppe nicht gefunden' });

      const existing = await fastify.prisma.groupMember.findUnique({
        where: { userId_groupId: { userId: request.user.id, groupId: group.id } },
      });
      if (existing) return reply.code(409).send({ error: 'Bereits Mitglied' });

      await fastify.prisma.groupMember.create({
        data: { userId: request.user.id, groupId: group.id },
      });

      return { group };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Beitritt fehlgeschlagen' });
    }
  });

  // DELETE /api/groups/:id/leave - Gruppe verlassen
  fastify.delete('/:id/leave', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const groupId = request.params.id;

      // Prüfen ob Mitglied
      const membership = await fastify.prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      });
      if (!membership) return reply.code(404).send({ error: 'Nicht Mitglied dieser Gruppe' });

      // Prüfen ob letzte Gruppe
      const memberCount = await fastify.prisma.groupMember.count({ where: { userId } });
      if (memberCount <= 1) {
        return reply.code(409).send({ error: 'Du kannst deine letzte Gruppe nicht verlassen' });
      }

      await fastify.prisma.groupMember.delete({
        where: { userId_groupId: { userId, groupId } },
      });

      return { ok: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Gruppe verlassen fehlgeschlagen' });
    }
  });

  // ── ADMIN ROUTES ─────────────────────────────────────

  async function requireAdmin(request, reply) {
    await request.jwtVerify();
    const user = await fastify.prisma.user.findUnique({ where: { id: request.user.id } });
    if (!user || user.role !== 'admin') {
      reply.code(403).send({ error: 'Nur Admins' });
      return false;
    }
    return true;
  }

  // GET /api/groups/admin/all - Alle Gruppen (Admin)
  fastify.get('/admin/all', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const groups = await fastify.prisma.group.findMany({
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { members: true, photos: true } } }
      });
      return { groups };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Laden' });
    }
  });

  // POST /api/groups/admin/create - Neue Gruppe erstellen (Admin)
  fastify.post('/admin/create', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const { name, code } = request.body;
      if (!name || !code) return reply.code(400).send({ error: 'name und code erforderlich' });
      const existing = await fastify.prisma.group.findUnique({ where: { code: code.toUpperCase() } });
      if (existing) return reply.code(409).send({ error: 'Code bereits vergeben' });
      const group = await fastify.prisma.group.create({
        data: { name, code: code.toUpperCase() }
      });
      return group;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Erstellen fehlgeschlagen' });
    }
  });

  // PATCH /api/groups/admin/:id - Gruppe bearbeiten (Admin)
  fastify.patch('/admin/:id', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const { name, code } = request.body;
      if (!name && !code) return reply.code(400).send({ error: 'name oder code erforderlich' });
      if (code) {
        const existing = await fastify.prisma.group.findFirst({
          where: { code: code.toUpperCase(), NOT: { id: request.params.id } }
        });
        if (existing) return reply.code(409).send({ error: 'Code bereits vergeben' });
      }
      const data = {};
      if (name) data.name = name;
      if (code) data.code = code.toUpperCase();
      const group = await fastify.prisma.group.update({ where: { id: request.params.id }, data });
      return group;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Bearbeiten fehlgeschlagen' });
    }
  });

  // POST /api/groups/admin/:id/backup - ZIP-Backup erstellen ohne Gruppe zu löschen
  fastify.post('/admin/:id/backup', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const photos = await fastify.prisma.photo.findMany({
        where: { groupId: request.params.id },
        select: { path: true, filename: true },
      });
      if (!photos.length) return { backupUrl: null, count: 0 };
      const zipKey = await createGroupBackupZip(request.params.id, photos);
      const backupUrl = `/api/groups/admin/backup/${encodeURIComponent(zipKey)}`;
      return { backupUrl, count: photos.length };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Backup fehlgeschlagen' });
    }
  });

  // GET /api/groups/admin/backup/:zipKey - ZIP-Datei streamen (proxy zu MinIO)
  fastify.get('/admin/backup/:zipKey', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const zipKey = decodeURIComponent(request.params.zipKey);
      const stat = await getBackupStat(zipKey);
      const stream = await getBackupStream(zipKey);
      reply
        .header('Content-Type', 'application/zip')
        .header('Content-Length', stat.size)
        .header('Content-Disposition', `attachment; filename="${zipKey}"`)
        .header('Cache-Control', 'private, no-store');
      return reply.send(stream);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(404).send({ error: 'Backup nicht gefunden' });
    }
  });

  // DELETE /api/groups/admin/:id - Gruppe löschen (Admin)
  fastify.delete('/admin/:id', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      // Fotos vor dem Löschen laden (für ZIP + MinIO-Cleanup)
      const photos = await fastify.prisma.photo.findMany({
        where: { groupId: request.params.id },
        select: { path: true, filename: true },
      });

      // ZIP-Backup in MinIO erstellen
      let backupUrl = null;
      if (photos.length > 0) {
        const zipKey = await createGroupBackupZip(request.params.id, photos);
        backupUrl = `/api/groups/admin/backup/${encodeURIComponent(zipKey)}`;
      }

      // Cascade: DB-Einträge löschen
      await fastify.prisma.like.deleteMany({ where: { photo: { groupId: request.params.id } } });
      await fastify.prisma.comment.deleteMany({ where: { photo: { groupId: request.params.id } } });
      await fastify.prisma.photo.deleteMany({ where: { groupId: request.params.id } });
      await fastify.prisma.album.deleteMany({ where: { groupId: request.params.id } });
      await fastify.prisma.groupMember.deleteMany({ where: { groupId: request.params.id } });
      await fastify.prisma.group.delete({ where: { id: request.params.id } });

      // MinIO-Foto-Objekte bereinigen
      await deleteGroupPhotoObjects(photos.map(p => p.path).filter(Boolean));

      return { status: 'deleted', backupUrl, count: photos.length };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Löschen fehlgeschlagen' });
    }
  });
}
