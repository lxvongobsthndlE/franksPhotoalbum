/**
 * Integrationstests für die Logo-Routen (Spec §3 Schritt 1, §8.4).
 *
 * Die drei Endpunkte:
 *   POST   /api/tournaments/:id/logo   — Admin-Upload (multipart)
 *   DELETE /api/tournaments/:id/logo   — Admin-Entfernen
 *   GET    /api/tournaments/:id/logo   — Public Stream (kein JWT)
 *
 * Wir fahren eine echte Fastify-Instanz hoch, registrieren multipart
 * + JWT + Routes produktionsgleich und prüfen via app.inject().
 *
 * Test-Matrix:
 *   POST 401  - kein JWT (kein x-test-user)
 *   POST 403  - Member (kein Admin) versucht Upload
 *   POST 400  - keine Datei im Multipart-Body
 *   POST 400  - PDF statt Bild (unsupported_format)
 *   POST 413  - zu große Datei (logo_too_large)
 *   POST 200  - Admin lädt gültiges PNG hoch → logoUrl gesetzt
 *   POST 200  - Admin lädt JPEG/WebP → wird zu PNG konvertiert
 *   DELETE 401 - kein JWT
 *   DELETE 403 - Member
 *   DELETE 200 - Admin: MinIO-Objekt weg, logoUrl=null
 *   GET 404  - Turnier existiert nicht
 *   GET 404  - Draft-Turnier (kein Leak)
 *   GET 404  - existierendes Turnier ohne Logo
 *   GET 200  - Live-Turnier mit Logo → PNG-Stream
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import tournamentsRoutes from '../index.js';

// Mock den storage-Layer vollständig — wir testen die Routen, nicht
// MinIO. Die Storage-Funktionen haben ihre eigenen Tests.
vi.mock('../../../utils/storage.js', () => ({
  uploadTournamentLogo: vi.fn(async (_buffer, _mimetype, tournamentId) => {
    return `logo_${tournamentId}`;
  }),
  deleteTournamentAsset: vi.fn(async () => {}),
  getTournamentAssetStream: vi.fn(async (_tournamentId) => {
    // Stream mit ein paar Dummy-Bytes — Fastify akzeptiert Readable.
    const { Readable } = await import('node:stream');
    return Readable.from([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
  }),
  getTournamentAssetStat: vi.fn(async () => ({
    size: 8,
    metaData: { 'content-type': 'image/png' },
  })),
}));

// Statischer Import des gemockten Moduls, damit wir in den Tests
// Zugriff auf dieselben mock-Instanzen haben, die auch routes.js
// verwendet. vi.mock() wirkt auf statische Imports, nicht auf
// dynamic import() — daher dieser Weg.
import * as storage from '../../../utils/storage.js';

// ------------------------------------------------------------------
// Lokaler Prisma-Mock (Modellnamen aus schema.prisma).
// ------------------------------------------------------------------
function createLocalMockPrisma() {
  const fn = () => vi.fn();
  return {
    user: { findUnique: fn() },
    group: { findUnique: fn() },
    groupMember: { findUnique: fn() },
    groupDeputy: { findUnique: fn() },
    tournament: {
      findUnique: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
    },
    tournamentTeam: { findMany: fn() },
    stage: { findMany: fn(), findUnique: fn(), create: fn(), deleteMany: fn() },
    group_: { findMany: fn(), create: fn() },
    groupMembership: { findMany: fn(), createMany: fn() },
    match: {
      findMany: fn(),
      findFirst: fn(),
      findUnique: fn(),
      create: fn(),
      createMany: fn(),
      update: fn(),
      updateMany: fn(),
      count: fn(),
      groupBy: fn(),
    },
    $transaction: vi.fn(async (cb) => {
      return typeof cb === 'function' ? cb(prisma) : cb;
    }),
  };
}

const u = {
  member: { id: 'u-member', role: 'user' },
  admin: { id: 'u-admin', role: 'user' },
  global: { id: 'u-global', role: 'admin' },
  stranger: { id: 'u-stranger', role: 'user' },
};
const gId = 'g-1';
const tDraft = 't-draft';
const tLive = 't-live';

function baseStubs(prisma) {
  prisma.user.findUnique.mockImplementation(async ({ where }) => {
    const map = {
      [u.member.id]: { id: u.member.id, role: u.member.role },
      [u.admin.id]: { id: u.admin.id, role: u.admin.role },
      [u.global.id]: { id: u.global.id, role: u.global.role },
      [u.stranger.id]: { id: u.stranger.id, role: u.stranger.role },
    };
    return map[where.id] ?? null;
  });

  prisma.group.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === gId) return { id: gId, createdBy: u.admin.id };
    return null;
  });

  prisma.groupDeputy.findUnique.mockResolvedValue(null);

  prisma.groupMember.findUnique.mockImplementation(async ({ where }) => {
    const { userId, groupId } = where.userId_groupId ?? {};
    if (groupId !== gId) return null;
    if (userId === u.member.id) return { userId: u.member.id, groupId: gId };
    if (userId === u.admin.id) return { userId: u.admin.id, groupId: gId };
    if (userId === u.global.id) return { userId: u.global.id, groupId: gId };
    return null;
  });

  prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === tDraft) {
      return {
        id: tDraft,
        groupId: gId,
        status: 'draft',
        isPublic: false,
        publicToken: null,
        publicRevokedAt: null,
        logoUrl: null,
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    if (where.id === tLive) {
      return {
        id: tLive,
        groupId: gId,
        status: 'group_stage',
        isPublic: false,
        publicToken: null,
        publicRevokedAt: null,
        logoUrl: '/api/tournaments/' + tLive + '/logo',
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    return null;
  });

  // Defaults, falls Standings-Aufrufe kämen.
  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.groupMembership.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.groupBy.mockResolvedValue([]);
}

async function buildApp(prisma) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);
  await app.register(multipart, {
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  // Test-Auth: x-test-user → request.user.id. Ohne Header wirft
  // jwtVerify (401), wie in Produktion.
  app.addHook('preHandler', async (request) => {
    request.jwtVerify = async () => {
      const uid = request.headers['x-test-user'];
      if (!uid) {
        const err = new Error('Missing JWT');
        err.statusCode = 401;
        throw err;
      }
      request.user = { id: String(uid) };
    };
  });

  await app.register(tournamentsRoutes, { prefix: '/api/tournaments' });
  await app.ready();
  return app;
}

// Hilfsfunktion: 1x1 PNG (rot) — echte PNG-Bytes, damit sharp() sie
// ohne Murren einliest.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
);

// 1x1 JPEG
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z',
  'base64'
);

// 1x1 WebP
const TINY_WEBP = Buffer.from(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vshgAA=',
  'base64'
);

// 1x1 PDF (Header "%PDF-1.4")
const TINY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8'
);

// Multipart-Roh-Body selbst bauen — Fastify multipart parst ihn, wenn
// der Content-Type-Header gesetzt ist.
function buildMultipart({ field = 'file', filename, contentType, buffer }) {
  const boundary = '----TestBoundary' + Math.random().toString(16).slice(2);
  const parts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n`,
    `Content-Type: ${contentType}\r\n\r\n`,
    buffer,
    `\r\n--${boundary}--\r\n`,
  ];
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'utf8')))),
  };
}

let storageNs;
beforeEach(async () => {
  storageNs = storage;
  storageNs.uploadTournamentLogo.mockClear();
  storageNs.deleteTournamentAsset.mockClear();
  storageNs.getTournamentAssetStream.mockClear();
  storageNs.getTournamentAssetStat.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ==================================================================
// POST /api/tournaments/:id/logo
// ==================================================================

describe('POST /api/tournaments/:id/logo', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('401: kein JWT', async () => {
    const mp = buildMultipart({
      filename: 'logo.png',
      contentType: 'image/png',
      buffer: TINY_PNG,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: mp.headers,
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('403: Member (kein Admin) bekommt 403', async () => {
    const mp = buildMultipart({
      filename: 'logo.png',
      contentType: 'image/png',
      buffer: TINY_PNG,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: { ...mp.headers, 'x-test-user': u.member.id },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('400: keine Datei im Multipart', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: {
        'content-type': 'multipart/form-data; boundary=----nobody',
        'x-test-user': u.admin.id,
      },
      payload: Buffer.from('------nobody--\r\n'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'no_file' });
  });

  it('400: PDF statt Bild (unsupported_format)', async () => {
    const mp = buildMultipart({
      filename: 'spielplan.pdf',
      contentType: 'application/pdf',
      buffer: TINY_PDF,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: { ...mp.headers, 'x-test-user': u.admin.id },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'unsupported_format' });
  });

  it('400: SVG (auch Bild, aber nicht im Allowlist)', async () => {
    const mp = buildMultipart({
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: { ...mp.headers, 'x-test-user': u.admin.id },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'unsupported_format' });
  });

  it('413: Datei > 5 MB (logo_too_large)', async () => {
    // 6 MB PNG — Header echt, dann Nullen.
    const big = Buffer.alloc(6 * 1024 * 1024, 0);
    const mp = buildMultipart({
      filename: 'huge.png',
      contentType: 'image/png',
      buffer: big,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: { ...mp.headers, 'x-test-user': u.admin.id },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'logo_too_large' });
  });

  it('200: Admin lädt gültiges PNG hoch, logoUrl gesetzt', async () => {
    const mp = buildMultipart({
      filename: 'logo.png',
      contentType: 'image/png',
      buffer: TINY_PNG,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: { ...mp.headers, 'x-test-user': u.admin.id },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.logoUrl).toBe(`/api/tournaments/${tDraft}/logo`);
    expect(storage.uploadTournamentLogo).toHaveBeenCalledTimes(1);
    // Argument 3 (tournamentId) und 4 (kind) prüfen
    const callArgs = storage.uploadTournamentLogo.mock.calls[0];
    expect(callArgs[2]).toBe(tDraft);
    expect(callArgs[3]).toBe('logo');
    // DB-Update mit logoUrl
    expect(prisma.tournament.update).toHaveBeenCalledWith({
      where: { id: tDraft },
      data: { logoUrl: `/api/tournaments/${tDraft}/logo` },
    });
  });

  it('200: Admin lädt JPEG hoch, wird zu PNG konvertiert', async () => {
    const mp = buildMultipart({
      filename: 'logo.jpg',
      contentType: 'image/jpeg',
      buffer: TINY_JPEG,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: { ...mp.headers, 'x-test-user': u.admin.id },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(200);
    // resizeLogoImage liefert mimetype='image/png'
    const callArgs = storage.uploadTournamentLogo.mock.calls[0];
    expect(callArgs[1]).toBe('image/png');
  });

  it('200: Admin lädt WebP hoch', async () => {
    const mp = buildMultipart({
      filename: 'logo.webp',
      contentType: 'image/webp',
      buffer: TINY_WEBP,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: { ...mp.headers, 'x-test-user': u.admin.id },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(200);
    expect(storage.uploadTournamentLogo).toHaveBeenCalledTimes(1);
  });

  it('200: Globaler Admin (role=admin) darf auch', async () => {
    const mp = buildMultipart({
      filename: 'logo.png',
      contentType: 'image/png',
      buffer: TINY_PNG,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: { ...mp.headers, 'x-test-user': u.global.id },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(200);
  });

  it('404: Turnier existiert nicht', async () => {
    const mp = buildMultipart({
      filename: 'logo.png',
      contentType: 'image/png',
      buffer: TINY_PNG,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/t-notfound/logo`,
      headers: { ...mp.headers, 'x-test-user': u.admin.id },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ==================================================================
// DELETE /api/tournaments/:id/logo
// ==================================================================

describe('DELETE /api/tournaments/:id/logo', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('401: kein JWT', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tDraft}/logo`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('403: Member (kein Admin) bekommt 403', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tDraft}/logo`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('200: Admin entfernt Logo, MinIO + DB werden aufgeräumt', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tLive}/logo`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(storage.deleteTournamentAsset).toHaveBeenCalledWith(tLive, 'logo');
    expect(prisma.tournament.update).toHaveBeenCalledWith({
      where: { id: tLive },
      data: { logoUrl: null },
    });
  });

  it('404: Turnier existiert nicht', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/t-notfound/logo`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ==================================================================
// DELETE /api/tournaments/:id — Logo (und Cover) räumen mit auf
// ==================================================================
describe('DELETE /api/tournaments/:id — Asset-Cleanup', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('200: Turnier löschen räumt Logo und Cover aus MinIO mit auf', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tLive}`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    // Beide Asset-Kinds werden aufgeräumt — Logo und Cover.
    // Reihenfolge: erst DB, dann MinIO. Wir prüfen die Aufrufe.
    expect(storage.deleteTournamentAsset).toHaveBeenCalledWith(tLive, 'logo');
    expect(storage.deleteTournamentAsset).toHaveBeenCalledWith(tLive, 'cover');
    expect(prisma.tournament.delete).toHaveBeenCalledWith({
      where: { id: tLive },
    });
  });

  it('MinIO-Fehler beim Aufräumen blockiert das Löschen NICHT', async () => {
    // Wenn MinIO streikt, wollen wir trotzdem die DB-Zeile weg haben.
    // Verwaiste Objekte sind weniger schlimm als ein Zombie-Turnier.
    storage.deleteTournamentAsset.mockRejectedValueOnce(new Error('MinIO down'));
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tLive}`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.tournament.delete).toHaveBeenCalled();
  });

  it('401: kein JWT', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tLive}`,
    });
    expect(res.statusCode).toBe(401);
    expect(storage.deleteTournamentAsset).not.toHaveBeenCalled();
  });
});

// ==================================================================
// POST /api/tournaments/:id/generate — Logo bleibt erhalten
// ==================================================================
describe('POST /api/tournaments/:id/generate — Logo bleibt', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('Generate löscht NICHT das Logo (regenerate ist logo-erhaltend)', async () => {
    // Wir prüfen die zentrale Invariante: der Generate-Endpoint darf
    // das Logo nicht antasten — egal ob er durchläuft oder nicht.
    // Wir schicken einen Request, der mit hoher Wahrscheinlichkeit
    // durchläuft (zwei Teams, eine Gruppe); selbst bei 4xx/5xx ist
    // die Asset-Operation das, was wir beobachten wollen.
    prisma.tournamentTeam.findMany.mockResolvedValue([
      { id: 'team-1', name: 'A', seed: 1 },
      { id: 'team-2', name: 'B', seed: 2 },
    ]);
    prisma.match.count.mockResolvedValue(0); // keine finished matches
    prisma.match.createMany.mockResolvedValue({ count: 1 });
    prisma.stage.create.mockResolvedValue({ id: 's-1', tournamentId: tLive });
    prisma.stage.deleteMany.mockResolvedValue({ count: 0 });
    prisma.group_.create.mockResolvedValue({ id: 'g-1', key: 'A', name: 'A' });
    prisma.groupMembership.createMany.mockResolvedValue({ count: 0 });
    prisma.tournament.update.mockResolvedValue({});

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tLive}/generate`,
      headers: { 'x-test-user': u.admin.id },
      payload: { numGroups: 1 },
    });
    // Status ignorieren — wir prüfen NUR die Asset-Operation.
    expect([200, 201, 400, 409, 500]).toContain(res.statusCode);
    // Wichtig: kein Asset-Delete.
    expect(storage.deleteTournamentAsset).not.toHaveBeenCalled();
  });
});

// ==================================================================
// GET /api/tournaments/:id/logo
// ==================================================================

describe('GET /api/tournaments/:id/logo', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('404: Turnier existiert nicht', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/t-notfound/logo`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('404: Draft-Turnier → Logo wird nicht ausgeliefert (Leak-Schutz)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tDraft}/logo`,
    });
    expect(res.statusCode).toBe(404);
    expect(storage.getTournamentAssetStream).not.toHaveBeenCalled();
  });

  it('404: Live-Turnier ohne Logo (MinIO NoSuchKey)', async () => {
    storage.getTournamentAssetStat.mockRejectedValueOnce({
      code: 'NoSuchKey',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tLive}/logo`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('200: Live-Turnier mit Logo → Stream aus MinIO', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tLive}/logo`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(storage.getTournamentAssetStream).toHaveBeenCalledWith(tLive, 'logo');
  });

  it('kein JWT nötig (öffentlich)', async () => {
    // Sicherstellen: kein x-test-user Header, trotzdem 200.
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tLive}/logo`,
    });
    expect(res.statusCode).toBe(200);
  });
});
