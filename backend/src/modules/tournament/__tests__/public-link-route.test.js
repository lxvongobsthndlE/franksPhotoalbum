/**
 * Routen-Tests für den Zuschauer-Link (Spec §11, Stufe B).
 *
 * public-access.test.js prüft die Bausteine. Hier geht es um den Weg durch
 * die echte Fastify-Kette — Auth, Statuscodes, was tatsächlich im Rumpf
 * ankommt:
 *
 *   POST   /:id/public      401 ohne Login · 403 für Mitglieder ·
 *                           409 im Entwurf · 200 mit Token · idempotent
 *   DELETE /:id/public      401 · 403 · löscht den Token wirklich
 *   GET    /public/:token   ohne jede Anmeldung · 404 in allen
 *                           Ablehnungsfällen · ohne Personendaten
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';

vi.mock('../../../utils/storage.js', () => ({
  uploadTournamentLogo: vi.fn(async () => {}),
  deleteTournamentAsset: vi.fn(async () => {}),
  getTournamentAssetStream: vi.fn(async () => null),
  getTournamentAssetStat: vi.fn(async () => null),
}));

const u = { member: { id: 'u-member' }, admin: { id: 'u-admin' } };
const gId = 'g-1';
const TOKEN = 'T'.repeat(32);

const tournaments = {
  't-live': {
    id: 't-live',
    groupId: gId,
    name: 'Sommerturnier',
    status: 'group_stage',
    mode: 'groups_ko',
    config: {},
    isPublic: false,
    publicToken: null,
    publicEnabledAt: null,
    publicRevokedAt: null,
    startedAt: new Date(),
    location: 'Vereinsheim',
    sport: 'becher',
    createdById: u.admin.id,
  },
  't-draft': {
    id: 't-draft',
    groupId: gId,
    name: 'Entwurf',
    status: 'draft',
    mode: 'groups_ko',
    config: {},
    isPublic: false,
    publicToken: null,
    publicEnabledAt: null,
    publicRevokedAt: null,
    startedAt: null,
    createdById: u.admin.id,
  },
  't-shared': {
    id: 't-shared',
    groupId: gId,
    name: 'Geteiltes Turnier',
    status: 'ko_stage',
    mode: 'groups_ko',
    config: {},
    isPublic: true,
    publicToken: TOKEN,
    publicEnabledAt: new Date(),
    publicRevokedAt: null,
    startedAt: new Date(),
    createdById: u.admin.id,
  },
};

function mockPrisma() {
  const zeilen = structuredClone(tournaments);
  // structuredClone macht aus Date wieder Date — passt.

  const p = {
    tournament: {
      findUnique: vi.fn(async ({ where }) => {
        let z = null;
        if (where.id) z = zeilen[where.id] ?? null;
        if (where.publicToken) {
          z = Object.values(zeilen).find((t) => t.publicToken === where.publicToken) ?? null;
        }
        if (!z) return null;
        return { ...z, group: { id: gId, createdBy: u.admin.id, name: 'Verein' } };
      }),
      update: vi.fn(async ({ where, data, select }) => {
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
    tournamentTeam: {
      findMany: vi.fn(async () => [
        {
          id: 'team-1',
          tournamentId: 't-shared',
          name: 'Die Adler',
          color: '#f00',
          logoUrl: null,
          seed: 1,
          players: 'Anna Schmidt, Bernd Meier',
          linkedUserIds: ['u-member'],
        },
      ]),
    },
    stage: {
      findMany: vi.fn(async () => [
        { id: 's1', tournamentId: 't-shared', type: 'group', name: 'Gruppenphase', orderIndex: 0 },
      ]),
    },
    group_: {
      findMany: vi.fn(async () => [
        {
          id: 'grp-a',
          stageId: 's1',
          key: 'A',
          name: 'Gruppe A',
          memberships: [
            {
              id: 'mm1',
              groupId: 'grp-a',
              teamId: 'team-1',
              position: 0,
              team: { id: 'team-1', name: 'Die Adler' },
            },
          ],
          matches: [],
        },
      ]),
    },
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

const alsAdmin = (method, url) =>
  app.inject({ method, url, headers: { 'x-test-user': u.admin.id }, payload: {} });

describe('POST /api/tournaments/:id/public — Freigabe', () => {
  it('401 ohne Login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments/t-live/public',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 für ein Mitglied', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments/t-live/public',
      headers: { 'x-test-user': u.member.id },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('409 für einen Entwurf, mit erklärendem Fehlercode', async () => {
    const res = await alsAdmin('POST', '/api/tournaments/t-draft/public');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('tournament_is_draft');
  });

  it('Admin bekommt einen Token und den fertigen Pfad', async () => {
    const res = await alsAdmin('POST', '/api/tournaments/t-live/public');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(body.path).toBe(`/t/${body.token}`);
    expect(body.created).toBe(true);
    expect(prisma._zeilen['t-live'].isPublic).toBe(true);
    expect(prisma._zeilen['t-live'].publicRevokedAt).toBeNull();
  });

  it('zweite Freigabe ändert den Link nicht (idempotent)', async () => {
    const erste = (await alsAdmin('POST', '/api/tournaments/t-live/public')).json();
    const zweite = (await alsAdmin('POST', '/api/tournaments/t-live/public')).json();
    expect(zweite.token).toBe(erste.token);
    expect(zweite.created).toBe(false);
  });

  it('Freigabe NACH einem Widerruf erzeugt einen neuen Token', async () => {
    const erste = (await alsAdmin('POST', '/api/tournaments/t-live/public')).json();
    await alsAdmin('DELETE', '/api/tournaments/t-live/public');
    const zweite = (await alsAdmin('POST', '/api/tournaments/t-live/public')).json();
    expect(zweite.token).not.toBe(erste.token);
    expect(zweite.created).toBe(true);
  });
});

describe('DELETE /api/tournaments/:id/public — Widerruf', () => {
  it('401 ohne Login', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tournaments/t-shared/public',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 für ein Mitglied', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tournaments/t-shared/public',
      headers: { 'x-test-user': u.member.id },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('löscht den Token, statt ihn nur stillzulegen', async () => {
    const res = await alsAdmin('DELETE', '/api/tournaments/t-shared/public');
    expect(res.statusCode).toBe(200);
    expect(prisma._zeilen['t-shared'].isPublic).toBe(false);
    expect(prisma._zeilen['t-shared'].publicToken).toBeNull();
    expect(prisma._zeilen['t-shared'].publicRevokedAt).toBeInstanceOf(Date);
  });

  it('nach dem Widerruf führt der alte Link ins Leere', async () => {
    await alsAdmin('DELETE', '/api/tournaments/t-shared/public');
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/public/${TOKEN}` });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/tournaments/public/:token — die Zuschauer-Ansicht', () => {
  it('liefert ohne jede Anmeldung', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/public/${TOKEN}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().tournament.name).toBe('Geteiltes Turnier');
    expect(res.json().readOnly).toBe(true);
  });

  it('enthält keine Personendaten', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/public/${TOKEN}` });
    const roh = res.body;
    expect(roh).not.toContain('Anna Schmidt');
    expect(roh).not.toContain('Bernd Meier');
    expect(roh).not.toContain('linkedUserIds');
    expect(roh).not.toContain('u-member');
    // Auch der Token selbst wird nicht zurückgespiegelt.
    expect(roh).not.toContain(TOKEN);
  });

  it('liefert die Gruppentabelle mit', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/public/${TOKEN}` });
    const body = res.json();
    expect(body.groups).toHaveLength(1);
    expect(Array.isArray(body.groups[0].standings)).toBe(true);
  });

  it('404 bei unbekanntem Token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/public/${'X'.repeat(32)}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('404 bei missgestaltetem Token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tournaments/public/kurz' });
    expect(res.statusCode).toBe(404);
  });

  it('setzt einen kurzen Cache-Header', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/public/${TOKEN}` });
    expect(res.headers['cache-control']).toContain('max-age=15');
  });

  it('liefert einen QR-Code als SVG', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/public/${TOKEN}/qr.svg` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('viewBox');
  });

  it('der QR kennt dieselben Ablehnungen wie die Ansicht', async () => {
    // Sonst ließe sich am QR ablesen, ob ein Link mal gültig war,
    // während die Ansicht längst 404 gibt.
    await alsAdmin('DELETE', '/api/tournaments/t-shared/public');
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/public/${TOKEN}/qr.svg` });
    expect(res.statusCode).toBe(404);
  });

  it('unbekannter Token bekommt keinen QR', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/public/${'X'.repeat(32)}/qr.svg`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('die Turnier-ID allein öffnet nichts (Kern der Umstellung)', async () => {
    // t-shared ist freigegeben. Trotzdem darf der ID-Weg ohne Login
    // verschlossen bleiben — sonst wäre der Token bedeutungslos.
    const res = await app.inject({ method: 'GET', url: '/api/tournaments/t-shared' });
    expect(res.statusCode).toBe(401);
  });
});
