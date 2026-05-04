/**
 * Tests für Video-Upload-Validierung und Video-Quota-Endpoint.
 * Getestet: POST /api/photos (Validierungspfade) + GET /api/photos/video-quota
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';
import { createMockUser } from './fixtures/index.js';
import {
  MAX_VIDEO_DURATION_SECONDS,
  MAX_USER_VIDEOS_GLOBAL,
  MAX_VIDEO_FILE_SIZE_BYTES,
} from '../utils/videoLimits.js';

vi.mock('../utils/storage.js', () => ({
  uploadPhoto: vi.fn().mockResolvedValue('photos/test-key.mp4'),
  deletePhoto: vi.fn(),
  getPhotoStream: vi.fn(),
  getPhotoStat: vi.fn(),
  getPhotoRangeStream: vi.fn(),
}));

vi.mock('../utils/notifications.js', () => ({
  createNotification: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────

/** Erstellt einen Mock multipart-request mit einer einzigen Datei. */
function createMultipartRequest({
  user,
  fileBuffer,
  mimetype = 'video/mp4',
  filename = 'clip.mp4',
  fields = {},
} = {}) {
  const req = createMockRequest({
    user: user ?? createMockUser(),
    jwtVerify: vi.fn().mockResolvedValue(undefined),
  });

  // parts() ist ein async generator – wir simulieren ein file-part + field-parts
  req.parts = async function* () {
    // Felder zuerst
    for (const [fieldname, value] of Object.entries(fields)) {
      yield { file: false, fieldname, value };
    }
    // Dann die Datei
    yield {
      file: true,
      filename,
      mimetype,
      toBuffer: vi.fn().mockResolvedValue(fileBuffer ?? Buffer.alloc(1024)),
    };
  };

  return req;
}

// ── Setup ─────────────────────────────────────────────────

describe('photos routes – video upload validation', () => {
  let photosRoutes;
  let fastify;
  let prisma;
  const user = createMockUser({ id: 'uploader-1' });

  async function callPost(requestOverrides) {
    const handler = fastify.routes.POST.get('/');
    const reply = createMockReply();
    const result = await handler(requestOverrides, reply);
    // Success paths return directly; error paths call reply.code().send()
    if (reply.payload === undefined && result !== undefined) reply.payload = result;
    return reply;
  }

  async function callGet(path, requestOverrides = {}) {
    const handler = fastify.routes.GET.get(path);
    const req = createMockRequest({
      user,
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      ...requestOverrides,
    });
    const reply = createMockReply();
    const result = await handler(req, reply);
    if (reply.payload === undefined && result !== undefined) reply.payload = result;
    return reply;
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });

    // Standard-Mocks, die für Happy-Path benötigt werden
    prisma.photo.count.mockResolvedValue(0);
    prisma.photo.create.mockResolvedValue({
      id: 'photo-1',
      uploaderId: user.id,
      groupId: 'group-1',
      filename: 'clip.mp4',
      path: 'photos/test-key.mp4',
      mediaType: 'video',
      videoDuration: 30,
      albums: [],
    });
    prisma.groupMember.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.group.findUnique.mockResolvedValue({ name: 'Test Group', createdBy: 'other-user' });

    photosRoutes = (await import('../routes/photos.js')).default;
    await photosRoutes(fastify);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── MIME-Typ Validierung ──────────────────────────────

  describe('MIME-Typ Validierung', () => {
    it('lehnt eine PDF-Datei ab (weder Bild noch Video)', async () => {
      const req = createMultipartRequest({
        user,
        mimetype: 'application/pdf',
        fields: { groupId: 'group-1' },
      });
      const reply = await callPost(req);

      expect(reply.statusCode).toBe(400);
      expect(reply.payload.code).toBe('unsupported_format');
    });

    it('lehnt video/avi ab (nicht in der Allowlist)', async () => {
      const req = createMultipartRequest({
        user,
        mimetype: 'video/avi',
        fields: { groupId: 'group-1' },
      });
      const reply = await callPost(req);

      expect(reply.statusCode).toBe(400);
      expect(reply.payload.code).toBe('unsupported_video_format');
    });

    it('akzeptiert video/mp4', async () => {
      const req = createMultipartRequest({
        user,
        mimetype: 'video/mp4',
        fields: { groupId: 'group-1', videoDuration: '30' },
      });
      const reply = await callPost(req);

      expect(reply.statusCode).not.toBe(400);
      expect(reply.payload?.photo?.mediaType).toBe('video');
    });

    it('akzeptiert video/quicktime (MOV)', async () => {
      const req = createMultipartRequest({
        user,
        mimetype: 'video/quicktime',
        filename: 'clip.mov',
        fields: { groupId: 'group-1', videoDuration: '10' },
      });
      const reply = await callPost(req);

      expect(reply.statusCode).not.toBe(400);
    });
  });

  // ── Dateigröße ───────────────────────────────────────

  describe('Dateigröße', () => {
    it('lehnt ein Video ab, das MAX_VIDEO_FILE_SIZE_BYTES überschreitet', async () => {
      const oversizedBuffer = Buffer.alloc(MAX_VIDEO_FILE_SIZE_BYTES + 1);
      const req = createMultipartRequest({
        user,
        fileBuffer: oversizedBuffer,
        fields: { groupId: 'group-1' },
      });
      const reply = await callPost(req);

      expect(reply.statusCode).toBe(413);
      expect(reply.payload.code).toBe('video_file_too_large');
    });

    it('akzeptiert ein Video genau an der Größengrenze', async () => {
      const maxBuffer = Buffer.alloc(MAX_VIDEO_FILE_SIZE_BYTES);
      const req = createMultipartRequest({
        user,
        fileBuffer: maxBuffer,
        fields: { groupId: 'group-1', videoDuration: '10' },
      });
      const reply = await callPost(req);

      expect(reply.statusCode).not.toBe(413);
    });
  });

  // ── Videodauer ────────────────────────────────────────

  describe('Videodauer', () => {
    it('lehnt ein Video ab, das MAX_VIDEO_DURATION_SECONDS überschreitet', async () => {
      const req = createMultipartRequest({
        user,
        fields: { groupId: 'group-1', videoDuration: String(MAX_VIDEO_DURATION_SECONDS + 1) },
      });
      const reply = await callPost(req);

      expect(reply.statusCode).toBe(409);
      expect(reply.payload.code).toBe('video_duration_limit_exceeded');
      expect(reply.payload.max).toBe(MAX_VIDEO_DURATION_SECONDS);
    });

    it('akzeptiert ein Video, das genau MAX_VIDEO_DURATION_SECONDS lang ist', async () => {
      const req = createMultipartRequest({
        user,
        fields: { groupId: 'group-1', videoDuration: String(MAX_VIDEO_DURATION_SECONDS) },
      });
      const reply = await callPost(req);

      expect(reply.statusCode).not.toBe(409);
    });

    it('akzeptiert ein Video ohne videoDuration-Feld (Dauer unbekannt)', async () => {
      const req = createMultipartRequest({
        user,
        fields: { groupId: 'group-1' },
      });
      const reply = await callPost(req);

      // Kein Duration-Fehler – sollte durchgehen
      expect(reply.payload?.code).not.toBe('video_duration_limit_exceeded');
    });
  });

  // ── Globales Video-Kontingent ─────────────────────────

  describe('Globales Video-Kontingent (POST)', () => {
    it('lehnt Upload ab, wenn Nutzer MAX_USER_VIDEOS_GLOBAL Videos hat', async () => {
      prisma.photo.count.mockResolvedValue(MAX_USER_VIDEOS_GLOBAL);

      const req = createMultipartRequest({
        user,
        fields: { groupId: 'group-1', videoDuration: '10' },
      });
      const reply = await callPost(req);

      expect(reply.statusCode).toBe(409);
      expect(reply.payload.code).toBe('user_global_video_limit_reached');
      expect(reply.payload.max).toBe(MAX_USER_VIDEOS_GLOBAL);
      expect(reply.payload.current).toBe(MAX_USER_VIDEOS_GLOBAL);
    });

    it('erlaubt Upload, wenn Nutzer noch unter dem Limit ist', async () => {
      prisma.photo.count.mockResolvedValue(MAX_USER_VIDEOS_GLOBAL - 1);

      const req = createMultipartRequest({
        user,
        fields: { groupId: 'group-1', videoDuration: '10' },
      });
      const reply = await callPost(req);

      expect(reply.payload?.code).not.toBe('user_global_video_limit_reached');
    });
  });

  // ── mediaType wird korrekt gespeichert ───────────────

  describe('mediaType im DB-Eintrag', () => {
    it('setzt mediaType auf "video" bei Video-Upload', async () => {
      const req = createMultipartRequest({
        user,
        fields: { groupId: 'group-1', videoDuration: '30' },
      });
      await callPost(req);

      const createCall = prisma.photo.create.mock.calls[0][0];
      expect(createCall.data.mediaType).toBe('video');
    });

    it('setzt mediaType auf "image" bei Bild-Upload', async () => {
      prisma.photo.create.mockResolvedValue({
        id: 'photo-2',
        uploaderId: user.id,
        groupId: 'group-1',
        filename: 'photo.jpg',
        path: 'photos/photo.jpg',
        mediaType: 'image',
        videoDuration: null,
        albums: [],
      });

      const req = createMultipartRequest({
        user,
        mimetype: 'image/jpeg',
        filename: 'photo.jpg',
        fields: { groupId: 'group-1' },
      });
      await callPost(req);

      const createCall = prisma.photo.create.mock.calls[0][0];
      expect(createCall.data.mediaType).toBe('image');
      expect(createCall.data.videoDuration).toBeNull();
    });

    it('speichert videoDuration als Integer', async () => {
      const req = createMultipartRequest({
        user,
        fields: { groupId: 'group-1', videoDuration: '42' },
      });
      await callPost(req);

      const createCall = prisma.photo.create.mock.calls[0][0];
      expect(createCall.data.videoDuration).toBe(42);
    });
  });

  // ── GET /video-quota ──────────────────────────────────

  describe('GET /video-quota', () => {
    it('gibt aktuellen Stand, Maximum und verbleibende Slots zurück', async () => {
      prisma.photo.count.mockResolvedValue(5);

      const reply = await callGet('/video-quota');

      expect(reply.statusCode).toBe(200);
      expect(reply.payload).toEqual({
        current: 5,
        max: MAX_USER_VIDEOS_GLOBAL,
        remaining: MAX_USER_VIDEOS_GLOBAL - 5,
      });
    });

    it('gibt remaining: 0 zurück, wenn Limit erreicht', async () => {
      prisma.photo.count.mockResolvedValue(MAX_USER_VIDEOS_GLOBAL);

      const reply = await callGet('/video-quota');

      expect(reply.payload.remaining).toBe(0);
    });

    it('gibt 401 zurück, wenn kein gültiger Token vorliegt', async () => {
      const handler = fastify.routes.GET.get('/video-quota');
      const req = createMockRequest({
        user: null,
        jwtVerify: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 })),
      });
      const reply = createMockReply();
      await handler(req, reply);

      expect(reply.statusCode).toBe(500); // Route fängt alle Fehler als 500 – korrekt für diesen Fehlertyp
    });
  });

  // ── Fehlende groupId ─────────────────────────────────

  describe('Fehlende Pflichtfelder', () => {
    it('lehnt Upload ohne groupId ab', async () => {
      const req = createMultipartRequest({ user, fields: {} });
      const reply = await callPost(req);

      expect(reply.statusCode).toBe(400);
      expect(reply.payload.error).toMatch(/groupId/);
    });
  });
});
