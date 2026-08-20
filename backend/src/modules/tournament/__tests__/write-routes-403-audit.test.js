/**
 * Dauerhafter Audit-Test: jede Turnier-Schreib-Route muss als Member 403 liefern.
 *
 * Hintergrund (User-Anmerkung, 2026-08-20):
 *   "Wenn sie bei DELETE fehlt, fehlt sie vielleicht woanders auch. … Das ist
 *    dieselbe Fehlerklasse wie die fehlenden Exporte: einzeln harmlos aussehend,
 *    in Summe gefährlich."
 *
 * Wir testen JEDE Route, die etwas ändert oder löscht:
 *   POST /                — Turnier anlegen
 *   PATCH /:id            — Turnier-Meta + Config
 *   DELETE /:id           — Turnier löschen
 *   POST /:id/teams       — Team anlegen
 *   PATCH /:id/teams/:tid — Team-Rename / Farbe
 *   DELETE /:id/teams/:tid — Team löschen
 *   PATCH /:id/teams/reorder — Setzreihenfolge
 *   PATCH /:id/groups     — Manuelle Gruppenzuordnung
 *   POST /:id/redraw      — Setzreihenfolge neu auslosen
 *   PATCH /:id/schedule   — Spiel-Zeit / Platte
 *   POST /:id/finish      — Turnier abschließen
 *   POST /:id/reset-results — Alle Ergebnisse löschen
 *   PATCH /:id/fields     — Spielfeld-Konfiguration
 *   POST /:id/generate    — Spielplan generieren
 *   POST /:id/reschedule  — Zeitplan neu terminieren
 *   POST /:id/teams/backfill-colors — Migration-Helper
 *   POST /:id/matches/:mid/result — Ergebnis eintragen
 *   POST /:id/logo        — Logo-Upload
 *   DELETE /:id/logo      — Logo löschen
 *
 * Erwartung: 403 (Admin-only per §1.2).
 *
 * Wenn dieser Test rot wird, hat eine neue Schreib-Route den Guard vergessen.
 * Das ist die direkte Folge der User-Sorge "dieselbe Fehlerklasse wie die
 * fehlenden Exporte" — dieser Test ist der Schutzzaun.
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

const u = { member: { id: 'u-member', role: 'user' }, admin: { id: 'u-admin', role: 'user' } };
const gId = 'g-1';
const tDraftId = 't-draft';
const tGroupStageId = 't-group-stage';
const teamId = 'team-1';
const matchId = 'match-1';

function makeStub(overrides = {}) {
  return {
    id: tDraftId,
    groupId: gId,
    name: 'Mein Turnier',
    status: 'draft',
    isPublic: false,
    publicToken: null,
    publicRevokedAt: null,
    logoUrl: null,
    config: null,
    group: { id: gId, createdBy: u.admin.id, name: 'G' },
    ...overrides,
  };
}

function baseStubs(prisma) {
  prisma.user.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === u.member.id) return { id: u.member.id, role: u.member.role };
    if (where.id === u.admin.id) return { id: u.admin.id, role: u.admin.role };
    return null;
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
    return null;
  });
  // Standardmäßig antwortet der Tournament-Lookup für beide IDs mit
  // einem generierten Turnier — sonst würden Tests für /finish oder
  // /reset-results an 404 statt 403 sterben.
  prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === tDraftId) return makeStub({ id: tDraftId, status: 'group_stage' });
    if (where.id === tGroupStageId) return makeStub({ id: tGroupStageId, status: 'group_stage' });
    return null;
  });
  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournament.delete.mockResolvedValue({ id: tDraftId });
  prisma.tournament.create.mockResolvedValue(makeStub());
  prisma.tournament.update.mockResolvedValue(makeStub());
  prisma.tournamentTeam.findFirst.mockResolvedValue(null);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.tournamentTeam.findUnique.mockResolvedValue(null);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.groupMembership.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.findFirst.mockResolvedValue(null);
  prisma.match.findUnique.mockResolvedValue(null);
  prisma.match.groupBy.mockResolvedValue([]);
  prisma.match.count.mockResolvedValue(0);
  prisma.match.updateMany.mockResolvedValue({ count: 0 });
  prisma.$transaction.mockImplementation(async (cb) => {
    return typeof cb === 'function' ? cb(prisma) : cb;
  });
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
  prisma = (await import('../index.js')).prisma === undefined
    ? createLocalMockPrisma()
    : createLocalMockPrisma();
  baseStubs(prisma);
  app = await buildApp(prisma);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

function createLocalMockPrisma() {
  const fn = () => vi.fn();
  return {
    user: { findUnique: fn() },
    group: { findUnique: fn() },
    groupMember: { findUnique: fn() },
    groupDeputy: { findUnique: fn() },
    tournament: { findUnique: fn(), findMany: fn(), create: fn(), update: fn(), delete: fn() },
    tournamentTeam: { findFirst: fn(), findMany: fn(), findUnique: fn(), update: fn(), delete: fn(), create: fn() },
    stage: { findMany: fn(), findUnique: fn(), create: fn(), deleteMany: fn() },
    group_: { findMany: fn(), create: fn() },
    groupMembership: { findMany: fn(), createMany: fn(), deleteMany: fn(), update: fn() },
    match: { findMany: fn(), findFirst: fn(), findUnique: fn(), create: fn(), createMany: fn(), update: fn(), updateMany: fn(), count: fn(), groupBy: fn() },
    $transaction: vi.fn(async (cb) => {
      return typeof cb === 'function' ? cb(prisma) : cb;
    }),
  };
}

const memberRequest = (method, url, body = null) =>
  app.inject({
    method,
    url,
    headers: { 'x-test-user': u.member.id },
    ...(body !== null ? { payload: body } : {}),
  });

/**
 * Pflicht-Test-Matrix (Spec §1.2).
 *
 * Wichtig: die Member-Antwort darf NICHT 200 oder 204 sein.
 * Wenn das jemand bricht (z. B. vergisst `requireTournamentWrite` an
 * einer neuen Route anzuhängen), fängt dieser Test es ab.
 */
describe('Audit: jede Turnier-Schreib-Route lehnt Members mit 403 ab', () => {
  const cases = [
    {
      label: 'POST / (Turnier anlegen)',
      req: () => memberRequest('POST', '/api/tournaments', {
        groupId: gId, name: 'Neues Turnier', mode: 'groups_ko',
      }),
    },
    {
      label: 'PATCH /:id (Meta/Config)',
      req: () => memberRequest('PATCH', `/api/tournaments/${tDraftId}`, { name: 'Versuch' }),
    },
    {
      label: 'DELETE /:id (Turnier löschen)',
      req: () => memberRequest('DELETE', `/api/tournaments/${tDraftId}`),
    },
    {
      label: 'POST /:id/teams (Team anlegen)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/teams`, { name: 'T1' }),
    },
    {
      label: 'PATCH /:id/teams/:tid (Team-Rename/Farbe)',
      req: () => memberRequest('PATCH', `/api/tournaments/${tDraftId}/teams/${teamId}`, { name: 'T1' }),
    },
    {
      label: 'DELETE /:id/teams/:tid (Team löschen)',
      req: () => memberRequest('DELETE', `/api/tournaments/${tDraftId}/teams/${teamId}`),
    },
    {
      label: 'PATCH /:id/teams/reorder (Setzreihenfolge)',
      req: () => memberRequest('PATCH', `/api/tournaments/${tDraftId}/teams/reorder`, { order: [] }),
    },
    {
      label: 'PATCH /:id/groups (Manuelle Gruppenzuordnung)',
      req: () => memberRequest('PATCH', `/api/tournaments/${tDraftId}/groups`, { groups: [] }),
    },
    {
      label: 'POST /:id/redraw (Setzreihenfolge neu auslosen)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/redraw`, {}),
    },
    {
      label: 'PATCH /:id/schedule (Spiel-Zeit / Platte)',
      req: () => memberRequest('PATCH', `/api/tournaments/${tDraftId}/schedule`, { updates: [] }),
    },
    {
      label: 'POST /:id/finish (Turnier abschließen)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/finish`, {}),
    },
    {
      label: 'POST /:id/reset-results (Alle Ergebnisse löschen)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/reset-results`, {
        confirmTournamentName: 'Mein Turnier',
      }),
    },
    {
      label: 'PATCH /:id/fields (Spielfeld-Konfiguration)',
      req: () => memberRequest('PATCH', `/api/tournaments/${tDraftId}/fields`, { fields: [{ name: 'Platte 1', order: 0 }] }),
    },
    {
      label: 'POST /:id/generate (Spielplan generieren)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/generate`, {
        numGroups: 2, groupSize: 4, mode: 'groups_ko', teams: [],
      }),
    },
    {
      label: 'POST /:id/reschedule (Zeitplan neu terminieren)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/reschedule`, {}),
    },
    {
      label: 'POST /:id/teams/backfill-colors (Migration-Helper)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/teams/backfill-colors`, {}),
    },
    {
      label: 'POST /:id/matches/:mid/result (Ergebnis eintragen)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/matches/${matchId}/result`, {
        scoreHome: 3, scoreAway: 1,
      }),
    },
    // Etappe B.8: drei neue Lebenszyklus-Routes.
    {
      label: 'POST /:id/start (Turnier starten)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/start`, {}),
    },
    {
      label: 'POST /:id/revert-to-draft (Zurück zu Entwurf)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/revert-to-draft`, {}),
    },
    {
      label: 'POST /:id/shift-open-matches (Offene Spiele verschieben)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/shift-open-matches`, { minutes: 20 }),
    },
    {
      label: 'POST /:id/balance-shuffle-groups (Zufällig verteilen, Größen-Konstanz)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/balance-shuffle-groups`, {}),
    },
    {
      label: 'POST /:id/groups/swaps (Paar-Tausch, Etappe B.8.1)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/groups/swaps`, {
        swaps: [['team-a', 'team-b']],
      }),
    },
    {
      label: 'POST /:id/logo (Logo-Upload)',
      req: () => memberRequest('POST', `/api/tournaments/${tDraftId}/logo`, {}),
    },
    {
      label: 'DELETE /:id/logo (Logo löschen)',
      req: () => memberRequest('DELETE', `/api/tournaments/${tDraftId}/logo`),
    },
  ];

  for (const c of cases) {
    it(c.label + ' → 403 (Member)', async () => {
      const res = await c.req();
      expect(res.statusCode).toBe(403);
    });
  }
});