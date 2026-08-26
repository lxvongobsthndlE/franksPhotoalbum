/**
 * Tests für die 3 neuen Lebenszyklus-Routes (Etappe B.8):
 *   POST /:id/start
 *   POST /:id/revert-to-draft
 *   POST /:id/shift-open-matches
 *
 * Inkl. Round-Trip-Test für revert (User-Anmerkung 2026-08-20):
 * "Prüf, dass die Ergebnisse wirklich noch da sind, wenn ich zweimal hin
 * und her wechsle."
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
const tStartedId = 't-started';
const tFinishedId = 't-finished';
const matchId = 'match-1';

function makeStub(overrides = {}) {
  return {
    id: tDraftId,
    groupId: gId,
    name: 'Mein Turnier',
    status: 'draft',
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

function createLocalMockPrisma() {
  const fn = () => vi.fn();
  return {
    user: { findUnique: fn() },
    group: { findUnique: fn() },
    groupMember: { findUnique: fn() },
    groupDeputy: { findUnique: fn() },
    tournament: { findUnique: fn(), findMany: fn(), create: fn(), update: fn(), delete: fn() },
    tournamentTeam: {
      findFirst: fn(),
      findMany: fn(),
      findUnique: fn(),
      update: fn(),
      delete: fn(),
    },
    stage: { findMany: fn(), findUnique: fn(), create: fn(), deleteMany: fn() },
    group_: { findMany: fn(), create: fn() },
    groupMembership: { findMany: fn(), createMany: fn(), deleteMany: fn() },
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
    if (where.id === tStartedId)
      return makeStub({
        id: tStartedId,
        status: 'group_stage',
        startedAt: new Date('2026-08-20T10:00:00Z'),
      });
    if (where.id === tFinishedId)
      return makeStub({
        id: tFinishedId,
        status: 'finished',
        startedAt: new Date('2026-08-19T10:00:00Z'),
      });
    return null;
  });
  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournament.update.mockImplementation(async ({ where, data }) => {
    return makeStub({ id: where.id, ...data });
  });
  prisma.tournamentTeam.findFirst.mockResolvedValue(null);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.groupMembership.findMany.mockResolvedValue([]);
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
    method: 'POST',
    url,
    headers: { 'x-test-user': userId },
    payload: body,
  });

describe('POST /api/tournaments/:id/start', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tGeneratedId}/start`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 Member (§1.2 Pflicht-Test)', async () => {
    const res = await post(`/api/tournaments/${tGeneratedId}/start`, {}, u.member.id);
    expect(res.statusCode).toBe(403);
  });

  it('200: status "generated" + startedAt null → startet', async () => {
    const res = await post(`/api/tournaments/${tGeneratedId}/start`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().startedAt).toBeTruthy();
    // Verify: tournament.update wurde mit startedAt aufgerufen
    const lastUpdate = prisma.tournament.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate?.data?.startedAt).toBeInstanceOf(Date);
  });

  it('409 wenn status "draft" (noch nicht generiert)', async () => {
    const res = await post(`/api/tournaments/${tDraftId}/start`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('tournament_not_generated');
  });

  it('409 wenn bereits started', async () => {
    const res = await post(`/api/tournaments/${tStartedId}/start`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('tournament_already_started');
  });
});

describe('POST /api/tournaments/:id/revert-to-draft', () => {
  it('401 / 403', async () => {
    const r1 = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tStartedId}/revert-to-draft`,
      payload: {},
    });
    expect(r1.statusCode).toBe(401);
    const r2 = await post(`/api/tournaments/${tStartedId}/revert-to-draft`, {}, u.member.id);
    expect(r2.statusCode).toBe(403);
  });

  it('200: LÄUFT + 0 finished → revert ohne Confirm', async () => {
    prisma.match.count.mockResolvedValue(0);
    const res = await post(`/api/tournaments/${tStartedId}/revert-to-draft`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('draft');
    const lastUpdate = prisma.tournament.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate?.data?.startedAt).toBeNull();
    expect(lastUpdate?.data?.status).toBe('draft');
  });

  it('409 wenn startedAt null (noch nicht gestartet)', async () => {
    const res = await post(`/api/tournaments/${tGeneratedId}/revert-to-draft`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('tournament_not_started');
  });

  it('409 wenn finished > 0 (needsConfirmation: true)', async () => {
    prisma.match.count.mockResolvedValue(3);
    const res = await post(`/api/tournaments/${tStartedId}/revert-to-draft`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('revert_locked_results_present');
    expect(res.json().needsConfirmation).toBe(true);
  });

  it('200 mit korrektem confirmTournamentName trotz 3 finished', async () => {
    prisma.match.count.mockResolvedValue(3);
    const res = await post(`/api/tournaments/${tStartedId}/revert-to-draft`, {
      confirmTournamentName: 'mein turnier',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('draft');
  });

  it('Round-Trip: start → revert → start → revert: Daten bleiben konsistent', async () => {
    prisma.match.count.mockResolvedValue(0);
    // 1) Start (Bereit → Läuft)
    const r1 = await post(`/api/tournaments/${tGeneratedId}/start`, {});
    expect(r1.statusCode).toBe(200);
    // 2) Mock: Status nach start = 'group_stage', startedAt = now
    prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === tGeneratedId)
        return makeStub({ id: tGeneratedId, status: 'group_stage', startedAt: new Date() });
      return null;
    });
    // 3) Revert (Läuft → Entwurf)
    const r2 = await post(`/api/tournaments/${tGeneratedId}/revert-to-draft`, {});
    expect(r2.statusCode).toBe(200);
    // 4) Mock: Status nach revert = 'generated' (für 2. Start), startedAt = null
    prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === tGeneratedId)
        return makeStub({ id: tGeneratedId, status: 'generated', startedAt: null });
      return null;
    });
    // 5) Erneut starten
    const r3 = await post(`/api/tournaments/${tGeneratedId}/start`, {});
    expect(r3.statusCode).toBe(200);
    // 6) Erneut revert
    prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === tGeneratedId)
        return makeStub({ id: tGeneratedId, status: 'group_stage', startedAt: new Date() });
      return null;
    });
    const r4 = await post(`/api/tournaments/${tGeneratedId}/revert-to-draft`, {});
    expect(r4.statusCode).toBe(200);
    // Anzahl update-Calls: 2× start + 2× revert = 4
    expect(prisma.tournament.update).toHaveBeenCalledTimes(4);
  });
});

describe('POST /api/tournaments/:id/shift-open-matches', () => {
  it('401 / 403', async () => {
    const r1 = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tStartedId}/shift-open-matches`,
      payload: { minutes: 20 },
    });
    expect(r1.statusCode).toBe(401);
    const r2 = await post(
      `/api/tournaments/${tStartedId}/shift-open-matches`,
      { minutes: 20 },
      u.member.id
    );
    expect(r2.statusCode).toBe(403);
  });

  it('409 wenn status "finished"', async () => {
    const res = await post(`/api/tournaments/${tFinishedId}/shift-open-matches`, { minutes: 20 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('tournament_finished');
  });

  it('400 invalid minutes (0)', async () => {
    const res = await post(`/api/tournaments/${tStartedId}/shift-open-matches`, { minutes: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_minutes');
  });

  it('400 invalid minutes (out of range)', async () => {
    const res = await post(`/api/tournaments/${tStartedId}/shift-open-matches`, { minutes: 9999 });
    expect(res.statusCode).toBe(400);
  });

  it('200 positive shift: alle scheduled matches verschoben', async () => {
    const base = new Date('2026-08-20T10:00:00Z');
    prisma.match.findMany.mockResolvedValue([
      { id: 'm1', scheduledAt: new Date(base.getTime()) },
      { id: 'm2', scheduledAt: new Date(base.getTime() + 30 * 60_000) },
    ]);
    const res = await post(`/api/tournaments/${tStartedId}/shift-open-matches`, { minutes: 20 });
    expect(res.statusCode).toBe(200);
    expect(res.json().shiftedCount).toBe(2);
    // Jeder Match-Update sollte scheduledAt um 20 Minuten verschoben haben
    const calls = prisma.match.update.mock.calls;
    expect(calls.length).toBe(2);
    for (const c of calls) {
      const newTime = c[0].data.scheduledAt;
      expect(newTime.getTime() % 60_000).toBe(0); // Minutengranularität
    }
  });

  it('200 negative shift: offene Spiele nach vorn', async () => {
    const base = new Date('2026-08-20T12:00:00Z');
    prisma.match.findMany.mockResolvedValue([{ id: 'm1', scheduledAt: new Date(base.getTime()) }]);
    const res = await post(`/api/tournaments/${tStartedId}/shift-open-matches`, { minutes: -30 });
    expect(res.statusCode).toBe(200);
    expect(res.json().shiftedCount).toBe(1);
  });

  it('200 wenn keine scheduled matches', async () => {
    prisma.match.findMany.mockResolvedValue([]);
    const res = await post(`/api/tournaments/${tStartedId}/shift-open-matches`, { minutes: 20 });
    expect(res.statusCode).toBe(200);
    expect(res.json().shiftedCount).toBe(0);
  });
});
