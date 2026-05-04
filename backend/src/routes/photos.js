import { uploadPhoto, deletePhoto, getPhotoStream, getPhotoStat, getPhotoRangeStream } from '../utils/storage.js';
import { MAX_VIDEO_DURATION_SECONDS, MAX_USER_VIDEOS_GLOBAL, MAX_VIDEO_FILE_SIZE_BYTES, ALLOWED_VIDEO_MIMETYPES } from '../utils/videoLimits.js';
import { createNotification } from '../utils/notifications.js';

// Debounce-Map für gebündelte "neue Fotos"-Notifications
// Key: `${uploaderId}:${groupId}` → { timer, photoIds, uploaderName, groupName, memberIds }
const _pendingPhotoNotifs = new Map();
const PHOTO_NOTIF_DEBOUNCE_MS = 5000;

function _flushPhotoNotif(prisma, key) {
  const pending = _pendingPhotoNotifs.get(key);
  if (!pending) return;
  _pendingPhotoNotifs.delete(key);

  const count = pending.photoIds.length;
  const title = `${count === 1 ? 'Neues Foto' : `${count} neue Fotos`} in „${pending.groupName}"`;
  const body =
    count === 1
      ? `${pending.uploaderName} hat ein neues Foto hochgeladen.`
      : `${pending.uploaderName} hat ${count} neue Fotos hochgeladen.`;
  const entityId = count === 1 ? pending.photoIds[0] : undefined;
  const entityType = count === 1 ? 'photo' : undefined;

  for (const userId of pending.memberIds) {
    createNotification(prisma, {
      userId,
      type: 'newPhoto',
      title,
      body,
      entityId,
      entityType,
    }).catch(() => {});
  }
}

function _schedulePhotoNotif(
  prisma,
  { uploaderId, groupId, photoId, uploaderName, groupName, memberIds }
) {
  const key = `${uploaderId}:${groupId}`;
  const existing = _pendingPhotoNotifs.get(key);

  if (existing) {
    clearTimeout(existing.timer);
    existing.photoIds.push(photoId);
  } else {
    _pendingPhotoNotifs.set(key, { photoIds: [photoId], uploaderName, groupName, memberIds });
  }

  const entry = _pendingPhotoNotifs.get(key);
  entry.timer = setTimeout(() => _flushPhotoNotif(prisma, key), PHOTO_NOTIF_DEBOUNCE_MS);
}

export default async function photosRoutes(fastify) {
  async function isGroupOwner(groupId, userId) {
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role === 'admin') return true;
    const group = await fastify.prisma.group.findUnique({
      where: { id: groupId },
      select: { createdBy: true },
    });
    return group?.createdBy === userId;
  }

  async function isGroupDeputy(groupId, userId) {
    const deputy = await fastify.prisma.groupDeputy.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    return !!deputy;
  }

  async function hasGroupAdminRights(groupId, userId) {
    return (await isGroupOwner(groupId, userId)) || (await isGroupDeputy(groupId, userId));
  }

  // GET /api/photos - Liste Fotos mit Pagination + Likes/Comments-Counts
  fastify.get('/', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;

      const { groupId, albumId, uploaderId, skip = 0, limit = 20, order = 'desc' } = request.query;

      if (!groupId) {
        return reply.code(400).send({ error: 'groupId erforderlich' });
      }

      const where = { groupId };
      if (albumId) where.albums = { some: { albumId } };
      if (uploaderId) where.uploaderId = uploaderId;

      const orderDir = order === 'asc' ? 'asc' : 'desc';

      const [rawPhotos, total] = await Promise.all([
        fastify.prisma.photo.findMany({
          where,
          include: {
            uploader: {
              select: { id: true, name: true, username: true, color: true, avatar: true },
            },
            albums: { select: { albumId: true } },
            _count: { select: { likes: true, comments: true } },
          },
          orderBy: { createdAt: orderDir },
          skip: parseInt(skip),
          take: parseInt(limit),
        }),
        fastify.prisma.photo.count({ where }),
      ]);

      // Welche Fotos hat der aktuelle User geliked?
      const photoIds = rawPhotos.map((p) => p.id);
      const myLikes = photoIds.length
        ? await fastify.prisma.like.findMany({
            where: { photoId: { in: photoIds }, userId },
            select: { photoId: true },
          })
        : [];
      const likedSet = new Set(myLikes.map((l) => l.photoId));

      // Proxy-URLs (kein direkter MinIO-Zugriff vom Client)
      const photos = rawPhotos.map((p) => ({
        ...p,
        uploader: p.uploader
          ? {
              ...p.uploader,
              avatar:
                p.uploader.avatar && !p.uploader.avatar.startsWith('/api/')
                  ? `/api/auth/avatar/${p.uploader.id}`
                  : p.uploader.avatar,
            }
          : p.uploader,
        albums: undefined,
        albumIds: p.albums.map((a) => a.albumId),
        _count: undefined,
        _likes: p._count.likes,
        _comments: p._count.comments,
        _liked: likedSet.has(p.id),
        url: `/api/photos/${p.id}/file`,
      }));

      return { photos, total, hasMore: parseInt(skip) + photos.length < total };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Abrufen von Fotos' });
    }
  });

  // POST /api/photos - Upload (protected, multipart)
  fastify.post('/', async (request, reply) => {
    try {
      await request.jwtVerify();

      // Alle Multipart-Parts einlesen (Felder + Datei)
      const parts = request.parts();
      let fileData = null;
      const fields = {};

      for await (const part of parts) {
        if (part.file) {
          fileData = part;
          // Buffer sofort lesen, bevor der Stream geschlossen wird
          fileData._buffer = await part.toBuffer();
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      if (!fileData) {
        return reply.code(400).send({ error: 'Keine Datei hochgeladen' });
      }

      const { filename, mimetype } = fileData;
      const { groupId, albumId, description, videoDuration } = fields;

      if (!groupId) {
        return reply.code(400).send({ error: 'groupId erforderlich' });
      }

      const isVideo = mimetype.startsWith('video/');
      const isImage = mimetype.startsWith('image/');

      if (!isImage && !isVideo) {
        return reply.code(400).send({ error: 'Nur Bilder und Videos erlaubt', code: 'unsupported_format' });
      }
      if (isVideo && !ALLOWED_VIDEO_MIMETYPES.includes(mimetype)) {
        return reply.code(400).send({ error: 'Nur MP4 und MOV Videos sind erlaubt', code: 'unsupported_video_format' });
      }

      const buffer = fileData._buffer;

      if (isVideo) {
        if (buffer.length > MAX_VIDEO_FILE_SIZE_BYTES) {
          return reply.code(413).send({ error: 'Video zu groß (max. 200 MB)', code: 'video_file_too_large' });
        }
        const duration = videoDuration ? parseFloat(videoDuration) : null;
        if (duration !== null && duration > MAX_VIDEO_DURATION_SECONDS) {
          return reply.code(409).send({
            error: `Video zu lang (${Math.round(duration)}s, max. ${MAX_VIDEO_DURATION_SECONDS}s)`,
            code: 'video_duration_limit_exceeded',
            max: MAX_VIDEO_DURATION_SECONDS,
          });
        }
        const videoCount = await fastify.prisma.photo.count({
          where: { uploaderId: request.user.id, mediaType: 'video' },
        });
        if (videoCount >= MAX_USER_VIDEOS_GLOBAL) {
          return reply.code(409).send({
            error: `Du hast bereits ${MAX_USER_VIDEOS_GLOBAL} Videos hochgeladen (globales Limit)`,
            code: 'user_global_video_limit_reached',
            max: MAX_USER_VIDEOS_GLOBAL,
            current: videoCount,
          });
        }
      }

      const key = await uploadPhoto(buffer, mimetype, filename);

      const photo = await fastify.prisma.photo.create({
        data: {
          uploaderId: request.user.id,
          groupId,
          filename,
          path: key,
          description: description || null,
          mediaType: isVideo ? 'video' : 'image',
          videoDuration: isVideo && videoDuration ? parseInt(videoDuration) : null,
          ...(albumId ? { albums: { create: { albumId } } } : {}),
        },
        include: { uploader: true, albums: { select: { albumId: true } } },
      });

      const url = `/api/photos/${photo.id}/file`;

      // Gebündelte Notification: Debounce pro (uploader, group)
      const groupMembers = await fastify.prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      const uploaderUser = await fastify.prisma.user.findUnique({
        where: { id: request.user.id },
        select: { name: true, username: true },
      });
      const uploaderName = uploaderUser?.name || uploaderUser?.username || 'Jemand';
      const photoGroup = await fastify.prisma.group.findUnique({
        where: { id: groupId },
        select: { name: true },
      });
      const memberIds = groupMembers.map((m) => m.userId).filter((id) => id !== request.user.id);
      _schedulePhotoNotif(fastify.prisma, {
        uploaderId: request.user.id,
        groupId,
        photoId: photo.id,
        uploaderName,
        groupName: photoGroup?.name || groupId,
        memberIds,
      });

      return {
        photo: { ...photo, albumIds: photo.albums.map((a) => a.albumId), albums: undefined },
        url,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Upload fehlgeschlagen' });
    }
  });

  // GET /api/photos/video-quota – Globales Video-Kontingent des eingeloggten Nutzers
  fastify.get('/video-quota', async (request, reply) => {
    try {
      await request.jwtVerify();
      const count = await fastify.prisma.photo.count({
        where: { uploaderId: request.user.id, mediaType: 'video' },
      });
      return {
        current: count,
        max: MAX_USER_VIDEOS_GLOBAL,
        remaining: MAX_USER_VIDEOS_GLOBAL - count,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Abrufen des Kontingents' });
    }
  });

  // DELETE /api/photos/:id (protected)
  fastify.delete('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();

      const photo = await fastify.prisma.photo.findUnique({
        where: { id: request.params.id },
      });

      if (!photo) {
        return reply.code(404).send({ error: 'Foto nicht gefunden' });
      }

      // Nur Owner oder Admin kann löschen
      if (photo.uploaderId !== request.user.id) {
        return reply.code(403).send({ error: 'Du kannst nur deine eigenen Fotos löschen' });
      }

      // MinIO-Objekt löschen
      try {
        await deletePhoto(photo.path);
      } catch (err) {
        fastify.log.warn('Could not delete object from MinIO:', err.message);
      }

      // Lösche DB-Eintrag
      await fastify.prisma.photo.delete({ where: { id: request.params.id } });

      return { status: 'deleted' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Löschen fehlgeschlagen' });
    }
  });

  // PATCH /api/photos/batch-album - Mehrere Fotos einem Album zuordnen oder entfernen (protected)
  fastify.patch('/batch-album', async (request, reply) => {
    try {
      await request.jwtVerify();
      const userId = request.user.id;
      const { photoIds, albumId, remove } = request.body;
      if (!Array.isArray(photoIds)) return reply.code(400).send({ error: 'photoIds erforderlich' });
      if (!albumId) return reply.code(400).send({ error: 'albumId erforderlich' });

      // Berechtigung prüfen: Creator, Contributor oder Admin
      const album = await fastify.prisma.album.findUnique({ where: { id: albumId } });
      if (!album) return reply.code(404).send({ error: 'Album nicht gefunden' });

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const isAdmin = user?.role === 'admin';
      const isCreator = album.createdBy === userId;
      const isGroupAdmin =
        !isAdmin && !isCreator && (await hasGroupAdminRights(album.groupId, userId));
      const isContrib =
        !isAdmin &&
        !isCreator &&
        !isGroupAdmin &&
        (await fastify.prisma.albumContributor.findUnique({
          where: { albumId_userId: { albumId, userId } },
        }));
      if (!isAdmin && !isCreator && !isGroupAdmin && !isContrib) {
        return reply.code(403).send({ error: 'Keine Berechtigung für dieses Album' });
      }

      if (remove) {
        await fastify.prisma.photoAlbum.deleteMany({
          where: { albumId, photoId: { in: photoIds } },
        });
      } else {
        await fastify.prisma.photoAlbum.createMany({
          data: photoIds.map((photoId) => ({ photoId, albumId })),
          skipDuplicates: true,
        });
      }
      return { status: 'updated', count: photoIds.length };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Batch-Update fehlgeschlagen' });
    }
  });

  // PATCH /api/photos/:id - Album-Zuordnung oder Beschreibung ändern (protected)
  fastify.patch('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();

      const photo = await fastify.prisma.photo.findUnique({ where: { id: request.params.id } });
      if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

      const { albumId, albumIds, description } = request.body;
      const userId = request.user.id;
      const userRecord = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const isAdmin = userRecord?.role === 'admin';

      // Beschreibung darf nur der Uploader ändern
      if (description !== undefined && photo.uploaderId !== userId && !isAdmin) {
        return reply.code(403).send({ error: 'Kein Zugriff' });
      }

      // Helper: prüft Album-Berechtigung (Creator, Contributor oder Admin)
      async function checkAlbumAccess(aid) {
        if (isAdmin) return true;
        const alb = await fastify.prisma.album.findUnique({ where: { id: aid } });
        if (!alb) return false;
        if (alb.createdBy === userId) return true;
        if (await hasGroupAdminRights(alb.groupId, userId)) return true;
        const contrib = await fastify.prisma.albumContributor.findUnique({
          where: { albumId_userId: { albumId: aid, userId } },
        });
        return !!contrib;
      }

      // albumId: toggle (add if not present, remove if present)
      if (albumId !== undefined) {
        if (!(await checkAlbumAccess(albumId))) {
          return reply.code(403).send({ error: 'Keine Berechtigung für dieses Album' });
        }
        const existing = await fastify.prisma.photoAlbum.findUnique({
          where: { photoId_albumId: { photoId: photo.id, albumId } },
        });
        if (existing) {
          await fastify.prisma.photoAlbum.delete({
            where: { photoId_albumId: { photoId: photo.id, albumId } },
          });
        } else {
          await fastify.prisma.photoAlbum.create({ data: { photoId: photo.id, albumId } });
        }
      }

      // albumIds: replace all album assignments
      if (albumIds !== undefined) {
        // Alle neuen albumIds auf Berechtigung prüfen
        for (const aid of albumIds) {
          if (!(await checkAlbumAccess(aid))) {
            return reply.code(403).send({ error: `Keine Berechtigung für Album ${aid}` });
          }
        }
        await fastify.prisma.photoAlbum.deleteMany({ where: { photoId: photo.id } });
        if (albumIds.length > 0) {
          await fastify.prisma.photoAlbum.createMany({
            data: albumIds.map((aid) => ({ photoId: photo.id, albumId: aid })),
            skipDuplicates: true,
          });
        }
      }

      const updateData = {};
      if (description !== undefined) updateData.description = description || null;

      const updated = await fastify.prisma.photo.update({
        where: { id: request.params.id },
        data: updateData,
        include: { albums: { select: { albumId: true } } },
      });
      return { ...updated, albumIds: updated.albums.map((a) => a.albumId), albums: undefined };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Update fehlgeschlagen' });
    }
  });

  // GET /api/photos/:id/file - Foto-Datei streamen (proxy zu MinIO)
  // Auth via ?t=<accessToken> Query-Param (nötig da <img src> keinen Authorization-Header senden kann)
  fastify.get('/:id/file', async (request, reply) => {
    try {
      const token = request.query.t;
      if (!token) return reply.code(401).send({ error: 'Unauthorized' });
      try {
        fastify.jwt.verify(token);
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const photo = await fastify.prisma.photo.findUnique({
        where: { id: request.params.id },
        select: { path: true, filename: true },
      });
      if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

      const stat = await getPhotoStat(photo.path);
      const size = stat.size;
      const contentType = stat.metaData['content-type'] || 'application/octet-stream';
      const rangeHeader = request.headers['range'];

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1]);
          const end = match[2] ? Math.min(parseInt(match[2]), size - 1) : size - 1;
          const chunkSize = end - start + 1;
          const rangeStream = await getPhotoRangeStream(photo.path, start, chunkSize);
          return reply
            .code(206)
            .header('Content-Type', contentType)
            .header('Content-Length', chunkSize)
            .header('Content-Range', `bytes ${start}-${end}/${size}`)
            .header('Accept-Ranges', 'bytes')
            .header('Cache-Control', 'private, max-age=3600')
            .send(rangeStream);
        }
      }

      const stream = await getPhotoStream(photo.path);
      return reply
        .header('Content-Type', contentType)
        .header('Content-Length', size)
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', 'private, max-age=3600')
        .send(stream);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Datei konnte nicht geladen werden' });
    }
  });

  // GET /api/photos/:id - Foto-Details
  fastify.get('/:id', async (request, reply) => {
    try {
      const photo = await fastify.prisma.photo.findUnique({
        where: { id: request.params.id },
        include: {
          uploader: true,
          albums: { select: { albumId: true } },
          comments: { include: { user: true }, orderBy: { createdAt: 'asc' } },
          likes: { include: { user: true } },
        },
      });

      if (!photo) {
        return reply.code(404).send({ error: 'Foto nicht gefunden' });
      }

      const url = `/api/photos/${photo.id}/file`;
      return { ...photo, albums: undefined, albumIds: photo.albums.map((a) => a.albumId), url };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Abrufen des Fotos' });
    }
  });
}
