/**
 * Integrationstests für POST /api/tournaments/:id/finish (Etappe B.7).
 *
 * Einstellungen-Tab Aktionen-Block: „Turnier abschließen" — regulärer
 * Abschluss, KEIN confirmTournamentName, idempotent.
 *
 * Wir testen:
 *   - 401 / 403
 *   - 200 setzt status='finished' in der DB
 *   - 409 wenn bereits finished (idempotent)
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

const u = { member: { id: 'u-member', role: 'user' }, admin: { id: 'u-admin', role: 'user' } };
const gId = 'g-1';
const tActiveId = 't-active';
const tFinishedId = 't-finished';

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
    if (where.id === tActiveId) {
      return {
        id: tActiveId, groupId: gId, status: 'group_stage', isPublic: false,
        publicToken: null, publicRevokedAt: null, logoUrl: null, config: null,
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    if (where.id === tFinishedId) {
      return {
        id: tFinishedId, groupId: gId, status: 'finished', isPublic: false,
        publicToken: null, publicRevokedAt: null, logoUrl: null, config: null,
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
  prisma.match.count.mockResolvedValue(0);
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

const finish = (tournamentId, userId = u.admin.id) =>
  app.inject({
    method: 'POST',
    url: `/api/tournaments/${tournamentId}/finish`,
    headers: { 'x-test-user': userId },
    payload: {},
  });

describe('POST /api/tournaments/:id/finish', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tournaments/${tActiveId}/finish`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 wenn Member', async () => {
    const res = await finish(tActiveId, u.member.id);
    expect(res.statusCode).toBe(403);
  });

  it('200 setzt status=finished in der DB', async () => {
    const res = await finish(tActiveId);
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().status).toBe('finished');
    expect(prisma.tournament.update).toHaveBeenCalledWith({
      where: { id: tActiveId },
      data: { status: 'finished' },
    });
  });

  it('409 wenn bereits finished (idempotent)', async () => {
    const res = await finish(tFinishedId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('tournament_already_finished');
  });
});
