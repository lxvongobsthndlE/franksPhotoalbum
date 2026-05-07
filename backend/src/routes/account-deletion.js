import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { deleteAvatar, deleteGroupPhotoObjects, deleteUserExportObject } from '../utils/storage.js';

const CODE_TTL_MINUTES = 15;
const PURGE_DELAY_DAYS = 14;
const PURGE_INTERVAL_MINUTES_DEFAULT = 6 * 60;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

const LAST_ADMIN_GUARD_MESSAGE =
  'Der letzte aktive Admin kann nicht deaktiviert oder gelöscht werden. Bitte ernennen Sie zuerst einen weiteren Admin.';

async function sendDeletionCodeEmail(targetEmail, code) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    if (isProduction()) {
      throw new Error('SMTP ist nicht konfiguriert.');
    }
    return { delivered: false, fallback: 'log-only' };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const catchAll = process.env.DEV_MAIL_CATCHALL;
  const isDev = !isProduction();
  const to =
    isDev && catchAll ? catchAll.replace('${local}', targetEmail.split('@')[0]) : targetEmail;
  const headers =
    isDev && catchAll && to !== targetEmail ? { 'X-Original-To': targetEmail } : undefined;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Bestätigungscode für Account-Löschung',
    text: `Dein Bestätigungscode lautet: ${code}\n\nDer Code ist ${CODE_TTL_MINUTES} Minuten gültig.`,
    headers,
  });

  return { delivered: true };
}

async function requireAuth(request, reply) {
  try {
    await request.jwtVerify();
    return true;
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
}

async function getOrCreateDeletedPlaceholderUserId(prisma) {
  const markerEmail = 'deleted-content@local.invalid';
  const existing = await prisma.user.findUnique({
    where: { email: markerEmail },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: {
      email: markerEmail,
      username: 'geloescht',
      name: 'Gelöscht',
      displayNameField: 'name',
      role: 'user',
      color: '#777777',
      auth_source: 'system',
    },
    select: { id: true },
  });

  return created.id;
}

function hasConfirmedFutureDeletion(record, now = new Date()) {
  return !!record && record.status === 'confirmed' && (!record.purgeAt || record.purgeAt > now);
}

export async function hasActiveAccountDeletion(prisma, userId) {
  if (!userId) return false;
  const record = await prisma.accountDeletionRequest.findUnique({
    where: { userId },
    select: { status: true, purgeAt: true },
  });
  return hasConfirmedFutureDeletion(record);
}

export function isDeletionGuardBypassed(url) {
  const pathname = String(url || '').split('?')[0];
  return (
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/callback' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/logout-url' ||
    pathname.startsWith('/api/auth/avatar/') ||
    pathname === '/api/account-deletion/request' ||
    pathname === '/api/account-deletion/status' ||
    pathname === '/api/account-deletion/confirm' ||
    pathname === '/api/account-deletion/reactivate'
  );
}

export function createActiveDeletionGuard({ prisma, jwt }) {
  return async function activeDeletionGuard(request, reply) {
    const pathname = String(request.url || '').split('?')[0];
    if (!pathname.startsWith('/api/')) return;
    if (isDeletionGuardBypassed(pathname)) return;

    const authHeader = request.headers?.authorization;
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return;

    let decoded;
    try {
      decoded = jwt.verify(authHeader.slice(7));
    } catch {
      return;
    }

    if (!decoded?.id) return;

    if (await hasActiveAccountDeletion(prisma, decoded.id)) {
      return reply.code(403).send({ error: 'Account ist deaktiviert. Bitte neu einloggen.' });
    }
  };
}

async function ensureNotLastActiveAdmin(prisma, user) {
  if (!user || user.role !== 'admin') {
    return null;
  }

  const otherAdmins = await prisma.user.findMany({
    where: {
      role: 'admin',
      id: { not: user.id },
    },
    select: { id: true },
  });

  if (otherAdmins.length === 0) {
    return LAST_ADMIN_GUARD_MESSAGE;
  }

  const now = new Date();
  for (const admin of otherAdmins) {
    const record = await prisma.accountDeletionRequest.findUnique({
      where: { userId: admin.id },
      select: { status: true, purgeAt: true },
    });

    if (!hasConfirmedFutureDeletion(record, now)) {
      return null;
    }
  }

  return LAST_ADMIN_GUARD_MESSAGE;
}

async function purgeSingleUserAccount(fastify, requestRecord) {
  const userId = requestRecord.userId;
  let transferUserId = null;

  if (requestRecord.successorUserId && requestRecord.successorUserId !== userId) {
    const successor = await fastify.prisma.user.findUnique({
      where: { id: requestRecord.successorUserId },
      select: { id: true },
    });
    transferUserId = successor?.id || null;
  } else if (requestRecord.keepContent) {
    transferUserId = await getOrCreateDeletedPlaceholderUserId(fastify.prisma);
  }

  const exports = await fastify.prisma.userExport.findMany({
    where: { userId },
    select: { id: true, zipKey: true },
  });
  for (const entry of exports) {
    await deleteUserExportObject(entry.zipKey).catch(() => {});
    await fastify.prisma.userExport.delete({ where: { id: entry.id } }).catch(() => {});
  }

  const ownPhotos = await fastify.prisma.photo.findMany({
    where: { uploaderId: userId },
    select: { id: true, path: true },
  });
  const ownPhotoIds = ownPhotos.map((p) => p.id);

  if (transferUserId) {
    await fastify.prisma.photo.updateMany({
      where: { uploaderId: userId },
      data: { uploaderId: transferUserId },
    });
    await fastify.prisma.album.updateMany({
      where: { createdBy: userId },
      data: { createdBy: transferUserId },
    });
    await fastify.prisma.group.updateMany({
      where: { createdBy: userId },
      data: { createdBy: transferUserId },
    });
  } else {
    if (ownPhotoIds.length > 0) {
      await fastify.prisma.like.deleteMany({ where: { photoId: { in: ownPhotoIds } } });
      await fastify.prisma.comment.deleteMany({ where: { photoId: { in: ownPhotoIds } } });
      await fastify.prisma.photoAlbum.deleteMany({ where: { photoId: { in: ownPhotoIds } } });
    }
    await fastify.prisma.photo.deleteMany({ where: { uploaderId: userId } });
    await fastify.prisma.album.deleteMany({ where: { createdBy: userId } });
    await fastify.prisma.group.updateMany({
      where: { createdBy: userId },
      data: { createdBy: null },
    });
    deleteGroupPhotoObjects(ownPhotos.map((p) => p.path).filter(Boolean)).catch(() => {});
  }

  await fastify.prisma.like.deleteMany({ where: { userId } });
  await fastify.prisma.comment.deleteMany({ where: { userId } });
  await fastify.prisma.albumContributor.deleteMany({ where: { userId } });
  await fastify.prisma.groupDeputy.deleteMany({ where: { userId } });
  await fastify.prisma.groupMember.deleteMany({ where: { userId } });
  await fastify.prisma.notificationPreference.deleteMany({ where: { userId } });

  await fastify.prisma.user.delete({ where: { id: userId } });
  deleteAvatar(userId).catch(() => {});
}

export async function reactivateDeletionOnLogin(prisma, userId) {
  const now = new Date();
  const requestRecord = await prisma.accountDeletionRequest.findUnique({
    where: { userId },
    select: { id: true, status: true, purgeAt: true },
  });

  if (!requestRecord || requestRecord.status !== 'confirmed') {
    return { reactivated: false };
  }

  // Note: even if purgeAt has already passed, we still reactivate here –
  // as long as the account still exists, an explicit login signals intent to cancel.
  // The purge job only deletes accounts with status === 'confirmed'.

  await prisma.accountDeletionRequest.update({
    where: { id: requestRecord.id },
    data: {
      status: 'reactivated',
      reactivatedAt: now,
      codeHash: hashCode(`reactivated-${userId}-${now.toISOString()}`),
      codeExpiresAt: now,
    },
  });

  return { reactivated: true };
}

export async function purgeDueDeletedAccounts(fastify, { limit = 50 } = {}) {
  const now = new Date();
  const due = await fastify.prisma.accountDeletionRequest.findMany({
    where: {
      status: 'confirmed',
      purgeAt: { lte: now },
    },
    take: limit,
    orderBy: { purgeAt: 'asc' },
    select: {
      id: true,
      userId: true,
      keepContent: true,
      successorUserId: true,
    },
  });

  let removed = 0;
  let errors = 0;
  for (const record of due) {
    try {
      await purgeSingleUserAccount(fastify, record);
      removed += 1;
    } catch (err) {
      errors += 1;
      fastify.log.error(err, 'Account-Purge fehlgeschlagen');
    }
  }

  return { scanned: due.length, removed, errors };
}

export function startAccountDeletionPurgeTask(fastify) {
  const intervalMinutes = Math.max(
    30,
    Number(process.env.ACCOUNT_DELETION_PURGE_INTERVAL_MINUTES || PURGE_INTERVAL_MINUTES_DEFAULT)
  );

  async function runPurge() {
    try {
      const result = await purgeDueDeletedAccounts(fastify);
      if (result.removed > 0 || result.errors > 0) {
        fastify.log.info(result, 'Account-Purge Lauf abgeschlossen');
      }
    } catch (err) {
      fastify.log.error(err, 'Account-Purge Task fehlgeschlagen');
    }
  }

  // Einmal direkt beim Start ausführen
  runPurge();

  const timer = setInterval(runPurge, intervalMinutes * 60 * 1000);

  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

export default async function accountDeletionRoutes(fastify) {
  fastify.post(
    '/request',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '10 minutes',
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;

      const userId = request.user.id;
      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true },
      });
      if (!user) return reply.code(404).send({ error: 'User nicht gefunden' });

      const guardError = await ensureNotLastActiveAdmin(fastify.prisma, user);
      if (guardError) {
        return reply.code(409).send({ error: guardError });
      }

      const existing = await fastify.prisma.accountDeletionRequest.findUnique({
        where: { userId },
        select: { id: true, status: true, purgeAt: true },
      });
      if (hasConfirmedFutureDeletion(existing)) {
        return reply
          .code(409)
          .send({ error: 'Für deinen Account ist bereits eine Löschung eingeplant.' });
      }

      const code = generateCode();
      const now = new Date();
      const codeExpiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000);

      await fastify.prisma.accountDeletionRequest.upsert({
        where: { userId },
        create: {
          userId,
          codeHash: hashCode(code),
          codeExpiresAt,
          requestedAt: now,
          lastCodeSentAt: now,
          status: 'pending',
          confirmAttempts: 0,
        },
        update: {
          codeHash: hashCode(code),
          codeExpiresAt,
          requestedAt: now,
          lastCodeSentAt: now,
          status: 'pending',
          confirmAttempts: 0,
          keepContent: null,
          successorUserId: null,
          confirmedAt: null,
          purgeAt: null,
          reactivatedAt: null,
        },
      });

      await sendDeletionCodeEmail(user.email, code);
      if (!isProduction()) {
        fastify.log.info({ userId, code }, 'Account-Löschcode (dev)');
      }

      return {
        ok: true,
        codeExpiresAt,
        message: `Bestätigungscode wurde gesendet. Gültig für ${CODE_TTL_MINUTES} Minuten.`,
      };
    }
  );

  fastify.get('/status', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    const record = await fastify.prisma.accountDeletionRequest.findUnique({
      where: { userId: request.user.id },
      select: {
        status: true,
        codeExpiresAt: true,
        keepContent: true,
        successorUserId: true,
        purgeAt: true,
      },
    });

    if (!record) return { status: 'none' };

    if (record.status === 'confirmed' && record.purgeAt) {
      const msLeft = Math.max(0, new Date(record.purgeAt).getTime() - Date.now());
      return {
        status: 'scheduled',
        purgeAt: record.purgeAt,
        daysRemaining: Math.ceil(msLeft / (24 * 60 * 60 * 1000)),
        keepContent: record.keepContent,
        successorUserId: record.successorUserId,
      };
    }

    if (record.status === 'pending') {
      return {
        status: 'pending',
        codeExpiresAt: record.codeExpiresAt,
      };
    }

    return { status: record.status };
  });

  fastify.post('/confirm', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    const userId = request.user.id;
    const code = String(request.body?.code || '').trim();
    const successorUserId = request.body?.successorUserId
      ? String(request.body.successorUserId).trim()
      : null;
    const keepContent = request.body?.keepContent === true;

    if (!code || code.length < 4 || code.length > 12) {
      return reply.code(400).send({ error: 'Bitte gib einen gültigen Bestätigungscode ein.' });
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) {
      return reply.code(404).send({ error: 'User nicht gefunden' });
    }

    const guardError = await ensureNotLastActiveAdmin(fastify.prisma, user);
    if (guardError) {
      return reply.code(409).send({ error: guardError });
    }

    const record = await fastify.prisma.accountDeletionRequest.findUnique({
      where: { userId },
      select: {
        id: true,
        status: true,
        codeHash: true,
        codeExpiresAt: true,
      },
    });

    if (!record || record.status !== 'pending') {
      return reply.code(409).send({ error: 'Kein offener Löschvorgang gefunden.' });
    }

    if (record.codeExpiresAt < new Date()) {
      return reply.code(410).send({ error: 'Der Bestätigungscode ist abgelaufen.' });
    }

    if (hashCode(code) !== record.codeHash) {
      await fastify.prisma.accountDeletionRequest.update({
        where: { id: record.id },
        data: { confirmAttempts: { increment: 1 } },
      });
      return reply.code(400).send({ error: 'Der Bestätigungscode ist falsch.' });
    }

    if (successorUserId && successorUserId === userId) {
      return reply.code(400).send({ error: 'Du kannst dich nicht selbst als Erben setzen.' });
    }

    if (successorUserId) {
      const successor = await fastify.prisma.user.findUnique({
        where: { id: successorUserId },
        select: { id: true },
      });
      if (!successor) {
        return reply.code(404).send({ error: 'Der ausgewählte Erbe wurde nicht gefunden.' });
      }
    }

    const now = new Date();
    const purgeAt = new Date(now.getTime() + PURGE_DELAY_DAYS * 24 * 60 * 60 * 1000);

    await fastify.prisma.accountDeletionRequest.update({
      where: { id: record.id },
      data: {
        status: 'confirmed',
        confirmedAt: now,
        purgeAt,
        keepContent: successorUserId ? null : keepContent,
        successorUserId: successorUserId || null,
        codeHash: hashCode(`confirmed-${userId}-${now.toISOString()}`),
        codeExpiresAt: now,
      },
    });

    reply.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return {
      ok: true,
      purgeAt,
      message: `Dein Account wurde deaktiviert und wird in ${PURGE_DELAY_DAYS} Tagen endgültig gelöscht.`,
    };
  });

  fastify.post('/reactivate', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    const userId = request.user.id;
    const record = await fastify.prisma.accountDeletionRequest.findUnique({
      where: { userId },
      select: { id: true, status: true, purgeAt: true },
    });

    if (!record || record.status !== 'confirmed') {
      return reply.code(400).send({ error: 'Kein deaktivierter Account gefunden.' });
    }

    if (record.purgeAt && record.purgeAt <= new Date()) {
      return reply.code(410).send({ error: 'Der Account ist bereits zur Löschung fällig.' });
    }

    await fastify.prisma.accountDeletionRequest.update({
      where: { id: record.id },
      data: {
        status: 'reactivated',
        reactivatedAt: new Date(),
        codeHash: hashCode(`reactivated-${userId}-${Date.now()}`),
        codeExpiresAt: new Date(),
      },
    });

    return { ok: true };
  });
}
