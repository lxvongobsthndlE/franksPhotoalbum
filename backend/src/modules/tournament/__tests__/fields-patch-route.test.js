/**
 * Integrationstests für PATCH /api/tournaments/:id/fields (Etappe B.7, A4).
 *
 * Einstellungen-Tab Spielfelder-Block: Anzahl + benennbare Felder.
 * Lock: nach Generierung (status !== 'draft') gesperrt.
 *
 * Wir testen:
 *   - 401 / 403
 *   - 400 count out of range (0, 13)
 *   - 400 leerer Name, > 32 Zeichen, doppelt
 *   - 400 invalid order, doppelter order
 *   - 409 locked (status !== 'draft')
 *   - 200 ok mit Stable-IDs
 *   - 200 verringert Anzahl → match.field für wegfallende IDs → null
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
const tDraftId = 't-draft';
const tGeneratedId = 't-generated';
const tFinishedId = 't-finished';

function makeStub(overrides = {}) {
  return {
    id: tDraftId, groupId: gId, status: 'draft', isPublic: false,
    publicToken: null, publicRevokedAt: null, logoUrl: null, config: null,
    group: { id: gId, createdBy: u.admin.id, name: 'G' },
    ...overrides,
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
    if (where.id === tDraftId) return makeStub();
    if (where.id === tGeneratedId) return makeStub({
      id: tGeneratedId,
      status: 'group_stage',
      // Etappe B.8: startedAt setzt das Turnier in „LÄUFT".
      // Spielfelder bleiben in LÄUFT editierbar (User kann am Turniertag
      // z.B. „Platte 3" → „Beach Court" umbenennen).
      startedAt: new Date('2026-08-20T10:00:00Z'),
    });
    if (where.id === tFinishedId) return makeStub({ id: tFinishedId, status: 'finished' });
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
  prisma.match.updateMany.mockResolvedValue({ count: 0 });
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

const patchFields = (tournamentId, body, userId = u.admin.id) =>
  app.inject({
    method: 'PATCH',
    url: `/api/tournaments/${tournamentId}/fields`,
    headers: { 'x-test-user': userId },
    payload: body,
  });

describe('PATCH /api/tournaments/:id/fields', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tDraftId}/fields`,
      payload: { fields: [{ name: 'Platte 1', order: 0 }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 wenn Member', async () => {
    const res = await patchFields(
      tDraftId,
      { fields: [{ name: 'Platte 1', order: 0 }] },
      u.member.id
    );
    expect(res.statusCode).toBe(403);
  });

  it('400 wenn count = 0', async () => {
    const res = await patchFields(tDraftId, { fields: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('fields_count_out_of_range');
  });

  it('400 wenn count = 13', async () => {
    const fields = Array.from({ length: 13 }, (_, i) => ({
      name: `Feld ${i + 1}`,
      order: i,
    }));
    const res = await patchFields(tDraftId, { fields });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('fields_count_out_of_range');
  });

  it('400 bei leerem Namen', async () => {
    const res = await patchFields(tDraftId, {
      fields: [{ name: '', order: 0 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('fields_name_empty');
  });

  it('400 bei Name > 32 Zeichen', async () => {
    const res = await patchFields(tDraftId, {
      fields: [{ name: 'A'.repeat(33), order: 0 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('fields_name_too_long');
  });

  it('400 bei doppeltem Namen', async () => {
    const res = await patchFields(tDraftId, {
      fields: [
        { name: 'Platte 1', order: 0 },
        { name: 'Platte 1', order: 1 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('fields_name_duplicate');
  });

  it('400 bei doppelter order', async () => {
    const res = await patchFields(tDraftId, {
      fields: [
        { name: 'Platte 1', order: 0 },
        { name: 'Platte 2', order: 0 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('fields_order_duplicate');
  });

  it('200 in LÄUFT (Spielfeld-Namen dürfen am Turniertag noch geändert werden)', async () => {
    const res = await patchFields(tGeneratedId, {
      fields: [{ name: 'Platte 1', order: 0 }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('409 wenn status === finished (read-only)', async () => {
    const res = await patchFields(tFinishedId, {
      fields: [{ name: 'Platte 1', order: 0 }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('fields_locked');
  });

  it('200 ok mit Stable-IDs', async () => {
    const res = await patchFields(tDraftId, {
      fields: [
        { name: 'Tischtennisplatte A', order: 0 },
        { name: 'Platte 2', order: 1 },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().fields).toHaveLength(2);
    expect(res.json().fields[0].name).toBe('Tischtennisplatte A');
    expect(res.json().fields[0].order).toBe(0);
    expect(typeof res.json().fields[0].id).toBe('string');
    expect(res.json().fields[0].id.length).toBeGreaterThan(0);
  });

  it('200 verringert Anzahl: match.field für wegfallende IDs wird auf null gesetzt', async () => {
    // Vorher: 4 Felder gespeichert im config.
    prisma.tournament.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === tDraftId) {
        return makeStub({
          config: {
            fields: [
              { id: 'f1', name: 'Platte 1', order: 0 },
              { id: 'f2', name: 'Platte 2', order: 1 },
              { id: 'f3', name: 'Platte 3', order: 2 },
              { id: 'f4', name: 'Platte 4', order: 3 },
            ],
          },
        });
      }
      return null;
    });
    const res = await patchFields(tDraftId, {
      fields: [
        { name: 'Platte 1', order: 0 },
        { name: 'Platte 2', order: 1 },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fields).toHaveLength(2);
    expect(res.json().warnings).toHaveLength(1);
    expect(res.json().warnings[0].type).toBe('fields_dropped');
    expect(res.json().warnings[0].droppedIds).toEqual(['f3', 'f4']);
    // match.updateMany wurde mit den dropped IDs aufgerufen
    const updateManyCall = prisma.match.updateMany.mock.calls[0][0];
    expect(updateManyCall.where.field.in).toEqual(['f3', 'f4']);
    expect(updateManyCall.data.field).toBeNull();
  });
});
