import crypto from 'crypto';
import {
  createUserExportZip,
  deleteUserExportObject,
  getUserExportStat,
  getUserExportStream,
} from '../utils/storage.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const EXPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EXPORT_NOT_READY = new Set(['queued', 'running']);

const EXPORT_CLEANUP_DEFAULT_MINUTES = 60;

function generateExportZipKey(userId) {
  return `export_user_${userId}_${Date.now()}.zip`;
}

function generateDownloadToken() {
  return crypto.randomBytes(32).toString('hex');
}

function toCsvValue(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildPhotosCsv(photos) {
  const headers = [
    'photoId',
    'filename',
    'path',
    'mediaType',
    'videoDuration',
    'description',
    'groupId',
    'groupName',
    'albumIds',
    'albumNames',
    'createdAt',
  ];

  const rows = photos.map((photo) => {
    const albums = photo.albums?.map((entry) => entry.album).filter(Boolean) || [];
    return [
      photo.id,
      photo.filename,
      photo.path,
      photo.mediaType,
      photo.videoDuration ?? '',
      photo.description ?? '',
      photo.group?.id ?? '',
      photo.group?.name ?? '',
      albums.map((a) => a.id).join('|'),
      albums.map((a) => a.name).join('|'),
      photo.createdAt instanceof Date ? photo.createdAt.toISOString() : String(photo.createdAt || ''),
    ]
      .map(toCsvValue)
      .join(',');
  });

  return `${headers.join(',')}\n${rows.join('\n')}`;
}

function toPublicExportDto(record) {
  const expired = record.linkExpiry < new Date();
  return {
    id: record.id,
    status: record.status,
    photoCount: record.photoCount,
    sizeBytes: record.sizeBytes ? Number(record.sizeBytes) : null,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    readyAt: record.readyAt,
    linkExpiry: record.linkExpiry,
    expired,
    downloadUrl:
      record.status === 'ready' && !expired
        ? `/api/exports/download/${encodeURIComponent(record.downloadToken)}`
        : null,
  };
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

async function requireAdmin(fastify, request, reply) {
  if (!(await requireAuth(request, reply))) return false;

  const caller = await fastify.prisma.user.findUnique({
    where: { id: request.user.id },
    select: { role: true },
  });
  if (!caller || caller.role !== 'admin') {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function toAdminExportDto(record) {
  const dto = toPublicExportDto(record);
  return {
    ...dto,
    userId: record.userId,
  };
}

export async function cleanupExpiredUserExports(fastify, { limit = 250 } = {}) {
  const now = new Date();
  const expired = await fastify.prisma.userExport.findMany({
    where: { linkExpiry: { lt: now } },
    orderBy: { linkExpiry: 'asc' },
    take: limit,
    select: {
      id: true,
      zipKey: true,
    },
  });

  let removed = 0;
  let errors = 0;

  for (const item of expired) {
    try {
      await deleteUserExportObject(item.zipKey).catch(() => {});
      await fastify.prisma.userExport.delete({ where: { id: item.id } });
      removed += 1;
    } catch {
      errors += 1;
    }
  }

  return { scanned: expired.length, removed, errors };
}

export function startUserExportCleanupTask(fastify) {
  const intervalMinutes = Math.max(
    5,
    Number(process.env.EXPORT_CLEANUP_INTERVAL_MINUTES || EXPORT_CLEANUP_DEFAULT_MINUTES)
  );

  const timer = setInterval(async () => {
    try {
      const result = await cleanupExpiredUserExports(fastify);
      if (result.removed > 0 || result.errors > 0) {
        fastify.log.info(
          {
            removed: result.removed,
            errors: result.errors,
            scanned: result.scanned,
          },
          'Export cleanup completed'
        );
      }
    } catch (error) {
      fastify.log.error(error, 'Export cleanup task failed');
    }
  }, intervalMinutes * 60 * 1000);

  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

async function processUserExport(fastify, exportId) {
  try {
    const exportRecord = await fastify.prisma.userExport.findUnique({
      where: { id: exportId },
      select: { id: true, userId: true, zipKey: true, status: true },
    });

    if (!exportRecord || exportRecord.status !== 'queued') return;

    await fastify.prisma.userExport.update({
      where: { id: exportId },
      data: { status: 'running', errorMessage: null },
    });

    const photos = await fastify.prisma.photo.findMany({
      where: { uploaderId: exportRecord.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        filename: true,
        path: true,
        mediaType: true,
        videoDuration: true,
        description: true,
        createdAt: true,
        group: { select: { id: true, name: true } },
        albums: {
          select: {
            album: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    const metadataJson = {
      exportedAt: new Date().toISOString(),
      userId: exportRecord.userId,
      photoCount: photos.length,
      photos: photos.map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        path: photo.path,
        mediaType: photo.mediaType,
        videoDuration: photo.videoDuration,
        description: photo.description,
        createdAt:
          photo.createdAt instanceof Date ? photo.createdAt.toISOString() : String(photo.createdAt),
        group: photo.group,
        albums: (photo.albums || []).map((entry) => entry.album).filter(Boolean),
      })),
    };

    await createUserExportZip(
      exportRecord.userId,
      exportRecord.zipKey,
      photos,
      {
        json: metadataJson,
        csv: buildPhotosCsv(photos),
      }
    );

    const stat = await getUserExportStat(exportRecord.zipKey).catch(() => null);
    await fastify.prisma.userExport.update({
      where: { id: exportId },
      data: {
        status: 'ready',
        photoCount: photos.length,
        sizeBytes: stat?.size ?? null,
        readyAt: new Date(),
        errorMessage: null,
      },
    });
  } catch (error) {
    fastify.log.error(error);
    await fastify.prisma.userExport
      .update({
        where: { id: exportId },
        data: {
          status: 'failed',
          errorMessage: String(error?.message || 'Export failed').slice(0, 500),
        },
      })
      .catch(() => {});
  }
}

export default async function exportsRoutes(fastify) {
  // POST /api/exports/request - neuen Export erzeugen (strict: 1x pro 24h pro User)
  fastify.post(
    '/request',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;

      const userId = request.user.id;

      const latestExport = await fastify.prisma.userExport.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      if (latestExport && Date.now() - latestExport.createdAt.getTime() < DAY_IN_MS) {
        return reply
          .code(429)
          .send({ error: 'Du kannst nur einmal pro 24 Stunden einen Export anfordern.' });
      }

      const pendingExport = await fastify.prisma.userExport.findFirst({
        where: { userId, status: { in: ['queued', 'running'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      if (pendingExport) {
        return reply.code(409).send({ error: 'Es laeuft bereits ein Export fuer deinen Account.' });
      }

      const exportRecord = await fastify.prisma.userExport.create({
        data: {
          userId,
          zipKey: generateExportZipKey(userId),
          downloadToken: generateDownloadToken(),
          status: 'queued',
          linkExpiry: new Date(Date.now() + EXPORT_TTL_MS),
        },
      });

      void processUserExport(fastify, exportRecord.id);

      return reply.code(202).send({ export: toPublicExportDto(exportRecord) });
    }
  );

  // GET /api/exports/mine - eigene Exporte laden
  fastify.get('/mine', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    const exports = await fastify.prisma.userExport.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: 'desc' },
    });

    return { exports: exports.map(toPublicExportDto) };
  });

  // GET /api/exports/download/:token - Export-Datei authentifiziert laden (Owner/Admin)
  fastify.get(
    '/download/:token',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      try {
        if (!(await requireAuth(request, reply))) return;

        const token = decodeURIComponent(request.params.token || '');
        const exportRecord = await fastify.prisma.userExport.findUnique({
          where: { downloadToken: token },
          select: {
            id: true,
            userId: true,
            zipKey: true,
            status: true,
            linkExpiry: true,
          },
        });

        if (!exportRecord) {
          return reply.code(404).send({ error: 'Export nicht gefunden' });
        }

        if (exportRecord.userId !== request.user.id) {
          const caller = await fastify.prisma.user.findUnique({
            where: { id: request.user.id },
            select: { role: true },
          });
          if (!caller || caller.role !== 'admin') {
            return reply.code(403).send({ error: 'Forbidden' });
          }
        }

        if (EXPORT_NOT_READY.has(exportRecord.status)) {
          return reply.code(409).send({ error: 'Export wird noch erstellt.' });
        }

        if (exportRecord.status !== 'ready') {
          return reply.code(404).send({ error: 'Export nicht verfuegbar' });
        }

        if (exportRecord.linkExpiry < new Date()) {
          return reply.code(410).send({ error: 'Dieser Download-Link ist abgelaufen.' });
        }

        const stat = await getUserExportStat(exportRecord.zipKey);
        const stream = await getUserExportStream(exportRecord.zipKey);

        reply
          .header('Content-Type', 'application/zip')
          .header('Content-Length', stat.size)
          .header('Content-Disposition', `attachment; filename="${exportRecord.zipKey}"`)
          .header('Cache-Control', 'private, no-store');

        return reply.send(stream);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(404).send({ error: 'Export nicht gefunden' });
      }
    }
  );

  // GET /api/exports/admin/exports - User-Exporte fuer Admin-UI laden
  fastify.get('/admin/exports', async (request, reply) => {
    if (!(await requireAdmin(fastify, request, reply))) return;

    const exports = await fastify.prisma.userExport.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        zipKey: true,
        downloadToken: true,
        status: true,
        photoCount: true,
        sizeBytes: true,
        errorMessage: true,
        createdAt: true,
        readyAt: true,
        linkExpiry: true,
        user: {
          select: {
            name: true,
            username: true,
          },
        },
      },
    });

    return {
      exports: exports.map((entry) => ({
        ...toAdminExportDto(entry),
        userLabel: entry.user?.name || entry.user?.username || entry.userId,
      })),
    };
  });

  // POST /api/exports/admin/exports/:id/refresh - Export-Link um 30 Tage verlaengern
  fastify.post('/admin/exports/:id/refresh', async (request, reply) => {
    if (!(await requireAdmin(fastify, request, reply))) return;
    try {
      const updated = await fastify.prisma.userExport.update({
        where: { id: request.params.id },
        data: { linkExpiry: new Date(Date.now() + EXPORT_TTL_MS) },
      });
      return { linkExpiry: updated.linkExpiry };
    } catch {
      return reply.code(404).send({ error: 'Export nicht gefunden' });
    }
  });

  // DELETE /api/exports/admin/exports/:id - Export aus MinIO und DB loeschen
  fastify.delete('/admin/exports/:id', async (request, reply) => {
    if (!(await requireAdmin(fastify, request, reply))) return;
    try {
      const record = await fastify.prisma.userExport.findUnique({
        where: { id: request.params.id },
        select: { id: true, zipKey: true },
      });
      if (!record) return reply.code(404).send({ error: 'Export nicht gefunden' });
      await deleteUserExportObject(record.zipKey).catch(() => {});
      await fastify.prisma.userExport.delete({ where: { id: record.id } });
      return { status: 'deleted' };
    } catch {
      return reply.code(500).send({ error: 'Loeschen fehlgeschlagen' });
    }
  });

  // POST /api/exports/admin/exports/cleanup - abgelaufene Exporte manuell aufraeumen
  fastify.post('/admin/exports/cleanup', async (request, reply) => {
    if (!(await requireAdmin(fastify, request, reply))) return;

    const result = await cleanupExpiredUserExports(fastify, { limit: 500 });
    return result;
  });
}
