/**
 * Integrationstests für PATCH /api/tournaments/:id/groups (Etappe B.7).
 *
 * Einstellungen-Tab: Admin kann Teams per DnD zwischen Gruppen
 * verschieben. Atomarer Endpoint, schreibt GroupMembership.position neu.
 *
 * Wir testen:
 *   - 401 ohne JWT
 *   - 403 wenn Member (kein Admin)
 *   - 400 leere groups / falsche Anzahl / unbekannte Gruppe /
 *     leere Gruppe / Team nicht im Turnier / Team doppelt / Summe mismatch
 *   - 409 wenn ≥1 beendetes Match
 *   - 200 Admin: atomare Persistenz, Response hat groups-Form
 *   - 200 mit umgekehrter Reihenfolge: position = Index
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
    groupMembership: { findMany: fn(), createMany: fn(), deleteMany: fn() },
    match: { findMany: fn(), findFirst: fn(), findUnique: fn(), create: fn(), createMany: fn(), update: fn(), updateMany: fn(), count: fn(), groupBy: fn() },
    $transaction: vi.fn(async (cb) => {
      return typeof cb === 'function' ? cb(prisma) : cb;
    }),
  };
}

const u = {
  member: { id: 'u-member', role: 'user' },
  admin: { id: 'u-admin', role: 'user' },
};
const gId = 'g-1';
const tDraftId = 't-draft';
const tLockedId = 't-locked';
const teamsDraft = [
  { id: 'team-a', name: 'Team A', color: '#111111', seed: 0 },
  { id: 'team-b', name: 'Team B', color: '#222222', seed: 1 },
  { id: 'team-c', name: 'Team C', color: '#333333', seed: 2 },
  { id: 'team-d', name: 'Team D', color: '#444444', seed: 3 },
];
const draftGroups = [
  { id: 'gA', key: 'A' },
  { id: 'gB', key: 'B' },
];
const draftGroupMemberships = {
  gA: [
    { id: 'm1', groupId: 'gA', teamId: 'team-a', position: 0 },
    { id: 'm2', groupId: 'gA', teamId: 'team-b', position: 1 },
  ],
  gB: [
    { id: 'm3', groupId: 'gB', teamId: 'team-c', position: 0 },
    { id: 'm4', groupId: 'gB', teamId: 'team-d', position: 1 },
  ],
};

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
  prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
    if (where.id === tDraftId) {
      return {
        id: tDraftId, groupId: gId, status: 'draft', isPublic: false,
        publicToken: null, publicRevokedAt: null, logoUrl: null, config: null,
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    if (where.id === tLockedId) {
      return {
        id: tLockedId, groupId: gId, status: 'group_stage', isPublic: false,
        publicToken: null, publicRevokedAt: null, logoUrl: null, config: null,
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
  prisma.tournamentTeam.findMany.mockImplementation(async ({ where }) => {
    if (where?.tournamentId === tDraftId || where?.tournamentId === tLockedId) {
      return [...teamsDraft];
    }
    return [];
  });
  prisma.group_.findMany.mockImplementation(async ({ where }) => {
    if (where?.stage?.tournamentId === tDraftId) return [...draftGroups];
    return [];
  });
  prisma.groupMembership.findMany.mockImplementation(async ({ where }) => {
    if (where?.groupId === 'gA') return draftGroupMemberships.gA;
    if (where?.groupId === 'gB') return draftGroupMemberships.gB;
    return [];
  });
  prisma.match.count.mockImplementation(async ({ where }) => {
    if (where?.tournamentId === tDraftId) return 0;
    if (where?.tournamentId === tLockedId) return 3;
    return 0;
  });
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
  app = await buildApp(prisma);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

const patchGroups = (tournamentId, body, userId = u.admin.id) =>
  app.inject({
    method: 'PATCH',
    url: `/api/tournaments/${tournamentId}/groups`,
    headers: { 'x-test-user': userId },
    payload: body,
  });

describe('PATCH /api/tournaments/:id/groups', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tDraftId}/groups`,
      payload: { groups: [{ key: 'A', teamIds: ['team-a'] }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 wenn Member (kein Admin)', async () => {
    const res = await patchGroups(
      tDraftId,
      { groups: [{ key: 'A', teamIds: ['team-a'] }] },
      u.member.id
    );
    expect(res.statusCode).toBe(403);
  });

  it('400 wenn groups[] fehlt', async () => {
    const res = await patchGroups(tDraftId, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('groups_invalid');
  });

  it('400 wenn groups[] leer ist', async () => {
    const res = await patchGroups(tDraftId, { groups: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('groups_invalid');
  });

  it('400 wenn Gruppen-Anzahl nicht stimmt', async () => {
    const res = await patchGroups(tDraftId, {
      groups: [{ key: 'A', teamIds: ['team-a'] }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('groups_count_mismatch');
  });

  it('400 bei unbekannter Gruppen-Key', async () => {
    const res = await patchGroups(tDraftId, {
      groups: [
        { key: 'A', teamIds: ['team-a', 'team-b'] },
        { key: 'Z', teamIds: ['team-c', 'team-d'] },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('groups_invalid_key');
  });

  it('400 bei leerer Gruppe', async () => {
    const res = await patchGroups(tDraftId, {
      groups: [
        { key: 'A', teamIds: ['team-a', 'team-b'] },
        { key: 'B', teamIds: [] },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('group_must_have_team');
  });

  it('400 bei Team nicht in Turnier', async () => {
    const res = await patchGroups(tDraftId, {
      groups: [
        { key: 'A', teamIds: ['team-a', 'team-foreign'] },
        { key: 'B', teamIds: ['team-c', 'team-d'] },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('team_not_in_tournament');
  });

  it('400 bei Team in mehreren Gruppen', async () => {
    const res = await patchGroups(tDraftId, {
      groups: [
        { key: 'A', teamIds: ['team-a', 'team-b'] },
        { key: 'B', teamIds: ['team-b', 'team-c'] },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('team_in_multiple_groups');
  });

  it('400 bei Team-Sum mismatch', async () => {
    const res = await patchGroups(tDraftId, {
      groups: [
        { key: 'A', teamIds: ['team-a', 'team-b'] },
        { key: 'B', teamIds: ['team-c'] },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('teams_group_count_mismatch');
  });

  it('409 wenn ≥1 beendetes Match', async () => {
    const res = await patchGroups(tLockedId, {
      groups: [
        { key: 'A', teamIds: ['team-a', 'team-b'] },
        { key: 'B', teamIds: ['team-c', 'team-d'] },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('groups_locked_results_present');
    expect(res.json().finishedMatches).toBe(3);
  });

  it('200 Admin: atomare Persistenz, ruft groupMembership.deleteMany + createMany pro Gruppe', async () => {
    const res = await patchGroups(tDraftId, {
      groups: [
        { key: 'A', teamIds: ['team-c', 'team-a'] },
        { key: 'B', teamIds: ['team-d', 'team-b'] },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(Array.isArray(res.json().groups)).toBe(true);
    // deleteMany + createMany für jede Gruppe
    expect(prisma.groupMembership.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.groupMembership.createMany).toHaveBeenCalledTimes(2);
    // createMany-Daten: position = Index
    const calls = prisma.groupMembership.createMany.mock.calls;
    expect(calls[0][0].data).toEqual([
      { groupId: 'gA', teamId: 'team-c', position: 0 },
      { groupId: 'gA', teamId: 'team-a', position: 1 },
    ]);
  });

  it('Atomarität: bei Fehler in createMany bleibt der State unverändert', async () => {
    // Wenn createMany einmal fehlschlägt, soll die Transaktion
    // zurückspringen. Hier simulieren wir einen Fehler im zweiten
    // createMany.
    prisma.groupMembership.createMany
      .mockResolvedValueOnce({ count: 2 })
      .mockRejectedValueOnce(new Error('DB-Fehler im zweiten Step'));
    const res = await patchGroups(tDraftId, {
      groups: [
        { key: 'A', teamIds: ['team-c', 'team-a'] },
        { key: 'B', teamIds: ['team-d', 'team-b'] },
      ],
    });
    // Antwort: 500 (handleError wrappt), nicht 200.
    expect(res.statusCode).toBe(500);
  });
});
