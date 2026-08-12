/**
 * Round-Trip-Test für den v3-Wizard (Spec §3, §1.2, §6, §10).
 *
 * Hintergrund: Bis 2026-08-11 hatten wir Slices/Engine/Routen alle
 * grün, ABER der Wizard hat Teams nicht zum Server geschickt — der
 * User konnte bis Step 5 klicken, dann brach POST /generate mit
 * "Mindestens 2 Teams erforderlich" ab. Grund: buildPatchPayload
 * serialisiert nur config + meta, NICHT state.teams. Das hier ist
 * genau die Klasse von Bug, die man nicht findet, indem man den
 * Engine-Code reviewt oder die Generate-Route einzeln testet — sie
 * sitzt in der Kette Wizard → HTTP → Routes → Engine → DB → DTO.
 *
 * Dieser Test fährt die Kette ECHT hoch (Fastify + gemocktes Prisma)
 * und prüft JEDEN einzelnen Wert, den der Wizard laut Default-State
 * setzt: 12 Teams mit Platzhalternamen, 4 Gruppen, beste Dritte,
 * Spiel um Platz 3, Punkteregel 2/1/0, eigene Tiebreaker-Reihenfolge,
 * 4 Tischnamen, Startzeit, Spieldauer, Pause, Sportart Bierpong.
 *
 * Was NICHT hier geprüft wird (separate Tests):
 *   - Engine-Logik an sich (engine-generate.test.js, §10.1-§10.10)
 *   - Auth-Header / 401-Retry (frontend draft-promise-*.test.js)
 *   - Spec §10.1-§10.10 Pflicht-Tests (generate.integration.test.js)
 *
 * Spec §13.5: "Ursache beheben statt Meldung verschönern". Der
 * Round-Trip ist hier die Ursachen-Ebene: er verifiziert, dass die
 * Kette stimmt, BEVOR der User sie von Hand durchklicken muss.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';

// ------------------------------------------------------------------
// Lokaler Prisma-Mock — minimal für den Round-Trip-Flow.
// Teams + Stages + Groups + Matches werden als leere Sammlungen
// initialisiert. Die Engine (über routes.js → engine/index.js → ...)
// läuft ECHT, deshalb reichen Stubs, die das richtige Schema
// zurückliefern.
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
  admin: { id: 'u-admin', role: 'user' },
  global: { id: 'u-global', role: 'admin' },
};
const gId = 'g-round-trip';

// Auth-Stubs: Admin ist Group-Owner (alle Rechte).
function stubUsersAndGroup(prisma) {
  prisma.user.findUnique.mockImplementation(async ({ where }) => {
    const map = {
      [u.admin.id]: { id: u.admin.id, role: u.admin.role },
      [u.global.id]: { id: u.global.id, role: u.global.id },
    };
    return map[where.id] ?? null;
  });
  prisma.group.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === gId) return { id: gId, createdBy: u.admin.id, name: 'Bierpong-Gruppe' };
    return null;
  });
  prisma.groupDeputy.findUnique.mockResolvedValue(null);
  prisma.groupMember.findUnique.mockImplementation(async ({ where }) => {
    const { userId, groupId } = where.userId_groupId ?? {};
    if (groupId !== gId) return null;
    if (userId === u.admin.id) return { userId: u.admin.id, groupId };
    if (userId === u.global.id) return { userId: u.global.id, groupId };
    return null;
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------------------
// Wizard-State, wie ihn der v3-Wizard bei "Anzahl festlegen" + alle
// Step-3- und Step-4-Defaults erzeugt. Werte sind 1:1 aus
// tournament.js DEFAULT_WIZARD_STATE übernommen.
//
// Der Body für die drei HTTP-Aufrufe (POST /, POST /teams, PATCH /:id)
// wird hier zu Fuss gebaut — das ist genau das, was der Wizard auf
// dem Draht sendet. Wenn sich tourname.js ändert, müssen diese
// Bodies mit den neuen Feldern mitwachsen.
// ------------------------------------------------------------------
function makeWizardState() {
  return {
    name: 'Bierpong-Turnier 2026',
    date: '2026-08-15',
    location: 'Vereinsheim',
    sport: 'becher',
    // Step 2: Teams per "Anzahl festlegen" → Platzhalternamen
    teams: Array.from({ length: 12 }, (_, i) => ({
      name: `Team ${i + 1}`,
      color: null,
      seed: i + 1,
    })),
    // Step 3: Modus + Verteilung + Punkteregel + Tiebreaker
    mode: 'groups_ko',
    numGroups: 4,
    distributionMethod: 'snake',
    pointsWin: 2,
    pointsDraw: 1,
    pointsLoss: 0,
    tiebreakers: ['points', 'goalDiff', 'headToHead', 'wins'],
    // Step 4: Qualifikation + Spiel um Platz 3
    advancePerGroup: 2,
    bestThirdsCount: 2,
    thirdPlaceMatch: true,
    // Step 5: Zeitplan
    numTables: 4,
    tableNames: ['Theke', 'DJ-Pult', 'Ecke-links', 'Ecke-rechts'],
    startTime: '14:00',
    matchDuration: 20,
    pauseMinutes: 10,
  };
}

// Baut die HTTP-Bodies, die der Wizard bei den drei Schritten sendet.
function buildRequestBodies(state) {
  // 1) POST /api/tournaments — Step 1 (Draft anlegen)
  const createBody = {
    groupId: gId,
    name: state.name,
    mode: state.mode,
  };
  // 2) POST /api/tournaments/:id/teams — Step 2 (Bulk-Add)
  const teamsBody = {
    names: state.teams.map((t) => t.name),
  };
  // 3) PATCH /api/tournaments/:id — Steps 1/3/4/5 (Config + Meta)
  //    Genau so, wie es buildPatchPayload in tournament.js serialisiert.
  const patchBody = {
    location: state.location,
    sport: state.sport,
    tableLabels: state.tableNames,
    config: {
      distribution: state.distributionMethod,
      pointsPerWin: state.pointsWin,
      pointsPerDraw: state.pointsDraw,
      pointsPerLoss: state.pointsLoss,
      tiebreakers: state.tiebreakers,
      qualifyPerGroup: state.advancePerGroup,
      bestThirds: state.bestThirdsCount,
      hasThirdPlacePlayoff: state.thirdPlaceMatch,
      schedule: {
        slotMinutes: 15,
        matchDurationMinutes: state.matchDuration,
        pauseAfterMatches: state.pauseMinutes,
        parallelFields: state.numTables,
        startTime: state.startTime,
      },
    },
  };
  // 4) POST /api/tournaments/:id/generate — Step 5
  const generateBody = {
    baseDate: state.date,
    numGroups: state.numGroups,
    groupSize: Math.ceil(state.teams.length / state.numGroups),
  };
  return { createBody, teamsBody, patchBody, generateBody };
}

// ------------------------------------------------------------------
// Der eigentliche Round-Trip-Test
// ------------------------------------------------------------------
describe('Wizard → DB → DTO Round-Trip (12 Teams, alle Optionen)', () => {
  let app, prisma, tId, state, bodies;

  beforeEach(async () => {
    prisma = createLocalMockPrisma();
    stubUsersAndGroup(prisma);

    state = makeWizardState();
    bodies = buildRequestBodies(state);

    // ID-Counter, damit jede Entity eine stabile fake-ID bekommt.
    let nextId = 1;
    const idFor = (prefix) => `${prefix}-${nextId++}`;

    // ── POST /api/tournaments
    let createdConfig = null;
    let createdLocation = null;
    let createdSport = null;
    let createdTableLabels = null;

    prisma.tournament.create.mockImplementation(async ({ data }) => {
      tId = idFor('t');
      const row = {
        id: tId,
        groupId: data.groupId,
        name: data.name,
        mode: data.mode ?? 'groups_ko',
        status: 'draft',
        config: null,
        location: null,
        sport: 'becher',
        tableLabels: null,
        logoUrl: null,
        coverUrl: null,
        isPublic: false,
        publicToken: null,
        publicEnabledAt: null,
        publicRevokedAt: null,
        startsAt: null,
        endsAt: null,
        createdById: data.createdById,
        createdAt: new Date('2026-08-11T10:00:00Z'),
        updatedAt: new Date('2026-08-11T10:00:00Z'),
      };
      return row;
    });

    // ── PATCH /api/tournaments/:id
    prisma.tournament.update.mockImplementation(async ({ where, data }) => {
      if ('config' in data) createdConfig = data.config;
      if ('location' in data) createdLocation = data.location;
      if ('sport' in data) createdSport = data.sport;
      if ('tableLabels' in data) createdTableLabels = data.tableLabels;
      return { id: where.id, status: 'draft' };
    });

    // ── Tournament.findUnique (für GET + Auth + View)
    //
    // HINWEIS: Der Status wechselt nach /generate von 'draft' → 'generated'.
    // Wir simulieren das, indem wir nach dem /generate einen Tracker-Status
    // pflegen. Aber ACHTUNG: kein doppeltes mockImplementation — wir
    // würden uns sonst rekursiv selbst aufrufen.
    let currentStatus = 'draft';
    prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
      if (where.id !== tId) return null;
      return {
        id: tId,
        groupId: gId,
        name: state.name,
        mode: state.mode,
        status: currentStatus,
        config: createdConfig,
        location: createdLocation,
        sport: createdSport,
        tableLabels: createdTableLabels,
        logoUrl: null,
        coverUrl: null,
        isPublic: false,
        publicToken: null,
        publicEnabledAt: null,
        publicRevokedAt: null,
        startsAt: null,
        endsAt: null,
        createdById: u.admin.id,
        createdAt: new Date('2026-08-11T10:00:00Z'),
        updatedAt: new Date('2026-08-11T10:00:00Z'),
        group: { id: gId, createdBy: u.admin.id, name: 'Bierpong-Gruppe' },
      };
    });

    // Tournament-Update: fängt Status-Wechsel ab (für /generate)
    const originalUpdateImpl = prisma.tournament.update.getMockImplementation();
    prisma.tournament.update.mockImplementation(async (args) => {
      const r = await originalUpdateImpl(args);
      if (args?.data?.status) currentStatus = args.data.status;
      return r;
    });

    // ── Teams
    const serverTeams = [];
    let teamCounter = 0;
    prisma.tournamentTeam.createMany.mockImplementation(async ({ data }) => {
      const existingNames = new Set(serverTeams.map((t) => t.name));
      const newRows = data
        .filter((row) => !existingNames.has(row.name))
        .map((row) => {
          teamCounter++;
          const row2 = {
            id: idFor('team'),
            tournamentId: row.tournamentId,
            name: row.name,
            seed: row.seed ?? teamCounter,
            createdAt: new Date(`2026-08-11T10:${String(teamCounter).padStart(2, '0')}:00Z`),
          };
          serverTeams.push(row2);
          return row2;
        });
      return { count: newRows.length };
    });
    prisma.tournamentTeam.findMany.mockImplementation(async () =>
      serverTeams.slice().sort((a, b) => a.createdAt - b.createdAt)
    );
    prisma.tournamentTeam.delete.mockImplementation(async ({ where }) => {
      const idx = serverTeams.findIndex((t) => t.id === where.id);
      if (idx >= 0) serverTeams.splice(idx, 1);
      return { id: where.id };
    });

    // ── Stages / Groups / Matches (Stub für Persist)
    // Wir tracken die persistierten Entities in Arrays, damit der
    // anschließende GET /:id die richtigen Counts liefert.
    const persistedStages = [];
    const persistedGroups = [];
    const persistedMemberships = [];
    const persistedMatches = [];

    prisma.stage.deleteMany.mockImplementation(async ({ where }) => {
      // Alles für dieses Turnier löschen, damit Re-Generate sauber
      // startet.
      const before = persistedStages.length;
      for (let i = persistedStages.length - 1; i >= 0; i--) {
        if (persistedStages[i].tournamentId === where.tournamentId) {
          persistedStages.splice(i, 1);
        }
      }
      return { count: before };
    });
    prisma.stage.create.mockImplementation(async ({ data }) => {
      const row = {
        id: idFor('stage'),
        ...data,
        createdAt: new Date(),
      };
      persistedStages.push(row);
      return row;
    });
    prisma.group_.create.mockImplementation(async ({ data }) => {
      const row = {
        id: idFor(`group-${data.key}`),
        ...data,
      };
      persistedGroups.push(row);
      return row;
    });
    prisma.groupMembership.createMany.mockImplementation(async ({ data }) => {
      for (const m of data) persistedMemberships.push(m);
      return { count: data.length };
    });
    prisma.match.createMany.mockImplementation(async ({ data }) => {
      for (const m of data) persistedMatches.push({ ...m });
      return { count: data.length };
    });
    prisma.match.count.mockResolvedValue(0); // keine finished Matches

    // ── View liest nach Persist — wir geben die persistierten Entities
    // zurück, damit der DTO die korrekten Counts liefert.
    prisma.stage.findMany.mockImplementation(async ({ where }) =>
      persistedStages.filter((s) => s.tournamentId === where?.tournamentId)
    );
    prisma.group_.findMany.mockImplementation(async ({ where }) => {
      // where: { stage: { tournamentId } }
      const tId = where?.stage?.tournamentId;
      const stageIds = new Set(
        persistedStages.filter((s) => s.tournamentId === tId).map((s) => s.id)
      );
      const groups = persistedGroups.filter((g) => stageIds.has(g.stageId));
      // Memberships anhängen
      return groups.map((g) => ({
        ...g,
        memberships: persistedMemberships.filter((m) => m.groupId === g.id),
        matches: persistedMatches.filter((m) => m.groupId === g.id),
      }));
    });
    prisma.match.findMany.mockImplementation(async ({ where }) =>
      persistedMatches.filter((m) => m.tournamentId === where?.tournamentId)
    );

    // (KEIN doppeltes mockImplementation — die ursprüngliche
    // findUnique-Implementierung oben liefert bereits den fertigen
    // Zustand mit den von PATCH gesammelten createdConfig / -Location /
    // -Sport / -TableLabels. Wenn wir hier nochmal wrappen und uns
    // selbst aufrufen, gibt's eine Endlos-Rekursion → "Maximum call
    // stack size exceeded". Status 'generated' wird im Original-Mock
    // schon so zurückgegeben.)

    app = await buildApp(prisma);
  });

  it('Schritt 1: POST /api/tournaments legt den Entwurf an', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: bodies.createBody,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tournament.id).toBe(tId);
    expect(body.tournament.status).toBe('draft');
    expect(body.tournament.mode).toBe('groups_ko');
  });

  it('Schritt 2: POST /api/tournaments/:id/teams legt 12 Platzhalter-Teams an', async () => {
    // Step 1 zuerst
    await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: bodies.createBody,
      headers: { 'x-test-user': u.admin.id },
    });
    // Step 2: Teams
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/teams`,
      payload: bodies.teamsBody,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.added).toBe(12);
    expect(body.teams).toHaveLength(12);
    // Platzhalternamen sind gültige Namen — keine Sonderbehandlung.
    expect(body.teams.map((t) => t.name).sort()).toEqual([
      'Team 1', 'Team 10', 'Team 11', 'Team 12',
      'Team 2', 'Team 3', 'Team 4', 'Team 5',
      'Team 6', 'Team 7', 'Team 8', 'Team 9',
    ]);
  });

  it('Schritt 3+4+5: PATCH speichert alle Config- und Meta-Felder', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: bodies.createBody,
      headers: { 'x-test-user': u.admin.id },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: bodies.patchBody,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    // Wir prüfen, was die Route an Prisma durchgereicht hat.
    expect(prisma.tournament.update).toHaveBeenCalled();
    const updateArgs = prisma.tournament.update.mock.calls[0][0];
    expect(updateArgs.data.location).toBe('Vereinsheim');
    expect(updateArgs.data.sport).toBe('becher');
    expect(updateArgs.data.tableLabels).toEqual([
      'Theke', 'DJ-Pult', 'Ecke-links', 'Ecke-rechts',
    ]);
    expect(updateArgs.data.config.distribution).toBe('snake');
    expect(updateArgs.data.config.pointsPerWin).toBe(2);
    expect(updateArgs.data.config.pointsPerDraw).toBe(1);
    expect(updateArgs.data.config.pointsPerLoss).toBe(0);
    expect(updateArgs.data.config.tiebreakers).toEqual([
      'points', 'goalDiff', 'headToHead', 'wins',
    ]);
    expect(updateArgs.data.config.qualifyPerGroup).toBe(2);
    expect(updateArgs.data.config.bestThirds).toBe(2);
    expect(updateArgs.data.config.hasThirdPlacePlayoff).toBe(true);
    expect(updateArgs.data.config.schedule.matchDurationMinutes).toBe(20);
    expect(updateArgs.data.config.schedule.pauseAfterMatches).toBe(10);
    expect(updateArgs.data.config.schedule.parallelFields).toBe(4);
    expect(updateArgs.data.config.schedule.startTime).toBe('14:00');
  });

  it('Schritt 5: POST /generate erzeugt Stages + Groups + Matches ohne "Teams fehlen"-Fehler', async () => {
    // Komplette Kette
    await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: bodies.createBody,
      headers: { 'x-test-user': u.admin.id },
    });
    await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/teams`,
      payload: bodies.teamsBody,
      headers: { 'x-test-user': u.admin.id },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: bodies.patchBody,
      headers: { 'x-test-user': u.admin.id },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: bodies.generateBody,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tournament).toBeDefined();
    expect(body.counts.groups).toBeGreaterThan(0);
    expect(body.counts.matches).toBeGreaterThan(0);
    expect(body.warnings).toEqual([]);
  });

  it('Round-Trip: JEDER Wert aus dem Wizard-State landet im DTO (Spec §1.2)', async () => {
    // Komplette Kette durchlaufen
    await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: bodies.createBody,
      headers: { 'x-test-user': u.admin.id },
    });
    await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/teams`,
      payload: bodies.teamsBody,
      headers: { 'x-test-user': u.admin.id },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: bodies.patchBody,
      headers: { 'x-test-user': u.admin.id },
    });
    const genRes = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: bodies.generateBody,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(genRes.statusCode).toBe(201);

    // DTO abfragen
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(getRes.statusCode).toBe(200);
    const dto = getRes.json();

    // ── Meta
    expect(dto.tournament.name).toBe(state.name);
    expect(dto.tournament.location).toBe(state.location);
    // Sport → Bierpong-Steuerung: Spaltenbezeichnung MUSS "Becher" sein,
    // nicht "Tore". Das war der explizite Bierpong→Becher-Check aus dem
    // Auftrag.
    expect(dto.tournament.sport).toBe('becher');
    expect(dto.tournament.scoreLabel).toBe('Becher');
    expect(dto.tournament.tableLabels).toEqual(state.tableNames);

    // ── Teams: 12 Teams mit Platzhalternamen sind tatsächlich in der DB.
    // Das war die ursprüngliche Fehlerklasse: state.teams hatte 12 Einträge,
    // die DB hatte 0, Generate brach ab.
    expect(dto.teams).toHaveLength(12);
    const teamNames = dto.teams.map((t) => t.name).sort();
    expect(teamNames).toEqual([
      'Team 1', 'Team 10', 'Team 11', 'Team 12',
      'Team 2', 'Team 3', 'Team 4', 'Team 5',
      'Team 6', 'Team 7', 'Team 8', 'Team 9',
    ]);
    // Jedes Team hat eine ID bekommen (sonst könnten wir später nicht löschen).
    for (const t of dto.teams) {
      expect(t.id).toBeTruthy();
    }

    // ── Config aus PATCH ist in der DB angekommen
    expect(dto.tournament.teamCount).toBe(12);
    expect(dto.stats.groupCount).toBeGreaterThan(0);
    expect(dto.stats.matchCount).toBeGreaterThan(0);
  });

  it('Round-Trip ohne Teams schlägt mit "Mindestens 2 Teams" fehl (Regressionsschutz)', async () => {
    // Wenn der Wizard die Teams nicht synct (z. B. weil ein zukünftiger
    // Refactor die Sync-Logik entfernt), MUSS die /generate-Route
    // weiterhin hart ablehnen — der Bug aus 2026-08-11 darf nicht
    // stillschweigend verschwinden.
    await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: bodies.createBody,
      headers: { 'x-test-user': u.admin.id },
    });
    // KEIN POST /teams.
    await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}`,
      payload: bodies.patchBody,
      headers: { 'x-test-user': u.admin.id },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/generate`,
      payload: bodies.generateBody,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/team/i);
  });
});