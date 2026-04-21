import { createNotification } from '../utils/notifications.js';
import { deleteGroupPhotoObjects, deleteAvatar } from '../utils/storage.js';

export default async function adminRoutes(fastify) {

  // Hilfsfunktion: prüft ob der anfragende User Admin ist
  async function requireAdmin(request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const caller = await fastify.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { role: true },
    });
    if (!caller || caller.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  }

  // GET /api/admin/users - Alle User auflisten
  fastify.get('/users', async (request, reply) => {
    const stop = await requireAdmin(request, reply);
    if (stop) return;

    const users = await fastify.prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        avatar: true,
        color: true,
        createdAt: true,
      },
    });

    return {
      users: users.map(u => ({
        ...u,
        avatar: u.avatar && !u.avatar.startsWith('/api/')
          ? `/api/auth/avatar/${u.id}`
          : u.avatar,
      })),
    };
  });

  // GET /api/admin/users/:id - Detailansicht eines Users (Statistiken, Gruppen)
  fastify.get('/users/:id', async (request, reply) => {
    const stop = await requireAdmin(request, reply);
    if (stop) return;

    const userId = request.params.id;
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        color: true,
        avatar: true,
        displayNameField: true,
        createdAt: true,
        _count: {
          select: {
            photos: true,
            comments: true,
            likes: true,
            albumContributions: true,
          },
        },
        groups: { select: { group: { select: { id: true, name: true, createdBy: true } } } },
        groupDeputies: { select: { groupId: true } },
      },
    });
    if (!user) return reply.code(404).send({ error: 'User nicht gefunden' });

    const [albumsCreated, likesReceived] = await Promise.all([
      fastify.prisma.album.count({ where: { createdBy: userId } }),
      fastify.prisma.like.count({ where: { photo: { uploaderId: userId } } }),
    ]);

    const deputyGroupIds = new Set(user.groupDeputies.map(d => d.groupId));
    const groups = user.groups.map(({ group: g }) => {
      let role = 'member';
      if (g.createdBy === userId) role = 'owner';
      else if (deputyGroupIds.has(g.id)) role = 'deputy';
      return { id: g.id, name: g.name, role };
    });

    return {
      ...user,
      avatar: user.avatar && !user.avatar.startsWith('/api/')
        ? `/api/auth/avatar/${user.id}`
        : user.avatar,
      stats: {
        photos: user._count.photos,
        comments: user._count.comments,
        likesGiven: user._count.likes,
        likesReceived,
        albums: albumsCreated,
      },
      groups,
      _count: undefined,
      groupDeputies: undefined,
    };
  });

  // DELETE /api/admin/users/:id - User löschen (inkl. Fotos, Kommentare, Gruppen-Mitgliedschaften)
  fastify.delete('/users/:id', async (request, reply) => {
    const stop = await requireAdmin(request, reply);
    if (stop) return;

    const userId = request.params.id;
    if (userId === request.user.id) {
      return reply.code(400).send({ error: 'Du kannst deinen eigenen Account nicht löschen.' });
    }

    const target = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, name: true, username: true },
    });
    if (!target) return reply.code(404).send({ error: 'User nicht gefunden' });

    if (target.role === 'admin') {
      const adminCount = await fastify.prisma.user.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        return reply.code(409).send({ error: 'Letzter Admin kann nicht gelöscht werden.' });
      }
    }

    // Fotos des Users laden (für MinIO-Cleanup)
    const photos = await fastify.prisma.photo.findMany({
      where: { uploaderId: userId },
      select: { id: true, path: true },
    });
    const photoIds = photos.map(p => p.id);

    // DB-Einträge in korrekter Reihenfolge löschen
    if (photoIds.length > 0) {
      await fastify.prisma.like.deleteMany({ where: { photoId: { in: photoIds } } });
      await fastify.prisma.comment.deleteMany({ where: { photoId: { in: photoIds } } });
      await fastify.prisma.photoAlbum.deleteMany({ where: { photoId: { in: photoIds } } });
    }
    await fastify.prisma.like.deleteMany({ where: { userId } });
    await fastify.prisma.comment.deleteMany({ where: { userId } });
    await fastify.prisma.photo.deleteMany({ where: { uploaderId: userId } });
    await fastify.prisma.albumContributor.deleteMany({ where: { userId } });
    await fastify.prisma.album.deleteMany({ where: { createdBy: userId } });
    await fastify.prisma.groupDeputy.deleteMany({ where: { userId } });
    await fastify.prisma.groupMember.deleteMany({ where: { userId } });
    await fastify.prisma.group.updateMany({ where: { createdBy: userId }, data: { createdBy: null } });
    await fastify.prisma.notificationPreference.deleteMany({ where: { userId } });
    await fastify.prisma.user.delete({ where: { id: userId } });

    // MinIO-Cleanup (fire-and-forget)
    deleteGroupPhotoObjects(photos.map(p => p.path).filter(Boolean)).catch(() => {});
    deleteAvatar(userId).catch(() => {});

    return { ok: true };
  });

  // POST /api/admin/users/:id/notify - Gezielte Benachrichtigung an einzelnen User
  fastify.post('/users/:id/notify', async (request, reply) => {
    const stop = await requireAdmin(request, reply);
    if (stop) return;

    const { title, body, entityUrl } = request.body || {};
    if (!title || typeof title !== 'string' || title.trim().length < 1) {
      return reply.code(400).send({ error: 'title erforderlich' });
    }
    const userId = request.params.id;
    const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return reply.code(404).send({ error: 'User nicht gefunden' });

    await createNotification(fastify.prisma, {
      userId,
      type: 'system',
      title: title.trim(),
      body: (body || '').trim() || undefined,
      entityUrl: entityUrl ? String(entityUrl).trim() : undefined,
    });

    return { ok: true };
  });

  // POST /api/admin/broadcast - System-Benachrichtigung an alle User
  fastify.post('/broadcast', async (request, reply) => {
    const stop = await requireAdmin(request, reply);
    if (stop) return;

    const { title, body, imageUrl, entityUrl } = request.body || {};
    if (!title || typeof title !== 'string' || title.trim().length < 1) {
      return reply.code(400).send({ error: 'title erforderlich' });
    }

    const users = await fastify.prisma.user.findMany({ select: { id: true } });
    // System-Benachrichtigungen direkt erstellen (kein Prefs-Check, immer liefern)
    const uniqueIds = [...new Set(users.map(u => u.id))];
    for (const userId of uniqueIds) {
      try {
        await createNotification(fastify.prisma, {
          userId,
          type: 'system',
          title: title.trim(),
          body: (body || '').trim() || undefined,
          imageUrl: imageUrl ? String(imageUrl).trim() : undefined,
          entityUrl: entityUrl ? String(entityUrl).trim() : undefined,
        });
      } catch(e) {
        fastify.log.warn(`Broadcast an ${userId} fehlgeschlagen: ${e.message}`);
      }
    }

    return { sent: uniqueIds.length };
  });

  // PATCH /api/admin/users/:id/role - Rolle eines Users ändern
  fastify.patch('/users/:id/role', async (request, reply) => {
    const stop = await requireAdmin(request, reply);
    if (stop) return;

    const { role } = request.body;
    if (!['user', 'admin'].includes(role)) {
      return reply.code(400).send({ error: 'Ungültige Rolle. Erlaubt: user, admin' });
    }

    // Schutz: letzter Admin kann sich nicht selbst degradieren
    if (request.params.id === request.user.id && role !== 'admin') {
      const adminCount = await fastify.prisma.user.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        return reply.code(409).send({ error: 'Du bist der letzte Admin und kannst dich nicht selbst degradieren.' });
      }
    }

    const updated = await fastify.prisma.user.update({
      where: { id: request.params.id },
      data: { role },
      select: { id: true, name: true, role: true },
    });

    return { ok: true, user: updated };
  });
}
