/**
 * Integrationstests für DELETE /api/tournaments/:id (Etappe B.7 / §13.10).
 *
 * Confirm-Handshake analog zu /reset-results:
 *   - finishedCount = 0 → einfaches DELETE (passt zur Turnier-Liste)
 *   - finishedCount > 0 → confirmTournamentName mit Turniernamen erforderlich
 *
 * Wir testen:
 *   - 401 ohne JWT
 *   - 403 wenn Member (Pflicht-Test §1.2)
 *   - 200 bei 0 finished (kein Confirm)
 *   - 409 `delete_locked_results_present` bei ≥1 finished ohne Confirm
 *   - 200 bei korrektem Confirm
 *   - Asset-Cleanup wird aufgerufen
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
    if (where.id === tGeneratedId) return makeStub({ id: tGeneratedId, status: 'group_stage' });
    return null;
  });
  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournament.delete.mockResolvedValue({ id: tDraftId });
  prisma.tournamentTeam.findFirst.mockResolvedValue(null);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue([]);
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.groupMembership.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
  prisma.match.groupBy.mockResolvedValue([]);
  prisma.match.count.mockResolvedValue(0); // Default: 0 finished
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

const deleteTournament = (tournamentId, body = {}, userId = u.admin.id) =>
  app.inject({
    method: 'DELETE',
    url: `/api/tournaments/${tournamentId}`,
    headers: { 'x-test-user': userId },
    payload: body,
  });

describe('DELETE /api/tournaments/:id', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tournaments/${tDraftId}`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 wenn Member (§1.2 Pflicht-Test)', async () => {
    const res = await deleteTournament(tDraftId, {}, u.member.id);
    expect(res.statusCode).toBe(403);
    // Bei draft-Turnier: Member sieht den Draft gar nicht (canViewTournament).
    // Bei generiertem Turnier: Member darf nicht schreiben (requireTournamentWrite).
    // Beide sind 403 — die Lücke wäre 200 oder 204.
    // Wichtig: der Tournament-Delete darf NICHT aufgerufen worden sein.
    expect(prisma.tournament.delete).not.toHaveBeenCalled();
  });

  it('403 wenn Member auf generiertes Turnier (requireTournamentWrite)', async () => {
    // generated statt draft, damit canViewTournament=true → requireTournamentWrite greift.
    const res = await deleteTournament(tGeneratedId, {}, u.member.id);
    expect(res.statusCode).toBe(403);
    expect(prisma.tournament.delete).not.toHaveBeenCalled();
  });

  it('200 bei 0 finished (kein Confirm erforderlich)', async () => {
    prisma.match.count.mockResolvedValue(0);
    const res = await deleteTournament(tDraftId, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(prisma.tournament.delete).toHaveBeenCalledWith({ where: { id: tDraftId } });
  });

  it('409 delete_locked_results_present bei ≥1 finished ohne Confirm', async () => {
    prisma.match.count.mockResolvedValue(3);
    const res = await deleteTournament(tGeneratedId, {});
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('delete_locked_results_present');
    expect(body.finishedMatches).toBe(3);
    expect(body.needsConfirmation).toBe(true);
    // Wichtig: der Delete darf NICHT passieren.
    expect(prisma.tournament.delete).not.toHaveBeenCalled();
  });

  it('409 auch wenn confirmTournamentName gesetzt aber falsch', async () => {
    prisma.match.count.mockResolvedValue(2);
    const res = await deleteTournament(tGeneratedId, {
      confirmTournamentName: 'Anderes Turnier',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('delete_locked_results_present');
    expect(prisma.tournament.delete).not.toHaveBeenCalled();
  });

  it('200 bei ≥1 finished mit korrektem Confirm (case-insensitive + trim)', async () => {
    prisma.match.count.mockResolvedValue(5);
    const res = await deleteTournament(tGeneratedId, {
      confirmTournamentName: '  mein turnier  ', // Lowercase + Whitespace
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(prisma.tournament.delete).toHaveBeenCalledWith({ where: { id: tGeneratedId } });
  });

  it('Asset-Cleanup wird aufgerufen (logo + cover)', async () => {
    const storage = await import('../../../utils/storage.js');
    prisma.match.count.mockResolvedValue(0);
    const res = await deleteTournament(tDraftId, {});
    expect(res.statusCode).toBe(200);
    expect(storage.deleteTournamentAsset).toHaveBeenCalledWith(tDraftId, 'logo');
    expect(storage.deleteTournamentAsset).toHaveBeenCalledWith(tDraftId, 'cover');
  });

  it('Asset-Cleanup-Fehler werden geschluckt (DB-Cascade wichtiger)', async () => {
    const storage = await import('../../../utils/storage.js');
    storage.deleteTournamentAsset.mockRejectedValueOnce(new Error('MinIO down'));
    prisma.match.count.mockResolvedValue(0);
    const res = await deleteTournament(tDraftId, {});
    expect(res.statusCode).toBe(200);
    // DB-Delete muss trotz MinIO-Fehler durchgegangen sein.
    expect(prisma.tournament.delete).toHaveBeenCalled();
  });
});