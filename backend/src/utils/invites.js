import crypto from 'crypto';
import { createNotification } from './notifications.js';

export const INVITE_TOKEN_LENGTH = 16;
export const OWNER_PRESET_NOTIFICATION = 'Willkommen in der Gruppe!';

const INVITE_TOKEN_RE = /^[A-Z0-9]{16}$/;

export function normalizeInviteToken(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim().toUpperCase();
  if (!INVITE_TOKEN_RE.test(token)) return null;
  return token;
}

export function createInviteToken() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(INVITE_TOKEN_LENGTH);
  let token = '';
  for (let i = 0; i < INVITE_TOKEN_LENGTH; i += 1) {
    token += alphabet[bytes[i] % alphabet.length];
  }
  return token;
}

export function isInviteExpired(invite, now = new Date()) {
  return !!(invite?.expiresAt && invite.expiresAt.getTime() < now.getTime());
}

export function isInviteExhausted(invite) {
  return (
    invite?.maxUses !== null && invite?.maxUses !== undefined && invite.useCount >= invite.maxUses
  );
}

/**
 * Loest einen Invite fuer einen User ein.
 * Rueckgabe enthaelt status/codes fuer direkte API-Antworten.
 */
export async function redeemInviteForUser(prisma, { token, userId, now = new Date() }) {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) {
    return {
      ok: false,
      httpCode: 400,
      status: 'failed',
      code: 'invalid_token_format',
      message: 'Einladungslink ist ungueltig.',
    };
  }

  const invite = await prisma.groupInvite.findUnique({
    where: { token: normalizedToken },
    include: {
      groups: {
        include: {
          group: {
            select: { id: true, name: true, createdBy: true, maxMembers: true },
          },
        },
      },
    },
  });

  if (!invite || !invite.isActive) {
    return {
      ok: false,
      httpCode: 404,
      status: 'failed',
      code: 'invite_not_found',
      message: 'Dieser Einladungslink wurde deaktiviert oder existiert nicht.',
    };
  }

  if (isInviteExpired(invite, now)) {
    return {
      ok: false,
      httpCode: 410,
      status: 'failed',
      code: 'invite_expired',
      message: 'Einladungslink ist abgelaufen.',
    };
  }

  if (isInviteExhausted(invite)) {
    return {
      ok: false,
      httpCode: 410,
      status: 'failed',
      code: 'invite_exhausted',
      message: 'Einladungslink wurde bereits vollstaendig genutzt.',
    };
  }

  const targets = invite.groups.map((entry) => entry.group).filter(Boolean);
  if (targets.length === 0) {
    return {
      ok: false,
      httpCode: 404,
      status: 'failed',
      code: 'invite_not_found',
      message: 'Dieser Einladungslink wurde deaktiviert oder existiert nicht.',
    };
  }

  const groupIds = targets.map((group) => group.id);
  const memberships = await prisma.groupMember.findMany({
    where: { userId, groupId: { in: groupIds } },
    select: { groupId: true },
  });
  const memberSet = new Set(memberships.map((entry) => entry.groupId));

  const joinedGroups = [];
  const alreadyMemberGroups = [];
  const failedGroups = [];

  for (const group of targets) {
    if (memberSet.has(group.id)) {
      alreadyMemberGroups.push({ groupId: group.id, name: group.name });
      continue;
    }

    if (group.maxMembers !== null && group.maxMembers !== undefined) {
      const memberCount = await prisma.groupMember.count({ where: { groupId: group.id } });
      if (memberCount >= group.maxMembers) {
        failedGroups.push({ groupId: group.id, name: group.name, reason: 'group_full' });
        continue;
      }
    }

    await prisma.groupMember.create({
      data: { userId, groupId: group.id },
    });

    if (!group.createdBy) {
      await prisma.group.update({
        where: { id: group.id },
        data: { createdBy: userId },
      });
    }

    joinedGroups.push({ groupId: group.id, name: group.name });
  }

  if (joinedGroups.length > 0) {
    await prisma.groupInvite.update({
      where: { id: invite.id },
      data: { useCount: { increment: 1 } },
    });

    if (invite.notificationText) {
      await createNotification(prisma, {
        userId,
        type: 'system',
        title: 'Willkommen',
        body: invite.notificationText,
      }).catch(() => {});
    }

    // Notify the group owner about the new member
    const joiningUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, username: true, displayNameField: true },
    }).catch(() => null);
    const joiningName =
      (joiningUser?.displayNameField === 'username' ? joiningUser?.username : joiningUser?.name) ||
      joiningUser?.name ||
      joiningUser?.username ||
      'Ein neues Mitglied';

    for (const joined of joinedGroups) {
      const group = targets.find((g) => g.id === joined.groupId);
      if (group?.createdBy && group.createdBy !== userId) {
        await createNotification(prisma, {
          userId: group.createdBy,
          type: 'groupMemberJoined',
          title: `Neues Mitglied in „${group.name}"`,
          body: `${joiningName} ist der Gruppe beigetreten.`,
          entityId: group.id,
          entityType: 'group',
        }).catch(() => {});
      }
    }
  }

  if (joinedGroups.length === 0 && failedGroups.length === 0) {
    return {
      ok: true,
      httpCode: 200,
      status: 'already_member',
      code: 'already_member',
      message: 'Du bist bereits in der Gruppe.',
      joinedGroups,
      failedGroups,
      alreadyMemberGroups,
    };
  }

  if (joinedGroups.length > 0 && failedGroups.length > 0) {
    return {
      ok: true,
      httpCode: 200,
      status: 'partial',
      code: 'partial_join',
      message: 'Invite teilweise erfolgreich eingeloest.',
      joinedGroups,
      failedGroups,
      alreadyMemberGroups,
    };
  }

  if (joinedGroups.length === 0 && failedGroups.length > 0) {
    const hasGroupFull = failedGroups.some((entry) => entry.reason === 'group_full');
    return {
      ok: false,
      httpCode: hasGroupFull ? 409 : 400,
      status: 'failed',
      code: hasGroupFull ? 'group_full' : 'invite_redeem_failed',
      message: hasGroupFull
        ? 'Mindestens eine Zielgruppe ist voll.'
        : 'Einladung konnte nicht eingeloest werden.',
      joinedGroups,
      failedGroups,
      alreadyMemberGroups,
    };
  }

  return {
    ok: true,
    httpCode: 200,
    status: 'joined',
    code: 'joined',
    message: 'Einladung erfolgreich eingeloest.',
    joinedGroups,
    failedGroups,
    alreadyMemberGroups,
  };
}
