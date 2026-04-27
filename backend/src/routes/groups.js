// Groups Routes
import { createGroupBackupZip, deleteGroupPhotoObjects, deleteBackupObject, getBackupStream, getBackupStat } from '../utils/storage.js';
import { createNotification } from '../utils/notifications.js';

export default async function groupsRoutes(fastify) {
  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function parseMaxMembers(rawValue) {
    if (rawValue === null) return { value: null };
    if (typeof rawValue !== 'number' || !Number.isInteger(rawValue)) {
      return { error: 'maxMembers muss eine ganze Zahl oder null sein' };
    }
    return { value: rawValue };
  }

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
            createdBy: userId,
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
            select: { id: true, name: true, username: true, color: true, avatar: true, displayNameField: true },
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

      if (group.maxMembers !== null) {
        const memberCount = await fastify.prisma.groupMember.count({ where: { groupId: group.id } });
        if (memberCount >= group.maxMembers) {
          return reply.code(409).send({ error: `Diese Gruppe ist voll (${memberCount}/${group.maxMembers})` });
        }
      }

      await fastify.prisma.groupMember.create({
        data: { userId: request.user.id, groupId: group.id },
      });

      // Erster Beitretender wird automatisch Owner, falls noch keiner gesetzt
      if (!group.createdBy) {
        await fastify.prisma.group.update({
          where: { id: group.id },
          data: { createdBy: request.user.id },
        });
      }

      // Notification an Gruppen-Owner
      const ownerId = group.createdBy;
      if (ownerId && ownerId !== request.user.id) {
        const joiner = await fastify.prisma.user.findUnique({ where: { id: request.user.id }, select: { name: true, username: true } });
        const joinerName = joiner?.name || joiner?.username || 'Jemand';
        createNotification(fastify.prisma, {
          userId: ownerId, type: 'groupMemberJoined',
          title: `Neues Mitglied in „${group.name}"`,
          body: `${joinerName} ist der Gruppe beigetreten.`,
          entityId: group.id, entityType: 'group',
        }).catch(() => {});
      }

      return { group };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Beitritt fehlgeschlagen' });
    }
  });

  // PATCH /api/groups/:id - Gruppe umbenennen (nur Owner)
  fastify.patch('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const groupId = request.params.id;
      const { name } = request.body;
      if (!name?.trim()) return reply.code(400).send({ error: 'Name erforderlich' });

      const group = await fastify.prisma.group.findUnique({ where: { id: groupId }, select: { createdBy: true } });
      if (!group) return reply.code(404).send({ error: 'Gruppe nicht gefunden' });

      const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (group.createdBy !== userId && user?.role !== 'admin') {
        return reply.code(403).send({ error: 'Nur der Owner kann die Gruppe umbenennen' });
      }

      const updated = await fastify.prisma.group.update({
        where: { id: groupId },
        data: { name: name.trim() },
      });
      return { group: updated };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Umbenennen fehlgeschlagen' });
    }
  });

  // PATCH /api/groups/:id/settings - Gruppeneinstellungen (Owner/Admin)
  fastify.patch('/:id/settings', async (request, reply) => {
    try {
      await request.jwtVerify();
      const groupId = request.params.id;
      const userId = request.user.id;
      const body = request.body || {};
      const hasInviteCodeVisibility = hasOwn(body, 'inviteCodeVisibleToMembers');
      const hasMaxMembers = hasOwn(body, 'maxMembers');

      if (!hasInviteCodeVisibility && !hasMaxMembers) {
        return reply.code(400).send({ error: 'Mindestens eine Einstellung muss angegeben werden' });
      }

      if (hasInviteCodeVisibility && typeof body.inviteCodeVisibleToMembers !== 'boolean') {
        return reply.code(400).send({ error: 'inviteCodeVisibleToMembers muss boolean sein' });
      }

      const group = await fastify.prisma.group.findUnique({
        where: { id: groupId },
        select: { id: true, createdBy: true, memberLimitLocked: true },
      });
      if (!group) return reply.code(404).send({ error: 'Gruppe nicht gefunden' });

      const requester = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (group.createdBy !== userId && requester?.role !== 'admin') {
        return reply.code(403).send({ error: 'Nur der Owner kann diese Einstellung ändern' });
      }

      const isAdmin = requester?.role === 'admin';
      const data = {};

      if (hasInviteCodeVisibility) {
        data.inviteCodeVisibleToMembers = body.inviteCodeVisibleToMembers;
      }

      if (hasMaxMembers) {
        if (group.memberLimitLocked && !isAdmin) {
          return reply.code(403).send({ error: 'Das Mitgliederlimit wurde von einem Admin gesperrt' });
        }

        const parsedMaxMembers = parseMaxMembers(body.maxMembers);
        if (parsedMaxMembers.error) {
          return reply.code(400).send({ error: parsedMaxMembers.error });
        }

        const maxMembers = parsedMaxMembers.value;
        if (maxMembers !== null) {
          if (maxMembers > 50) {
            return reply.code(400).send({ error: 'maxMembers darf maximal 50 sein' });
          }

          const memberCount = await fastify.prisma.groupMember.count({ where: { groupId } });
          if (maxMembers < memberCount) {
            return reply.code(400).send({ error: `maxMembers muss mindestens ${memberCount} sein` });
          }
        }

        data.maxMembers = maxMembers;
      }

      const updated = await fastify.prisma.group.update({
        where: { id: groupId },
        data,
      });

      return { group: updated };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Einstellung speichern fehlgeschlagen' });
    }
  });

  // POST /api/groups/:id/code/rotate - Einladungscode neu generieren (Owner/Admin)
  fastify.post('/:id/code/rotate', async (request, reply) => {
    try {
      await request.jwtVerify();
      const groupId = request.params.id;
      const userId = request.user.id;

      const group = await fastify.prisma.group.findUnique({ where: { id: groupId }, select: { id: true, createdBy: true } });
      if (!group) return reply.code(404).send({ error: 'Gruppe nicht gefunden' });

      const requester = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (group.createdBy !== userId && requester?.role !== 'admin') {
        return reply.code(403).send({ error: 'Nur der Owner kann den Einladungscode ändern' });
      }

      let nextCode = null;
      for (let i = 0; i < 10; i++) {
        const candidate = Math.random().toString(36).slice(2, 8).toUpperCase();
        const exists = await fastify.prisma.group.findUnique({ where: { code: candidate }, select: { id: true } });
        if (!exists) {
          nextCode = candidate;
          break;
        }
      }

      if (!nextCode) {
        return reply.code(500).send({ error: 'Konnte keinen eindeutigen Code erzeugen' });
      }

      const updated = await fastify.prisma.group.update({
        where: { id: groupId },
        data: { code: nextCode },
      });

      return { group: updated };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Code ändern fehlgeschlagen' });
    }
  });

  // DELETE /api/groups/:id - Gruppe löschen inkl. Backup (Owner/Admin)
  fastify.delete('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      const groupId = request.params.id;
      const userId = request.user.id;

      const group = await fastify.prisma.group.findUnique({
        where: { id: groupId },
        select: { id: true, name: true, createdBy: true },
      });
      if (!group) return reply.code(404).send({ error: 'Gruppe nicht gefunden' });

      const requester = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      const isAdmin = requester?.role === 'admin';
      const isOwner = group.createdBy === userId;
      if (!isOwner && !isAdmin) {
        return reply.code(403).send({ error: 'Nur der Gruppen-Owner kann die Gruppe löschen' });
      }

      if (isOwner) {
        const userGroupCount = await fastify.prisma.groupMember.count({ where: { userId } });
        if (userGroupCount <= 1) {
          return reply.code(409).send({ error: 'Du kannst deine letzte Gruppe nicht löschen' });
        }
      }

      const photos = await fastify.prisma.photo.findMany({
        where: { groupId },
        select: { path: true, filename: true },
      });

      const actingUser = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
      const deletedByName = actingUser?.name || actingUser?.username || null;

      let backupUrl = null;
      let linkExpiry = null;
      if (photos.length > 0) {
        const zipKey = await createGroupBackupZip(groupId, photos);
        backupUrl = `/api/groups/admin/backup/${encodeURIComponent(zipKey)}`;
        linkExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const stat = await getBackupStat(zipKey).catch(() => null);
        const sizeBytes = stat?.size ?? null;
        await fastify.prisma.groupBackup.create({
          data: {
            zipKey,
            groupId,
            groupName: group.name,
            photoCount: photos.length,
            linkExpiry,
            deletedByName,
            sizeBytes,
          },
        });
      }

      const groupMembers = await fastify.prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });

      await fastify.prisma.like.deleteMany({ where: { photo: { groupId } } });
      await fastify.prisma.comment.deleteMany({ where: { photo: { groupId } } });
      await fastify.prisma.photo.deleteMany({ where: { groupId } });
      await fastify.prisma.album.deleteMany({ where: { groupId } });
      await fastify.prisma.groupDeputy.deleteMany({ where: { groupId } });
      await fastify.prisma.groupMember.deleteMany({ where: { groupId } });
      await fastify.prisma.group.delete({ where: { id: groupId } });

      await deleteGroupPhotoObjects(photos.map(p => p.path).filter(Boolean));

      for (const { userId: memberId } of groupMembers) {
        const isGroupOwner = memberId === group.createdBy;
        const body = backupUrl && isGroupOwner
          ? 'Der Gruppen-Owner hat die Gruppe gelöscht. Deine Fotos wurden gesichert und können heruntergeladen werden.'
          : backupUrl
            ? 'Der Gruppen-Owner hat die Gruppe gelöscht. Die Fotos wurden gesichert.'
            : 'Der Gruppen-Owner hat die Gruppe gelöscht. Es waren keine Fotos vorhanden.';
        createNotification(fastify.prisma, {
          userId: memberId,
          type: 'groupDeleted',
          title: `Gruppe „${group.name}" wurde gelöscht`,
          body,
          entityType: 'group',
          entityUrl: isGroupOwner ? (backupUrl || undefined) : undefined,
        }).catch(() => {});
      }

      return {
        status: 'deleted',
        backupUrl,
        count: photos.length,
        linkExpiry,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Löschen fehlgeschlagen' });
    }
  });

  // DELETE /api/groups/:id/leave - Gruppe verlassen
  fastify.delete('/:id/leave', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const groupId = request.params.id;
      const { successorId } = request.body || {};

      // Prüfen ob Mitglied
      const membership = await fastify.prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      });
      if (!membership) return reply.code(404).send({ error: 'Nicht Mitglied dieser Gruppe' });

      // Prüfen ob letzte Gruppe
      const userGroupCount = await fastify.prisma.groupMember.count({ where: { userId } });
      if (userGroupCount <= 1) {
        return reply.code(409).send({ error: 'Du kannst deine letzte Gruppe nicht verlassen' });
      }

      // Owner-Succession: wenn User Owner ist und ein Nachfolger angegeben wurde
      const group = await fastify.prisma.group.findUnique({ where: { id: groupId } });
      if (group?.createdBy === userId) {
        if (!successorId) {
          // Prüfen wie viele andere Mitglieder es gibt
          const memberCount = await fastify.prisma.groupMember.count({ where: { groupId } });
          if (memberCount > 1) {
            return reply.code(400).send({ error: 'Als Owner musst du einen Nachfolger angeben' });
          }
          // Last member → can't leave via this endpoint, use dissolve
          return reply.code(400).send({ error: 'Du bist das letzte Mitglied. Nutze den "Gruppe auflösen"-Flow.' });
        }
        // Nachfolger muss Mitglied sein
        const successorMembership = await fastify.prisma.groupMember.findUnique({
          where: { userId_groupId: { userId: successorId, groupId } },
        });
        if (!successorMembership) return reply.code(400).send({ error: 'Nachfolger ist kein Mitglied der Gruppe' });

        // Ownership übertragen + Deputies des alten Owners entfernen
        await fastify.prisma.group.update({ where: { id: groupId }, data: { createdBy: successorId } });
        await fastify.prisma.groupDeputy.deleteMany({ where: { groupId, userId: successorId } }); // Nachfolger war evtl. Deputy
      }

      await fastify.prisma.groupMember.delete({
        where: { userId_groupId: { userId, groupId } },
      });
      // Auch als Deputy entfernen
      await fastify.prisma.groupDeputy.deleteMany({ where: { groupId, userId } });

      // Notification an Gruppen-Owner
      if (group?.createdBy && group.createdBy !== userId) {
        const leaver = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
        const leaverName = leaver?.name || leaver?.username || 'Jemand';
        createNotification(fastify.prisma, {
          userId: group.createdBy, type: 'groupMemberLeft',
          title: `Mitglied hat „${group.name}" verlassen`,
          body: `${leaverName} hat die Gruppe verlassen.`,
          entityId: groupId, entityType: 'group',
        }).catch(() => {});
      }

      return { ok: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Gruppe verlassen fehlgeschlagen' });
    }
  });

  // DELETE /api/groups/:id/dissolve - Owner (letztes Mitglied) löst Gruppe auf + Backup
  fastify.delete('/:id/dissolve', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const groupId = request.params.id;

      const group = await fastify.prisma.group.findUnique({ where: { id: groupId } });
      if (!group) return reply.code(404).send({ error: 'Gruppe nicht gefunden' });
      if (group.createdBy !== userId) return reply.code(403).send({ error: 'Nur der Gruppen-Owner kann die Gruppe auflösen' });

      const memberCount = await fastify.prisma.groupMember.count({ where: { groupId } });
      if (memberCount > 1) return reply.code(409).send({ error: 'Gruppe hat noch weitere Mitglieder' });

      // Letzte Gruppe prüfen
      const userGroupCount = await fastify.prisma.groupMember.count({ where: { userId } });
      if (userGroupCount <= 1) return reply.code(409).send({ error: 'Du kannst deine letzte Gruppe nicht auflösen' });

      // Backup erstellen
      const photos = await fastify.prisma.photo.findMany({
        where: { groupId },
        select: { path: true, filename: true },
      });
      const actingUser = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
      const deletedByName = actingUser?.name || actingUser?.username || null;
      let backupUrl = null;
      let zipKey = null;
      let photoCount = photos.length;
      if (photos.length > 0) {
        zipKey = await createGroupBackupZip(groupId, photos);
        backupUrl = `/api/groups/admin/backup/${encodeURIComponent(zipKey)}`;
        const linkExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const stat = await getBackupStat(zipKey).catch(() => null);
        const sizeBytes = stat?.size ?? null;
        await fastify.prisma.groupBackup.create({
          data: { zipKey, groupId, groupName: group.name, photoCount, linkExpiry, deletedByName, sizeBytes },
        });
      }

      // Cascade löschen
      await fastify.prisma.like.deleteMany({ where: { photo: { groupId } } });
      await fastify.prisma.comment.deleteMany({ where: { photo: { groupId } } });
      await fastify.prisma.photo.deleteMany({ where: { groupId } });
      await fastify.prisma.album.deleteMany({ where: { groupId } });
      await fastify.prisma.groupDeputy.deleteMany({ where: { groupId } });
      await fastify.prisma.groupMember.deleteMany({ where: { groupId } });
      await fastify.prisma.group.delete({ where: { id: groupId } });

      await deleteGroupPhotoObjects(photos.map(p => p.path).filter(Boolean));

      return { status: 'dissolved', backupUrl, count: photoCount, linkExpiry: photos.length > 0 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Gruppe auflösen fehlgeschlagen' });
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
      const hasMaxMembers = hasOwn(request.body || {}, 'maxMembers');
      const hasMemberLimitLocked = hasOwn(request.body || {}, 'memberLimitLocked');
      if (!name || !code) return reply.code(400).send({ error: 'name und code erforderlich' });
      const existing = await fastify.prisma.group.findUnique({ where: { code: code.toUpperCase() } });
      if (existing) return reply.code(409).send({ error: 'Code bereits vergeben' });

      let maxMembers = null;
      if (hasMaxMembers) {
        const parsedMaxMembers = parseMaxMembers(request.body.maxMembers);
        if (parsedMaxMembers.error) return reply.code(400).send({ error: parsedMaxMembers.error });
        maxMembers = parsedMaxMembers.value;
        if (maxMembers !== null && (maxMembers < 1 || maxMembers > 50)) {
          return reply.code(400).send({ error: 'maxMembers muss zwischen 1 und 50 liegen oder null sein' });
        }
      }

      let memberLimitLocked = false;
      if (hasMemberLimitLocked) {
        if (typeof request.body.memberLimitLocked !== 'boolean') {
          return reply.code(400).send({ error: 'memberLimitLocked muss boolean sein' });
        }
        memberLimitLocked = request.body.memberLimitLocked;
      }

      const group = await fastify.prisma.group.create({
        data: {
          name,
          code: code.toUpperCase(),
          createdBy: null,
          maxMembers,
          memberLimitLocked,
        }
      });
      return group;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Erstellen fehlgeschlagen' });
    }
  });

  // GET /api/groups/admin/:id/stranded-members - User ohne andere Gruppe
  fastify.get('/admin/:id/stranded-members', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const members = await fastify.prisma.groupMember.findMany({
        where: { groupId: request.params.id },
        select: { userId: true, user: { select: { id: true, name: true, username: true } } },
      });
      const userIds = members.map(m => m.userId);
      const counts = await fastify.prisma.groupMember.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _count: { groupId: true },
      });
      const strandedIds = new Set(counts.filter(r => r._count.groupId <= 1).map(r => r.userId));
      const stranded = members
        .filter(m => strandedIds.has(m.userId))
        .map(m => ({ id: m.userId, name: m.user.name || m.user.username }));
      return { stranded };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler' });
    }
  });

  // PATCH /api/groups/admin/:id - Gruppe bearbeiten (Admin)
  fastify.patch('/admin/:id', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const { name, code } = request.body;
      const hasMaxMembers = hasOwn(request.body || {}, 'maxMembers');
      const hasMemberLimitLocked = hasOwn(request.body || {}, 'memberLimitLocked');

      if (!name && !code && !hasMaxMembers && !hasMemberLimitLocked) {
        return reply.code(400).send({ error: 'name, code, maxMembers oder memberLimitLocked erforderlich' });
      }

      if (code) {
        const existing = await fastify.prisma.group.findFirst({
          where: { code: code.toUpperCase(), NOT: { id: request.params.id } }
        });
        if (existing) return reply.code(409).send({ error: 'Code bereits vergeben' });
      }

      const data = {};
      if (name) data.name = name;
      if (code) data.code = code.toUpperCase();

      if (hasMaxMembers) {
        const parsedMaxMembers = parseMaxMembers(request.body.maxMembers);
        if (parsedMaxMembers.error) return reply.code(400).send({ error: parsedMaxMembers.error });

        const maxMembers = parsedMaxMembers.value;
        if (maxMembers !== null) {
          if (maxMembers > 50) {
            return reply.code(400).send({ error: 'maxMembers darf maximal 50 sein' });
          }

          const memberCount = await fastify.prisma.groupMember.count({ where: { groupId: request.params.id } });
          if (maxMembers < memberCount) {
            return reply.code(400).send({ error: `maxMembers muss mindestens ${memberCount} sein` });
          }
        }

        data.maxMembers = maxMembers;
      }

      if (hasMemberLimitLocked) {
        if (typeof request.body.memberLimitLocked !== 'boolean') {
          return reply.code(400).send({ error: 'memberLimitLocked muss boolean sein' });
        }
        data.memberLimitLocked = request.body.memberLimitLocked;
      }

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
      const group = await fastify.prisma.group.findUnique({ where: { id: request.params.id }, select: { name: true } });
      const photos = await fastify.prisma.photo.findMany({
        where: { groupId: request.params.id },
        select: { path: true, filename: true },
      });
      if (!photos.length) return { backupUrl: null, count: 0 };
      const adminUser = await fastify.prisma.user.findUnique({ where: { id: request.user.id }, select: { name: true, username: true } });
      const deletedByName = adminUser?.name || adminUser?.username || null;
      const zipKey = await createGroupBackupZip(request.params.id, photos);
      const backupUrl = `/api/groups/admin/backup/${encodeURIComponent(zipKey)}`;
      const linkExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const stat = await getBackupStat(zipKey).catch(() => null);
      const sizeBytes = stat?.size ?? null;
      await fastify.prisma.groupBackup.create({
        data: { zipKey, groupId: request.params.id, groupName: group?.name || '?', photoCount: photos.length, linkExpiry, deletedByName, sizeBytes },
      });
      return { backupUrl, count: photos.length, linkExpiry };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Backup fehlgeschlagen' });
    }
  });

  // GET /api/groups/admin/backup/:zipKey - ZIP-Datei streamen (proxy zu MinIO)
  // Öffentlich — kein Auth nötig. Der zipKey selbst ist das Geheimnis (unguessable ID).
  fastify.get('/admin/backup/:zipKey', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    try {
      const zipKey = decodeURIComponent(request.params.zipKey);
      const record = await fastify.prisma.groupBackup.findUnique({ where: { zipKey } });
      if (!record) return reply.code(404).send({ error: 'Backup nicht gefunden' });
      if (record.linkExpiry < new Date()) {
        return reply.code(410).send({ error: 'Dieser Download-Link ist abgelaufen.' });
      }
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

  // GET /api/groups/admin/backups - Alle Backups auflisten
  fastify.get('/admin/backups', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const backups = await fastify.prisma.groupBackup.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return { backups: backups.map(b => ({
        ...b,
        sizeBytes: b.sizeBytes ? Number(b.sizeBytes) : null,
        downloadUrl: `/api/groups/admin/backup/${encodeURIComponent(b.zipKey)}`,
        expired: b.linkExpiry < new Date(),
      })) };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Laden der Backups' });
    }
  });

  // POST /api/groups/admin/backups/:zipKey/refresh - Link verlängern (+30 Tage)
  fastify.post('/admin/backups/:zipKey/refresh', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const zipKey = decodeURIComponent(request.params.zipKey);
      const linkExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const record = await fastify.prisma.groupBackup.update({ where: { zipKey }, data: { linkExpiry } });
      return { linkExpiry: record.linkExpiry };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(404).send({ error: 'Backup nicht gefunden' });
    }
  });

  // DELETE /api/groups/admin/backups/:zipKey - Backup final löschen (MinIO + DB)
  fastify.delete('/admin/backups/:zipKey', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const zipKey = decodeURIComponent(request.params.zipKey);
      await deleteBackupObject(zipKey);
      await fastify.prisma.groupBackup.delete({ where: { zipKey } });
      return { status: 'deleted' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Löschen fehlgeschlagen' });
    }
  });

  // DELETE /api/groups/admin/:id - Gruppe löschen (Admin)
  fastify.delete('/admin/:id', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const group = await fastify.prisma.group.findUnique({ where: { id: request.params.id }, select: { name: true, createdBy: true } });
      // Fotos vor dem Löschen laden (für ZIP + MinIO-Cleanup)
      const photos = await fastify.prisma.photo.findMany({
        where: { groupId: request.params.id },
        select: { path: true, filename: true },
      });

      // ZIP-Backup in MinIO erstellen + DB-Record speichern
      const adminUser = await fastify.prisma.user.findUnique({ where: { id: request.user.id }, select: { name: true, username: true } });
      const deletedByName = adminUser?.name || adminUser?.username || null;
      let backupUrl = null;
      if (photos.length > 0) {
        const zipKey = await createGroupBackupZip(request.params.id, photos);
        backupUrl = `/api/groups/admin/backup/${encodeURIComponent(zipKey)}`;
        const linkExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const stat = await getBackupStat(zipKey).catch(() => null);
        const sizeBytes = stat?.size ?? null;
        await fastify.prisma.groupBackup.create({
          data: { zipKey, groupId: request.params.id, groupName: group?.name || '?', photoCount: photos.length, linkExpiry, deletedByName, sizeBytes },
        });
      }

      // Mitglieder-Liste vor dem Löschen für Notifications holen
      const groupMembers = await fastify.prisma.groupMember.findMany({
        where: { groupId: request.params.id },
        select: { userId: true },
      });

      // Cascade: DB-Einträge löschen
      await fastify.prisma.like.deleteMany({ where: { photo: { groupId: request.params.id } } });
      await fastify.prisma.comment.deleteMany({ where: { photo: { groupId: request.params.id } } });
      await fastify.prisma.photo.deleteMany({ where: { groupId: request.params.id } });
      await fastify.prisma.album.deleteMany({ where: { groupId: request.params.id } });
      await fastify.prisma.groupDeputy.deleteMany({ where: { groupId: request.params.id } });
      await fastify.prisma.groupMember.deleteMany({ where: { groupId: request.params.id } });
      await fastify.prisma.group.deleteMany({ where: { id: request.params.id } });

      // MinIO-Foto-Objekte bereinigen
      await deleteGroupPhotoObjects(photos.map(p => p.path).filter(Boolean));

      // Notifications an alle Mitglieder (fire-and-forget)
      const groupNameStr = group?.name || '?';
      const ownerId = group?.createdBy || null;
      for (const { userId } of groupMembers) {
        const isOwner = userId === ownerId;
        const notifBody = backupUrl && isOwner
          ? `Ein Administrator hat die Gruppe gelöscht. Deine Fotos wurden gesichert und können heruntergeladen werden.`
          : backupUrl
            ? `Ein Administrator hat die Gruppe gelöscht. Die Fotos wurden gesichert.`
            : `Ein Administrator hat die Gruppe gelöscht. Es waren keine Fotos vorhanden.`;
        createNotification(fastify.prisma, {
          userId, type: 'groupDeleted',
          title: `Gruppe „${groupNameStr}" wurde gelöscht`,
          body: notifBody,
          entityType: 'group',
          entityUrl: isOwner ? (backupUrl || undefined) : undefined,
        }).catch(() => {});
      }

      return { status: 'deleted', backupUrl, count: photos.length, linkExpiry: photos.length > 0 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Löschen fehlgeschlagen' });
    }
  });

  // ── DEPUTY MANAGEMENT ─────────────────────────────────────

  // GET /api/groups/:id/deputies - Vertreter auflisten (Mitglieder der Gruppe)
  fastify.get('/:id/deputies', async (request, reply) => {
    try {
      await request.jwtVerify();

      const deputies = await fastify.prisma.groupDeputy.findMany({
        where: { groupId: request.params.id },
        include: {
          user: { select: { id: true, name: true, username: true, color: true, avatar: true } },
        },
      });

      return {
        deputies: deputies.map(d => ({
          ...d.user,
          avatar: d.user.avatar && !d.user.avatar.startsWith('/api/')
            ? `/api/auth/avatar/${d.user.id}`
            : d.user.avatar,
        })),
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Laden der Vertreter' });
    }
  });

  // POST /api/groups/:id/deputies - Vertreter hinzufügen (nur Gruppen-Owner)
  fastify.post('/:id/deputies', async (request, reply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.body;
      if (!userId) return reply.code(400).send({ error: 'userId erforderlich' });

      const group = await fastify.prisma.group.findUnique({ where: { id: request.params.id } });
      if (!group) return reply.code(404).send({ error: 'Gruppe nicht gefunden' });

      const requester = await fastify.prisma.user.findUnique({ where: { id: request.user.id }, select: { role: true } });
      const isAdmin = requester?.role === 'admin';
      if (group.createdBy !== request.user.id && !isAdmin) {
        return reply.code(403).send({ error: 'Nur der Gruppen-Owner kann Vertreter ernennen' });
      }

      if (userId === group.createdBy) {
        return reply.code(400).send({ error: 'Der Gruppen-Owner ist bereits berechtigt' });
      }

      const membership = await fastify.prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId: request.params.id } },
      });
      if (!membership) return reply.code(400).send({ error: 'User ist kein Mitglied dieser Gruppe' });

      await fastify.prisma.groupDeputy.upsert({
        where: { groupId_userId: { groupId: request.params.id, userId } },
        create: { groupId: request.params.id, userId },
        update: {},
      });

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, username: true, color: true, avatar: true },
      });

      // Notification an ernannten Deputy
      createNotification(fastify.prisma, {
        userId, type: 'deputyAdded',
        title: `Du bist jetzt Vertreter in „${group.name}"`,
        body: `Du wurdest als Vertreter ernannt und hast erweiterte Rechte in dieser Gruppe.`,
        entityId: group.id, entityType: 'group',
      }).catch(() => {});

      return {
        ...user,
        avatar: user.avatar && !user.avatar.startsWith('/api/') ? `/api/auth/avatar/${user.id}` : user.avatar,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Vertreter hinzufügen fehlgeschlagen' });
    }
  });

  // DELETE /api/groups/:id/deputies/:userId - Vertreter entfernen (nur Gruppen-Owner)
  fastify.delete('/:id/deputies/:userId', async (request, reply) => {
    try {
      await request.jwtVerify();

      const group = await fastify.prisma.group.findUnique({ where: { id: request.params.id } });
      if (!group) return reply.code(404).send({ error: 'Gruppe nicht gefunden' });

      const requester = await fastify.prisma.user.findUnique({ where: { id: request.user.id }, select: { role: true } });
      const isAdmin = requester?.role === 'admin';
      if (group.createdBy !== request.user.id && !isAdmin) {
        return reply.code(403).send({ error: 'Nur der Gruppen-Owner kann Vertreter entfernen' });
      }

      await fastify.prisma.groupDeputy.deleteMany({
        where: { groupId: request.params.id, userId: request.params.userId },
      });

      // Notification an entfernten Deputy
      createNotification(fastify.prisma, {
        userId: request.params.userId, type: 'deputyRemoved',
        title: `Vertreter-Rolle in „${group.name}" entzogen`,
        body: `Du bist nicht mehr Vertreter dieser Gruppe.`,
        entityId: group.id, entityType: 'group',
      }).catch(() => {});

      return { status: 'removed' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Vertreter entfernen fehlgeschlagen' });
    }
  });
}
