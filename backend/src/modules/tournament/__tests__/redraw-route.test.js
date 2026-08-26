/**
 * Integrationstests für POST /api/tournaments/:id/redraw (Etappe B.7).
 *
 * Einstellungen-Tab: Admin kann die Setzreihenfolge (seed) neu würfeln.
 *   - 0 beendete Matches: direkter Shuffle, kein Confirm.
 *   - ≥1 beendete Matches: confirmTournamentName erforderlich (Spec §13.10).
 *
 * Wir testen:
 *   - 401 / 403
 *   - 200 ohne Lock: Seeds werden via $transaction gesetzt
 *   - 409 mit Lock ohne Confirm: needsConfirmation: true
 *   - 200 mit Lock + korrektem Confirm
 *   - 200 mit Lock + falschem Confirm → 409
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
const tDraftId = 't-draft';
const tLockedId = 't-locked';
const teamsDraft = [
  { id: 'team-a', name: 'A', color: '#111111', seed: 0 },
  { id: 'team-b', name: 'B', color: '#222222', seed: 1 },
  { id: 'team-c', name: 'C', color: '#333333', seed: 2 },
  { id: 'team-d', name: 'D', color: '#444444', seed: 3 },
];

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
        id: tDraftId,
        groupId: gId,
        status: 'draft',
        isPublic: false,
        publicToken: null,
        publicRevokedAt: null,
        logoUrl: null,
        config: null,
        name: 'Mein Turnier',
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    if (where.id === tLockedId) {
      return {
        id: tLockedId,
        groupId: gId,
        status: 'group_stage',
        isPublic: false,
        publicToken: null,
        publicRevokedAt: null,
        logoUrl: null,
        config: null,
        // Etappe B.8: startedAt ist der Lock-Trigger. „LÄUFT" =
        // startedAt gesetzt + status != 'finished'.
        startedAt: new Date('2026-08-20T10:00:00Z'),
        name: 'Mein Turnier',
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
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.groupMembership.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.groupBy.mockResolvedValue([]);
  prisma.match.count.mockImplementation(async ({ where }) => {
    if (where?.tournamentId === tDraftId) return 0;
    if (where?.tournamentId === tLockedId) return 3;
    return 0;
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

const redraw = (tournamentId, body = {}, userId = u.admin.id) =>
  app.inject({
    method: 'POST',
    url: `/api/tournaments/${tournamentId}/redraw`,
    headers: { 'x-test-user': userId },
    payload: body,
  });

describe('POST /api/tournaments/:id/redraw', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tDraftId}/redraw`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 wenn Member', async () => {
    const res = await redraw(tDraftId, {}, u.member.id);
    expect(res.statusCode).toBe(403);
  });

  it('200 ohne Lock: Seeds werden via $transaction gesetzt', async () => {
    const res = await redraw(tDraftId, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(prisma.tournamentTeam.update).toHaveBeenCalled();
    // requiresKoRegeneration: false (kein Lock)
    expect(res.json().requiresKoRegeneration).toBe(false);
  });

  it('409 mit Lock ohne Confirm', async () => {
    const res = await redraw(tLockedId, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('redraw_locked_results_present');
    expect(res.json().needsConfirmation).toBe(true);
    expect(res.json().finishedMatches).toBe(3);
  });

  it('409 mit Lock + falschem Confirm', async () => {
    const res = await redraw(tLockedId, { confirmTournamentName: 'Falscher Name' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('redraw_locked_results_present');
  });

  it('200 mit Lock + korrektem Confirm: requiresKoRegeneration: true', async () => {
    const res = await redraw(tLockedId, { confirmTournamentName: 'Mein Turnier' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().requiresKoRegeneration).toBe(true);
  });
});
