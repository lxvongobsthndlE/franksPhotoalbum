/**
 * Integrationstests für PATCH /api/tournaments/:id/teams/:teamId (Spec §5).
 *
 * Spec §5: "Ein Team umbenennen berührt den Spielplan nicht — nur die
 * Anzeige." Diese Route ist der Endpoint für genau diesen Use-Case.
 * Wir testen:
 *
 *   - 401 ohne JWT
 *   - 403 wenn der User nur Member ist (kein Admin)
 *   - 400 leere Patches, leerer Name, ungültige Farbe
 *   - 404 unbekanntes Team / Team aus anderem Turnier
 *   - 409 Namens-Duplikat beim Rename
 *   - 200 Admin: Name + Color erfolgreich aktualisiert
 *   - 200 nur Name, 200 nur Color, 200 leer
 *
 * Bewusst NICHT hier: das Zusammenspiel mit Spielplan/Standings
 * (das ist ein eigener Integrationstest, s. team-rename-through-view.test.js).
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
    tournament: {
      findUnique: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
    },
    tournamentTeam: {
      findFirst: fn(),
      findMany: fn(),
      findUnique: fn(),
      update: fn(),
      delete: fn(),
    },
    stage: { findMany: fn(), findUnique: fn(), create: fn(), deleteMany: fn() },
    group_: { findMany: fn(), create: fn() },
    groupMembership: { findMany: fn(), createMany: fn() },
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

const u = {
  member: { id: 'u-member', role: 'user' },
  admin: { id: 'u-admin', role: 'user' },
  global: { id: 'u-global', role: 'admin' },
  stranger: { id: 'u-stranger', role: 'user' },
};
const gId = 'g-1';
const tId = 't-live';
const teamA = { id: 'team-a', name: 'Team 1', color: '#888888', seed: 1 };
const teamB = { id: 'team-b', name: 'Team 2', color: '#444444', seed: 2 };

function baseStubs(prisma) {
  prisma.user.findUnique.mockImplementation(async ({ where }) => {
    const map = {
      [u.member.id]: { id: u.member.id, role: u.member.role },
      [u.admin.id]: { id: u.admin.id, role: u.admin.role },
      [u.global.id]: { id: u.global.id, role: u.global.role },
      [u.stranger.id]: { id: u.stranger.id, role: u.stranger.role },
    };
    return map[where.id] ?? null;
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
    if (userId === u.global.id) return { userId: u.global.id, groupId: gId };
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
        group: { id: gId, createdBy: u.admin.id, name: 'G' },
      };
    }
    return null;
  });

  prisma.tournament.findMany.mockResolvedValue([]);
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
  app = await buildApp(prisma);
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe('PATCH /api/tournaments/:id/teams/:teamId', () => {
  it('401 ohne JWT', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      payload: { name: 'Rakija Boys' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 wenn Member (kein Admin) patcht', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.member.id },
      payload: { name: 'Rakija Boys' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('403 für Fremden (kein Mitglied der Gruppe)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.stranger.id },
      payload: { name: 'Rakija Boys' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 wenn Team zum Turnier nicht gehört', async () => {
    prisma.tournamentTeam.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Rakija Boys' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 wenn nichts im Body steht', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'team_patch_empty' });
  });

  it('400 wenn name leer ist', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'team_name_empty' });
  });

  it('400 wenn name > 128 Zeichen', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'x'.repeat(129) },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'team_name_too_long' });
  });

  it('400 wenn color kein String und nicht null', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { color: 12345 },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'team_color_invalid' });
  });

  it('400 wenn color kein #RRGGBB-Format hat', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { color: 'rot' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'team_color_invalid' });
  });

  it('200 Admin: Name wird aktualisiert, Update wird gerufen', async () => {
    // Reihenfolge: 1. Team-finden → teamA; 2. Duplikat-Suche → null
    prisma.tournamentTeam.findFirst.mockResolvedValueOnce(teamA).mockResolvedValueOnce(null);
    prisma.tournamentTeam.update.mockResolvedValue({
      ...teamA,
      name: 'Rakija Boys',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Rakija Boys' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      id: teamA.id,
      name: 'Rakija Boys',
      color: teamA.color,
      seed: teamA.seed,
    });
    expect(prisma.tournamentTeam.update).toHaveBeenCalledWith({
      where: { id: teamA.id },
      data: { name: 'Rakija Boys' },
    });
  });

  it('200 Admin: nur Color wird aktualisiert (name bleibt)', async () => {
    prisma.tournamentTeam.findFirst.mockResolvedValue(teamA);
    prisma.tournamentTeam.update.mockResolvedValue({
      ...teamA,
      color: '#ff00aa',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { color: '#ff00aa' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).color).toBe('#ff00aa');
    expect(prisma.tournamentTeam.update).toHaveBeenCalledWith({
      where: { id: teamA.id },
      data: { color: '#ff00aa' },
    });
  });

  it('200 Admin: Color = null setzt die Farbe zurück', async () => {
    prisma.tournamentTeam.findFirst.mockResolvedValue(teamA);
    prisma.tournamentTeam.update.mockResolvedValue({ ...teamA, color: null });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { color: null },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).color).toBeNull();
  });

  it('200 globaler Admin darf auch patchen', async () => {
    prisma.tournamentTeam.findFirst.mockResolvedValueOnce(teamA).mockResolvedValueOnce(null);
    prisma.tournamentTeam.update.mockResolvedValue({
      ...teamA,
      name: 'Global-Team',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.global.id },
      payload: { name: 'Global-Team' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('200 Name + Color zusammen', async () => {
    prisma.tournamentTeam.findFirst.mockResolvedValueOnce(teamA).mockResolvedValueOnce(null);
    prisma.tournamentTeam.update.mockResolvedValue({
      ...teamA,
      name: 'Rakija Boys',
      color: '#8B6B4A',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Rakija Boys', color: '#8B6B4A' },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.tournamentTeam.update).toHaveBeenCalledWith({
      where: { id: teamA.id },
      data: { name: 'Rakija Boys', color: '#8B6B4A' },
    });
  });

  it('409 wenn gleichnamiges Team bereits existiert', async () => {
    prisma.tournamentTeam.findFirst
      .mockResolvedValueOnce(teamA) // 1. Call: Team finden
      .mockResolvedValueOnce(teamB); // 2. Call: Duplikat-Suche → Treffer

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Team 2' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'team_name_taken' });
    expect(prisma.tournamentTeam.update).not.toHaveBeenCalled();
  });

  it('200 Self-Rename (Team-A zu eigenem Namen) ist erlaubt', async () => {
    prisma.tournamentTeam.findFirst.mockResolvedValueOnce(teamA).mockResolvedValueOnce(null); // Duplikat-Suche: id ist not teamA → null
    prisma.tournamentTeam.update.mockResolvedValue({
      ...teamA,
      name: 'Team 1',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: 'Team 1' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('200 Whitespace im name wird getrimmt', async () => {
    prisma.tournamentTeam.findFirst.mockResolvedValueOnce(teamA).mockResolvedValueOnce(null);
    prisma.tournamentTeam.update.mockResolvedValue({
      ...teamA,
      name: 'Rakija Boys',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tournaments/${tId}/teams/${teamA.id}`,
      headers: { 'x-test-user': u.admin.id },
      payload: { name: '  Rakija Boys  ' },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.tournamentTeam.update).toHaveBeenCalledWith({
      where: { id: teamA.id },
      data: { name: 'Rakija Boys' },
    });
  });
});
