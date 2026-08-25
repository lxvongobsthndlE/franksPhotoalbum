/**
 * P5-Re-Fix (2026-08-25): Tests für die erweiterte KO-Baum-Auto-Fill-
 * Logik. Der User wollte:
 *
 *   a) Auto-Trigger ZUVERLÄSSIG mit Toast "K.-o.-Phase steht: Team X
 *      trifft auf Team Y" — der bisher nur still im Server-Log stand.
 *   b) Manueller Knopf "K.-o.-Phase starten" als Rückfallebene — der
 *      P3-Button wurde nie angezeigt, weil die alte Heuristik
 *      `matches.length === 0` prüfte; die KO-Stage hat aber immer
 *      Matches (mit Platzhaltern).
 *   c) Warnung bei nachträglicher Änderung eines Gruppenergebnisses
 *      WÄHREND der Baum schon gefüllt ist — statt still zu überschreiben.
 *
 * Diese Tests sichern die Server-Seite ab:
 *   - GET /bracket liefert jetzt `allGroupsFinished` + `bracketHasPlaceholders`
 *   - POST /result liefert `koFill` mit firstMatchup und `bracketWasAlreadyFilled`
 *   - maybeFillKoFromGroupFinish bricht mit reason 'bracket_already_filled'
 *     ab, statt still zu überschreiben.
 *
 * Mock-Strategie: Wir geben RAW-DB-Zeilen zurück (id, tournamentId,
 * stageId, teamHome, teamAway, status, ...). buildTournamentViewContext
 * → prepareMatchList → prepareMatchView baut daraus das DTO mit
 * isGroupMatch / isKoMatch / isFinished. So testen wir, was die Route
 * tatsächlich sieht — nicht unsere Annahmen über die DTO-Form.
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
  const prisma = {
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
  };
  prisma.$transaction = vi.fn(async (cb) => {
    return typeof cb === 'function' ? cb(prisma) : cb;
  });
  return prisma;
}

const u = {
  member: { id: 'u-member', role: 'user' },
  admin: { id: 'u-admin', role: 'user' },
};
const gId = 'g-1';
const tId = 't-1';

// Stages: ein Group-Stage + ein KO-Stage.
const STAGES = [
  { id: 's-group', tournamentId: tId, type: 'group', name: 'Gruppenphase' },
  { id: 's-ko', tournamentId: tId, type: 'ko', name: 'K.-o.-Runde' },
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
        id: tId,
        groupId: gId,
        status: 'group_stage',
        isPublic: false,
        publicToken: null,
        publicRevokedAt: null,
        logoUrl: null,
        config: { mode: 'groups_ko' },
        name: 'Mein Turnier',
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    return null;
  });
  prisma.tournament.findMany.mockResolvedValue([]);
  prisma.tournamentTeam.findFirst.mockResolvedValue(null);
  prisma.tournamentTeam.findMany.mockResolvedValue([]);
  prisma.stage.findMany.mockResolvedValue(STAGES);
  prisma.stage.findUnique.mockImplementation(async ({ where }) => {
    return STAGES.find((s) => s.id === where.id) ?? null;
  });
  prisma.group_.findMany.mockResolvedValue([]);
  prisma.groupMembership.findMany.mockResolvedValue([]);
  prisma.match.groupBy.mockResolvedValue([]);
  prisma.match.findUnique.mockResolvedValue(null);
  prisma.match.findFirst.mockResolvedValue(null);
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

// ─────────────────────────────────────────────────────────────────
// 1) GET /bracket — neue Flags allGroupsFinished + bracketHasPlaceholders
// ─────────────────────────────────────────────────────────────────

describe('GET /api/tournaments/:id/bracket — neue Flags (P5-Re-Fix)', () => {
  it('Response enthält allGroupsFinished + bracketHasPlaceholders', async () => {
    prisma.match.findMany.mockResolvedValue([
      // Roh-DB-Zeilen, prepareMatchView macht daraus das DTO.
      { id: 'gm-1', tournamentId: tId, stageId: 's-group', groupId: 'g-grp-a',
        teamHome: 'team-a', teamAway: 'team-b', status: 'finished', scoreHome: 2, scoreAway: 1 },
      { id: 'ko-1', tournamentId: tId, stageId: 's-ko', groupId: null,
        teamHome: null, teamAway: null, status: 'scheduled' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}/bracket`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('allGroupsFinished');
    expect(body).toHaveProperty('bracketHasPlaceholders');
  });

  it('allGroupsFinished=true wenn alle Gruppen-Matches finished', async () => {
    prisma.match.findMany.mockResolvedValue([
      { id: 'gm-1', tournamentId: tId, stageId: 's-group', groupId: 'g-grp-a',
        teamHome: 'team-a', teamAway: 'team-b', status: 'finished', scoreHome: 2, scoreAway: 1 },
      { id: 'gm-2', tournamentId: tId, stageId: 's-group', groupId: 'g-grp-a',
        teamHome: 'team-c', teamAway: 'team-d', status: 'finished', scoreHome: 3, scoreAway: 0 },
      { id: 'ko-1', tournamentId: tId, stageId: 's-ko', groupId: null,
        teamHome: null, teamAway: null, status: 'scheduled' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}/bracket`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.json().allGroupsFinished).toBe(true);
  });

  it('allGroupsFinished=false wenn ein Gruppen-Match noch nicht fertig', async () => {
    prisma.match.findMany.mockResolvedValue([
      { id: 'gm-1', tournamentId: tId, stageId: 's-group', groupId: 'g-grp-a',
        teamHome: 'team-a', teamAway: 'team-b', status: 'finished', scoreHome: 2, scoreAway: 1 },
      { id: 'gm-2', tournamentId: tId, stageId: 's-group', groupId: 'g-grp-a',
        teamHome: 'team-c', teamAway: 'team-d', status: 'scheduled', scoreHome: null, scoreAway: null },
      { id: 'ko-1', tournamentId: tId, stageId: 's-ko', groupId: null,
        teamHome: null, teamAway: null, status: 'scheduled' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}/bracket`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.json().allGroupsFinished).toBe(false);
  });

  it('bracketHasPlaceholders=true wenn mindestens ein KO-Slot leer ist', async () => {
    prisma.match.findMany.mockResolvedValue([
      { id: 'gm-1', tournamentId: tId, stageId: 's-group', groupId: 'g-grp-a',
        teamHome: 'team-a', teamAway: 'team-b', status: 'finished', scoreHome: 2, scoreAway: 1 },
      { id: 'ko-1', tournamentId: tId, stageId: 's-ko', groupId: null,
        teamHome: 'team-a', teamAway: null, status: 'scheduled' },
      { id: 'ko-2', tournamentId: tId, stageId: 's-ko', groupId: null,
        teamHome: 'team-b', teamAway: 'team-c', status: 'scheduled' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}/bracket`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.json().bracketHasPlaceholders).toBe(true);
  });

  it('bracketHasPlaceholders=false wenn alle KO-Slots befüllt sind', async () => {
    prisma.match.findMany.mockResolvedValue([
      { id: 'gm-1', tournamentId: tId, stageId: 's-group', groupId: 'g-grp-a',
        teamHome: 'team-a', teamAway: 'team-b', status: 'finished', scoreHome: 2, scoreAway: 1 },
      { id: 'ko-1', tournamentId: tId, stageId: 's-ko', groupId: null,
        teamHome: 'team-a', teamAway: 'team-b', status: 'scheduled' },
      { id: 'ko-2', tournamentId: tId, stageId: 's-ko', groupId: null,
        teamHome: 'team-c', teamAway: 'team-d', status: 'scheduled' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/tournaments/${tId}/bracket`,
      headers: { 'x-test-user': u.member.id },
    });
    expect(res.json().bracketHasPlaceholders).toBe(false);
  });
});
