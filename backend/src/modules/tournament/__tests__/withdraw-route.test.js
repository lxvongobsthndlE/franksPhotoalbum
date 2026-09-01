/**
 * Tests für POST /api/tournaments/:id/teams/:teamId/withdraw
 * (Team-Rückzug vor Turnierstart, 2026-09-01).
 *
 * Der fachliche Entscheid dahinter: Ein Team, das kurz vor dem Turnier
 * absagt, verschwindet vollständig — kein 3:0-Wertungsspiel, weil das die
 * Punkte-pro-Spiel-Werte der Beste-Dritte-Tabelle verzerren würde.
 *
 * Diese Datei sichert genau die Stellen, an denen das schiefgehen kann:
 *   - die vier Gates in ihrer Reihenfolge (Lock, Modus, Team, Restbestand),
 *   - dass NUR die Spiele des zurückgezogenen Teams verschwinden und die
 *     übrigen Paarungen der Gruppe unangetastet bleiben (die Gruppen
 *     werden bewusst nicht neu ausgelost),
 *   - dass der neu gepackte Spielplan die harte Planer-Regel H1 hält:
 *     kein Team spielt zweimal im selben Zeitfenster.
 *
 * Prisma ist gemockt, aber gegen einen mutierbaren In-Memory-Bestand:
 * Ein Mock, der feste Werte zurückgibt, könnte die Kernfrage („was steht
 * NACH dem Rückzug im Spielplan?") gar nicht beantworten.
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

const tGroupsId = 't-groups'; // 4 Gruppen à 4 Teams, BEREIT
const tRunningId = 't-running'; // startedAt gesetzt
const tFinishedId = 't-finished';
const tKoId = 't-ko'; // mode 'ko_only'
const tDoubleId = 't-double'; // mode 'double_elim'
const tTinyId = 't-tiny'; // nur 2 Teams
const tOtherId = 't-other'; // fremdes Turnier, liefert die 404-Probe

const BASISZEIT = new Date('2026-09-05T10:00:00.000Z');

const CONFIG = {
  schedule: {
    matchDurationMinutes: 30,
    pauseAfterMatches: 0,
    parallelFields: 3,
    startTime: '10:00',
  },
};

// ─────────────────────────────────────────────────────────
// In-Memory-Bestand
// ─────────────────────────────────────────────────────────

let db;

/** Round-Robin für genau vier Teams: 3 Spieltage à 2 Spiele. */
function paarungenFuerVier([a, b, c, d]) {
  return [
    { round: '1', teamHome: a, teamAway: b },
    { round: '1', teamHome: c, teamAway: d },
    { round: '2', teamHome: a, teamAway: c },
    { round: '2', teamHome: b, teamAway: d },
    { round: '3', teamHome: a, teamAway: d },
    { round: '3', teamHome: b, teamAway: c },
  ];
}

function seed() {
  const teams = [];
  const stages = [];
  const groups = [];
  const memberships = [];
  const matches = [];

  // Hauptturnier: 16 Teams, 4 Gruppen à 4, 24 Gruppenspiele.
  const stage = {
    id: 'stage-group',
    tournamentId: tGroupsId,
    type: 'group',
    name: 'Gruppenphase',
    orderIndex: 0,
  };
  stages.push(stage);

  for (let i = 1; i <= 16; i++) {
    teams.push({
      id: `team-${i}`,
      tournamentId: tGroupsId,
      name: `Team ${i}`,
      color: null,
      seed: i,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)),
    });
  }

  const schluessel = ['A', 'B', 'C', 'D'];
  let bracketPos = 0;
  schluessel.forEach((key, gi) => {
    const group = { id: `group-${key.toLowerCase()}`, stageId: stage.id, key, name: null };
    groups.push(group);
    const ids = [1, 2, 3, 4].map((n) => `team-${gi * 4 + n}`);
    ids.forEach((teamId, pos) => {
      memberships.push({ id: `mem-${teamId}`, groupId: group.id, teamId, position: pos });
    });
    for (const p of paarungenFuerVier(ids)) {
      matches.push({
        id: `m-${key}-${bracketPos}`,
        tournamentId: tGroupsId,
        stageId: stage.id,
        groupId: group.id,
        round: p.round,
        bracketType: null,
        bracketPos,
        teamHome: p.teamHome,
        teamAway: p.teamAway,
        scoreHome: null,
        scoreAway: null,
        status: 'scheduled',
        field: 1,
        scheduledAt: new Date(BASISZEIT),
      });
      bracketPos += 1;
    }
  });

  // Zwei-Team-Turnier für die Restbestand-Probe.
  teams.push(
    {
      id: 'tiny-1',
      tournamentId: tTinyId,
      name: 'Klein 1',
      color: null,
      seed: 1,
      createdAt: new Date(),
    },
    {
      id: 'tiny-2',
      tournamentId: tTinyId,
      name: 'Klein 2',
      color: null,
      seed: 2,
      createdAt: new Date(),
    }
  );
  // Team eines FREMDEN Turniers — darf über tGroupsId nicht erreichbar sein.
  teams.push({
    id: 'foreign-1',
    tournamentId: tOtherId,
    name: 'Fremd 1',
    color: null,
    seed: 1,
    createdAt: new Date(),
  });

  return { teams, stages, groups, memberships, matches };
}

function turnierStub(overrides = {}) {
  return {
    id: tGroupsId,
    groupId: gId,
    name: 'Mein Turnier',
    mode: 'groups_only',
    status: 'generated',
    isPublic: false,
    publicToken: null,
    publicSlug: null,
    publicRevokedAt: null,
    logoUrl: null,
    coverUrl: null,
    config: CONFIG,
    startedAt: null,
    startsAt: null,
    endsAt: null,
    location: null,
    sport: 'becher',
    tableLabels: null,
    rules: null,
    createdById: u.admin.id,
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    updatedAt: new Date('2026-09-01T08:00:00.000Z'),
    group: { id: gId, createdBy: u.admin.id, name: 'G' },
    ...overrides,
  };
}

const TURNIERE = () => ({
  [tGroupsId]: turnierStub(),
  [tRunningId]: turnierStub({
    id: tRunningId,
    status: 'group_stage',
    startedAt: new Date('2026-09-05T10:00:00.000Z'),
  }),
  [tFinishedId]: turnierStub({ id: tFinishedId, status: 'finished' }),
  [tKoId]: turnierStub({ id: tKoId, mode: 'ko_only' }),
  [tDoubleId]: turnierStub({ id: tDoubleId, mode: 'double_elim' }),
  [tTinyId]: turnierStub({ id: tTinyId }),
  [tOtherId]: turnierStub({ id: tOtherId }),
});

// ─────────────────────────────────────────────────────────
// Prisma-Mock gegen den Bestand
// ─────────────────────────────────────────────────────────

function passtOr(m, where) {
  if (!where.OR) return true;
  return where.OR.some((klausel) =>
    Object.entries(klausel).every(([feld, wert]) => m[feld] === wert)
  );
}

function createMockPrisma() {
  const turniere = TURNIERE();
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }) => {
        if (where.id === u.member.id) return { ...u.member };
        if (where.id === u.admin.id) return { ...u.admin };
        return null;
      }),
    },
    group: {
      findUnique: vi.fn(async ({ where }) =>
        where.id === gId ? { id: gId, createdBy: u.admin.id } : null
      ),
    },
    groupMember: {
      findUnique: vi.fn(async ({ where }) => {
        const { userId, groupId } = where.userId_groupId ?? {};
        if (groupId !== gId) return null;
        if (userId === u.member.id || userId === u.admin.id) return { userId, groupId };
        return null;
      }),
    },
    groupDeputy: { findUnique: vi.fn(async () => null) },
    tournament: {
      findUnique: vi.fn(async ({ where }) => turniere[where.id] ?? null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ where, data }) => ({ ...turniere[where.id], ...data })),
      delete: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    tournamentTeam: {
      findFirst: vi.fn(
        async ({ where }) =>
          db.teams.find(
            (t) =>
              t.id === where.id &&
              (where.tournamentId ? t.tournamentId === where.tournamentId : true)
          ) ?? null
      ),
      findMany: vi.fn(async ({ where }) =>
        db.teams
          .filter((t) => t.tournamentId === where.tournamentId)
          .slice()
          .sort((a, b) => a.createdAt - b.createdAt)
      ),
      findUnique: vi.fn(async ({ where }) => db.teams.find((t) => t.id === where.id) ?? null),
      count: vi.fn(
        async ({ where }) => db.teams.filter((t) => t.tournamentId === where.tournamentId).length
      ),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async ({ where }) => {
        const idx = db.teams.findIndex((t) => t.id === where.id);
        const [weg] = db.teams.splice(idx, 1);
        // Cascade wie im Schema (GroupMembership.team onDelete: Cascade).
        db.memberships = db.memberships.filter((m) => m.teamId !== where.id);
        return weg;
      }),
    },
    stage: {
      findMany: vi.fn(async ({ where }) =>
        db.stages.filter((s) => s.tournamentId === where.tournamentId)
      ),
      findUnique: vi.fn(async ({ where }) => db.stages.find((s) => s.id === where.id) ?? null),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    group_: {
      findMany: vi.fn(async ({ where }) => {
        const tid = where?.stage?.tournamentId;
        const stageIds = db.stages.filter((s) => s.tournamentId === tid).map((s) => s.id);
        return db.groups
          .filter((g) => stageIds.includes(g.stageId))
          .map((g) => ({
            ...g,
            memberships: db.memberships
              .filter((m) => m.groupId === g.id)
              .map((m) => ({ ...m, team: db.teams.find((t) => t.id === m.teamId) ?? null })),
            matches: db.matches.filter((m) => m.groupId === g.id),
          }));
      }),
      create: vi.fn(async () => ({})),
    },
    groupMembership: {
      findMany: vi.fn(async () => db.memberships),
      createMany: vi.fn(async ({ data }) => ({ count: data.length })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    match: {
      findMany: vi.fn(async ({ where, include }) =>
        db.matches
          .filter((m) => m.tournamentId === where.tournamentId && passtOr(m, where))
          .map((m) =>
            include?.stage ? { ...m, stage: db.stages.find((s) => s.id === m.stageId) } : { ...m }
          )
      ),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async ({ where }) => db.matches.find((m) => m.id === where.id) ?? null),
      count: vi.fn(
        async ({ where }) =>
          db.matches.filter(
            (m) =>
              m.tournamentId === where.tournamentId &&
              (where.status ? m.status === where.status : true)
          ).length
      ),
      deleteMany: vi.fn(async ({ where }) => {
        const treffer = db.matches.filter(
          (m) => m.tournamentId === where.tournamentId && passtOr(m, where)
        );
        db.matches = db.matches.filter((m) => !treffer.includes(m));
        return { count: treffer.length };
      }),
      update: vi.fn(async ({ where, data }) => {
        const m = db.matches.find((x) => x.id === where.id);
        Object.assign(m, data);
        return { ...m };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({})),
      createMany: vi.fn(async () => ({ count: 0 })),
      groupBy: vi.fn(async () => []),
    },
  };
  prisma.$transaction = vi.fn(async (arg) => (typeof arg === 'function' ? arg(prisma) : arg));
  return prisma;
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
  db = seed();
  prisma = createMockPrisma();
  app = await buildApp(prisma);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

const withdraw = (tid, teamId, userId = u.admin.id) =>
  app.inject({
    method: 'POST',
    url: `/api/tournaments/${tid}/teams/${teamId}/withdraw`,
    headers: { 'x-test-user': userId },
    payload: {},
  });

/** Paarungs-Signatur eines Spiels — unabhängig von Zeit und Platte. */
const paarung = (m) => `${m.teamHome}|${m.teamAway}`;

describe('POST /api/tournaments/:id/teams/:teamId/withdraw — Gates', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tGroupsId}/teams/team-1/withdraw`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 für Mitglieder (§1.2 Pflicht-Test)', async () => {
    const res = await withdraw(tGroupsId, 'team-1', u.member.id);
    expect(res.statusCode).toBe(403);
  });

  it('409 withdraw_locked, wenn das Turnier läuft (startedAt !== null)', async () => {
    const res = await withdraw(tRunningId, 'team-1');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('withdraw_locked');
    expect(res.json().status).toBe('group_stage');
    expect(typeof res.json().message).toBe('string');
    expect(res.json().message.length).toBeGreaterThan(0);
  });

  it('409 withdraw_locked, wenn das Turnier beendet ist', async () => {
    const res = await withdraw(tFinishedId, 'team-1');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('withdraw_locked');
    expect(res.json().status).toBe('finished');
  });

  it('Lock greift VOR dem Löschen: kein Spiel und kein Team verschwindet', async () => {
    const vorherTeams = db.teams.length;
    const vorherMatches = db.matches.length;
    await withdraw(tRunningId, 'team-1');
    expect(db.teams).toHaveLength(vorherTeams);
    expect(db.matches).toHaveLength(vorherMatches);
  });

  // Regression zum Befund vom 2026-09-01: `startedAt === null` beweist
  // NICHT, dass noch nichts gespielt wurde — POST /:id/matches/:matchId/result
  // hat kein Start-Gate. Ohne Gate 1b haette der Rueckzug hier ein
  // beendetes Spiel still geloescht, und die Tabelle danach saehe
  // plausibel aus. Genau solche Fehler faellt niemandem auf.
  it('409 withdraw_results_present: ein Ergebnis vor dem Start blockt den Rueckzug', async () => {
    const m = db.matches.find((x) => x.tournamentId === tGroupsId);
    m.status = 'finished';
    m.scoreHome = 3;
    m.scoreAway = 1;

    const vorherTeams = db.teams.length;
    const vorherMatches = db.matches.length;

    const res = await withdraw(tGroupsId, 'team-1');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('withdraw_results_present');
    expect(res.json().finishedMatches).toBe(1);

    // Und zwar VOR dem Loeschen: nichts ist weg.
    expect(db.teams).toHaveLength(vorherTeams);
    expect(db.matches).toHaveLength(vorherMatches);
  });

  it('409 withdraw_not_supported_for_mode bei ko_only', async () => {
    const res = await withdraw(tKoId, 'team-1');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('withdraw_not_supported_for_mode');
    expect(res.json().mode).toBe('ko_only');
    expect(res.json().message).toContain('K.-o.');
  });

  it('409 withdraw_not_supported_for_mode bei double_elim', async () => {
    const res = await withdraw(tDoubleId, 'team-1');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('withdraw_not_supported_for_mode');
    expect(res.json().mode).toBe('double_elim');
  });

  it('404 bei unbekannter teamId', async () => {
    const res = await withdraw(tGroupsId, 'team-gibtsnicht');
    expect(res.statusCode).toBe(404);
  });

  it('404 bei einem Team aus einem FREMDEN Turnier', async () => {
    const res = await withdraw(tGroupsId, 'foreign-1');
    expect(res.statusCode).toBe(404);
    // Das fremde Team steht danach unverändert im Bestand.
    expect(db.teams.some((t) => t.id === 'foreign-1')).toBe(true);
  });

  it('400 too_few_teams, wenn danach weniger als zwei Teams blieben', async () => {
    const res = await withdraw(tTinyId, 'tiny-1');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('too_few_teams');
    // Nichts gelöscht.
    expect(db.teams.filter((t) => t.tournamentId === tTinyId)).toHaveLength(2);
  });
});

describe('POST /api/tournaments/:id/teams/:teamId/withdraw — Wirkung', () => {
  it('Happy Path: Team weg, seine 3 Spiele weg, Zähler nachgezogen', async () => {
    const gruppeAvorher = db.matches.filter((m) => m.groupId === 'group-a');
    expect(gruppeAvorher).toHaveLength(6);
    const bleibenSollen = gruppeAvorher
      .filter((m) => m.teamHome !== 'team-1' && m.teamAway !== 'team-1')
      .map(paarung)
      .sort();
    expect(bleibenSollen).toHaveLength(3);

    const res = await withdraw(tGroupsId, 'team-1');
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.withdrawn).toEqual({
      teamId: 'team-1',
      name: 'Team 1',
      deletedMatches: 3,
    });
    expect(body.stats.teamCount).toBe(15);
    expect(body.stats.matchCount).toBe(21); // 24 − 3
    expect(body.teams.some((t) => t.id === 'team-1')).toBe(false);

    // Bestand: Team weg, Membership per Cascade weg.
    expect(db.teams.some((t) => t.id === 'team-1')).toBe(false);
    expect(db.memberships.some((m) => m.teamId === 'team-1')).toBe(false);

    // Kein einziges Spiel mit dem Team ist übrig.
    expect(db.matches.some((m) => m.teamHome === 'team-1' || m.teamAway === 'team-1')).toBe(false);
    expect(db.matches).toHaveLength(21);

    // Gruppe A ist eine 3er-Gruppe geworden — die Paarungen der übrigen
    // drei Spiele sind IDENTISCH (keine Neu-Auslosung).
    const gruppeAnachher = db.matches.filter((m) => m.groupId === 'group-a');
    expect(gruppeAnachher).toHaveLength(3);
    expect(gruppeAnachher.map(paarung).sort()).toEqual(bleibenSollen);

    // Die anderen Gruppen sind unberührt.
    for (const key of ['b', 'c', 'd']) {
      expect(db.matches.filter((m) => m.groupId === `group-${key}`)).toHaveLength(6);
    }
  });

  it('Neu gepackt: alle verbleibenden Spiele bekommen Zeit + Platte, H1 hält', async () => {
    const res = await withdraw(tGroupsId, 'team-1');
    expect(res.statusCode).toBe(200);
    expect(res.json().rescheduledCount).toBe(21);

    // Jedes verbleibende Spiel hat eine Anstoßzeit und eine Platte.
    for (const m of db.matches) {
      expect(m.scheduledAt).toBeInstanceOf(Date);
      expect(typeof m.field).toBe('number');
    }

    // Die 24 Spiele lagen vorher alle auf derselben Zeit (Platzhalter im
    // Bestand) — nach dem Packen liegen sie auf mehreren Fenstern.
    const fenster = new Set(db.matches.map((m) => m.scheduledAt.getTime()));
    expect(fenster.size).toBeGreaterThan(1);

    // H1 (hart): kein Team spielt zweimal im selben Zeitfenster.
    const proFenster = new Map();
    for (const m of db.matches) {
      const key = m.scheduledAt.getTime();
      if (!proFenster.has(key)) proFenster.set(key, new Set());
      const belegt = proFenster.get(key);
      for (const t of [m.teamHome, m.teamAway]) {
        if (t == null) continue;
        expect(
          belegt.has(t),
          `Team ${t} spielt zweimal im Fenster ${new Date(key).toISOString()}`
        ).toBe(false);
        belegt.add(t);
      }
    }

    // Und die zweite Planer-Zusage: pro Fenster nie mehr Spiele als Platten.
    for (const [, belegt] of proFenster) {
      expect(belegt.size).toBeLessThanOrEqual(2 * CONFIG.schedule.parallelFields);
    }
  });

  it('Bezugspunkt bleibt der früheste bestehende Anstoß (kein Sprung auf „jetzt")', async () => {
    await withdraw(tGroupsId, 'team-1');
    const frueheste = Math.min(...db.matches.map((m) => m.scheduledAt.getTime()));
    const basis = new Date(BASISZEIT);
    basis.setHours(10, 0, 0, 0);
    expect(frueheste).toBe(basis.getTime());
  });

  it('Löschen und Neu-Packen laufen in EINER Transaktion', async () => {
    await withdraw(tGroupsId, 'team-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
