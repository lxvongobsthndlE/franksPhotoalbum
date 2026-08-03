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
        {
          roundNumber: 2,
          name: 'Viertelfinale',
          stageKey: 'single_elimination',
          status: 'planned',
        },
      ],
      preset: {
        id: 'preset-1',
        name: 'KO 16',
        baseType: 'single_elimination',
        participantMode: 'team',
      },
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

  it('records match results and recomputes standings stats (individual mode)', async () => {
    // 1. getInstanceWithManageRights → mode-aware stat-detection → recomputeStats (individual)
    // 2. transaction-mode-detection → re-fetch für response
    prisma.tournamentInstance.findUnique.mockImplementation(async ({ select }) => {
      // Bei select.preset.participantMode → individual
      if (select && select.preset) {
        return { id: 'inst-1', preset: { participantMode: 'individual' } };
      }
      // Default: getInstanceWithManageRights und re-fetch für Response
      return { id: 'inst-1', groupId: 'group-1', status: 'in_progress', name: 'Cup' };
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

    prisma.tournamentParticipant.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

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
    expect(prisma.tournamentMatchResult.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
    });
    expect(prisma.tournamentParticipant.update).toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Ghost-Teilnehmer (kein userId, nur displayName + teamId)
  // ──────────────────────────────────────────────────────────────────────

  it('creates ghost participant in team mode without userId', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'draft',
      name: 'Cup',
      preset: { minParticipants: 2, maxParticipants: 16, participantMode: 'team' },
    });
    prisma.tournamentParticipant.count.mockResolvedValue(0);
    prisma.tournamentTeam.findUnique.mockResolvedValue({
      id: 'team-1',
      instanceId: 'inst-1',
      name: 'Team Nord',
    });
    prisma.tournamentParticipant.create.mockResolvedValue({
      id: 'p-1',
      instanceId: 'inst-1',
      userId: null,
      displayName: 'Team Nord',
      teamId: 'team-1',
      seed: 1,
      status: 'registered',
    });

    const { reply, result } = await callRoute('POST', '/instances/:id/participants', {
      user: { id: 'admin-1' },
      params: { id: 'inst-1' },
      body: {
        teamId: 'team-1',
        displayName: 'Team Nord',
        seed: 1,
      },
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(201);
    expect(payload.participant.userId).toBeNull();
    expect(payload.participant.displayName).toBe('Team Nord');
    expect(prisma.tournamentParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          displayName: 'Team Nord',
          teamId: 'team-1',
          assignedAt: null,
        }),
      })
    );
  });

  it('rejects ghost participant in individual mode', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'draft',
      name: 'Cup',
      preset: { minParticipants: 2, maxParticipants: 16, participantMode: 'individual' },
    });

    const { reply, result } = await callRoute('POST', '/instances/:id/participants', {
      user: { id: 'admin-1' },
      params: { id: 'inst-1' },
      body: { displayName: 'Niemand' },
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(400);
    expect(payload.error).toMatch(/individual-Modus/i);
  });

  it('rejects participant without userId AND displayName', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'draft',
      name: 'Cup',
      preset: { minParticipants: 2, maxParticipants: 16, participantMode: 'team' },
    });
    prisma.tournamentTeam.findUnique.mockResolvedValue({
      id: 'team-1',
      instanceId: 'inst-1',
      name: 'Team A',
    });

    const { reply, result } = await callRoute('POST', '/instances/:id/participants', {
      user: { id: 'admin-1' },
      params: { id: 'inst-1' },
      body: { teamId: 'team-1' },
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(400);
    expect(payload.error).toMatch(/userId oder displayName/i);
  });

  // ──────────────────────────────────────────────────────────────────────
  // PATCH /participants/:id (assign / unassign / update)
  // ──────────────────────────────────────────────────────────────────────

  it('assigns user to ghost participant via PATCH', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ id: 'user-1', name: 'Frank', username: 'frank', email: 'f@x' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'draft',
      name: 'Cup',
    });
    prisma.tournamentParticipant.findUnique.mockResolvedValue({
      id: 'p-1',
      instanceId: 'inst-1',
      userId: null,
      displayName: 'Team Nord',
      team: { id: 'team-1', name: 'Team Nord' },
    });
    prisma.tournamentParticipant.update.mockResolvedValue({
      id: 'p-1',
      userId: 'user-1',
      displayName: 'Frank',
    });

    const { reply, result } = await callRoute(
      'PATCH',
      '/instances/:id/participants/:participantId',
      {
        user: { id: 'admin-1' },
        params: { id: 'inst-1', participantId: 'p-1' },
        body: { op: 'assign_user', userId: 'user-1' },
      }
    );

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(200);
    expect(payload.participant.userId).toBe('user-1');
    expect(payload.participant.displayName).toBe('Frank');
    expect(prisma.tournamentParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-1' },
        data: expect.objectContaining({
          userId: 'user-1',
          displayName: 'Frank',
          assignedAt: expect.any(Date),
        }),
      })
    );
  });

  it('unassigns user from participant via PATCH', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'in_progress',
      name: 'Cup',
    });
    prisma.tournamentParticipant.findUnique.mockResolvedValue({
      id: 'p-1',
      instanceId: 'inst-1',
      userId: 'user-1',
      displayName: 'Frank',
      team: { id: 'team-1', name: 'Team Nord' },
    });
    prisma.tournamentParticipant.update.mockResolvedValue({
      id: 'p-1',
      userId: null,
      displayName: 'Team Nord',
    });

    const { reply, result } = await callRoute(
      'PATCH',
      '/instances/:id/participants/:participantId',
      {
        user: { id: 'admin-1' },
        params: { id: 'inst-1', participantId: 'p-1' },
        body: { op: 'unassign_user' },
      }
    );

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(200);
    expect(payload.participant.userId).toBeNull();
    // displayName sollte auf Team-Name zurueckgesetzt sein
    expect(prisma.tournamentParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          assignedAt: null,
          displayName: 'Team Nord',
        }),
      })
    );
  });

  it('rejects unassign when no user is assigned', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'in_progress',
      name: 'Cup',
    });
    prisma.tournamentParticipant.findUnique.mockResolvedValue({
      id: 'p-1',
      instanceId: 'inst-1',
      userId: null,
      displayName: 'Team Nord',
      team: { id: 'team-1', name: 'Team Nord' },
    });

    const { reply, result } = await callRoute(
      'PATCH',
      '/instances/:id/participants/:participantId',
      {
        user: { id: 'admin-1' },
        params: { id: 'inst-1', participantId: 'p-1' },
        body: { op: 'unassign_user' },
      }
    );

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(400);
    expect(payload.error).toMatch(/keinen zugeordneten User/);
  });

  it('rejects unknown op for PATCH /participants', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'in_progress',
      name: 'Cup',
    });
    prisma.tournamentParticipant.findUnique.mockResolvedValue({
      id: 'p-1',
      instanceId: 'inst-1',
      userId: 'user-1',
      displayName: 'Frank',
    });

    const { reply, result } = await callRoute(
      'PATCH',
      '/instances/:id/participants/:participantId',
      {
        user: { id: 'admin-1' },
        params: { id: 'inst-1', participantId: 'p-1' },
        body: { op: 'frobnicate' },
      }
    );

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(400);
    expect(payload.error).toMatch(/Ungueltige op/);
  });

  // ──────────────────────────────────────────────────────────────────────
  // POST /instances/:id/bracket/generate
  // ──────────────────────────────────────────────────────────────────────

  it('generates single-elim bracket for 4 participants (individual mode)', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    // Bracket-Generator schreibt 2 Rounds + 3 Matches in die DB
    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'draft',
      name: 'Cup',
      preset: {
        id: 'preset-1',
        minParticipants: 2,
        maxParticipants: 16,
        participantMode: 'individual',
        stages: [
          {
            id: 'stage-1',
            stageOrder: 1,
            name: 'Hauptrunde',
            stageType: 'single_elimination',
            config: null,
          },
        ],
      },
      teams: [],
      participants: [
        { id: 'p1', seed: 1, displayName: 'A', teamId: 't1' },
        { id: 'p2', seed: 2, displayName: 'B', teamId: 't2' },
        { id: 'p3', seed: 3, displayName: 'C', teamId: 't3' },
        { id: 'p4', seed: 4, displayName: 'D', teamId: 't4' },
      ],
    });

    // Keine bestehenden Matches oder Rounds
    prisma.tournamentMatch.findMany.mockResolvedValue([]);
    prisma.tournamentRound.findMany.mockResolvedValue([]);

    // Transaction-Inserts simulieren (jeder .create-Aufruf gibt eine Row zurueck)
    let matchCounter = 0;
    prisma.tournamentMatch.create.mockImplementation(({ data }) => {
      matchCounter += 1;
      return Promise.resolve({ id: `match-${matchCounter}`, ...data });
    });
    let roundCounter = 0;
    prisma.tournamentRound.create.mockImplementation(({ data }) => {
      roundCounter += 1;
      return Promise.resolve({ id: `round-${roundCounter}`, ...data });
    });
    prisma.tournamentMatch.update.mockResolvedValue({});

    const { reply, result } = await callRoute('POST', '/instances/:id/bracket/generate', {
      user: { id: 'admin-1' },
      params: { id: 'inst-1' },
      body: {},
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.generated.stageType).toBe('single_elimination');
    expect(payload.generated.matches).toBe(3);
    expect(prisma.tournamentRound.create).toHaveBeenCalledTimes(2);
    expect(prisma.tournamentMatch.create).toHaveBeenCalledTimes(3);
  });

  it('rejects bracket generation with less than 2 participants (individual mode)', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockResolvedValue({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'draft',
      name: 'Cup',
      preset: {
        id: 'preset-1',
        minParticipants: 2,
        maxParticipants: 16,
        participantMode: 'individual',
        stages: [
          {
            id: 'stage-1',
            stageOrder: 1,
            name: 'Hauptrunde',
            stageType: 'single_elimination',
            config: null,
          },
        ],
      },
      teams: [],
      participants: [{ id: 'p1', seed: 1, displayName: 'A' }],
    });

    const { reply, result } = await callRoute('POST', '/instances/:id/bracket/generate', {
      user: { id: 'admin-1' },
      params: { id: 'inst-1' },
      body: {},
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(400);
    expect(payload.error).toMatch(/Entities/);
  });

  it('rejects group_plus_knockout with wrong team count', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockImplementation(async () => ({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'draft',
      name: 'Cup',
      preset: {
        id: 'preset-1',
        // minParticipants kleiner als 8, damit der Group-Count-Check zuerst feuert
        minParticipants: 2,
        maxParticipants: 16,
        participantMode: 'team',
        config: { groupPhase: { groupCount: 2, teamsPerGroup: 4 } },
        stages: [
          {
            id: 'stage-1',
            stageOrder: 1,
            name: 'Gruppen + KO',
            stageType: 'group_plus_knockout',
            config: null,
          },
        ],
      },
      teams: [
        { id: 't1', seed: 1, name: 'A' },
        { id: 't2', seed: 2, name: 'B' },
      ],
      participants: [],
    }));

    const { reply, result } = await callRoute('POST', '/instances/:id/bracket/generate', {
      user: { id: 'admin-1' },
      params: { id: 'inst-1' },
      body: {},
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(400);
    // 2 Groups × 4 Teams = 8 erwartet, aber nur 2 vorhanden
    expect(payload.error).toMatch(/Group\+Knockout braucht 8 Teams/);
  });

  it('generates group_plus_knockout phase (group phase matches)', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockImplementation(async () => ({
      id: 'inst-1',
      groupId: 'group-1',
      status: 'draft',
      name: 'Cup',
      preset: {
        id: 'preset-1',
        minParticipants: 8,
        maxParticipants: 16,
        participantMode: 'team',
        config: { groupPhase: { groupCount: 2, teamsPerGroup: 4 } },
        stages: [
          {
            id: 'stage-1',
            stageOrder: 1,
            name: 'Gruppen + KO',
            stageType: 'group_plus_knockout',
            config: null,
          },
        ],
      },
      teams: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `t${n}`, seed: n, name: `Team ${n}` })),
      participants: [],
    }));

    prisma.tournamentMatch.findMany.mockResolvedValue([]);
    prisma.tournamentRound.findMany.mockResolvedValue([]);
    prisma.tournamentMatch.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `m-${Math.random()}`, ...data })
    );
    prisma.tournamentRound.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `r-${Math.random()}`, ...data })
    );
    prisma.tournamentMatch.update.mockResolvedValue({});

    const { reply, result } = await callRoute('POST', '/instances/:id/bracket/generate', {
      user: { id: 'admin-1' },
      params: { id: 'inst-1' },
      body: {},
    });

    const payload = reply.payload ?? result?.payload ?? result;
    expect(reply.statusCode).toBe(201);
    expect(payload.generated.stageType).toBe('group_phase');
    // 2 Gruppen × 4 Teams, Round-Robin → 6 Matches pro Gruppe = 12 total
    expect(payload.generated.matches).toBe(12);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Auto-Advance im Result-Endpoint
  // ──────────────────────────────────────────────────────────────────────

  it('auto-advances winner into next match slot after recording result (individual mode)', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.findUnique.mockResolvedValue({ createdBy: 'owner-1' });
    prisma.groupDeputy.findUnique.mockResolvedValue(null);

    prisma.tournamentInstance.findUnique.mockImplementation(async ({ select } = {}) => {
      // getInstanceWithManageRights oder Mode-Detection
      if (select && select.preset) {
        return { id: 'inst-1', preset: { participantMode: 'individual' } };
      }
      return { id: 'inst-1', groupId: 'group-1', status: 'in_progress', name: 'Cup' };
    });
    prisma.tournamentMatch.findUnique
      // Erstes Lookup: aktuelles Match inkl. nextWinnerMatchId
      .mockResolvedValueOnce({
        id: 'match-1',
        instanceId: 'inst-1',
        homeParticipantId: 'p1',
        awayParticipantId: 'p2',
        status: 'in_progress',
        nextWinnerMatchId: 'match-2',
        nextWinnerSlot: 'home',
      })
      // Zweites Lookup: aktualisiertes Match für die Response
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
    // Auto-Advance muss Folge-Match aktualisiert haben
    expect(prisma.tournamentMatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'match-2' },
        data: { homeParticipantId: 'p1' },
      })
    );
  });
});
