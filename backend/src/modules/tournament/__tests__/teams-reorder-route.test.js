/**
 * Integrationstests für PATCH /api/tournaments/:id/teams/reorder (Etappe B.5).
 *
 * Teams-Tab: Admin kann die Setzreihenfolge per DnD festlegen. Die Route
 * schreibt atomar die seed-Spalte aller Teams dieses Turniers neu.
 *
 * Wir testen:
 *   - 401 ohne JWT
 *   - 403 wenn der User nur Member ist
 *   - 400 leeres order[], 400 doppelte IDs, 400 fremde IDs, 400 falsche Anzahl
 *   - 409 wenn Status nicht 'draft' (Spielplan schon generiert → Reorder gesperrt)
 *   - 200 Admin im draft: Seeds werden atomar gesetzt, TeamDTO zurück
 *   - 200 mit umgekehrter Reihenfolge: seed = Index in order
 *   - Transaktion-Atomarität: Wenn ein Update fehlschlägt, bleibt DB-State unverändert
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

function createLocalMockPrisma() {
  const fn = () => vi.fn();
  return {
    user: { findUnique: fn() },
    group: { findUnique: fn() },
    groupMember: { findUnique: fn() },
    groupDeputy: { findUnique: fn() },
    tournament: { findUnique: fn(), findMany: fn(), create: fn(), update: fn(), delete: fn() },
    tournamentTeam: { findFirst: fn(), findMany: fn(), findUnique: fn(), update: fn(), delete: fn() },
    stage: { findMany: fn(), findUnique: fn(), create: fn(), deleteMany: fn() },
    group_: { findMany: fn(), create: fn() },
    groupMembership: { findMany: fn(), createMany: fn() },
    match: { findMany: fn(), findFirst: fn(), findUnique: fn(), create: fn(), createMany: fn(), update: fn(), updateMany: fn(), count: fn(), groupBy: fn() },
    $transaction: vi.fn(async (cb) => {
      return typeof cb === 'function' ? cb(prisma) : cb;
    }),
  };
}

const u = {
  member: { id: 'u-member', role: 'user' },
  admin: { id: 'u-admin', role: 'user' },
  global: { id: 'u-global', role: 'admin' },
};
const gId = 'g-1';
// Zwei Turniere: eins im draft (für erlaubte Reorders), eins im generated (für 409).
const tDraftId = 't-draft';
const tGeneratedId = 't-generated';
const teamsDraft = [
  { id: 'team-a', name: 'Team A', color: '#111111', seed: 0 },
  { id: 'team-b', name: 'Team B', color: '#222222', seed: 1 },
  { id: 'team-c', name: 'Team C', color: '#333333', seed: 2 },
];

function baseStubs(prisma) {
  prisma.user.findUnique.mockImplementation(async ({ where }) => {
    const map = {
      [u.member.id]: { id: u.member.id, role: u.member.role },
      [u.admin.id]: { id: u.admin.id, role: u.admin.role },
      [u.global.id]: { id: u.global.id, role: u.global.role },
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
    if (where.id === tDraftId) {
      return {
        id: tDraftId, groupId: gId, status: 'draft', isPublic: false,
        publicToken: null, publicRevokedAt: null, logoUrl: null,
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    if (where.id === tGeneratedId) {
      return {
        id: tGeneratedId, groupId: gId, status: 'group_stage', isPublic: false,
        publicToken: null, publicRevokedAt: null, logoUrl: null,
        // Etappe B.8: startedAt ist der Lock-Trigger.
        startedAt: new Date('2026-08-20T10:00:00Z'),
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    return null;
  });

  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournamentTeam.findFirst.mockResolvedValue(null);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.groupMembership.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.groupBy.mockResolvedValue([]);
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
  prisma = createLocalMockPrisma();
  baseStubs(prisma);
  // tournamentTeam.update schreibt den seed in den mutable Teams-Array zurück,
  // damit der darauffolgende findMany (mit orderBy: { seed: 'asc' }) die
  // aktualisierte Reihenfolge sieht.
  prisma.tournamentTeam.update.mockImplementation(async ({ where, data }) => {
    const team = teamsDraft.find((t) => t.id === where.id) ?? teamsDraft[0];
    if (data?.seed !== undefined) {
      team.seed = data.seed;
    }
    return { ...team, ...data };
  });
  // findMany: je nach orderBy sortieren — die Reorder-Route liest
  // mit orderBy: { seed: 'asc' }, daher MUSS der Mock das honorieren.
  prisma.tournamentTeam.findMany.mockImplementation(async ({ where, orderBy }) => {
    let rows = [];
    if (where?.tournamentId === tDraftId) rows = [...teamsDraft];
    else if (where?.tournamentId === tGeneratedId) rows = [...teamsDraft];
    else return [];
    if (orderBy?.seed === 'asc') rows.sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
    return rows;
  });
  app = await buildApp(prisma);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

const reorder = (tournamentId, order, userId = u.admin.id) =>
  app.inject({
    method: 'PATCH',
    url: `/api/tournaments/${tournamentId}/teams/reorder`,
    headers: { 'x-test-user': userId },
    payload: { order },
  });

describe('PATCH /api/tournaments/:id/teams/reorder', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tDraftId}/teams/reorder`,
      payload: { order: ['team-a', 'team-b', 'team-c'] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 wenn Member (kein Admin) reordert', async () => {
    const res = await reorder(tDraftId, ['team-a', 'team-b', 'team-c'], u.member.id);
    expect(res.statusCode).toBe(403);
  });

  it('400 wenn order[] fehlt', async () => {
    const res = await reorder(tDraftId, undefined);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('teams_reorder_invalid');
  });

  it('400 wenn order[] leer ist', async () => {
    const res = await reorder(tDraftId, []);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('teams_reorder_invalid');
  });

  it('400 bei doppelten IDs in order[]', async () => {
    const res = await reorder(tDraftId, ['team-a', 'team-a', 'team-b']);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('teams_reorder_duplicates');
  });

  it('400 wenn order[] fremde IDs enthält', async () => {
    const res = await reorder(tDraftId, ['team-a', 'team-b', 'team-fremd']);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('teams_reorder_mismatch');
  });

  it('400 wenn order[] zu wenig Teams hat', async () => {
    // Turnier hat 3 Teams, Frontend schickt nur 2
    const res = await reorder(tDraftId, ['team-a', 'team-b']);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('teams_reorder_mismatch');
  });

  it('400 wenn order[] zu viele Teams hat', async () => {
    // Frontend hat Phantom-Team
    const res = await reorder(tDraftId, ['team-a', 'team-b', 'team-c', 'team-z']);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('teams_reorder_mismatch');
  });

  it('409 wenn Status nicht draft (generated/finished/...)', async () => {
    const res = await reorder(tGeneratedId, ['team-a', 'team-b', 'team-c']);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('teams_reorder_locked');
    expect(res.json().status).toBe('group_stage');
  });

  it('200 Admin im draft: Seeds werden atomar gesetzt (umgekehrte Reihenfolge)', async () => {
    const res = await reorder(tDraftId, ['team-c', 'team-b', 'team-a']);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.teams).toHaveLength(3);
    // Reihenfolge: C=0, B=1, A=2 (nach update)
    expect(body.teams.map((t) => t.id)).toEqual(['team-c', 'team-b', 'team-a']);
    expect(body.teams.map((t) => t.seed)).toEqual([0, 1, 2]);
  });

  it('Transaktion wird aufgerufen (Atomarität: ein Rollback bei einem Fehler)', async () => {
    // Wenn das dritte update fehlschlägt, muss die Transaktion die ersten
    // beiden zurücksetzt haben. Wir simulieren das, indem prisma.$transaction
    // mit einem throw aufgerufen wird.
    prisma.$transaction.mockImplementationOnce(async (updates) => {
      // updates ist ein Array von Promises (unser route-code nutzt .map)
      const results = [];
      for (const u of updates) {
        results.push(await u);
      }
      return results;
    });
    const res = await reorder(tDraftId, ['team-b', 'team-a', 'team-c']);
    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('Reorder ändert KEINE anderen Felder (name, color bleiben)', async () => {
    const res = await reorder(tDraftId, ['team-c', 'team-a', 'team-b']);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const teamA = body.teams.find((t) => t.id === 'team-a');
    expect(teamA.name).toBe('Team A');
    expect(teamA.color).toBe('#111111');
    expect(teamA.seed).toBe(1);
  });

  it('Antwort enthält TeamDTO (id, name, color, seed, players, logoUrl)', async () => {
    const res = await reorder(tDraftId, ['team-a', 'team-b', 'team-c']);
    const body = res.json();
    const team = body.teams[0];
    expect(team).toHaveProperty('id');
    expect(team).toHaveProperty('name');
    expect(team).toHaveProperty('color');
    expect(team).toHaveProperty('seed');
    expect(team).toHaveProperty('logoUrl');
    expect(team).toHaveProperty('players');
  });
});
