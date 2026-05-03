import {
  createInviteToken,
  normalizeInviteToken,
  OWNER_PRESET_NOTIFICATION,
  isInviteExpired,
  isInviteExhausted,
  redeemInviteForUser,
} from '../utils/invites.js';

const MAX_OWNER_ACTIVE_INVITES_PER_GROUP = 10;
const MAX_INVITE_MONTHS = 12;

function toDateOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function addMonths(base, months) {
  const next = new Date(base.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildInviteUrl(request, token) {
  const host = request.headers.host;
  const proto = request.headers['x-forwarded-proto'] || request.protocol || 'http';
  if (!host) return `/?invite=${encodeURIComponent(token)}`;
  return `${proto}://${host}/?invite=${encodeURIComponent(token)}`;
}

async function getRequester(prisma, userId) {
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
}

async function assertAdminOrGroupOwner(prisma, requester, groupId) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, createdBy: true },
  });

  if (!group) {
    return { ok: false, httpCode: 404, payload: { error: 'Gruppe nicht gefunden' } };
  }

  const isAdmin = requester?.role === 'admin';
  const isOwner = group.createdBy === requester?.id;
  if (!isAdmin && !isOwner) {
    return { ok: false, httpCode: 403, payload: { error: 'Keine Berechtigung für diese Gruppe' } };
  }

  return { ok: true, group, isAdmin, isOwner };
}

export default async function invitesRoutes(fastify) {
  // GET /api/invites/preview/:token - öffentliche Invite-Vorschau
  fastify.get('/preview/:token', async (request, reply) => {
    try {
      const token = normalizeInviteToken(request.params.token);
      if (!token) {
        return reply
          .code(400)
          .send({ error: 'Einladungslink ist ungueltig.', code: 'invalid_token_format' });
      }

      const invite = await fastify.prisma.groupInvite.findUnique({
        where: { token },
        include: {
          groups: { include: { group: { select: { id: true, name: true } } } },
        },
      });

      if (!invite || !invite.isActive) {
        return reply.code(404).send({
          error: 'Dieser Einladungslink wurde deaktiviert oder existiert nicht.',
          code: 'invite_not_found',
        });
      }

      if (isInviteExpired(invite)) {
        return reply
          .code(410)
          .send({ error: 'Einladungslink ist abgelaufen.', code: 'invite_expired' });
      }

      if (isInviteExhausted(invite)) {
        return reply.code(410).send({
          error: 'Einladungslink wurde bereits vollstaendig genutzt.',
          code: 'invite_exhausted',
        });
      }

      return {
        invite: {
          token: invite.token,
          expiresAt: invite.expiresAt,
          maxUses: invite.maxUses,
          useCount: invite.useCount,
          groups: invite.groups.map((entry) => entry.group).filter(Boolean),
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Invite-Vorschau fehlgeschlagen' });
    }
  });

  // POST /api/invites - Invite erstellen
  fastify.post('/', async (request, reply) => {
    try {
      await request.jwtVerify();
      const requester = await getRequester(fastify.prisma, request.user.id);
      if (!requester) return reply.code(401).send({ error: 'Unauthorized' });

      const body = request.body || {};
      const rawGroupIds = Array.isArray(body.groupIds) ? body.groupIds : [];
      const groupIds = [
        ...new Set(rawGroupIds.filter((value) => typeof value === 'string' && value.trim())),
      ];
      if (groupIds.length === 0) {
        return reply.code(400).send({ error: 'groupIds erforderlich', code: 'group_ids_required' });
      }

      const isAdmin = requester.role === 'admin';
      if (!isAdmin && groupIds.length > 1) {
        return reply.code(403).send({
          error: 'Group-Owner duerfen nur Einladungen fuer eine Gruppe erstellen',
          code: 'owner_single_group_only',
        });
      }

      const groups = await fastify.prisma.group.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, createdBy: true },
      });
      if (groups.length !== groupIds.length) {
        return reply.code(404).send({ error: 'Mindestens eine Gruppe wurde nicht gefunden' });
      }

      if (!isAdmin) {
        const invalid = groups.find((group) => group.createdBy !== requester.id);
        if (invalid) {
          return reply
            .code(403)
            .send({ error: 'Du bist nicht Owner aller Zielgruppen', code: 'not_group_owner' });
        }

        const groupId = groupIds[0];
        const links = await fastify.prisma.groupInviteGroup.findMany({
          where: { groupId },
          include: { invite: true },
        });
        const activeInviteCount = links.filter((entry) => {
          const invite = entry.invite;
          if (!invite || !invite.isActive) return false;
          if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) return false;
          if (
            invite.maxUses !== null &&
            invite.maxUses !== undefined &&
            invite.useCount >= invite.maxUses
          ) {
            return false;
          }
          return true;
        }).length;

        if (activeInviteCount >= MAX_OWNER_ACTIVE_INVITES_PER_GROUP) {
          return reply.code(409).send({
            error: 'Maximal 10 aktive Links pro Gruppe erlaubt',
            code: 'owner_active_invite_limit',
          });
        }
      }

      const now = new Date();
      const expiresAt = toDateOrNull(body.expiresAt);
      if (body.expiresAt !== undefined && !expiresAt) {
        return reply.code(400).send({ error: 'Ungueltiges expiresAt Datum' });
      }
      if (expiresAt && expiresAt.getTime() <= now.getTime()) {
        return reply.code(400).send({ error: 'expiresAt muss in der Zukunft liegen' });
      }
      if (expiresAt && expiresAt.getTime() > addMonths(now, MAX_INVITE_MONTHS).getTime()) {
        return reply.code(400).send({
          error: 'expiresAt darf maximal 12 Monate in der Zukunft liegen',
          code: 'expires_at_too_far',
        });
      }

      let maxUses = null;
      if (body.maxUses !== undefined && body.maxUses !== null) {
        if (
          typeof body.maxUses !== 'number' ||
          !Number.isInteger(body.maxUses) ||
          body.maxUses < 1
        ) {
          return reply
            .code(400)
            .send({ error: 'maxUses muss eine ganze Zahl >= 1 sein', code: 'invalid_max_uses' });
        }
        maxUses = body.maxUses;
      }

      let notificationText = null;
      if (isAdmin) {
        notificationText = isNonEmptyString(body.notificationText)
          ? body.notificationText.trim()
          : null;
      } else if (body.notificationText === true || isNonEmptyString(body.notificationText)) {
        notificationText = OWNER_PRESET_NOTIFICATION;
      }

      let token = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = createInviteToken();
        const exists = await fastify.prisma.groupInvite.findUnique({
          where: { token: candidate },
          select: { id: true },
        });
        if (!exists) {
          token = candidate;
          break;
        }
      }

      if (!token) {
        return reply.code(500).send({ error: 'Konnte keinen eindeutigen Invite-Token erzeugen' });
      }

      const invite = await fastify.prisma.groupInvite.create({
        data: {
          token,
          createdBy: requester.id,
          expiresAt,
          maxUses,
          notificationText,
          groups: {
            create: groupIds.map((groupId) => ({ groupId })),
          },
        },
        include: {
          groups: { include: { group: { select: { id: true, name: true } } } },
        },
      });

      return {
        invite: {
          id: invite.id,
          token: invite.token,
          url: buildInviteUrl(request, invite.token),
          expiresAt: invite.expiresAt,
          maxUses: invite.maxUses,
          useCount: invite.useCount,
          isActive: invite.isActive,
          notificationText: invite.notificationText,
          groups: invite.groups.map((entry) => entry.group).filter(Boolean),
        },
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Invite konnte nicht erstellt werden' });
    }
  });

  // GET /api/invites/group/:groupId - Invites einer Gruppe laden
  fastify.get('/group/:groupId', async (request, reply) => {
    try {
      await request.jwtVerify();
      const requester = await getRequester(fastify.prisma, request.user.id);
      if (!requester) return reply.code(401).send({ error: 'Unauthorized' });

      const access = await assertAdminOrGroupOwner(
        fastify.prisma,
        requester,
        request.params.groupId
      );
      if (!access.ok) return reply.code(access.httpCode).send(access.payload);

      const links = await fastify.prisma.groupInviteGroup.findMany({
        where: { groupId: request.params.groupId, invite: { isActive: true } },
        include: {
          invite: {
            include: {
              groups: { include: { group: { select: { id: true, name: true } } } },
              creator: { select: { id: true, username: true, name: true } },
            },
          },
        },
      });

      const invites = links
        .map((entry) => entry.invite)
        .filter(Boolean)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((invite) => ({
          id: invite.id,
          token: invite.token,
          url: buildInviteUrl(request, invite.token),
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          maxUses: invite.maxUses,
          useCount: invite.useCount,
          isActive: invite.isActive,
          notificationText: invite.notificationText,
          creator: invite.creator,
          groups: invite.groups.map((row) => row.group).filter(Boolean),
        }));

      return { invites };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Invite-Liste konnte nicht geladen werden' });
    }
  });

  // DELETE /api/invites/:id - Invite widerrufen
  fastify.delete('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      const requester = await getRequester(fastify.prisma, request.user.id);
      if (!requester) return reply.code(401).send({ error: 'Unauthorized' });

      const invite = await fastify.prisma.groupInvite.findUnique({
        where: { id: request.params.id },
        include: {
          groups: {
            include: {
              group: {
                select: { id: true, createdBy: true },
              },
            },
          },
        },
      });

      if (!invite) return reply.code(404).send({ error: 'Invite nicht gefunden' });

      const isAdmin = requester.role === 'admin';
      const ownsAllGroups = invite.groups.every((entry) => entry.group?.createdBy === requester.id);
      const canDelete = isAdmin || invite.createdBy === requester.id || ownsAllGroups;
      if (!canDelete) {
        return reply
          .code(403)
          .send({ error: 'Keine Berechtigung zum Loeschen dieses Invite-Links' });
      }

      const updated = await fastify.prisma.groupInvite.update({
        where: { id: invite.id },
        data: { isActive: false },
      });

      return { ok: true, invite: { id: updated.id, isActive: updated.isActive } };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Invite konnte nicht geloescht werden' });
    }
  });

  // POST /api/invites/redeem/:token - Invite einloesen
  fastify.post('/redeem/:token', async (request, reply) => {
    try {
      await request.jwtVerify();
      const result = await redeemInviteForUser(fastify.prisma, {
        token: request.params.token,
        userId: request.user.id,
      });

      if (!result.ok) {
        return reply.code(result.httpCode).send({
          error: result.message,
          code: result.code,
          joinedGroups: result.joinedGroups || [],
          failedGroups: result.failedGroups || [],
          alreadyMemberGroups: result.alreadyMemberGroups || [],
        });
      }

      return {
        status: result.status,
        code: result.code,
        message: result.message,
        joinedGroups: result.joinedGroups,
        failedGroups: result.failedGroups,
        alreadyMemberGroups: result.alreadyMemberGroups,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Invite-Einloesung fehlgeschlagen' });
    }
  });
}
