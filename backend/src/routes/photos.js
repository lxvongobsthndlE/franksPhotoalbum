import { uploadPhoto, deletePhoto, getPhotoStream, getPhotoStat } from '../utils/storage.js';

export default async function photosRoutes(fastify) {
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
      if (albumId)    where.albums = { some: { albumId } };
      if (uploaderId) where.uploaderId = uploaderId;

      const orderDir = order === 'asc' ? 'asc' : 'desc';

      const [rawPhotos, total] = await Promise.all([
        fastify.prisma.photo.findMany({
          where,
          include: {
            uploader: { select: { id: true, name: true, username: true, color: true, avatar: true } },
            albums:   { select: { albumId: true } },
            _count:   { select: { likes: true, comments: true } },
          },
          orderBy: { createdAt: orderDir },
          skip:    parseInt(skip),
          take:    parseInt(limit),
        }),
        fastify.prisma.photo.count({ where }),
      ]);

      // Welche Fotos hat der aktuelle User geliked?
      const photoIds = rawPhotos.map(p => p.id);
      const myLikes  = photoIds.length
        ? await fastify.prisma.like.findMany({
            where: { photoId: { in: photoIds }, userId },
            select: { photoId: true },
          })
        : [];
      const likedSet = new Set(myLikes.map(l => l.photoId));

      // Proxy-URLs (kein direkter MinIO-Zugriff vom Client)
      const photos = rawPhotos.map((p) => ({
        ...p,
        uploader: p.uploader ? {
          ...p.uploader,
          avatar: p.uploader.avatar && !p.uploader.avatar.startsWith('/api/')
            ? `/api/auth/avatar/${p.uploader.id}`
            : p.uploader.avatar,
        } : p.uploader,
        albums:    undefined,
        albumIds:  p.albums.map(a => a.albumId),
        _count:    undefined,
        _likes:    p._count.likes,
        _comments: p._count.comments,
        _liked:    likedSet.has(p.id),
        url:       `/api/photos/${p.id}/file`,
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
      const { groupId, albumId, description } = fields;

      if (!groupId) {
        return reply.code(400).send({ error: 'groupId erforderlich' });
      }

      if (!mimetype.startsWith('image/')) {
        return reply.code(400).send({ error: 'Nur Bilder erlaubt' });
      }

      const buffer = fileData._buffer;
      const key = await uploadPhoto(buffer, mimetype, filename);

      const photo = await fastify.prisma.photo.create({
        data: {
          uploaderId:  request.user.id,
          groupId,
          filename,
          path:        key,
          description: description || null,
          ...(albumId ? { albums: { create: { albumId } } } : {}),
        },
        include: { uploader: true, albums: { select: { albumId: true } } },
      });

      const url = `/api/photos/${photo.id}/file`;
      return { photo: { ...photo, albumIds: photo.albums.map(a => a.albumId), albums: undefined }, url };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Upload fehlgeschlagen' });
    }
  });

  // DELETE /api/photos/:id (protected)
  fastify.delete('/:id', async (request, reply) => {
    try {
      await request.jwtVerify();
      
      const photo = await fastify.prisma.photo.findUnique({
        where: { id: request.params.id }
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
      const { photoIds, albumId, remove } = request.body;
      if (!Array.isArray(photoIds)) return reply.code(400).send({ error: 'photoIds erforderlich' });
      if (!albumId) return reply.code(400).send({ error: 'albumId erforderlich' });

      if (remove) {
        // Aus Album entfernen
        await fastify.prisma.photoAlbum.deleteMany({
          where: { albumId, photoId: { in: photoIds } },
        });
      } else {
        // Zum Album hinzufügen (überspringt Duplikate via skipDuplicates)
        await fastify.prisma.photoAlbum.createMany({
          data: photoIds.map(photoId => ({ photoId, albumId })),
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
      // Beschreibung darf nur der Uploader ändern
      if (description !== undefined && photo.uploaderId !== request.user.id) {
        return reply.code(403).send({ error: 'Kein Zugriff' });
      }

      // albumId: toggle (add if not present, remove if present)
      if (albumId !== undefined) {
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
        await fastify.prisma.photoAlbum.deleteMany({ where: { photoId: photo.id } });
        if (albumIds.length > 0) {
          await fastify.prisma.photoAlbum.createMany({
            data: albumIds.map(aid => ({ photoId: photo.id, albumId: aid })),
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
      return { ...updated, albumIds: updated.albums.map(a => a.albumId), albums: undefined };
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
      try { fastify.jwt.verify(token); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }

      const photo = await fastify.prisma.photo.findUnique({
        where: { id: request.params.id },
        select: { path: true, filename: true },
      });
      if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

      const stat = await getPhotoStat(photo.path);
      const stream = await getPhotoStream(photo.path);

      reply
        .header('Content-Type', stat.metaData['content-type'] || 'image/jpeg')
        .header('Content-Length', stat.size)
        .header('Cache-Control', 'private, max-age=3600');
      return reply.send(stream);
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
          likes: { include: { user: true } }
        }
      });
      
      if (!photo) {
        return reply.code(404).send({ error: 'Foto nicht gefunden' });
      }

      const url = `/api/photos/${photo.id}/file`;
      return { ...photo, albums: undefined, albumIds: photo.albums.map(a => a.albumId), url };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Fehler beim Abrufen des Fotos' });
    }
  });
}
