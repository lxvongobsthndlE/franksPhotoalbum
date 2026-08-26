/**
 * Echte Route-Integrationstests für die Tournament-Module-Routen.
 *
 * Spec §13.2 verlangt Auth-Helper auf Routen. Helper-Tests (auth.test.js)
 * prüfen die Logik isoliert. Was sie NICHT prüfen: ist der Wrapper
 * ÜBERHAUPT an die Route gehängt? Wenn jemand das vergisst, sind alle
 * Helper-Tests grün und die Route ist trotzdem offen.
 *
 * Deshalb fahren wir hier eine echte Fastify-Instanz hoch, registrieren
 * die Routen produktionsgleich und prüfen den HTTP-Statuscode via
 * `app.inject()`.
 *
 * Pflicht-Tests (mindestens einer pro Schutzmechanismus):
 *
 *   1. Member POST /tournaments                  → 403
 *   2. Member GET  /tournaments/:id (draft)      → 403
 *   3. Member POST /matches/:id/result           → 403
 *   4. Member GET  /tournaments/group/:id        → enthält keine drafts
 *
 * Plus: Public-Bypass 200, Admin 200/201, Nicht-Mitglied 403.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';

// ------------------------------------------------------------------
// Lokaler Prisma-Mock mit den richtigen Modellnamen aus schema.prisma:
//   tournament, tournamentTeam, stage, group_, groupMembership, match.
// Der zentrale mocks/index.js hat Legacy-Namen (tournamentMatch etc.) —
// passt nicht zum v4-Schema. Nicht-zentrale Mock-Erzeugung gemäß §0,
// wir bleiben im Modul-Verzeichnis.
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
    group_: { findMany: fn(), create: fn() }, // Trailing-Undercore siehe schema.prisma
    groupMembership: { createMany: fn(), findMany: fn() },
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
      // Real-Fastify transaction client: wir geben die gleiche prisma zurück.
      return typeof cb === 'function' ? cb(prisma) : cb;
    }),
  };
  return prisma;
}

// ------------------------------------------------------------------
// Fixture: Fastify pro Test frisch, mit prisma-Dekorator und gemocktem JWT.
// ------------------------------------------------------------------
async function buildApp(prisma) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);

  // Auth-Helper erwarten request.jwtVerify() und request.user.
  // Test-Header x-test-user → request.user.id.
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
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    return null;
  });

  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.findFirst.mockResolvedValue(null);
  // match.groupBy wird für die List-Aggregation (Counts) gebraucht.
  // Default: leere Liste — Aggregate-Funktion verarbeitet das korrekt.
  prisma.match.groupBy.mockResolvedValue([]);
  // match.count wird von DELETE /:id (Confirm-Handshake §13.10) und
  // Reset-Results / Redraw / Groups / Schedule für die Lock-Prüfung
  // gebraucht. Default: 0 finished.
  prisma.match.count.mockResolvedValue(0);
}

afterEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------------------
// Pflicht-Test 1: Member POST /tournaments → 403
// ------------------------------------------------------------------
describe('Pflicht-Test 1: Member POST /tournaments', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('Member (kein Admin) bekommt 403', async () => {
    prisma.group.findUnique.mockResolvedValue({
      id: gId,
      createdBy: 'u-owner',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: { groupId: gId, name: 'Mein Turnier' },
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Admin (Group-Owner) bekommt 201', async () => {
    prisma.tournament.create.mockResolvedValue({
      id: 't-new',
      groupId: gId,
      name: 'Mein Turnier',
      status: 'draft',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: { groupId: gId, name: 'Mein Turnier' },
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
  });

  it('Globaler Admin (role="admin") bekommt 201', async () => {
    prisma.tournament.create.mockResolvedValue({
      id: 't-new2',
      groupId: gId,
      name: 'X',
      status: 'draft',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: { groupId: gId, name: 'X' },
      headers: { 'x-test-user': u.global.id },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ------------------------------------------------------------------
// Pflicht-Test 2: Member GET /tournaments/:id (draft) → 403
// ------------------------------------------------------------------
describe('Pflicht-Test 2: Member GET /tournaments/:id (draft)', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('Member bekommt 403, wenn Turnier im Status draft ist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tDraft}`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Admin bekommt 200 (Detail-DTO, nicht Roh-Row)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tDraft}`,
      headers: { 'x-test-user': u.global.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tournament).toBeDefined();
    expect(body.tournament.id).toBe(tDraft);
    // DTO hat statusLabel + modeLabel als deutsche Strings — kein rohes
    // Prisma-CUID, sondern ein Anzeigeobjekt.
    expect(typeof body.tournament.statusLabel).toBe('string');
    expect(typeof body.tournament.modeLabel).toBe('string');
  });

  it('Member bekommt 200, wenn Turnier NICHT draft ist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tLive}`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ------------------------------------------------------------------
// Pflicht-Test 3: Member POST /matches/:id/result → 403
// ------------------------------------------------------------------
describe('Pflicht-Test 3: Member POST /matches/:matchId/result', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    prisma.match.findFirst.mockImplementation(async ({ where }) => {
      if (where.id === 'm-1' && where.tournamentId === tLive) {
        return {
          id: 'm-1',
          tournamentId: tLive,
          stageId: 's-group',
          teamHome: 'team-a',
          teamAway: 'team-b',
          scoreHome: null,
          scoreAway: null,
          status: 'scheduled',
        };
      }
      return null;
    });
    prisma.stage.findUnique.mockResolvedValue({
      id: 's-group',
      type: 'group',
      name: 'Gruppenphase',
    });
    app = await buildApp(prisma);
  });

  it('Member bekommt 403, auch wenn Match da ist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tLive}/matches/m-1/result`,
      payload: { scoreHome: 2, scoreAway: 1 },
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Admin bekommt 200 mit DTO-Match', async () => {
    prisma.match.update.mockResolvedValue({
      id: 'm-1',
      tournamentId: tLive,
      stageId: 's-group',
      teamHome: 'team-a',
      teamAway: 'team-b',
      scoreHome: 2,
      scoreAway: 1,
      status: 'finished',
    });
    prisma.tournamentTeam.findMany.mockResolvedValue([
      { id: 'team-a', name: 'Alpha', tournamentId: tLive },
      { id: 'team-b', name: 'Beta', tournamentId: tLive },
    ]);
    prisma.stage.findMany.mockResolvedValue([
      { id: 's-group', type: 'group', name: 'Gruppenphase', orderIndex: 0 },
    ]);
    prisma.group_.findMany.mockResolvedValue([]);
    prisma.match.findMany.mockResolvedValue([
      {
        id: 'm-1',
        tournamentId: tLive,
        stageId: 's-group',
        groupId: null,
        teamHome: 'team-a',
        teamAway: 'team-b',
        status: 'finished',
        scoreHome: 2,
        scoreAway: 1,
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tLive}/matches/m-1/result`,
      payload: { scoreHome: 2, scoreAway: 1 },
      headers: { 'x-test-user': u.global.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.match).toBeDefined();
    expect(body.match.id).toBe('m-1');
    expect(typeof body.match.statusLabel).toBe('string');
  });

  // Schema-Drift-Regressionstest (Bug 2026-08-17):
  //   POST /result hat früher winnerTeamId/isDraw/completedAt an
  //   Prisma.match.update übergeben — drei Spalten, die im
  //   schema.prisma NICHT existieren. Prisma lehnt das mit
  //   "Unknown argument …" ab. Wenn dieser Test fehlschlägt, hat
  //   jemand wieder Felder hinzugefügt, die nicht im Schema stehen.
  it('Bug Schema-Drift: POST /result schreibt NUR Schema-konforme Felder', async () => {
    prisma.match.update.mockResolvedValue({
      id: 'm-1',
      tournamentId: tLive,
      stageId: 's-group',
      teamHome: 'team-a',
      teamAway: 'team-b',
      scoreHome: 2,
      scoreAway: 1,
      status: 'finished',
    });
    prisma.tournamentTeam.findMany.mockResolvedValue([
      { id: 'team-a', name: 'Alpha', tournamentId: tLive },
      { id: 'team-b', name: 'Beta', tournamentId: tLive },
    ]);
    prisma.stage.findMany.mockResolvedValue([
      { id: 's-group', type: 'group', name: 'Gruppenphase', orderIndex: 0 },
    ]);
    prisma.group_.findMany.mockResolvedValue([]);
    prisma.match.findMany.mockResolvedValue([]);

    await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tLive}/matches/m-1/result`,
      payload: { scoreHome: 2, scoreAway: 1 },
      headers: { 'x-test-user': u.global.id },
    });

    // Die Route muss an prisma.match.update() GENAU diese 3 Felder
    // übergeben — nicht mehr und nicht weniger. Jeder unerlaubte
    // Feldname wäre "Unknown argument" und würde Prisma werfen lassen.
    expect(prisma.match.update).toHaveBeenCalledTimes(1);
    const updateArgs = prisma.match.update.mock.calls[0][0];
    const dataKeys = Object.keys(updateArgs.data).sort();
    expect(dataKeys).toEqual(['scoreAway', 'scoreHome', 'status']);
    expect(updateArgs.data.scoreHome).toBe(2);
    expect(updateArgs.data.scoreAway).toBe(1);
    expect(updateArgs.data.status).toBe('finished');
    // Vor allem: KEINE Schema-Geister.
    expect('winnerTeamId' in updateArgs.data).toBe(false);
    expect('isDraw' in updateArgs.data).toBe(false);
    expect('completedAt' in updateArgs.data).toBe(false);
  });

  // Bug 2026-08-17 — KO-Matches lehnen Unentschieden ab.
  //   Vorher: Score 1:1 in einem Halbfinale wurde still akzeptiert
  //   (status=finished gesetzt), aber propagateWinner lief NICHT.
  //   Resultat: Finale blieb leer, User wusste nicht warum.
  //   Nachher: 400 no_draw_in_knockout + prisma.match.update GAR NICHT
  //   aufgerufen.
  it('Bug KO-Draw: POST /result mit 1:1 in KO-Stage → 400, kein DB-Write', async () => {
    // KO-Match statt Gruppen-Match — andere stageId + type.
    prisma.match.findFirst.mockResolvedValue({
      id: 'm-sf-1',
      tournamentId: tLive,
      stageId: 's-ko',
      teamHome: 'team-a',
      teamAway: 'team-b',
      scoreHome: null,
      scoreAway: null,
      status: 'open',
    });
    prisma.stage.findUnique.mockResolvedValue({
      id: 's-ko',
      type: 'ko',
      name: 'K.-o.-Phase',
      orderIndex: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tLive}/matches/m-sf-1/result`,
      payload: { scoreHome: 1, scoreAway: 1 },
      headers: { 'x-test-user': u.global.id },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('no_draw_in_knockout');
    // Garantiere: wir haben KEIN Update abgesetzt.
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  // Bug 2026-08-17 — propagatedMatches im Response.
  //   Vorher: nur propagated = ['id1', 'id2'] (IDs).
  //   Nachher: propagatedMatches = [<DTO>, <DTO>] — damit das Frontend
  //   die Folgespiele in-place patchen kann (applyPropagatedMatches).
  it('Bug Propagation-DTO: POST /result KO-Sieg → propagatedMatches = DTOs, nicht nur IDs', async () => {
    prisma.match.findFirst.mockResolvedValue({
      id: 'm-sf-1',
      tournamentId: tLive,
      stageId: 's-ko',
      teamHome: 'team-a',
      teamAway: 'team-b',
      scoreHome: null,
      scoreAway: null,
      status: 'open',
      winnerAdvancesTo: 'm-f-1',
      loserAdvancesTo: null,
    });
    prisma.stage.findUnique.mockResolvedValue({
      id: 's-ko',
      type: 'ko',
      name: 'K.-o.-Phase',
      orderIndex: 1,
    });
    prisma.match.update
      .mockResolvedValueOnce({
        // Update für m-sf-1 selbst
        id: 'm-sf-1',
        tournamentId: tLive,
        stageId: 's-ko',
        teamHome: 'team-a',
        teamAway: 'team-b',
        scoreHome: 2,
        scoreAway: 1,
        status: 'finished',
        winnerAdvancesTo: 'm-f-1',
        loserAdvancesTo: null,
      })
      .mockResolvedValueOnce({
        // Propagation für m-f-1 (Finale)
        id: 'm-f-1',
        tournamentId: tLive,
        stageId: 's-ko',
        teamHome: 'team-a',
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        status: 'open',
      });
    prisma.tournamentTeam.findMany.mockResolvedValue([
      { id: 'team-a', name: 'Alpha', tournamentId: tLive },
      { id: 'team-b', name: 'Beta', tournamentId: tLive },
    ]);
    prisma.stage.findMany.mockResolvedValue([
      { id: 's-ko', type: 'ko', name: 'K.-o.-Phase', orderIndex: 1 },
    ]);
    prisma.group_.findMany.mockResolvedValue([]);
    prisma.match.findMany.mockResolvedValue([
      // m-sf-1 (gerade abgeschlossen) — hat winnerAdvancesTo gesetzt.
      {
        id: 'm-sf-1',
        tournamentId: tLive,
        stageId: 's-ko',
        teamHome: 'team-a',
        teamAway: 'team-b',
        scoreHome: 2,
        scoreAway: 1,
        status: 'finished',
        winnerAdvancesTo: 'm-f-1',
        loserAdvancesTo: null,
      },
      // m-f-1 (Finale, leer → wird durch Propagation gefüllt)
      {
        id: 'm-f-1',
        tournamentId: tLive,
        stageId: 's-ko',
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        status: 'open',
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tLive}/matches/m-sf-1/result`,
      payload: { scoreHome: 2, scoreAway: 1 },
      headers: { 'x-test-user': u.global.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 1) propagated IDs für den Toast-Counter.
    expect(body.propagated).toEqual(['m-f-1']);
    // 2) propagatedMatches als DTO-Liste fürs In-place-Patching.
    expect(Array.isArray(body.propagatedMatches)).toBe(true);
    expect(body.propagatedMatches).toHaveLength(1);
    expect(body.propagatedMatches[0].id).toBe('m-f-1');
    // 3) DTO-Form: home/away Felder existieren (vom prepareMatchView).
    //    Die genaue team-Zuordnung testen wir in access-match.test.js
    //    — hier nur die Form: die Keys home/away sind da.
    expect('home' in body.propagatedMatches[0]).toBe(true);
    expect('away' in body.propagatedMatches[0]).toBe(true);
  });
});

// ------------------------------------------------------------------
// Pflicht-Test 4: Member GET /tournaments/group/:id → enthält keine drafts
// ------------------------------------------------------------------
describe('Pflicht-Test 4: Member GET /tournaments/group/:id filtert drafts', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('Member: findMany-WHERE hat status != draft, Antwort enthält keine drafts', async () => {
    prisma.tournament.findMany.mockImplementation(async ({ where }) => {
      // Route-Call: WHERE hat status-Filter.
      if (where?.status !== undefined) {
        expect(where.status).toEqual({ not: 'draft' });
        return [
          {
            id: 't-live-1',
            groupId: gId,
            name: 'Live',
            status: 'group_stage',
            mode: 'groups_ko',
            createdAt: new Date('2024-01-01'),
          },
        ];
      }
      // Aggregate-Call: WHERE hat id.in — wir liefern Minimal-Objekte.
      return (where?.id?.in ?? []).map((id) => ({ id }));
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/group/${gId}`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tournaments.every((t) => t.status !== 'draft')).toBe(true);
    expect(body.isAdmin).toBe(false);
  });

  it('Admin: Draft ist enthalten, findMany-WHERE hat KEINEN status-Filter', async () => {
    prisma.tournament.findMany.mockImplementation(async ({ where }) => {
      // Route-Call: kein status-Filter.
      if (where?.status === undefined) {
        return [
          {
            id: 't-draft-1',
            groupId: gId,
            name: 'Draft',
            status: 'draft',
            mode: 'groups_ko',
            createdAt: new Date('2024-02-01'),
          },
          {
            id: 't-live-1',
            groupId: gId,
            name: 'Live',
            status: 'group_stage',
            mode: 'groups_ko',
            createdAt: new Date('2024-01-01'),
          },
        ];
      }
      // Aggregate-Call: WHERE hat id.in — Minimal-Objekte.
      return (where?.id?.in ?? []).map((id) => ({ id }));
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/group/${gId}`,
      headers: { 'x-test-user': u.global.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isAdmin).toBe(true);
    expect(body.tournaments.some((t) => t.status === 'draft')).toBe(true);
  });
});

// ------------------------------------------------------------------
// Zusatz: Nicht-Mitglied, 404, kein JWT
// ------------------------------------------------------------------
describe('zusätzliche Auth-Routen-Absicherungen', () => {
  it('Nicht-Mitglied GET draft → 403', async () => {
    const prisma = createLocalMockPrisma();
    baseStubs(prisma);
    // Stranger explizit aus groupMember entfernen.
    prisma.groupMember.findUnique.mockResolvedValue(null);
    prisma.group.findUnique.mockResolvedValue({
      id: gId,
      createdBy: 'u-owner',
    });
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tDraft}`,
      headers: { 'x-test-user': u.stranger.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 bei unbekanntem Turnier', async () => {
    const prisma = createLocalMockPrisma();
    baseStubs(prisma);
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/unknown-id`,
      headers: { 'x-test-user': u.global.id },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ------------------------------------------------------------------
// Pflicht-Test 5+6: DELETE /api/tournaments/:id
//   - Member (kein Admin) → 403
//   - Admin/Owner → 204
//   - Anonymous → 401
//
// Braucht der Wizard für „bei Abbruch den Entwurf aufräumen" ohne
// dass liegengebliebene Drafts die Liste zumüllen. Spec §1.2: Entwürfe
// sind ohnehin nur für Admins sichtbar, also wirkt der 403 nur als
// Schutz gegen Versehen — Member VERSUCHEN es gar nicht erst.
// ------------------------------------------------------------------
describe('Pflicht-Test 5+6: DELETE /api/tournaments/:id', () => {
  let app, prisma;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    baseStubs(prisma);
    app = await buildApp(prisma);
  });

  it('Admin (Group-Owner) löscht Draft → 200', async () => {
    prisma.tournament.findUnique.mockResolvedValue({
      id: tDraft,
      groupId: gId,
      name: 'Draft',
      status: 'draft',
      isPublic: false,
      publicToken: null,
      publicRevokedAt: null,
      group: { id: gId, createdBy: u.admin.id, name: 'G' },
    });
    prisma.tournament.delete.mockResolvedValue({ id: tDraft });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tDraft}`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(prisma.tournament.delete).toHaveBeenCalledWith({ where: { id: tDraft } });
  });

  it('Globaler Admin (role=admin) löscht Draft → 200', async () => {
    prisma.tournament.findUnique.mockResolvedValue({
      id: tDraft,
      groupId: gId,
      name: 'Draft',
      status: 'draft',
      isPublic: false,
      publicToken: null,
      publicRevokedAt: null,
      group: { id: gId, createdBy: 'u-anders', name: 'G' },
    });
    prisma.tournament.delete.mockResolvedValue({ id: tDraft });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tDraft}`,
      headers: { 'x-test-user': u.global.id },
    });
    expect(res.statusCode).toBe(200);
  });

  it('Member (kein Admin) bekommt 403, kein delete-Call', async () => {
    prisma.tournament.findUnique.mockResolvedValue({
      id: tDraft,
      groupId: gId,
      name: 'Draft',
      status: 'draft',
      isPublic: false,
      publicToken: null,
      publicRevokedAt: null,
      group: { id: gId, createdBy: u.admin.id, name: 'G' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tDraft}`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.statusCode).toBe(403);
    expect(prisma.tournament.delete).not.toHaveBeenCalled();
  });
});
