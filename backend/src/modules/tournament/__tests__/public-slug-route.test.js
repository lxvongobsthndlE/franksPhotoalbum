/**
 * Routen-Tests für den umbenennbaren Zuschauer-Link (28.08.2026).
 *
 * public-slug.test.js prüft die Bausteine. Hier geht es um die Zusagen,
 * die nur der ganze Weg durch die Fastify-Kette belegen kann:
 *
 *   GET    /public/:ref        Slug UND Token führen zum SELBEN Turnier
 *   PATCH  /:id/public/slug    401 · 403 · 400 · 409 vergeben · 409 ohne Link
 *   DELETE /:id/public         löscht Token UND Slug
 *   GET    /public/:ref/qr.svg zeigt nach dem Umbenennen die NEUE Adresse
 *
 * Die zwei Zusagen, die am leichtesten still brechen, stehen jeweils
 * eigens unten drunter kommentiert: der tote Alt-Slug (Entscheidung
 * „keine Weiterleitung") und der Entwurf, der auch mit gültigem Namen
 * unsichtbar bleibt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';
import { buildQrSvg } from '../public-qr.js';

vi.mock('../../../utils/storage.js', () => ({
  uploadTournamentLogo: vi.fn(async () => {}),
  deleteTournamentAsset: vi.fn(async () => {}),
  getTournamentAssetStream: vi.fn(async () => null),
  getTournamentAssetStat: vi.fn(async () => null),
}));

const u = { member: { id: 'u-member' }, admin: { id: 'u-admin' } };
const gId = 'g-1';
const TOKEN_A = 'A'.repeat(32);
const TOKEN_B = 'B'.repeat(32);

const basisTurnier = (over) => ({
  groupId: gId,
  mode: 'groups_ko',
  config: {},
  isPublic: false,
  publicToken: null,
  publicSlug: null,
  publicEnabledAt: null,
  publicRevokedAt: null,
  startedAt: new Date(),
  sport: 'becher',
  createdById: u.admin.id,
  ...over,
});

const tournaments = {
  't-a': basisTurnier({
    id: 't-a',
    name: 'Sommerturnier',
    status: 'group_stage',
    isPublic: true,
    publicToken: TOKEN_A,
    publicSlug: null,
    publicEnabledAt: new Date(),
  }),
  't-b': basisTurnier({
    id: 't-b',
    name: 'Herbstturnier',
    status: 'ko_stage',
    isPublic: true,
    publicToken: TOKEN_B,
    publicSlug: 'herbst-2026',
    publicEnabledAt: new Date(),
  }),
  't-draft': basisTurnier({
    id: 't-draft',
    name: 'Entwurf',
    status: 'draft',
    startedAt: null,
    // Ein Entwurf MIT gültigem Slug — der Fall, den die Regel
    // „Entwürfe sind nie öffentlich" abfangen muss. Über die Routen
    // entsteht er nicht (POST /:id/public lehnt Entwürfe ab), über eine
    // spätere Rückstufung nach draft aber sehr wohl.
    isPublic: true,
    publicToken: 'C'.repeat(32),
    publicSlug: 'geheimer-entwurf',
    publicEnabledAt: new Date(),
  }),
  't-zu': basisTurnier({
    id: 't-zu',
    name: 'Ohne Link',
    status: 'group_stage',
  }),
};

function mockPrisma() {
  const zeilen = structuredClone(tournaments);

  const p = {
    tournament: {
      findUnique: vi.fn(async ({ where }) => {
        let z = null;
        if (where.id) z = zeilen[where.id] ?? null;
        if (where.publicToken) {
          z = Object.values(zeilen).find((t) => t.publicToken === where.publicToken) ?? null;
        }
        if (where.publicSlug) {
          z = Object.values(zeilen).find((t) => t.publicSlug === where.publicSlug) ?? null;
        }
        if (!z) return null;
        return { ...z, group: { id: gId, createdBy: u.admin.id, name: 'Verein' } };
      }),
      update: vi.fn(async ({ where, data, select }) => {
        // Der echte Unique-Index, nachgestellt. Ohne ihn liefe der
        // Kollisionstest gegen einen Mock, der alles annimmt — und
        // bewiese nichts.
        if (typeof data.publicSlug === 'string') {
          const fremd = Object.values(zeilen).find(
            (t) => t.id !== where.id && t.publicSlug === data.publicSlug
          );
          if (fremd) {
            const err = new Error('Unique constraint failed');
            err.code = 'P2002';
            err.meta = { target: ['publicSlug'] };
            throw err;
          }
        }
        Object.assign(zeilen[where.id], data);
        const z = zeilen[where.id];
        if (!select) return { ...z };
        const raus = {};
        for (const k of Object.keys(select)) raus[k] = z[k];
        return raus;
      }),
    },
    group: { findUnique: vi.fn(async () => ({ createdBy: u.admin.id })) },
    groupDeputy: { findUnique: vi.fn(async () => null) },
    groupMember: { findUnique: vi.fn(async () => ({ userId: u.member.id, groupId: gId })) },
    user: { findUnique: vi.fn(async ({ where }) => ({ id: where.id, role: 'user' })) },
    tournamentTeam: { findMany: vi.fn(async () => []) },
    stage: { findMany: vi.fn(async () => []) },
    group_: { findMany: vi.fn(async () => []) },
    match: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (cb) => (typeof cb === 'function' ? cb(p) : cb)),
    _zeilen: zeilen,
  };
  return p;
}

async function buildApp(prisma) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);
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

let prisma, app;
beforeEach(async () => {
  prisma = mockPrisma();
  app = await buildApp(prisma);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

const alsAdmin = (method, url, payload = {}) =>
  app.inject({ method, url, headers: { 'x-test-user': u.admin.id }, payload });

const alsMitglied = (method, url, payload = {}) =>
  app.inject({ method, url, headers: { 'x-test-user': u.member.id }, payload });

// ─────────────────────────────────────────────────────────
describe('GET /api/tournaments/:id/public — Stand des Links', () => {
  it('401 ohne Login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tournaments/t-b/public' });
    expect(res.statusCode).toBe(401);
  });

  it('403 für ein Mitglied — der Token ist ein Zugang, kein Anzeigefeld', async () => {
    const res = await alsMitglied('GET', '/api/tournaments/t-b/public');
    expect(res.statusCode).toBe(403);
  });

  it('liefert dem Admin Adresse, Pfad und QR-Quelle fertig', async () => {
    const body = (await alsAdmin('GET', '/api/tournaments/t-b/public')).json();
    expect(body.isPublic).toBe(true);
    expect(body.slug).toBe('herbst-2026');
    expect(body.token).toBe(TOKEN_B);
    expect(body.address).toBe('herbst-2026');
    expect(body.path).toBe('/t/herbst-2026');
    expect(body.qrPath).toBe('/api/tournaments/public/herbst-2026/qr.svg');
    expect(body.url).toMatch(/\/t\/herbst-2026$/);
  });

  it('ohne Slug ist der Token die Adresse', async () => {
    const body = (await alsAdmin('GET', '/api/tournaments/t-a/public')).json();
    expect(body.slug).toBeNull();
    expect(body.address).toBe(TOKEN_A);
    expect(body.path).toBe(`/t/${TOKEN_A}`);
  });

  it('ohne Freigabe meldet die Route das offen', async () => {
    const body = (await alsAdmin('GET', '/api/tournaments/t-zu/public')).json();
    expect(body.isPublic).toBe(false);
    expect(body.address).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
describe('PATCH /api/tournaments/:id/public/slug — umbenennen', () => {
  it('401 ohne Login', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/tournaments/t-a/public/slug',
      payload: { slug: 'sommerfest' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 für ein Mitglied — und die Datenbank bleibt unberührt', async () => {
    const res = await alsMitglied('PATCH', '/api/tournaments/t-a/public/slug', {
      slug: 'sommerfest',
    });
    expect(res.statusCode).toBe(403);
    expect(prisma._zeilen['t-a'].publicSlug).toBeNull();
  });

  it('Admin setzt den Namen — normalisiert und mit fertiger Adresse', async () => {
    const res = await alsAdmin('PATCH', '/api/tournaments/t-a/public/slug', {
      slug: 'Sommerfest 2026',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe('sommerfest-2026');
    expect(body.path).toBe('/t/sommerfest-2026');
    expect(body.changed).toBe(true);
    expect(body.previousSlug).toBeNull();
    expect(prisma._zeilen['t-a'].publicSlug).toBe('sommerfest-2026');
    // Der Token bleibt. Er ist die Rückfallebene, nicht der Wegwerfteil.
    expect(prisma._zeilen['t-a'].publicToken).toBe(TOKEN_A);
  });

  it('400 bei ungültigem Format, mit deutscher Erklärung am Feld', async () => {
    const res = await alsAdmin('PATCH', '/api/tournaments/t-a/public/slug', { slug: 'ab' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('slug_zu_kurz');
    expect(res.json().message).toMatch(/mindestens/i);
  });

  it('400 für einen reservierten Namen', async () => {
    const res = await alsAdmin('PATCH', '/api/tournaments/t-a/public/slug', { slug: 'Aushang' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('slug_reserviert');
  });

  it('400 für einen Namen, der wie ein Token aussieht', async () => {
    const res = await alsAdmin('PATCH', '/api/tournaments/t-a/public/slug', {
      slug: 'x'.repeat(32),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('slug_wie_token');
  });

  it('409 wenn der Name schon vergeben ist — kein Prisma-Absturz', async () => {
    const res = await alsAdmin('PATCH', '/api/tournaments/t-a/public/slug', {
      slug: 'herbst-2026',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('slug_taken');
    expect(res.json().message).toMatch(/vergeben/i);
    // Kein Durchschlagen des Prisma-Fehlers als 500.
    expect(res.statusCode).not.toBe(500);
  });

  it('409 solange es gar keinen Link gibt', async () => {
    const res = await alsAdmin('PATCH', '/api/tournaments/t-zu/public/slug', { slug: 'irgendwas' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('link_not_public');
  });

  it('derselbe Name noch einmal ändert nichts und meldet das', async () => {
    const res = await alsAdmin('PATCH', '/api/tournaments/t-b/public/slug', {
      slug: 'Herbst 2026',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBe(false);
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('leer heißt: Namen wieder abgeben, zurück auf den Zufallslink', async () => {
    const res = await alsAdmin('PATCH', '/api/tournaments/t-b/public/slug', { slug: '' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBeNull();
    expect(body.address).toBe(TOKEN_B);
    expect(body.previousSlug).toBe('herbst-2026');
    expect(prisma._zeilen['t-b'].publicSlug).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
describe('Auflösung: eine Adresse, zwei Wege', () => {
  it('Slug und Token führen zum selben Turnier', async () => {
    const ueberSlug = await app.inject({
      method: 'GET',
      url: '/api/tournaments/public/herbst-2026',
    });
    const ueberToken = await app.inject({
      method: 'GET',
      url: `/api/tournaments/public/${TOKEN_B}`,
    });
    expect(ueberSlug.statusCode).toBe(200);
    expect(ueberToken.statusCode).toBe(200);
    expect(ueberSlug.json().tournament.name).toBe('Herbstturnier');
    expect(ueberToken.json().tournament.name).toBe('Herbstturnier');
  });

  it('Groß- und Kleinschreibung im Slug ist egal — auf dem Plakat auch', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tournaments/public/Herbst-2026' });
    expect(res.statusCode).toBe(200);
  });

  it('der ALTE Name ist nach dem Umbenennen tot — es gibt keine Weiterleitung', async () => {
    // Die Entscheidung dahinter: Eine Weiterleitung hielte jeden
    // gedruckten Aushang still am Leben, und der Betreiber wüsste nie,
    // ob ein ersetzter Link wirklich weg ist.
    await alsAdmin('PATCH', '/api/tournaments/t-b/public/slug', { slug: 'winter-2027' });

    const alt = await app.inject({ method: 'GET', url: '/api/tournaments/public/herbst-2026' });
    expect(alt.statusCode).toBe(404);

    const neu = await app.inject({ method: 'GET', url: '/api/tournaments/public/winter-2027' });
    expect(neu.statusCode).toBe(200);

    // Der Zufallslink überlebt die Umbenennung.
    const token = await app.inject({ method: 'GET', url: `/api/tournaments/public/${TOKEN_B}` });
    expect(token.statusCode).toBe(200);
  });

  it('ein Entwurf bleibt auch mit gültigem Slug unsichtbar — 404, nicht 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tournaments/public/geheimer-entwurf',
    });
    expect(res.statusCode).toBe(404);
    // 403 würde verraten, dass es das Turnier gibt.
    expect(res.statusCode).not.toBe(403);
  });

  it('ein unbekannter Name ist ein 404 wie jeder andere', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tournaments/public/gibt-es-nicht' });
    expect(res.statusCode).toBe(404);
  });

  it('über den öffentlichen Pfad kommt kein Schreibzugriff', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const res = await app.inject({
        method,
        url: '/api/tournaments/public/herbst-2026',
        payload: {},
      });
      expect(res.statusCode, `${method} kam durch`).toBeGreaterThanOrEqual(400);
      expect(prisma._zeilen['t-b'].publicSlug).toBe('herbst-2026');
    }
  });

  it('der Slug taucht in der öffentlichen Nutzlast nicht auf', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tournaments/public/herbst-2026' });
    expect(res.body).not.toContain('publicSlug');
    expect(res.body).not.toContain(TOKEN_B);
  });
});

// ─────────────────────────────────────────────────────────
describe('QR-Code folgt der Umbenennung', () => {
  it('zeigt nach dem Umbenennen die NEUE Adresse — auch über den Token angefordert', async () => {
    const vorher = await app.inject({
      method: 'GET',
      url: `/api/tournaments/public/${TOKEN_A}/qr.svg`,
    });
    expect(vorher.statusCode).toBe(200);

    const patch = (
      await alsAdmin('PATCH', '/api/tournaments/t-a/public/slug', { slug: 'sommerfest-2026' })
    ).json();

    const nachher = await app.inject({
      method: 'GET',
      url: `/api/tournaments/public/${TOKEN_A}/qr.svg`,
    });
    expect(nachher.statusCode).toBe(200);
    // Anderes Muster als vorher …
    expect(nachher.body).not.toBe(vorher.body);
    // … und zwar genau das Muster der neuen Adresse. Die URL kommt aus
    // der PATCH-Antwort, damit Schema und Host dieselben sind wie im
    // Request — ein QR mit dem falschen Host sieht richtig aus.
    expect(nachher.body).toBe(buildQrSvg(patch.url));
  });

  it('der QR unter dem neuen Namen ist derselbe wie der unter dem Token', async () => {
    await alsAdmin('PATCH', '/api/tournaments/t-a/public/slug', { slug: 'sommerfest-2026' });
    const ueberSlug = await app.inject({
      method: 'GET',
      url: '/api/tournaments/public/sommerfest-2026/qr.svg',
    });
    const ueberToken = await app.inject({
      method: 'GET',
      url: `/api/tournaments/public/${TOKEN_A}/qr.svg`,
    });
    expect(ueberSlug.body).toBe(ueberToken.body);
  });

  it('wird nicht zwischengespeichert — ein gecachter QR zeigt sonst auf die tote Adresse', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/public/${TOKEN_A}/qr.svg`,
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['cache-control']).not.toContain('max-age=3600');
  });
});

// ─────────────────────────────────────────────────────────
describe('DELETE /api/tournaments/:id/public — Widerruf nimmt beide Adressen mit', () => {
  it('löscht Token UND Slug', async () => {
    const res = await alsAdmin('DELETE', '/api/tournaments/t-b/public');
    expect(res.statusCode).toBe(200);
    expect(prisma._zeilen['t-b'].publicToken).toBeNull();
    expect(prisma._zeilen['t-b'].publicSlug).toBeNull();
    expect(prisma._zeilen['t-b'].isPublic).toBe(false);
  });

  it('der widerrufene Name führt danach ins Leere', async () => {
    await alsAdmin('DELETE', '/api/tournaments/t-b/public');
    const res = await app.inject({ method: 'GET', url: '/api/tournaments/public/herbst-2026' });
    expect(res.statusCode).toBe(404);
  });

  it('eine spätere zweite Freigabe schaltet den alten Namen NICHT wieder scharf', async () => {
    // Die eigentliche Zusage: Der Slug ist die Adresse, die im Umlauf
    // ist — sie stehen zu lassen, machte den Widerruf für den
    // wichtigeren der beiden Wege wirkungslos.
    await alsAdmin('DELETE', '/api/tournaments/t-b/public');
    const neu = (await alsAdmin('POST', '/api/tournaments/t-b/public')).json();
    expect(neu.slug).toBeNull();
    expect(neu.token).not.toBe(TOKEN_B);

    const alt = await app.inject({ method: 'GET', url: '/api/tournaments/public/herbst-2026' });
    expect(alt.statusCode).toBe(404);
  });
});
