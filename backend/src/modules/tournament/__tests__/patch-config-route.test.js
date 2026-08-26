/**
 * Integration-Tests: PATCH /api/tournaments/:id mit config.
 *
 * Spec §3 (Config-Schema), §5.4 (Punkte/Tiebreaker), §13 (keine
 * stillen Annahmen, harte Obergrenzen) und der User-Wunsch:
 *
 *   - config darf nur über validierte Whitelist gesetzt werden
 *   - bei vorhandenen Ergebnissen ist config gesperrt (sonst ändert
 *     sich rückwirkend die Tabelle)
 *   - Zeiten und Tische bleiben auch bei Ergebnissen editierbar
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';

// ------------------------------------------------------------------
// Lokaler Prisma-Mock (gleich wie routes.integration.test.js).
// ------------------------------------------------------------------
function createMockPrisma() {
  const fn = () => vi.fn();
  const prisma = {
    user: { findUnique: fn() },
    group: { findUnique: fn() },
    groupMember: { findUnique: fn() },
    groupDeputy: { findUnique: fn() },
    tournament: {
      findUnique: fn(),
      update: fn(),
    },
    tournamentTeam: { findMany: fn() },
    stage: { findMany: fn() },
    group_: { findMany: fn() },
    match: {
      count: fn(),
      findMany: fn(),
      groupBy: fn(),
    },
  };
  return prisma;
}

async function buildApp(prisma) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);
  app.addHook('preHandler', async (request) => {
    request.jwtVerify = async () => {};
    const uid = request.headers['x-test-user'];
    if (uid) request.user = { id: String(uid) };
  });
  await app.register(tournamentsRoutes, { prefix: '/api/tournaments' });
  await app.ready();
  return app;
}

const u = {
  admin: { id: 'u-admin', role: 'user' },
};
const gId = 'g-1';
const tId = 't-1';

function baseStubs(prisma) {
  prisma.user.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === u.admin.id) return { id: u.admin.id, role: u.admin.role };
    return null;
  });
  prisma.group.findUnique.mockResolvedValue({
    id: gId,
    createdBy: u.admin.id,
  });
  prisma.groupDeputy.findUnique.mockResolvedValue(null);
  prisma.groupMember.findUnique.mockImplementation(async ({ where }) => {
    const { userId, groupId } = where.userId_groupId ?? {};
    if (groupId === gId && userId === u.admin.id) {
      return { userId: u.admin.id, groupId: gId };
    }
    return null;
  });
  prisma.tournament.findUnique.mockResolvedValue({
    id: tId,
    groupId: gId,
    name: 'Mein Turnier',
    mode: 'groups_ko',
    status: 'draft',
    isPublic: false,
    publicToken: null,
    publicRevokedAt: null,
    config: null,
    group: { id: gId, createdBy: u.admin.id, name: 'G' },
  });
  prisma.tournament.update.mockImplementation(async ({ where, data }) => ({
    id: where.id,
    ...data,
  }));
  // Default: keine Ergebnisse. Tests überschreiben das gezielt.
  prisma.match.count.mockResolvedValue(0);
  // Für buildTournamentViewContext:
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.groupBy.mockResolvedValue([]);
}

afterEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------------------
// Smoke: PATCH ohne config → unverändert (Regression-Test)
// ------------------------------------------------------------------
describe('PATCH /api/tournaments/:id ohne config', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('PATCH name → 200, data enthält nur name', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { name: 'Neuer Name' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data).toEqual({ name: 'Neuer Name' });
    expect('config' in updateArg.data).toBe(false);
  });
});

// ------------------------------------------------------------------
// Happy Path: gültige Config → 200, gespeichert
// ------------------------------------------------------------------
describe('PATCH /api/tournaments/:id mit gültiger config', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('Wizard-Standardwerte werden gespeichert', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        config: {
          distribution: 'snake',
          pointsPerWin: 3,
          pointsPerDraw: 1,
          pointsPerLoss: 0,
          tiebreakers: ['points', 'goalDiff', 'goalsFor', 'headToHead'],
          qualifyPerGroup: 2,
          bestThirds: 0,
          hasThirdPlacePlayoff: false,
          schedule: {
            slotMinutes: 15,
            matchDurationMinutes: 30,
            pauseAfterMatches: 0,
            parallelFields: 1,
            startTime: '10:00',
          },
        },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data.config).toBeDefined();
    expect(updateArg.data.config.pointsPerWin).toBe(3);
    expect(updateArg.data.config.tiebreakers).toEqual([
      'points', 'goalDiff', 'goalsFor', 'headToHead',
    ]);
    expect(updateArg.data.config.schedule.startTime).toBe('10:00');
  });

  it('Unbekannte Schlüssel werden stillschweigend verworfen', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        config: {
          pointsPerWin: 5,
          totalBogus: 'ignorieren',
          evilObject: { hack: true },
        },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data.config).toEqual({ pointsPerWin: 5 });
  });
});

// ------------------------------------------------------------------
// Fail-Path: ungültige Config → 400 mit Field-Info
// ------------------------------------------------------------------
describe('PATCH /api/tournaments/:id mit ungültiger config', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('Punkte -1 → 400, field=pointsPerWin', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { config: { pointsPerWin: -1 } },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('invalid_config');
    expect(body.field).toBe('pointsPerWin');
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('Unbekannter Tiebreaker → 400, field=tiebreakers', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        config: { tiebreakers: ['points', 'unbekannt'] },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('invalid_config');
    expect(body.field).toBe('tiebreakers');
    expect(body.message).toMatch(/unbekannt/);
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('Tiebreaker-Duplikat → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        config: { tiebreakers: ['points', 'goalDiff', 'points'] },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.field).toBe('tiebreakers');
    expect(body.message).toMatch(/doppelt/);
  });

  it('startTime "9:00" → 400, falsches Format', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        config: { schedule: { startTime: '9:00' } },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('schedule.startTime');
  });

  it('matchDurationMinutes 0 → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        config: { schedule: { matchDurationMinutes: 0 } },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('schedule.matchDurationMinutes');
  });

  it('Config ist Array → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { config: [1, 2, 3] },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// Config-Lock: bei vorhandenen Ergebnissen → 409
// ------------------------------------------------------------------
describe('PATCH /api/tournaments/:id config-Lock bei Ergebnissen', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createMockPrisma();
    baseStubs(prisma);
    // Turnier hat bereits 12 beendete Spiele.
    prisma.match.count.mockResolvedValue(12);
    app = await buildApp(prisma);
  });

  it('config-Patch bei Ergebnissen → 409 config_locked_results_present', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        config: { pointsPerWin: 5 },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('config_locked_results_present');
    expect(body.finishedMatches).toBe(12);
    expect(body.message).toMatch(/Ergebnisse/);
    expect(prisma.tournament.update).not.toHaveBeenCalled();
  });

  it('NUR config abgelehnt, andere Felder (name, startsAt) bleiben erlaubt', async () => {
    // name + startsAt ohne config → 200
    const res1 = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { name: 'Umbenannt' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res1.statusCode).toBe(200);
    // Bisher genau 1 update-Call (name).
    expect(prisma.tournament.update).toHaveBeenCalledTimes(1);

    // name + startsAt + config → 409 (wegen config)
    const res2 = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        name: 'Umbenannt 2',
        startsAt: '2026-09-01T10:00:00Z',
        config: { pointsPerWin: 5 },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res2.statusCode).toBe(409);
    // KEIN zweiter update-Call — 409 bricht vor DB-Schreibvorgang ab.
    expect(prisma.tournament.update).toHaveBeenCalledTimes(1);
  });

  it('Zeiten und Tische (schedule.*) sind bei Ergebnissen editierbar', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        // schedule.parallelFields ändert nur Tisch-Anzahl, nicht das
        // Ranking. Spec: Zeiten/Tische bleiben erlaubt.
        config: { schedule: { parallelFields: 2 } },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = prisma.tournament.update.mock.calls[0][0];
    expect(updateArg.data.config.schedule.parallelFields).toBe(2);
  });
});

// ------------------------------------------------------------------
// Grunddaten-Felder (location, sport, tableLabels) — Top-Level am Turnier,
// nicht in config. Spec §1.2.
// ------------------------------------------------------------------
describe('PATCH /api/tournaments/:id mit Grunddaten-Feldern', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('location wird gespeichert', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { location: 'Sporthalle A, Reutlingen' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const arg = prisma.tournament.update.mock.calls[0][0];
    expect(arg.data.location).toBe('Sporthalle A, Reutlingen');
  });

  it('location als leerer String wird zu null (kein „ " im Druckkopf)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { location: '   ' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const arg = prisma.tournament.update.mock.calls[0][0];
    expect(arg.data.location).toBe(null);
  });

  it('location: ungültiger Typ → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { location: 42 },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('location');
  });

  it('sport "becher" / "tore" / "punkte" werden gespeichert', async () => {
    for (const s of ['becher', 'tore', 'punkte']) {
      vi.clearAllMocks();
      baseStubs(prisma);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/tournaments/${tId}`,
        payload: { sport: s },
        headers: { 'x-test-user': u.admin.id },
      });
      expect(res.statusCode).toBe(200);
      expect(prisma.tournament.update.mock.calls[0][0].data.sport).toBe(s);
    }
  });

  it('sport unbekannt → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { sport: 'fussball' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('sport');
  });

  it('tableLabels Array wird gespeichert', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { tableLabels: ['Platte 1', 'Platte 2', 'Platte 3', 'Platte 4'] },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const arg = prisma.tournament.update.mock.calls[0][0];
    expect(arg.data.tableLabels).toEqual([
      'Platte 1', 'Platte 2', 'Platte 3', 'Platte 4',
    ]);
  });

  it('tableLabels null löscht die Liste', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { tableLabels: null },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.tournament.update.mock.calls[0][0].data.tableLabels).toBe(null);
  });

  it('tableLabels kein Array → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { tableLabels: 'Platte 1' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('tableLabels');
  });

  it('tableLabels mit leerem String-Eintrag → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { tableLabels: ['Platte 1', '  ', 'Platte 3'] },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('tableLabels');
  });
});
// ------------------------------------------------------------------
// PATCH heisst PATCH: ein Teil-Patch loescht den Rest der Config nicht
// ------------------------------------------------------------------
//
// Fehlerklasse (2026-08-26): Die Route schrieb `data.config = v.value`.
// `v.value` ist die gefilterte Whitelist des Validators — alles, was
// nicht im selben Body stand, war danach weg. Das traf ausgerechnet die
// Werte, die eine ANDERE Route in dieselbe Spalte schreibt:
// `config.fields` (Plattennamen, PATCH /:id/fields). Ein Klick auf
// „Zeitplan neu berechnen" im Einstellungen-Tab schickt nur
// `schedule.*` — und haette damit still die Plattennamen, `numGroups`,
// die Tiebreaker und die Anstosszeit auf Default zurueckgesetzt.
// Sichtbar wurde davon nichts, weil `mergeConfig` beim Lesen jeden
// fehlenden Schluessel aus DEFAULT_CONFIG nachfuellt.
describe('PATCH config: Teil-Patch bewahrt den Rest der Config', () => {
  let app, prisma;

  const bestandsConfig = {
    distribution: 'snake',
    pointsPerWin: 3,
    tiebreakers: ['points', 'goalDiff'],
    numGroups: 4,
    qualifyPerGroup: 2,
    fields: [
      { id: 'f1', name: 'Platte 1', order: 0 },
      { id: 'f2', name: 'Wintergarten', order: 1 },
    ],
    schedule: {
      slotMinutes: 35,
      matchDurationMinutes: 30,
      pauseAfterMatches: 5,
      parallelFields: 2,
      startTime: '09:30',
    },
  };

  beforeEach(async () => {
    prisma = createMockPrisma();
    baseStubs(prisma);
    prisma.tournament.findUnique.mockResolvedValue({
      id: tId,
      groupId: gId,
      name: 'Mein Turnier',
      mode: 'groups_ko',
      status: 'generated',
      isPublic: false,
      publicToken: null,
      publicRevokedAt: null,
      config: bestandsConfig,
      group: { id: gId, createdBy: u.admin.id, name: 'G' },
    });
    app = await buildApp(prisma);
  });

  it('schedule-Patch laesst fields, numGroups und Tiebreaker stehen', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        config: {
          schedule: {
            matchDurationMinutes: 20,
            pauseAfterMatches: 0,
            parallelFields: 3,
            slotMinutes: 20,
          },
        },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const cfg = prisma.tournament.update.mock.calls[0][0].data.config;
    expect(cfg.fields).toEqual(bestandsConfig.fields);
    expect(cfg.numGroups).toBe(4);
    expect(cfg.tiebreakers).toEqual(['points', 'goalDiff']);
    expect(cfg.pointsPerWin).toBe(3);
  });

  it('schedule-Patch laesst nicht mitgeschickte schedule-Werte stehen', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: {
        config: {
          schedule: {
            matchDurationMinutes: 20,
            pauseAfterMatches: 0,
            parallelFields: 3,
            slotMinutes: 20,
          },
        },
      },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const sched = prisma.tournament.update.mock.calls[0][0].data.config.schedule;
    // Der Anstoss stand nicht im Body — er bleibt, wo er war.
    expect(sched.startTime).toBe('09:30');
    // Und die mitgeschickten Werte gewinnen.
    expect(sched.matchDurationMinutes).toBe(20);
    expect(sched.pauseAfterMatches).toBe(0);
    expect(sched.slotMinutes).toBe(20);
    expect(sched.parallelFields).toBe(3);
  });

  it('ein Patch ausserhalb von schedule ueberschreibt nur seinen Schluessel', async () => {
    // Ergebnisse liegen keine vor (baseStubs: match.count = 0), also ist
    // auch ein Nicht-schedule-Patch erlaubt.
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: { config: { pointsPerWin: 5 } },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const cfg = prisma.tournament.update.mock.calls[0][0].data.config;
    expect(cfg.pointsPerWin).toBe(5);
    expect(cfg.fields).toEqual(bestandsConfig.fields);
    expect(cfg.schedule.startTime).toBe('09:30');
  });
});
