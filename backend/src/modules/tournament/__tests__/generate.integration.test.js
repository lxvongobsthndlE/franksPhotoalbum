/**
 * Echte Route-Integrationstests für POST /api/tournaments/:id/generate.
 *
 * Spec §1.2 (Sichtbarkeitswechsel draft → generated),
 *       §3 (Wizard-Flow),
 *       §13.2 (Admin-only),
 *       §13.10 (Bestätigung zerstörerischer Aktionen per Turniernamen).
 *
 * Diese Tests fahren eine echte Fastify-Instanz hoch und prüfen via
 * `app.inject()` das Verhalten am HTTP-Statuscode:
 *
 *   Auth (§13.2):
 *     G1  Member POST /generate → 403
 *     G2  Stranger POST /generate → 403
 *     G3  Admin (Group-Owner) POST /generate (draft) → 201
 *     G4  Globaler Admin POST /generate (draft) → 201
 *
 *   Sichtbarkeitswechsel (§1.2):
 *     G5  Draft-Turnier: Tournament.update wird mit status='generated' aufgerufen
 *
 *   Re-Generate-Logik:
 *     G6  Re-Generate ohne Ergebnisse (egal welcher Status) → 201, KEINE Bestätigung
 *     G7  Re-Generate MIT Ergebnissen, ohne confirmTournamentName → 409 results_present
 *     G8  Re-Generate MIT Ergebnissen + falschem Namen → 400 confirmation_mismatch
 *     G9  Re-Generate MIT Ergebnissen + richtigem Namen → 201, warnings=['results_deleted']
 *     G10 Status 'finished' → 409 tournament_finished (auch MIT Bestätigung)
 *
 *   Validierung:
 *     G11 < 2 Teams → 400
 *
 *   Antwort:
 *     G12 DTO enthält tournament, teams, groups, matches, stats, counts — KEINE Roh-Row
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';

// ------------------------------------------------------------------
// Lokaler Prisma-Mock — minimal für Generate-Route.
//
// Wir mocken NICHT die Engine — wir lassen die echte Engine laufen
// (über die importierten Module), weil §10.9 Determinismus garantiert
// und die Engine-Tests in engine-generate.test.js die Korrektheit
// bereits absichern. Die Tests hier prüfen nur die Route drumherum.
// ------------------------------------------------------------------
function createLocalMockPrisma() {
  const fn = () => vi.fn();
  const prisma = {
    user: { findUnique: fn(), findMany: fn(), create: fn() },
    group: { findUnique: fn(), findMany: fn() },
    groupMember: { findUnique: fn(), count: fn() },
    groupDeputy: { findUnique: fn() },
    tournament: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
    },
    tournamentTeam: {
      findMany: fn(),
      create: fn(),
      createMany: fn(),
      delete: fn(),
    },
    stage: { findMany: fn(), findUnique: fn(), create: fn(), deleteMany: fn() },
    group_: { findMany: fn(), create: fn() },
    groupMembership: { createMany: fn(), findMany: fn() },
    match: {
      findMany: fn(),
      findFirst: fn(),
      findUnique: fn(),
      create: fn(),
      createMany: fn(),
      update: fn(),
      updateMany: fn(),
      deleteMany: fn(),
      groupBy: fn(),
      count: fn(),
    },
    $transaction: vi.fn(async (cb) => {
      return typeof cb === 'function' ? cb(prisma) : cb;
    }),
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
  member: { id: 'u-member', role: 'user' },
  admin: { id: 'u-admin', role: 'user' },
  global: { id: 'u-global', role: 'admin' },
  stranger: { id: 'u-stranger', role: 'user' },
};
const gId = 'g-1';
const T_NAME = 'Bierpong Turnier 2.0';
const tId = 't-target';

// Auth-Stubs. Die meisten Generate-Tests arbeiten mit einem draft-Turnier,
// das dem Group-Owner (u.admin) gehört.
function stubUsersAndGroup(prisma) {
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
    return null; // stranger ist nicht Mitglied
  });
}

// Stub für buildTournamentViewContext — die Route ruft das nach der
// Persistierung, um das DTO zu bauen. Wir liefern Minimal-Strukturen
// zurück, damit die Antwort DTO-Form hat.
function stubViewContextRead(prisma) {
  // tournament.findUnique wird sowohl für die View als auch für
  // requireTournamentWrite aufgerufen — daher mergen wir die Antwort.
  prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === tId) {
      return {
        id: tId,
        groupId: gId,
        name: T_NAME,
        status: 'draft',
        mode: 'groups_ko',
        config: null,
        isPublic: false,
        publicToken: null,
        publicRevokedAt: null,
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    return null;
  });
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
}

// Stub für das Tournament-Read in requireTournamentWrite. Wird VOR der
// Engine/Persist aufgerufen. Status kann pro Test überschrieben werden.
function makeTournamentRow(overrides = {}) {
  return {
    id: tId,
    groupId: gId,
    name: T_NAME,
    mode: 'groups_ko',
    config: null,
    isPublic: false,
    publicToken: null,
    publicRevokedAt: null,
    group: { id: gId, createdBy: u.admin.id, name: 'G' },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------------------
// G1: Member POST /generate → 403
// ------------------------------------------------------------------
describe('G1: Member POST /generate → 403', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    stubViewContextRead(prisma);
    app = await buildApp(prisma);
  });

  it('Member bekommt 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ------------------------------------------------------------------
// G2: Stranger POST /generate → 403
// ------------------------------------------------------------------
describe('G2: Stranger (kein Mitglied) POST /generate → 403', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    stubViewContextRead(prisma);
    app = await buildApp(prisma);
  });

  it('Stranger bekommt 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.stranger.id },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ------------------------------------------------------------------
// G3/G4: Admin (Group-Owner) und Globaler Admin POST /generate (draft) → 201
// ------------------------------------------------------------------
describe('G3/G4: Admin und Globaler Admin POST /generate (draft) → 201', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    prisma.tournament.findUnique.mockResolvedValue(makeTournamentRow());
    // 6 Teams reichen für die Engine (min 2, aber Generator braucht min 4 für Gruppen).
    prisma.tournamentTeam.findMany.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        id: `team-${i}`,
        name: `Team ${i}`,
        seed: i + 1,
        createdAt: new Date(2026, 0, i + 1),
      }))
    );
    prisma.match.count.mockResolvedValue(0); // keine finished Matches
    // Persistenz-Stubs (die echte Engine läuft, sie ruft diese Methoden auf)
    prisma.stage.deleteMany.mockResolvedValue({ count: 0 });
    prisma.stage.create.mockImplementation(async ({ data }) => ({
      id: 'stage-1',
      ...data,
    }));
    prisma.group_.create.mockImplementation(async ({ data }) => ({
      id: `group-${data.key}`,
      ...data,
    }));
    prisma.groupMembership.createMany.mockResolvedValue({ count: 0 });
    prisma.match.createMany.mockResolvedValue({ count: 0 });
    // View-Context liest nach Persist — liefern Minimal-Strukturen.
    prisma.stage.findMany.mockResolvedValue([]);
    prisma.group_.findMany.mockResolvedValue([]);
    prisma.match.findMany.mockResolvedValue([]);
    prisma.tournament.update.mockResolvedValue(makeTournamentRow({ status: 'generated' }));
    app = await buildApp(prisma);
  });

  it('G3: Admin (Group-Owner) bekommt 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tournament).toBeDefined();
    expect(body.tournament.id).toBe(tId);
    expect(body.counts.groups).toBeGreaterThan(0);
    expect(body.counts.matches).toBeGreaterThan(0);
    expect(body.unresolvedConflicts).toBeDefined();
    expect(body.warnings).toEqual([]);
  });

  it('G4: Globaler Admin (role="admin") bekommt 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.global.id },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ------------------------------------------------------------------
// G5: Sichtbarkeitswechsel draft → generated
// ------------------------------------------------------------------
describe('G5: Status draft → generated', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    prisma.tournament.findUnique.mockResolvedValue(makeTournamentRow({ status: 'draft' }));
    prisma.tournamentTeam.findMany.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({
        id: `team-${i}`,
        name: `Team ${i}`,
        seed: i + 1,
        createdAt: new Date(2026, 0, i + 1),
      }))
    );
    prisma.match.count.mockResolvedValue(0);
    prisma.stage.deleteMany.mockResolvedValue({ count: 0 });
    prisma.stage.create.mockResolvedValue({ id: 'stage-1' });
    prisma.group_.create.mockResolvedValue({ id: 'group-1' });
    prisma.groupMembership.createMany.mockResolvedValue({ count: 0 });
    prisma.match.createMany.mockResolvedValue({ count: 0 });
    prisma.stage.findMany.mockResolvedValue([]);
    prisma.group_.findMany.mockResolvedValue([]);
    prisma.match.findMany.mockResolvedValue([]);
    prisma.tournament.update.mockResolvedValue(makeTournamentRow({ status: 'generated' }));
    app = await buildApp(prisma);
  });

  it('tournament.update wird mit status="generated" aufgerufen', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.tournament.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: tId },
        data: expect.objectContaining({ status: 'generated' }),
      })
    );
  });
});

// ------------------------------------------------------------------
// G6: Re-Generate ohne Ergebnisse → 201, KEINE Bestätigung nötig
// ------------------------------------------------------------------
describe('G6: Re-Generate ohne Ergebnisse → 201, egal welcher Status', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    prisma.tournament.findUnique.mockResolvedValue(makeTournamentRow({ status: 'group_stage' }));
    prisma.tournamentTeam.findMany.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({
        id: `team-${i}`,
        name: `Team ${i}`,
        seed: i + 1,
        createdAt: new Date(2026, 0, i + 1),
      }))
    );
    prisma.match.count.mockResolvedValue(0); // KEINE finished
    prisma.stage.deleteMany.mockResolvedValue({ count: 0 });
    prisma.stage.create.mockResolvedValue({ id: 'stage-1' });
    prisma.group_.create.mockResolvedValue({ id: 'group-1' });
    prisma.groupMembership.createMany.mockResolvedValue({ count: 0 });
    prisma.match.createMany.mockResolvedValue({ count: 0 });
    prisma.stage.findMany.mockResolvedValue([]);
    prisma.group_.findMany.mockResolvedValue([]);
    prisma.match.findMany.mockResolvedValue([]);
    prisma.tournament.update.mockResolvedValue(makeTournamentRow({ status: 'group_stage' }));
    app = await buildApp(prisma);
  });

  it('Re-Generate ohne Body → 201, kein 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().warnings).toEqual([]);
  });
});

// ------------------------------------------------------------------
// G7: Re-Generate MIT Ergebnissen, OHNE confirmTournamentName → 409
// ------------------------------------------------------------------
describe('G7: Re-Generate mit Ergebnissen ohne Bestätigung → 409 results_present', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    prisma.tournament.findUnique.mockResolvedValue(makeTournamentRow({ status: 'group_stage' }));
    prisma.tournamentTeam.findMany.mockResolvedValue([]);
    prisma.match.count.mockResolvedValue(3); // 3 finished matches
    app = await buildApp(prisma);
  });

  it('409 mit error=results_present, finishedMatches=3, needsConfirmation=true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('results_present');
    expect(body.finishedMatches).toBe(3);
    expect(body.needsConfirmation).toBe(true);
  });
});

// ------------------------------------------------------------------
// G8: Re-Generate MIT Ergebnissen + FALSCHEM Namen → 400
// ------------------------------------------------------------------
describe('G8: Bestätigung mit falschem Turniernamen → 400 confirmation_mismatch', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    prisma.tournament.findUnique.mockResolvedValue(makeTournamentRow());
    prisma.match.count.mockResolvedValue(2);
    app = await buildApp(prisma);
  });

  it('Vertipper-Schutz: falscher Name → 400, KEIN Schreibvorgang', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: { confirmTournamentName: 'Bierpong Turnier 3.0' }, // 3 statt 2
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('confirmation_mismatch');
    // Persistenz darf NICHT aufgerufen worden sein.
    expect(prisma.stage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.match.createMany).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// G9: Re-Generate MIT Ergebnissen + richtigem Namen → 201 + warnings
// ------------------------------------------------------------------
describe('G9: Bestätigung mit korrektem Namen → 201 + warnings=[results_deleted]', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    prisma.tournament.findUnique.mockResolvedValue(makeTournamentRow({ status: 'group_stage' }));
    prisma.tournamentTeam.findMany.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({
        id: `team-${i}`,
        name: `Team ${i}`,
        seed: i + 1,
        createdAt: new Date(2026, 0, i + 1),
      }))
    );
    prisma.match.count.mockResolvedValue(5); // 5 finished
    prisma.stage.deleteMany.mockResolvedValue({ count: 0 });
    prisma.stage.create.mockResolvedValue({ id: 'stage-1' });
    prisma.group_.create.mockResolvedValue({ id: 'group-1' });
    prisma.groupMembership.createMany.mockResolvedValue({ count: 0 });
    prisma.match.createMany.mockResolvedValue({ count: 0 });
    prisma.stage.findMany.mockResolvedValue([]);
    prisma.group_.findMany.mockResolvedValue([]);
    prisma.match.findMany.mockResolvedValue([]);
    prisma.tournament.update.mockResolvedValue(makeTournamentRow({ status: 'group_stage' }));
    app = await buildApp(prisma);
  });

  it('Korrekter Name → 201, warnings enthält "results_deleted"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: { confirmTournamentName: T_NAME }, // exakt: 'Bierpong Turnier 2.0'
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.warnings).toContain('results_deleted');
  });

  it('case-insensitive: kleingeschriebener Name wird AKZEPTIERT (trim + toLowerCase)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: { confirmTournamentName: T_NAME.toLowerCase() }, // 'bierpong turnier 2.0'
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().warnings).toContain('results_deleted');
  });

  it('Leading/Trailing-Whitespace wird ignoriert', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: { confirmTournamentName: '   ' + T_NAME + '   ' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
  });

  it('Falscher Name (z. B. andere Jahreszahl) wird weiterhin abgelehnt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: { confirmTournamentName: 'Bierpong Turnier 3.0' }, // 3 statt 2
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('confirmation_mismatch');
  });
});

// ------------------------------------------------------------------
// G10: Status 'finished' → 409 tournament_finished (auch MIT Bestätigung)
// ------------------------------------------------------------------
describe('G10: Status finished → 409 tournament_finished', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    prisma.tournament.findUnique.mockResolvedValue(makeTournamentRow({ status: 'finished' }));
    app = await buildApp(prisma);
  });

  it('Ohne Bestätigung → 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('tournament_finished');
  });

  it('MIT Bestätigung → immer noch 409 (finished ist endgültig)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: { confirmTournamentName: T_NAME },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('tournament_finished');
  });
});

// ------------------------------------------------------------------
// G11: < 2 Teams → 400
// ------------------------------------------------------------------
describe('G11: < 2 Teams → 400', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    prisma.tournament.findUnique.mockResolvedValue(makeTournamentRow());
    prisma.tournamentTeam.findMany.mockResolvedValue([]); // 0 Teams
    prisma.match.count.mockResolvedValue(0);
    app = await buildApp(prisma);
  });

  it('0 Teams → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Teams/);
  });
});

// ------------------------------------------------------------------
// G12: Antwort ist DTO, KEINE Roh-Row
// ------------------------------------------------------------------
describe('G12: Antwort ist DTO (tournament, teams, groups, matches, stats, counts)', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);
    // Status-State: anfangs draft, nach tournament.update wird er auf
    // 'generated' gesetzt. buildTournamentViewContext liest den aktuellen
    // Stand. Der Mock muss diesen Übergang widerspiegeln, sonst bekommen
    // wir im DTO ein leeres statusLabel.
    let currentStatus = 'draft';
    prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === tId) {
        return makeTournamentRow({ status: currentStatus });
      }
      return null;
    });
    prisma.tournament.update.mockImplementation(async ({ where, data }) => {
      currentStatus = data.status ?? currentStatus;
      return makeTournamentRow({ status: currentStatus });
    });
    prisma.tournamentTeam.findMany.mockImplementation(async ({ where }) => {
      if (where?.tournamentId === tId) {
        return Array.from({ length: 4 }, (_, i) => ({
          id: `team-${i}`,
          name: `Team ${i}`,
          seed: i + 1,
          createdAt: new Date(2026, 0, i + 1),
        }));
      }
      return [];
    });
    prisma.match.count.mockResolvedValue(0);
    prisma.stage.deleteMany.mockResolvedValue({ count: 0 });
    prisma.stage.create.mockResolvedValue({ id: 'stage-1' });
    prisma.group_.create.mockResolvedValue({ id: 'group-1' });
    prisma.groupMembership.createMany.mockResolvedValue({ count: 0 });
    prisma.match.createMany.mockResolvedValue({ count: 0 });
    prisma.stage.findMany.mockResolvedValue([
      { id: 'stage-1', tournamentId: tId, type: 'group', name: 'Gruppenphase', orderIndex: 0 },
    ]);
    prisma.group_.findMany.mockResolvedValue([]);
    prisma.match.findMany.mockResolvedValue([]);
    app = await buildApp(prisma);
  });

  it('Body enthält tournament + teams + stages + groups + matches + stats + counts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: {},
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('tournament');
    expect(body).toHaveProperty('teams');
    expect(body).toHaveProperty('stages');
    expect(body).toHaveProperty('groups');
    expect(body).toHaveProperty('matches');
    expect(body).toHaveProperty('stats');
    expect(body).toHaveProperty('counts');
    expect(body.counts).toHaveProperty('groups');
    expect(body.counts).toHaveProperty('matches');
    expect(body.counts).toHaveProperty('teams');
    // DTO hat statusLabel als deutschen String — 'generated' → 'Bereit'
    expect(body.tournament.statusLabel).toBe('Bereit');
  });
});