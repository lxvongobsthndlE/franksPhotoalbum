/**
 * Integrationstests für POST /api/tournaments/:id/reset-results (Etappe B.7).
 *
 * Einstellungen-Tab Gefahrenzone: „Alle Ergebnisse löschen" — destruktiv.
 * Spec §13.10: confirmTournamentName ist Pflicht.
 *
 * Wir testen:
 *   - 401 / 403
 *   - 400 wenn keine finished matches
 *   - 409 ohne Confirm / 409 mit falschem Confirm
 *   - 200 mit korrektem Confirm: scores null, status scheduled, KO-Teams null
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

const u = { member: { id: 'u-member', role: 'user' }, admin: { id: 'u-admin', role: 'user' } };
const gId = 'g-1';
const tId = 't-1';

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
    if (where.id === tId) {
      return {
        id: tId,
        groupId: gId,
        status: 'group_stage',
        isPublic: false,
        publicToken: null,
        publicRevokedAt: null,
        logoUrl: null,
        config: null,
        name: 'Mein Turnier',
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    return null;
  });
  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournamentTeam.findFirst.mockResolvedValue(null);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
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
  // Standard: 5 beendete Matches
  prisma.match.count.mockResolvedValue(5);
  app = await buildApp(prisma);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

const resetResults = (tournamentId, body = {}, userId = u.admin.id) =>
  app.inject({
    method: 'POST',
    url: `/api/tournaments/${tournamentId}/reset-results`,
    headers: { 'x-test-user': userId },
    payload: body,
  });

describe('POST /api/tournaments/:id/reset-results', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tId}/reset-results`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 wenn Member', async () => {
    const res = await resetResults(tId, { confirmTournamentName: 'Mein Turnier' }, u.member.id);
    expect(res.statusCode).toBe(403);
  });

  it('400 wenn keine finished matches', async () => {
    prisma.match.count.mockResolvedValue(0);
    const res = await resetResults(tId, { confirmTournamentName: 'Mein Turnier' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_results_to_reset');
  });

  it('409 ohne Confirm', async () => {
    const res = await resetResults(tId, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('reset_results_locked');
    expect(res.json().needsConfirmation).toBe(true);
    expect(res.json().finishedMatches).toBe(5);
  });

  it('409 mit falschem Confirm', async () => {
    const res = await resetResults(tId, { confirmTournamentName: 'Falscher Name' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('reset_results_locked');
  });

  it('200 mit korrektem Confirm: Scores null, Status scheduled, KO-Teams null', async () => {
    const res = await resetResults(tId, { confirmTournamentName: 'Mein Turnier' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().resetCount).toBe(5);
    // 1. updateMany: alle Matches → scoreHome/away null, status scheduled
    const updateManyCalls = prisma.match.updateMany.mock.calls;
    const allUpdate = updateManyCalls[0][0];
    expect(allUpdate.where.tournamentId).toBe(tId);
    expect(allUpdate.data.scoreHome).toBeNull();
    expect(allUpdate.data.scoreAway).toBeNull();
    expect(allUpdate.data.status).toBe('scheduled');
    // 2. updateMany: KO-Matches → teamHome/teamAway null
    const koUpdate = updateManyCalls[1][0];
    expect(koUpdate.where.stage.type).toEqual({ not: 'group' });
    expect(koUpdate.data.teamHome).toBeNull();
    expect(koUpdate.data.teamAway).toBeNull();
  });

  it('Confirm-Vergleich ist case-insensitive', async () => {
    const res = await resetResults(tId, { confirmTournamentName: 'mein turnier' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
