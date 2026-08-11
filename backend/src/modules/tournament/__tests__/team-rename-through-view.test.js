/**
 * Integrationstest: Team-Rename → Anzeige überall (Spec §5).
 *
 * Spec §5: "Ein Team umbenennen berührt den Spielplan nicht — nur die
 * Anzeige." Konkret heißt das: nach einem PATCH /:id/teams/:teamId
 * mit einem neuen Namen muss jedes DTO den neuen Namen zeigen:
 *
 *   - tournamentView.teams[i].name
 *   - tournamentView.matches[i].teamHome.name
 *   - tournamentView.matches[i].teamAway.name
 *   - tournamentView.groups[i].standings[*].team.name
 *
 * Der Test fährt eine Fastify-App mit einem In-Memory-Prisma, das
 * findUnique/findMany/update tatsächlich State mutiert. Damit ist
 * Round-Trip = "PATCH → GET Detail → Vergleich" produktionsnah.
 *
 * Was NICHT hier getestet wird:
 *   - Auth auf PATCH (das ist team-patch-route.test.js)
 *   - Echte Prisma-Operationen (das ist routes.integration.test.js)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';

// ------------------------------------------------------------------
// Mini-In-Memory-Prisma
// ------------------------------------------------------------------
function createInMemoryPrisma() {
  const tables = {
    user: [],
    group: [],
    groupMember: [],
    groupDeputy: [],
    tournament: [],
    tournamentTeam: [],
    stage: [],
    group_: [],
    groupMembership: [],
    match: [],
  };

  const nextId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

  function rowOf(value) {
    return { ...value };
  }

  const handlers = {
    user: {
      findUnique: async ({ where }) =>
        tables.user.find((r) => r.id === where.id) || null,
    },
    group: {
      findUnique: async ({ where }) =>
        tables.group.find((r) => r.id === where.id) || null,
    },
    groupMember: {
      findUnique: async ({ where }) => {
        const { userId, groupId } = where.userId_groupId ?? {};
        return (
          tables.groupMember.find(
            (r) => r.userId === userId && r.groupId === groupId
          ) || null
        );
      },
    },
    groupDeputy: {
      findUnique: async ({ where }) => null,
    },
    tournament: {
      findUnique: async ({ where }) =>
        tables.tournament.find((r) => r.id === where.id) || null,
      findMany: async ({ where } = {}) => {
        let rows = tables.tournament;
        if (where?.groupId) rows = rows.filter((r) => r.groupId === where.groupId);
        if (where?.status?.not) rows = rows.filter((r) => r.status !== where.status.not);
        return rows;
      },
    },
    tournamentTeam: {
      findFirst: async ({ where }) => {
        return (
          tables.tournamentTeam.find((r) => {
            if (where.id && r.id !== where.id) return false;
            if (where.tournamentId && r.tournamentId !== where.tournamentId)
              return false;
            if (where.name?.equals !== undefined) {
              const wanted = where.name.equals.toLowerCase();
              if (r.name.toLowerCase() !== wanted) return false;
            }
            // Prisma: where: { id: { not: 'team-a' } } — wir unterstützen
            // beide Formen (Skalar oder Objekt).
            const idNot = where.id?.not ?? where.id_not;
            if (idNot && r.id === idNot) return false;
            return true;
          }) || null
        );
      },
      findMany: async ({ where } = {}) => {
        let rows = tables.tournamentTeam;
        if (where?.tournamentId) {
          rows = rows.filter((r) => r.tournamentId === where.tournamentId);
        }
        return rows;
      },
      update: async ({ where, data }) => {
        const idx = tables.tournamentTeam.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error('tournamentTeam not found');
        tables.tournamentTeam[idx] = {
          ...tables.tournamentTeam[idx],
          ...data,
        };
        return rowOf(tables.tournamentTeam[idx]);
      },
    },
    stage: {
      findMany: async ({ where } = {}) => {
        let rows = tables.stage;
        if (where?.tournamentId) {
          rows = rows.filter((r) => r.tournamentId === where.tournamentId);
        }
        return rows;
      },
    },
    group_: {
      findMany: async ({ where } = {}) => {
        let rows = tables.group_;
        if (where?.stage?.tournamentId) {
          const tId = where.stage.tournamentId;
          rows = rows.filter((r) => {
            const stage = tables.stage.find((s) => s.id === r.stageId);
            return stage?.tournamentId === tId;
          });
        }
        // Materialize memberships + matches
        return rows.map((g) => ({
          ...rowOf(g),
          memberships: tables.groupMembership
            .filter((m) => m.groupId === g.id)
            .map((m) => ({
              ...rowOf(m),
              team: tables.tournamentTeam.find((t) => t.id === m.teamId),
            }))
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
          matches: tables.match.filter((m) => m.groupId === g.id),
        }));
      },
    },
    match: {
      findMany: async ({ where } = {}) => {
        let rows = tables.match;
        if (where?.tournamentId) {
          rows = rows.filter((r) => r.tournamentId === where.tournamentId);
        }
        return rows;
      },
      update: async ({ where, data }) => {
        const idx = tables.match.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error('match not found');
        tables.match[idx] = { ...tables.match[idx], ...data };
        return rowOf(tables.match[idx]);
      },
      count: async ({ where } = {}) => {
        let rows = tables.match;
        if (where?.tournamentId) {
          rows = rows.filter((r) => r.tournamentId === where.tournamentId);
        }
        if (where?.status) {
          rows = rows.filter((r) => r.status === where.status);
        }
        return rows.length;
      },
    },
  };

  const prisma = {
    user: handlers.user,
    group: handlers.group,
    groupMember: handlers.groupMember,
    groupDeputy: handlers.groupDeputy,
    tournament: handlers.tournament,
    tournamentTeam: handlers.tournamentTeam,
    stage: handlers.stage,
    group_: handlers.group_,
    match: handlers.match,
    groupMembership: tables.groupMembership,
  };

  // Helpers zum Seeden.
  prisma.__tables = tables;
  prisma.__seed = (table, row) => {
    const id = row.id ?? nextId(table);
    tables[table].push({ id, ...row });
    return id;
  };
  return prisma;
}

// ------------------------------------------------------------------
// Test-Setup
// ------------------------------------------------------------------
const u = {
  admin: { id: 'u-admin', role: 'user' },
  global: { id: 'u-global', role: 'admin' },
};
const gId = 'g-1';
const tId = 't-1';

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
  prisma = createInMemoryPrisma();

  prisma.__seed('user', u.admin);
  prisma.__seed('user', u.global);
  prisma.__seed('group', { id: gId, createdBy: u.admin.id, name: 'Testgruppe' });
  prisma.__seed('groupMember', { userId: u.admin.id, groupId: gId });
  prisma.__seed('groupMember', { userId: u.global.id, groupId: gId });
  prisma.__seed('tournament', {
    id: tId,
    groupId: gId,
    name: 'Sommer-Cup',
    status: 'group_stage',
    mode: 'groups_ko',
    isPublic: false,
    publicToken: null,
    publicRevokedAt: null,
    logoUrl: null,
    createdById: u.admin.id,
  });

  // Drei Teams, alle in Gruppe A.
  const teamA = prisma.__seed('tournamentTeam', {
    id: 'team-a',
    tournamentId: tId,
    name: 'Team 1',
    color: '#888888',
    seed: 1,
  });
  const teamB = prisma.__seed('tournamentTeam', {
    id: 'team-b',
    tournamentId: tId,
    name: 'Team 2',
    color: '#444444',
    seed: 2,
  });
  prisma.__seed('tournamentTeam', {
    id: 'team-c',
    tournamentId: tId,
    name: 'Team 3',
    color: '#222222',
    seed: 3,
  });

  const stageId = prisma.__seed('stage', {
    id: 'stage-1',
    tournamentId: tId,
    type: 'group',
    name: 'Gruppenphase',
    orderIndex: 0,
  });

  const groupId = prisma.__seed('group_', {
    id: 'group-a',
    stageId,
    tournamentId: tId,
    key: 'A',
    name: 'Gruppe A',
    orderIndex: 0,
  });

  prisma.__seed('groupMembership', {
    id: 'mem-a',
    groupId,
    teamId: teamA,
    position: 1,
  });
  prisma.__seed('groupMembership', {
    id: 'mem-b',
    groupId,
    teamId: teamB,
    position: 2,
  });
  prisma.__seed('groupMembership', {
    id: 'mem-c',
    groupId,
    teamId: 'team-c',
    position: 3,
  });

  // Match: Team A vs Team B.
  prisma.__seed('match', {
    id: 'm-1',
    tournamentId: tId,
    stageId,
    groupId,
    matchNumber: 1,
    // Schema-konforme FK-Spalten heißen teamHome/teamAway (nicht
    // teamHomeId/teamAwayId) — der DTO-Builder liest diese Felder
    // direkt, um die Map<id, team> aufzulösen.
    teamHome: teamA,
    teamAway: teamB,
    status: 'scheduled',
    scoreHome: null,
    scoreAway: null,
  });

  app = await buildApp(prisma);
});

afterEach(async () => {
  await app.close();
});

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('Team umbenennen: Anzeige überall', () => {
  it('GET /:id zeigt vor dem Rename die Platzhalter-Namen', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const teamNames = body.teams.map((t) => t.name).sort();
    expect(teamNames).toEqual(['Team 1', 'Team 2', 'Team 3']);

    // Match-DTO zeigt Team-1/Team-2 (Roh resolvte Namen).
    const match = body.matches[0];
    expect(match.home.name).toBe('Team 1');
    expect(match.away.name).toBe('Team 2');
  });

  it('PATCH benennt zwei Teams um; anschließend zeigt GET überall die neuen Namen', async () => {
    const patch1 = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/team-a`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Rakija Boys' },
    });
    expect(patch1.statusCode).toBe(200);
    expect(JSON.parse(patch1.body).name).toBe('Rakija Boys');

    const patch2 = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/team-b`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Bierversorium', color: '#4F7A4A' },
    });
    expect(patch2.statusCode).toBe(200);
    expect(JSON.parse(patch2.body).name).toBe('Bierversorium');
    expect(JSON.parse(patch2.body).color).toBe('#4F7A4A');

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // teams[] zeigt die neuen Namen.
    const teamNames = body.teams.map((t) => t.name).sort();
    expect(teamNames).toEqual(['Bierversorium', 'Rakija Boys', 'Team 3']);

    // match.home.name / match.away.name zeigen umbenannte Teams.
    const match = body.matches[0];
    expect(match.home.name).toBe('Rakija Boys');
    expect(match.away.name).toBe('Bierversorium');

    // groups[].members[].name zeigt umbenannte Teams (DTO heißt
    // "members" — siehe access/group.js, NICHT "memberships").
    const groupA = body.groups.find((g) => g.key === 'A');
    expect(groupA).toBeDefined();
    const memberNames = groupA.members.map((m) => m.name).sort();
    expect(memberNames).toEqual(['Bierversorium', 'Rakija Boys', 'Team 3']);
  });

  it('Standings-Endpoint zeigt ebenfalls den neuen Namen', async () => {
    // Erst ein Ergebnis eintragen, damit das Standings Sinn ergibt.
    await prisma.match.update({
      where: { id: 'm-1' },
      data: { status: 'finished', scoreHome: 12, scoreAway: 7 },
    });

    await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/team-a`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Die Champions' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}/standings`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // /standings liefert { groups: [{ groupKey, groupName, standings: [{ name, ... }] }] }
    const groupA = body.groups?.find((g) => g.groupKey === 'A');
    expect(groupA).toBeDefined();
    const rows = groupA.standings ?? [];
    const teamNames = rows.map((r) => r.name).filter(Boolean);
    expect(teamNames).toContain('Die Champions');
  });

  it('Schedule-Endpoint zeigt den neuen Namen', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/team-a`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Kubb Küken' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}/schedule`,
      headers: { 'x-test-user': u.admin.id },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const match = body.matches[0];
    expect(match.home.name).toBe('Kubb Küken');
  });

  it('403 wenn Member umbenennen will (über den vollständigen Auth-Pfad)', async () => {
    // Seeden eines normalen Members.
    prisma.__seed('user', { id: 'u-member', role: 'user' });
    prisma.__seed('groupMember', { userId: 'u-member', groupId: gId });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/team-a`,
      headers: { 'x-test-user': 'u-member' },
      payload: { name: 'Geklaute Namen' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Rename ändert nichts am Spielplan (matchNumber, status, score bleiben)', async () => {
    // Ein bestehendes Ergebnis eintragen.
    await prisma.match.update({
      where: { id: 'm-1' },
      data: { status: 'finished', scoreHome: 12, scoreAway: 7 },
    });

    const before = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}`,
      headers: { 'x-test-user': u.admin.id },
    });
    const beforeMatch = JSON.parse(before.body).matches[0];

    await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/team-a`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Neuer Name' },
    });

    const after = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}`,
      headers: { 'x-test-user': u.admin.id },
    });
    const afterMatch = JSON.parse(after.body).matches[0];

    expect(afterMatch.matchNumber).toBe(beforeMatch.matchNumber);
    expect(afterMatch.status).toBe(beforeMatch.status);
    expect(afterMatch.scoreHome).toBe(beforeMatch.scoreHome);
    expect(afterMatch.scoreAway).toBe(beforeMatch.scoreAway);
    // home.teamId bleibt dieselbe — die Bracket-Verkabelung sieht die ID.
    expect(afterMatch.home.teamId).toBe(beforeMatch.home.teamId);
    // name hat sich aber geändert.
    expect(afterMatch.home.name).not.toBe(beforeMatch.home.name);
  });
});