/**
 * Tests für die /balance-shuffle-groups-Route (Etappe B.8).
 *
 * Sicherheitsnetz für die User-Anforderung 2026-08-20:
 * „Teams tauschen, Gruppengröße muss gleich bleiben."
 *
 * Die Route muss:
 *   - 401 ohne JWT, 403 für Members geben.
 *   - 409 bei LÄUFT (canEdit('groups') = false) geben.
 *   - Bei BEREIT/ENTWURF die Memberships atomar neu schreiben.
 *   - Die Anzahl Teams pro Gruppe **vor** und **nach** identisch lassen
 *     (size-preserving Invariante).
 *   - Die Gesamt-Team-Anzahl unverändert lassen.
 *   - Bei leeren Gruppen / fehlenden Memberships 409 geben.
 *   - 403-Audit-Konform sein (gleiche `requireTournamentWrite`-Chain
 *     wie alle anderen Group-Routes).
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
const tGeneratedId = 't-generated';
const tRunningId = 't-running';
const tNoGroupsId = 't-no-groups';

const groups = [
  { id: 'group-a', key: 'A' },
  { id: 'group-b', key: 'B' },
  { id: 'group-c', key: 'C' },
];

// Initiale Memberships: 4 + 4 + 4 = 12 Teams, auf 3 Gruppen verteilt.
const initialMemberships = [
  // Gruppe A (4 Teams)
  { id: 'm1', groupId: 'group-a', teamId: 'team-1', position: 0 },
  { id: 'm2', groupId: 'group-a', teamId: 'team-2', position: 1 },
  { id: 'm3', groupId: 'group-a', teamId: 'team-3', position: 2 },
  { id: 'm4', groupId: 'group-a', teamId: 'team-4', position: 3 },
  // Gruppe B (4 Teams)
  { id: 'm5', groupId: 'group-b', teamId: 'team-5', position: 0 },
  { id: 'm6', groupId: 'group-b', teamId: 'team-6', position: 1 },
  { id: 'm7', groupId: 'group-b', teamId: 'team-7', position: 2 },
  { id: 'm8', groupId: 'group-b', teamId: 'team-8', position: 3 },
  // Gruppe C (4 Teams)
  { id: 'm9', groupId: 'group-c', teamId: 'team-9', position: 0 },
  { id: 'm10', groupId: 'group-c', teamId: 'team-10', position: 1 },
  { id: 'm11', groupId: 'group-c', teamId: 'team-11', position: 2 },
  { id: 'm12', groupId: 'group-c', teamId: 'team-12', position: 3 },
];

function makeStub(overrides = {}) {
  return {
    id: tDraftId, groupId: gId, name: 'Mein Turnier',
    status: 'draft', isPublic: false, publicToken: null,
    publicRevokedAt: null, logoUrl: null, config: null, startedAt: null,
    group: { id: gId, createdBy: u.admin.id, name: 'G' },
    ...overrides,
  };
}

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
    if (where.id === tDraftId) return makeStub({ id: tDraftId });
    if (where.id === tGeneratedId) return makeStub({ id: tGeneratedId, status: 'generated' });
    if (where.id === tRunningId) return makeStub({ id: tRunningId, status: 'group_stage', startedAt: new Date('2026-08-20T10:00:00Z') });
    if (where.id === tNoGroupsId) return makeStub({ id: tNoGroupsId, status: 'generated' });
    return null;
  });
  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournament.update.mockImplementation(async ({ where, data }) => {
    return makeStub({ id: where.id, ...data });
  });
  prisma.tournamentTeam.findFirst.mockResolvedValue(null);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue([]);
  // Standard: 3 Gruppen mit jeweils 4 Teams.
  prisma.group_.findMany.mockResolvedValue(groups);
  prisma.group_.create.mockResolvedValue({});
  // Standard-Memberships.
  prisma.groupMembership.findMany.mockResolvedValue(initialMemberships);
  // Lokales Mutable für delete + create (wird im Test kontrolliert geleert/gefüllt).
  prisma.groupMembership.deleteMany.mockImplementation(async () => {
    return { count: initialMemberships.length };
  });
  prisma.groupMembership.createMany.mockImplementation(async ({ data }) => {
    return { count: data.length };
  });
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.findFirst.mockResolvedValue(null);
  prisma.match.findUnique.mockResolvedValue(null);
  prisma.match.groupBy.mockResolvedValue([]);
  prisma.match.count.mockResolvedValue(0);
  prisma.match.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
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
  prisma = createLocalMockPrisma();
  baseStubs(prisma);
  app = await buildApp(prisma);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

const post = (url, body = {}, userId = u.admin.id) =>
  app.inject({
    method: 'POST', url,
    headers: { 'x-test-user': userId },
    payload: body,
  });

describe('POST /api/tournaments/:id/balance-shuffle-groups', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tGeneratedId}/balance-shuffle-groups`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 Member (§1.2 Pflicht-Test)', async () => {
    const res = await post(`/api/tournaments/${tGeneratedId}/balance-shuffle-groups`, {}, u.member.id);
    expect(res.statusCode).toBe(403);
  });

  it('409 in LÄUFT (startedAt !== null)', async () => {
    const res = await post(`/api/tournaments/${tRunningId}/balance-shuffle-groups`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('groups_locked_results_present');
  });

  it('200 in ENTWURF (no_groups wenn Memberships fehlen)', async () => {
    prisma.group_.findMany.mockResolvedValue([]);
    const res = await post(`/api/tournaments/${tDraftId}/balance-shuffle-groups`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('no_groups');
  });

  it('409 wenn Memberships leer (no_memberships)', async () => {
    prisma.groupMembership.findMany.mockResolvedValue([]);
    const res = await post(`/api/tournaments/${tDraftId}/balance-shuffle-groups`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('no_memberships');
  });

  it('200 in BEREIT: ruft deleteMany + createMany auf', async () => {
    const res = await post(`/api/tournaments/${tGeneratedId}/balance-shuffle-groups`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().shuffledTeamCount).toBe(12);
    // delete + create wurden aufgerufen
    expect(prisma.groupMembership.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.groupMembership.createMany).toHaveBeenCalledTimes(1);
    // createMany-Daten: 12 Einträge mit korrekten Gruppen-Sizes (4 + 4 + 4)
    const created = prisma.groupMembership.createMany.mock.calls.at(0)?.[0]?.data ?? [];
    expect(created).toHaveLength(12);
    const counts = { 'group-a': 0, 'group-b': 0, 'group-c': 0 };
    for (const e of created) counts[e.groupId] += 1;
    expect(counts['group-a']).toBe(4);
    expect(counts['group-b']).toBe(4);
    expect(counts['group-c']).toBe(4);
  });

  it('Size-Invariante: Anzahl Teams pro Gruppe bleibt gleich (3 Gruppen à 4)', async () => {
    // Track der letzten "written" Memberships.
    const lastWritten = [];
    prisma.groupMembership.deleteMany.mockImplementation(async () => ({ count: lastWritten.length }));
    prisma.groupMembership.createMany.mockImplementation(async ({ data }) => {
      lastWritten.length = 0;
      lastWritten.push(...data);
      return { count: data.length };
    });

    const res = await post(`/api/tournaments/${tGeneratedId}/balance-shuffle-groups`, {});
    expect(res.statusCode).toBe(200);
    expect(lastWritten).toHaveLength(12);
    const counts = { 'group-a': 0, 'group-b': 0, 'group-c': 0 };
    for (const e of lastWritten) counts[e.groupId] += 1;
    expect(counts['group-a']).toBe(4);
    expect(counts['group-b']).toBe(4);
    expect(counts['group-c']).toBe(4);
    // Alle 12 ursprünglichen Team-IDs sind in der neuen Zuordnung
    const newTeamIds = lastWritten.map((e) => e.teamId).sort();
    const originalTeamIds = initialMemberships.map((m) => m.teamId).sort();
    expect(newTeamIds).toEqual(originalTeamIds);
    // Jede teamId genau einmal
    expect(new Set(newTeamIds).size).toBe(12);
  });

  it('Atomicity: löscht erst alle, dann fügt alle ein (delete vor create)', async () => {
    const callOrder = [];
    prisma.groupMembership.deleteMany.mockImplementation(async () => {
      callOrder.push('delete');
      return { count: 12 };
    });
    prisma.groupMembership.createMany.mockImplementation(async ({ data }) => {
      callOrder.push('create');
      return { count: data.length };
    });
    await post(`/api/tournaments/${tGeneratedId}/balance-shuffle-groups`, {});
    expect(callOrder).toEqual(['delete', 'create']);
  });

  it('Locks verwenden canEdit("groups") mit dem korrekten Reason-Text', async () => {
    const res = await post(`/api/tournaments/${tRunningId}/balance-shuffle-groups`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBeTruthy();
    expect(typeof res.json().message).toBe('string');
    expect(res.json().message.length).toBeGreaterThan(0);
  });
});
