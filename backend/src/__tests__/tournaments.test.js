import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockPrismaClient,
  createMockReply,
  createMockRequest,
  createMockRouteFastify,
} from './mocks/index.js';

vi.mock('../utils/notifications.js', () => ({
  createNotification: vi.fn(() => Promise.resolve()),
}));

describe('tournaments routes', () => {
  let tournamentsRoutes;
  let fastify;
  let prisma;

  async function callRoute(method, path, requestOverrides = {}) {
    const handler = fastify.routes[method].get(path);
    const request = createMockRequest({
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      ...requestOverrides,
    });
    const reply = createMockReply();
    const result = await handler(request, reply);
    return { request, reply, result };
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    tournamentsRoutes = (await import('../routes/tournaments.js')).default;
    prisma = createMockPrismaClient();
    fastify = createMockRouteFastify({ prisma });
    await tournamentsRoutes(fastify);
  });

  it('denies preset creation without group management rights', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'user' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'someone-else' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    const { reply } = await callRoute('POST', '/presets', {
      user: { id: 'user-1' },
      body: {
        groupId: 'group-1',
        name: 'Sommer KO',
        baseType: 'single_elimination',
      },
    });

    expect(reply.statusCode).toBe(403);
    expect(reply.payload.error).toContain('Keine Berechtigung');
  });

  it('creates preset for group deputy with ordered stages', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'user' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue({ groupId: 'group-1', userId: 'deputy-1' });
    prisma.tournamentPreset.create.mockResolvedValue({
      id: 'preset-1',
      groupId: 'group-1',
      name: 'Liga + KO',
      baseType: 'group_plus_knockout',
      participantMode: 'team',
      minParticipants: 4,
      maxParticipants: 32,
      defaultMatchBestOf: 1,
      stages: [
        { stageOrder: 1, name: 'Gruppenphase', stageType: 'round_robin' },
        { stageOrder: 2, name: 'Finalrunde', stageType: 'single_elimination' },
      ],
    });

    const { reply, result } = await callRoute('POST', '/presets', {
      user: { id: 'deputy-1' },
      body: {
        groupId: 'group-1',
        name: 'Liga + KO',
        baseType: 'group_plus_knockout',
        stages: [
          { stageOrder: 2, name: 'Finalrunde', stageType: 'single_elimination' },
          { stageOrder: 1, name: 'Gruppenphase', stageType: 'round_robin' },
        ],
      },
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(201);
    expect(payload.preset.id).toBe('preset-1');
    expect(prisma.tournamentPreset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          groupId: 'group-1',
          name: 'Liga + KO',
          createdBy: 'deputy-1',
          stages: expect.objectContaining({
            create: [
              expect.objectContaining({ stageOrder: 1 }),
              expect.objectContaining({ stageOrder: 2 }),
            ],
          }),
        }),
      })
    );
  });

  it('creates tournament instance from preset stages', async () => {
    prisma.tournamentPreset.findUnique.mockResolvedValue({
      id: 'preset-1',
      groupId: 'group-1',
      name: 'KO 16',
      baseType: 'single_elimination',
      participantMode: 'team',
      minParticipants: 2,
      maxParticipants: 16,
      defaultMatchBestOf: 1,
      config: { thirdPlaceMatch: false },
      isArchived: false,
      stages: [
        { stageOrder: 1, name: 'Achtelfinale', stageType: 'single_elimination' },
        { stageOrder: 2, name: 'Viertelfinale', stageType: 'single_elimination' },
      ],
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);
    prisma.tournamentInstance.create.mockResolvedValue({
      id: 'instance-1',
      name: 'Sommer Cup 2026',
      groupId: 'group-1',
      status: 'draft',
      rounds: [
        { roundNumber: 1, name: 'Achtelfinale', stageKey: 'single_elimination', status: 'planned' },
        { roundNumber: 2, name: 'Viertelfinale', stageKey: 'single_elimination', status: 'planned' },
      ],
      preset: { id: 'preset-1', name: 'KO 16', baseType: 'single_elimination', participantMode: 'team' },
    });

    const { reply, result } = await callRoute('POST', '/instances', {
      user: { id: 'admin-1' },
      body: {
        presetId: 'preset-1',
        name: 'Sommer Cup 2026',
      },
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(201);
    expect(payload.instance.rounds).toHaveLength(2);
    expect(prisma.tournamentInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          presetId: 'preset-1',
          groupId: 'group-1',
          rounds: expect.objectContaining({ create: expect.any(Array) }),
        }),
      })
    );
  });

  it('deletes a tournament instance for group managers', async () => {
    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'draft',
      name: 'Cup',
    });
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    const { reply, result } = await callRoute('DELETE', '/instances/:id', {
      user: { id: 'admin-1' },
      params: { id: 'inst-1' },
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(200);
    expect(payload.ok).toBe(true);
    expect(prisma.tournamentInstance.delete).toHaveBeenCalledWith({ where: { id: 'inst-1' } });
  });

  it('records match results and recomputes standings stats', async () => {
    prisma.tournamentInstance.findUnique
      .mockResolvedValueOnce({ id: 'inst-1', groupId: 'group-1', status: 'in_progress', name: 'Cup' })
      .mockResolvedValueOnce({
        id: 'inst-1',
        preset: { minParticipants: 2, maxParticipants: 16, participantMode: 'team' },
      });
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentMatch.findUnique
      .mockResolvedValueOnce({
        id: 'match-1',
        instanceId: 'inst-1',
        homeParticipantId: 'p1',
        awayParticipantId: 'p2',
        status: 'in_progress',
      })
      .mockResolvedValueOnce({
        id: 'match-1',
        status: 'completed',
        results: [
          { participantId: 'p1', score: 10, outcome: 'win' },
          { participantId: 'p2', score: 7, outcome: 'loss' },
        ],
      });

    prisma.tournamentParticipant.findMany
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
      .mockResolvedValueOnce([
        { id: 'p1', points: 10, wins: 1, losses: 0, draws: 0 },
        { id: 'p2', points: 7, wins: 0, losses: 1, draws: 0 },
      ]);

    prisma.tournamentMatch.findMany.mockResolvedValue([
      {
        id: 'match-1',
        status: 'completed',
        results: [
          { participantId: 'p1', score: 10, outcome: 'win' },
          { participantId: 'p2', score: 7, outcome: 'loss' },
        ],
      },
    ]);

    const { reply, result } = await callRoute('PATCH', '/instances/:id/matches/:matchId/result', {
      user: { id: 'admin-1' },
      params: { id: 'inst-1', matchId: 'match-1' },
      body: {
        winnerParticipantId: 'p1',
        results: [
          { participantId: 'p1', score: 10, outcome: 'win' },
          { participantId: 'p2', score: 7, outcome: 'loss' },
        ],
      },
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(200);
    expect(payload.match.status).toBe('completed');
    expect(prisma.tournamentMatchResult.deleteMany).toHaveBeenCalledWith({ where: { matchId: 'match-1' } });
    expect(prisma.tournamentParticipant.update).toHaveBeenCalled();
  });
});
