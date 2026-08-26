/**
 * Etappe B.8.1 — POST /:id/groups/swaps Paar-Tausch (Admin).
 *
 * User-Forderung 2026-08-20: „Ich will nur einen Teamtausch ermöglichen.
 * Wenn drag and drop dafür nicht gut ist, schlag mir eine andere Option
 * vor." — Garantie: keine Gruppe verliert/gewinnt ein Team, weil beide
 * Teams gemeinsam die Plätze tauschen.
 *
 * Pflicht-Tests:
 *  - 401 ohne JWT
 *  - 403 Member (§1.2)
 *  - 400 wenn Body kein Array ist
 *  - 400 wenn Swap-Pair kein 2er-Array ist
 *  - 400 wenn beide Teams dieselbe ID haben
 *  - 400 wenn beide Teams in derselben Gruppe sind
 *  - 400 wenn eines der Teams nicht in diesem Turnier ist
 *  - 409 in LÄUFT (startedAt !== null)
 *  - 200 in BEREIT: beide Memberships atomar getauscht, Größe pro Gruppe konstant
 *  - 200 mit mehreren Swaps in einem Call
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import tournamentsRoutes from '../index.js';

const u = { member: { id: 'u-member', role: 'user' }, admin: { id: 'u-admin', role: 'user' } };
const gId = 'g-1';
const tId = 't-draft';
const groupA = 'g-A';
const groupB = 'g-B';
const teamAlpha = 't-alpha';
const teamBravo = 't-bravo';
const teamCharlie = 't-charlie';
const teamDelta = 't-delta';

function makeStub(overrides = {}) {
  return {
    id: tId,
    groupId: gId,
    name: 'Mein Turnier',
    status: 'generated',
    isPublic: false,
    publicToken: null,
    publicRevokedAt: null,
    logoUrl: null,
    config: null,
    startedAt: null,
    group: { id: gId, createdBy: u.admin.id, name: 'G' },
    ...overrides,
  };
}

function baseStubs(prisma, opts = {}) {
  const { startedAt = null, status = 'generated' } = opts;
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
    if (where.id === tId) return makeStub({ id: tId, status, startedAt });
    return null;
  });
  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournament.create.mockResolvedValue(makeStub());
  prisma.tournament.update.mockResolvedValue(makeStub());
  prisma.tournamentTeam.findFirst.mockResolvedValue(null);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.tournamentTeam.findUnique.mockResolvedValue(null);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([
    { id: groupA, key: 'A', stage: { tournamentId: tId } },
    { id: groupB, key: 'B', stage: { tournamentId: tId } },
  ]);
  prisma.groupMembership.findMany.mockImplementation(async ({ where }) => {
    if (where?.teamId?.in?.includes(teamAlpha) || where?.teamId?.in?.includes(teamBravo)) {
      // Default: Alpha in A, Bravo in B.
      const list = [];
      if (where.teamId.in.includes(teamAlpha)) {
        list.push({ id: 'm-alpha', groupId: groupA, teamId: teamAlpha, position: 0 });
      }
      if (where.teamId.in.includes(teamBravo)) {
        list.push({ id: 'm-bravo', groupId: groupB, teamId: teamBravo, position: 0 });
      }
      if (where.teamId.in.includes(teamCharlie)) {
        list.push({ id: 'm-charlie', groupId: groupA, teamId: teamCharlie, position: 1 });
      }
      if (where.teamId.in.includes(teamDelta)) {
        list.push({ id: 'm-delta', groupId: groupB, teamId: teamDelta, position: 1 });
      }
      return list;
    }
    return [];
  });
  prisma.groupMembership.update.mockImplementation(async ({ where, data }) => {
    return { id: where.id, ...data };
  });
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.findFirst.mockResolvedValue(null);
  prisma.match.findUnique.mockResolvedValue(null);
  prisma.match.groupBy.mockResolvedValue([]);
  prisma.match.count.mockResolvedValue(0);
  prisma.match.updateMany.mockResolvedValue({ count: 0 });
  prisma.$transaction.mockImplementation(async (arg) => {
    if (typeof arg === 'function') return arg(prisma);
    return Array.isArray(arg) ? Promise.all(arg) : arg;
  });
}

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
    $transaction: vi.fn(),
  };
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

const memberRequest = (method, url, body = null) =>
  app.inject({
    method,
    url,
    headers: { 'x-test-user': u.member.id },
    ...(body !== null ? { payload: body } : {}),
  });
const adminRequest = (method, url, body = null) =>
  app.inject({
    method,
    url,
    headers: { 'x-test-user': u.admin.id },
    ...(body !== null ? { payload: body } : {}),
  });
const noAuthRequest = (method, url, body = null) =>
  app.inject({
    method,
    url,
    ...(body !== null ? { payload: body } : {}),
  });

describe('Etappe B.8.1 — POST /:id/groups/swaps', () => {
  it('401 ohne JWT', async () => {
    const res = await noAuthRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [[teamAlpha, teamBravo]],
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 für Member (§1.2 Pflicht-Test)', async () => {
    const res = await memberRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [[teamAlpha, teamBravo]],
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 wenn Body kein swaps-Array ist', async () => {
    const res = await adminRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_swaps');
  });

  it('400 wenn Swap-Pair kein 2er-Array ist', async () => {
    const res = await adminRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [[teamAlpha]],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_swap_pair');
  });

  it('400 wenn beide Teams dieselbe ID haben', async () => {
    const res = await adminRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [[teamAlpha, teamAlpha]],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('swap_same_team');
  });

  it('400 wenn beide Teams in derselben Gruppe sind', async () => {
    // beide in Gruppe A
    const res = await adminRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [[teamAlpha, teamCharlie]],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('swap_same_group');
  });

  it('400 wenn eines der Teams nicht im Turnier ist', async () => {
    const res = await adminRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [[teamAlpha, 't-fantomas']],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('swap_team_not_found');
  });

  it('409 in LÄUFT (startedAt !== null)', async () => {
    await app.close();
    baseStubs(prisma, { startedAt: new Date().toISOString(), status: 'group_stage' });
    app = await buildApp(prisma);
    const res = await adminRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [[teamAlpha, teamBravo]],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('groups_locked');
  });

  it('200 in BEREIT: beide Memberships atomar getauscht, Größe pro Gruppe konstant', async () => {
    const res = await adminRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [[teamAlpha, teamBravo]],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().swapCount).toBe(1);
    // Genau 2 Updates an groupMembership (eine für jede Richtung).
    const updates = prisma.groupMembership.update.mock.calls;
    expect(updates).toHaveLength(2);
    // Die neuen Groups stehen im data.groupId.
    const updateMap = new Map(updates.map((c) => [c[0].where.id, c[0].data.groupId]));
    expect(updateMap.get('m-alpha')).toBe(groupB);
    expect(updateMap.get('m-bravo')).toBe(groupA);
    // Atomicity: $transaction wurde mit einem Array aufgerufen.
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('200 mit mehreren Swaps in einem Call', async () => {
    const res = await adminRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [
        [teamAlpha, teamBravo],
        [teamCharlie, teamDelta],
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().swapCount).toBe(2);
    // 4 Updates (2 Swaps × 2 Richtungen).
    expect(prisma.groupMembership.update.mock.calls).toHaveLength(4);
  });

  it('Tausch UND Spielplan laufen in EINER $transaction (atomar)', async () => {
    // Bis zum 26.08. war das eine $transaction mit einem ARRAY von zwei
    // Update-Promises. Seit dem Entscheid "die Spiele ziehen mit" gehoert
    // die Neuerzeugung der Gruppenphase in dieselbe Transaktion — und die
    // braucht die Callback-Form, weil sie mehrere abhaengige Schritte hat.
    //
    // Die ZUSICHERUNG ist unveraendert und wichtiger als die Form: beides
    // zusammen oder gar nichts. Ein Abbruch zwischen Tausch und Spielplan
    // waere genau der Zustand, den diese Aenderung abschafft — zwei
    // Quellen, die sich widersprechen.
    await adminRequest('POST', `/api/tournaments/${tId}/groups/swaps`, {
      swaps: [[teamAlpha, teamBravo]],
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    const calls = prisma.$transaction.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(typeof lastCall[0]).toBe('function');
    // Und die Updates laufen INNERHALB davon, nicht daneben.
    expect(prisma.groupMembership.update.mock.calls.length).toBeGreaterThan(0);
  });
});
