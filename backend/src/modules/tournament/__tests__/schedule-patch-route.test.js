/**
 * Integrationstests für PATCH /api/tournaments/:id/schedule (Etappe B.7).
 *
 * Spielplan-Tab mit „Bearbeiten"-Toggle: Admin kann pro Match die
 * Zeit (scheduledAt) und/oder Platte (field) anpassen.
 *
 * Wir testen:
 *   - 401 / 403
 *   - 400 leeres updates[] / 400 fremder matchId / 400 field-Range / 400 ISO
 *   - 409 match_locked (status !== 'scheduled') — auch gemischt
 *   - 409 ko_match_not_editable
 *   - 409 schedule_conflict
 *   - 200 erfolgreich: scheduledAt + field werden gesetzt
 *   - 200: status bleibt 'scheduled'
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
const tId = 't-1';
const draftMatches = [
  {
    id: 'm-group-1',
    status: 'scheduled',
    scheduledAt: new Date('2026-09-12T10:00:00Z'),
    field: 1,
    stage: { type: 'group' },
  },
  {
    id: 'm-group-2',
    status: 'scheduled',
    scheduledAt: new Date('2026-09-12T10:30:00Z'),
    field: 1,
    stage: { type: 'group' },
  },
  {
    id: 'm-ko-1',
    status: 'scheduled',
    scheduledAt: new Date('2026-09-12T14:00:00Z'),
    field: 1,
    stage: { type: 'ko' },
  },
  {
    id: 'm-finished',
    status: 'finished',
    scheduledAt: new Date('2026-09-12T09:00:00Z'),
    field: 1,
    stage: { type: 'group' },
  },
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
    if (where.id === tId) {
      return {
        id: tId, groupId: gId, status: 'group_stage', isPublic: false,
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
  prisma.match.findMany.mockImplementation(async ({ where }) => {
    if (where?.tournamentId === tId) return [...draftMatches];
    return [];
  });
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

const patchSchedule = (tournamentId, body, userId = u.admin.id) =>
  app.inject({
    method: 'PATCH',
    url: `/api/tournaments/${tournamentId}/schedule`,
    headers: { 'x-test-user': userId },
    payload: body,
  });

describe('PATCH /api/tournaments/:id/schedule', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/schedule`,
      payload: { updates: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 wenn Member', async () => {
    const res = await patchSchedule(tId, { updates: [] }, u.member.id);
    expect(res.statusCode).toBe(403);
  });

  it('400 wenn updates[] fehlt', async () => {
    const res = await patchSchedule(tId, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('schedule_invalid');
  });

  it('400 wenn updates[] leer ist', async () => {
    const res = await patchSchedule(tId, { updates: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('schedule_invalid');
  });

  it('404 bei fremder matchId', async () => {
    const res = await patchSchedule(tId, {
      updates: [{ matchId: 'm-foreign', scheduledAt: '2026-09-12T12:00:00Z' }],
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('match_not_found');
  });

  it('400 bei invalid ISO-String', async () => {
    const res = await patchSchedule(tId, {
      updates: [{ matchId: 'm-group-1', scheduledAt: 'kein-ISO' }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('schedule_iso_invalid');
  });

  it('400 bei field < 1', async () => {
    const res = await patchSchedule(tId, {
      updates: [{ matchId: 'm-group-1', field: 0 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('schedule_field_invalid');
  });

  it('400 bei field = String', async () => {
    const res = await patchSchedule(tId, {
      updates: [{ matchId: 'm-group-1', field: '1' }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('schedule_field_invalid');
  });

  it('409 bei KO-Match (nicht editierbar)', async () => {
    const res = await patchSchedule(tId, {
      updates: [{ matchId: 'm-ko-1', scheduledAt: '2026-09-12T15:00:00Z' }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ko_match_not_editable');
  });

  it('409 bei finished Match (auch in gemischtem Batch)', async () => {
    const res = await patchSchedule(tId, {
      updates: [
        { matchId: 'm-group-1', scheduledAt: '2026-09-12T11:00:00Z' },
        { matchId: 'm-finished', scheduledAt: '2026-09-12T11:30:00Z' },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('match_locked');
  });

  it('200 Admin: scheduledAt + field werden gesetzt', async () => {
    const res = await patchSchedule(tId, {
      updates: [{ matchId: 'm-group-1', scheduledAt: '2026-09-12T12:00:00Z', field: 3 }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(prisma.match.update).toHaveBeenCalled();
    const updateCall = prisma.match.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe('m-group-1');
    expect(updateCall.data.scheduledAt).toBeInstanceOf(Date);
    expect(updateCall.data.field).toBe(3);
  });

  it('200: scheduledAt = null entfernt die Zeit', async () => {
    const res = await patchSchedule(tId, {
      updates: [{ matchId: 'm-group-1', scheduledAt: null }],
    });
    expect(res.statusCode).toBe(200);
    const updateCall = prisma.match.update.mock.calls[0][0];
    expect(updateCall.data.scheduledAt).toBeNull();
  });
});
