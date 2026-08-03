import { createNotification } from '../utils/notifications.js';
import {
  computeNextAdvancesForResult,
  flattenMatchesForDb,
  generateBracket,
} from '../utils/tournament-bracket.js';

const VALID_PRESET_TYPES = new Set([
  'single_elimination',
  'double_elimination',
  'round_robin',
  'group_plus_knockout',
  'custom',
]);

const VALID_STAGE_TYPES = new Set(['single_elimination', 'double_elimination', 'round_robin']);

const PRESET_STAGE_SIGNATURES = {
  single_elimination: ['single_elimination'],
  double_elimination: ['double_elimination', 'single_elimination'],
  round_robin: ['round_robin'],
  group_plus_knockout: ['round_robin', 'single_elimination'],
};

const VALID_INSTANCE_STATUS = new Set([
  'draft',
  'registration',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
]);

const VALID_PARTICIPANT_STATUS = new Set([
  'registered',
  'checked_in',
  'active',
  'eliminated',
  'withdrawn',
]);

const VALID_MATCH_STATUS = new Set(['planned', 'in_progress', 'completed', 'void']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toSafeJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return null;
  return value;
}

function parsePositiveInt(value) {
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function normalizeStageType(stageType) {
  return VALID_STAGE_TYPES.has(stageType) ? stageType : 'single_elimination';
}

function inferPresetBaseType(stageTypes) {
  if (!Array.isArray(stageTypes) || stageTypes.length === 0) return 'custom';
  if (stageTypes.some((stageType) => !VALID_STAGE_TYPES.has(stageType))) return 'custom';

  for (const [baseType, signature] of Object.entries(PRESET_STAGE_SIGNATURES)) {
    if (stageTypes.length !== signature.length) continue;
    if (signature.every((stageType, index) => stageTypes[index] === stageType)) {
      return baseType;
    }
  }

  return 'custom';
}

function canManageByRole(role) {
  return role === 'admin';
}

export default async function tournamentsRoutes(fastify) {
  async function requireAuth(request, reply) {
    try {
      await request.jwtVerify();
      return true;
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
      return false;
    }
  }

  async function getUserRole(userId) {
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role || null;
  }

  async function hasGroupAccess(groupId, userId) {
    const [membership, role] = await Promise.all([
      fastify.prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      }),
      getUserRole(userId),
    ]);
    return !!membership || role === 'admin';
  }

  async function hasGroupManageRights(groupId, userId) {
    const [group, deputy, role] = await Promise.all([
      fastify.prisma.group.findUnique({
        where: { id: groupId },
        select: { createdBy: true },
      }),
      fastify.prisma.groupDeputy.findUnique({
        where: { groupId_userId: { groupId, userId } },
      }),
      getUserRole(userId),
    ]);

    if (!group) return { ok: false, code: 404, error: 'Gruppe nicht gefunden' };

    const isOwner = group.createdBy === userId;
    const isDeputy = !!deputy;
    const isAdmin = canManageByRole(role);
    if (!isOwner && !isDeputy && !isAdmin) {
      return { ok: false, code: 403, error: 'Keine Berechtigung fuer diese Gruppe' };
    }

    return { ok: true, group, isOwner, isDeputy, isAdmin };
  }

  async function getInstanceWithAccess(instanceId, userId) {
    const instance = await fastify.prisma.tournamentInstance.findUnique({
      where: { id: instanceId },
      include: {
        preset: {
          select: {
            id: true,
            groupId: true,
            name: true,
            baseType: true,
            participantMode: true,
            defaultMatchBestOf: true,
          },
        },
      },
    });

    if (!instance) {
      return { ok: false, code: 404, error: 'Turnier-Instanz nicht gefunden' };
    }

    const access = await hasGroupAccess(instance.groupId, userId);
    if (!access) {
      return { ok: false, code: 403, error: 'Kein Zugriff auf diese Turnier-Instanz' };
    }

    return { ok: true, instance };
  }

  async function getInstanceWithManageRights(instanceId, userId) {
    const instance = await fastify.prisma.tournamentInstance.findUnique({
      where: { id: instanceId },
      select: { id: true, groupId: true, status: true, name: true },
    });

    if (!instance) {
      return { ok: false, code: 404, error: 'Turnier-Instanz nicht gefunden' };
    }

    const rights = await hasGroupManageRights(instance.groupId, userId);
    if (!rights.ok) {
      return rights;
    }

    return { ok: true, instance, rights };
  }

  /**
   * Recomputed die Stats für die spielende Entity je nach participantMode:
   *  - 'individual' → TournamentParticipant.stats
   *  - 'team' | 'pair' → TournamentTeam.stats
   *
   * Liest alle completed Matches + ihre Result-Rows, akkumuliert Punkte/W/L/D
   * und schreibt per $transaction in einem Schwung zurück.
   */
  async function recomputeStats(instanceId, mode = 'team') {
    const isTeamMode = mode === 'team' || mode === 'pair';

    const matches = await fastify.prisma.tournamentMatch.findMany({
      where: { instanceId, status: 'completed' },
      include: {
        results: {
          select: { participantId: true, teamId: true, score: true, outcome: true },
        },
      },
    });

    if (isTeamMode) {
      const teams = await fastify.prisma.tournamentTeam.findMany({
        where: { instanceId },
        select: { id: true },
      });
      if (teams.length === 0) return;

      const stats = new Map();
      for (const team of teams) {
        stats.set(team.id, { points: 0, wins: 0, losses: 0, draws: 0 });
      }
      for (const match of matches) {
        for (const result of match.results) {
          const tid = result.teamId;
          if (!tid) continue;
          const current = stats.get(tid);
          if (!current) continue;
          current.points += Number(result.score || 0);
          if (result.outcome === 'win') current.wins += 1;
          if (result.outcome === 'loss') current.losses += 1;
          if (result.outcome === 'draw') current.draws += 1;
        }
      }
      await fastify.prisma.$transaction(
        Array.from(stats.entries()).map(([teamId, value]) =>
          fastify.prisma.tournamentTeam.update({
            where: { id: teamId },
            data: {
              points: value.points,
              wins: value.wins,
              losses: value.losses,
              draws: value.draws,
            },
          })
        )
      );
    } else {
      // individual-Mode
      const participants = await fastify.prisma.tournamentParticipant.findMany({
        where: { instanceId },
        select: { id: true },
      });
      if (participants.length === 0) return;

      const stats = new Map();
      for (const p of participants) {
        stats.set(p.id, { points: 0, wins: 0, losses: 0, draws: 0 });
      }
      for (const match of matches) {
        for (const result of match.results) {
          const pid = result.participantId;
          if (!pid) continue;
          const current = stats.get(pid);
          if (!current) continue;
          current.points += Number(result.score || 0);
          if (result.outcome === 'win') current.wins += 1;
          if (result.outcome === 'loss') current.losses += 1;
          if (result.outcome === 'draw') current.draws += 1;
        }
      }
      await fastify.prisma.$transaction(
        Array.from(stats.entries()).map(([participantId, value]) =>
          fastify.prisma.tournamentParticipant.update({
            where: { id: participantId },
            data: {
              points: value.points,
              wins: value.wins,
              losses: value.losses,
              draws: value.draws,
            },
          })
        )
      );
    }
  }

  // Alias für Rückwärtskompatibilität
  async function recomputeParticipantStats(instanceId) {
    return recomputeStats(instanceId, 'team');
  }

  // GET /api/tournaments/presets?groupId=
  fastify.get('/presets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const groupId = String(request.query?.groupId || '').trim();
      if (!groupId) return reply.code(400).send({ error: 'groupId erforderlich' });

      if (!(await hasGroupAccess(groupId, request.user.id))) {
        return reply.code(403).send({ error: 'Kein Zugriff auf diese Gruppe' });
      }

      const presets = await fastify.prisma.tournamentPreset.findMany({
        where: { groupId, isArchived: false },
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              username: true,
              avatar: true,
              color: true,
              displayNameField: true,
              role: true,
            },
          },
          stages: {
            orderBy: { stageOrder: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      return { presets };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Turnier-Presets konnten nicht geladen werden' });
    }
  });

  // POST /api/tournaments/presets
  fastify.post('/presets', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const body = request.body || {};
      const groupId = String(body.groupId || '').trim();
      const name = String(body.name || '').trim();
      const baseType = String(body.baseType || '').trim();
      const participantMode = String(body.participantMode || 'team').trim();
      const minParticipants = body.minParticipants ?? 2;
      const maxParticipants = body.maxParticipants ?? 128;
      const defaultMatchBestOf = body.defaultMatchBestOf ?? 1;
      const description = isNonEmptyString(body.description) ? body.description.trim() : null;
      const config = toSafeJson(body.config);
      const stageList = Array.isArray(body.stages) ? body.stages : [];
      const normalizedStages = stageList.map((item, index) => ({
        stageOrder: Number.isInteger(item?.stageOrder) ? item.stageOrder : index + 1,
        name: isNonEmptyString(item?.name) ? item.name.trim() : `Stage ${index + 1}`,
        stageType: normalizeStageType(item?.stageType),
        config: toSafeJson(item?.config),
      }));
      const stageTypes = normalizedStages
        .slice()
        .sort((a, b) => a.stageOrder - b.stageOrder)
        .map((item) => item.stageType);
      const resolvedBaseType = inferPresetBaseType(stageTypes);

      if (!groupId) return reply.code(400).send({ error: 'groupId erforderlich' });
      if (!name) return reply.code(400).send({ error: 'name erforderlich' });
      if (!VALID_PRESET_TYPES.has(baseType)) {
        return reply.code(400).send({ error: 'Ungueltiger baseType' });
      }
      if (!['individual', 'team', 'pair'].includes(participantMode)) {
        return reply.code(400).send({ error: 'Ungueltiger participantMode' });
      }

      const min = parsePositiveInt(minParticipants);
      const max = parsePositiveInt(maxParticipants);
      const bestOf = parsePositiveInt(defaultMatchBestOf);
      if (!min || !max || !bestOf || min > max) {
        return reply.code(400).send({ error: 'ungueltige Teilnehmer-/BestOf-Werte' });
      }

      const rights = await hasGroupManageRights(groupId, request.user.id);
      if (!rights.ok) return reply.code(rights.code).send({ error: rights.error });

      const preset = await fastify.prisma.tournamentPreset.create({
        data: {
          groupId,
          name,
          description,
          baseType: baseType === 'custom' ? 'custom' : resolvedBaseType,
          participantMode,
          minParticipants: min,
          maxParticipants: max,
          defaultMatchBestOf: bestOf,
          config,
          createdBy: request.user.id,
          stages: {
            create: normalizedStages
              .sort((a, b) => a.stageOrder - b.stageOrder),
          },
        },
        include: {
          stages: {
            orderBy: { stageOrder: 'asc' },
          },
        },
      });

      createNotification(fastify.prisma, {
        userId: request.user.id,
        type: 'system',
        title: 'Turnier-Preset erstellt',
        body: `Preset \"${preset.name}\" wurde erstellt.`,
        entityId: preset.id,
        entityType: 'tournament',
      }).catch(() => {});

      return reply.code(201).send({ preset });
    } catch (err) {
      fastify.log.error(err);
      if (err?.code === 'P2002') {
        return reply.code(409).send({ error: 'Preset-Name existiert bereits in der Gruppe' });
      }
      return reply.code(500).send({ error: 'Turnier-Preset konnte nicht erstellt werden' });
    }
  });

  // PATCH /api/tournaments/presets/:id
  fastify.patch('/presets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const presetId = String(request.params?.id || '').trim();
      if (!presetId) return reply.code(400).send({ error: 'id erforderlich' });
      const body = request.body || {};

      const existing = await fastify.prisma.tournamentPreset.findUnique({
        where: { id: presetId },
        select: {
          id: true,
          groupId: true,
          stages: {
            select: { stageType: true },
            orderBy: { stageOrder: 'asc' },
          },
        },
      });
      if (!existing) return reply.code(404).send({ error: 'Preset nicht gefunden' });

      const rights = await hasGroupManageRights(existing.groupId, request.user.id);
      if (!rights.ok) return reply.code(rights.code).send({ error: rights.error });

      const data = {};
      if (isNonEmptyString(body.name)) data.name = body.name.trim();
      if (body.description === null) data.description = null;
      if (isNonEmptyString(body.description)) data.description = body.description.trim();
      if (body.baseType !== undefined) {
        if (!VALID_PRESET_TYPES.has(body.baseType)) {
          return reply.code(400).send({ error: 'Ungueltiger baseType' });
        }
        const stageTypes = Array.isArray(existing.stages)
          ? existing.stages.map((stage) => stage.stageType)
          : [];
        data.baseType = body.baseType === 'custom' ? 'custom' : inferPresetBaseType(stageTypes);
      }
      if (body.participantMode !== undefined) {
        if (!['individual', 'team', 'pair'].includes(body.participantMode)) {
          return reply.code(400).send({ error: 'Ungueltiger participantMode' });
        }
        data.participantMode = body.participantMode;
      }
      if (body.minParticipants !== undefined) {
        const min = parsePositiveInt(body.minParticipants);
        if (!min) return reply.code(400).send({ error: 'minParticipants ungueltig' });
        data.minParticipants = min;
      }
      if (body.maxParticipants !== undefined) {
        const max = parsePositiveInt(body.maxParticipants);
        if (!max) return reply.code(400).send({ error: 'maxParticipants ungueltig' });
        data.maxParticipants = max;
      }
      if (body.defaultMatchBestOf !== undefined) {
        const bestOf = parsePositiveInt(body.defaultMatchBestOf);
        if (!bestOf) return reply.code(400).send({ error: 'defaultMatchBestOf ungueltig' });
        data.defaultMatchBestOf = bestOf;
      }
      if (body.config !== undefined) data.config = toSafeJson(body.config);

      if (body.stages !== undefined) {
        if (!Array.isArray(body.stages)) {
          return reply.code(400).send({ error: 'stages muss ein Array sein' });
        }
        const stageList = body.stages;
        if (stageList.some((item) => item?.stageType !== undefined && !VALID_STAGE_TYPES.has(item.stageType))) {
          return reply.code(400).send({ error: 'Ungueltiger stageType' });
        }
        const normalizedStages = stageList.map((item, index) => ({
          stageOrder: Number.isInteger(item?.stageOrder) ? item.stageOrder : index + 1,
          name: isNonEmptyString(item?.name) ? item.name.trim() : `Stage ${index + 1}`,
          stageType: normalizeStageType(item?.stageType),
          config: toSafeJson(item?.config),
        }));
        const stageTypes = normalizedStages
          .slice()
          .sort((a, b) => a.stageOrder - b.stageOrder)
          .map((item) => item.stageType);
        data.baseType = body.baseType === 'custom' ? 'custom' : inferPresetBaseType(stageTypes);
        data.stages = {
          deleteMany: {},
          create: normalizedStages.sort((a, b) => a.stageOrder - b.stageOrder),
        };
      }

      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'Keine gueltigen Felder fuer Update' });
      }
      if (
        data.minParticipants !== undefined &&
        data.maxParticipants !== undefined &&
        data.minParticipants > data.maxParticipants
      ) {
        return reply.code(400).send({ error: 'minParticipants darf maxParticipants nicht uebersteigen' });
      }

      const preset = await fastify.prisma.$transaction(async (tx) => {
        const updated = await tx.tournamentPreset.update({
          where: { id: presetId },
          data,
        });
        return updated;
      });
      return { preset };
    } catch (err) {
      fastify.log.error(err);
      if (err?.code === 'P2002') {
        return reply.code(409).send({ error: 'Preset-Name existiert bereits in der Gruppe' });
      }
      return reply.code(500).send({ error: 'Preset konnte nicht aktualisiert werden' });
    }
  });

  // DELETE /api/tournaments/presets/:id
  fastify.delete('/presets/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const presetId = String(request.params?.id || '').trim();
      if (!presetId) return reply.code(400).send({ error: 'id erforderlich' });

      const existing = await fastify.prisma.tournamentPreset.findUnique({
        where: { id: presetId },
        select: { id: true, groupId: true },
      });
      if (!existing) return reply.code(404).send({ error: 'Preset nicht gefunden' });

      const rights = await hasGroupManageRights(existing.groupId, request.user.id);
      if (!rights.ok) return reply.code(rights.code).send({ error: rights.error });

      await fastify.prisma.tournamentPreset.update({
        where: { id: presetId },
        data: { isArchived: true },
      });

      return { ok: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Preset konnte nicht archiviert werden' });
    }
  });

  // GET /api/tournaments/instances?groupId=&status=
  fastify.get('/instances', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const groupId = String(request.query?.groupId || '').trim();
      const status = request.query?.status ? String(request.query.status).trim() : null;
      if (!groupId) return reply.code(400).send({ error: 'groupId erforderlich' });
      if (!(await hasGroupAccess(groupId, request.user.id))) {
        return reply.code(403).send({ error: 'Kein Zugriff auf diese Gruppe' });
      }
      if (status && !VALID_INSTANCE_STATUS.has(status)) {
        return reply.code(400).send({ error: 'Ungueltiger status' });
      }

      const instances = await fastify.prisma.tournamentInstance.findMany({
        where: {
          groupId,
          ...(status ? { status } : {}),
        },
        include: {
          preset: {
            select: { id: true, name: true, baseType: true, participantMode: true },
          },
          _count: {
            select: {
              participants: true,
              matches: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { instances };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Turnier-Instanzen konnten nicht geladen werden' });
    }
  });

  // POST /api/tournaments/instances
  fastify.post('/instances', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const body = request.body || {};
      const presetId = String(body.presetId || '').trim();
      const name = String(body.name || '').trim();
      const config = toSafeJson(body.config);
      if (!presetId) return reply.code(400).send({ error: 'presetId erforderlich' });
      if (!name) return reply.code(400).send({ error: 'name erforderlich' });

      const preset = await fastify.prisma.tournamentPreset.findUnique({
        where: { id: presetId },
        include: {
          stages: {
            orderBy: { stageOrder: 'asc' },
          },
        },
      });
      if (!preset || preset.isArchived) {
        return reply.code(404).send({ error: 'Preset nicht gefunden oder archiviert' });
      }

      const rights = await hasGroupManageRights(preset.groupId, request.user.id);
      if (!rights.ok) return reply.code(rights.code).send({ error: rights.error });

      const instance = await fastify.prisma.tournamentInstance.create({
        data: {
          presetId: preset.id,
          groupId: preset.groupId,
          name,
          status: 'draft',
          config: config || preset.config,
          createdBy: request.user.id,
          rounds: {
            create: preset.stages.map((stage, index) => ({
              roundNumber: index + 1,
              stageKey: stage.stageType,
              name: stage.name,
              status: 'planned',
            })),
          },
        },
        include: {
          preset: {
            select: { id: true, name: true, baseType: true, participantMode: true },
          },
          rounds: {
            orderBy: { roundNumber: 'asc' },
          },
        },
      });

      createNotification(fastify.prisma, {
        userId: request.user.id,
        type: 'system',
        title: 'Turnier-Instanz erstellt',
        body: `Turnier \"${instance.name}\" wurde erstellt.`,
        entityId: instance.id,
        entityType: 'tournament',
      }).catch(() => {});

      return reply.code(201).send({ instance });
    } catch (err) {
      fastify.log.error(err);
      if (err?.code === 'P2002') {
        return reply.code(409).send({ error: 'Instanz-Name existiert bereits in der Gruppe' });
      }
      return reply.code(500).send({ error: 'Turnier-Instanz konnte nicht erstellt werden' });
    }
  });

  // PATCH /api/tournaments/instances/:id
  fastify.patch('/instances/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      const body = request.body || {};
      const data = {};
      if (isNonEmptyString(body.name)) data.name = body.name.trim();
      if (body.status !== undefined) {
        if (!VALID_INSTANCE_STATUS.has(body.status)) {
          return reply.code(400).send({ error: 'Ungueltiger status' });
        }
        data.status = body.status;
      }
      if (body.config !== undefined) data.config = toSafeJson(body.config);

      if (body.status === 'in_progress') {
        data.startedBy = request.user.id;
        data.startAt = new Date();
      }
      if (body.status === 'completed') {
        data.endedBy = request.user.id;
        data.endAt = new Date();
      }
      if (body.status === 'cancelled') {
        data.cancelledBy = request.user.id;
        data.cancelledAt = new Date();
        data.cancelledReason = isNonEmptyString(body.cancelledReason)
          ? body.cancelledReason.trim()
          : null;
      }

      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'Keine gueltigen Felder fuer Update' });
      }

      const instance = await fastify.prisma.tournamentInstance.update({
        where: { id: instanceId },
        data,
      });
      return { instance };
    } catch (err) {
      fastify.log.error(err);
      if (err?.code === 'P2002') {
        return reply.code(409).send({ error: 'Instanz-Name existiert bereits in der Gruppe' });
      }
      return reply.code(500).send({ error: 'Turnier-Instanz konnte nicht aktualisiert werden' });
    }
  });

  // DELETE /api/tournaments/instances/:id
  fastify.delete('/instances/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      await fastify.prisma.tournamentInstance.delete({ where: { id: instanceId } });

      return { ok: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Turnier-Instanz konnte nicht gelöscht werden' });
    }
  });

  // POST /api/tournaments/instances/:id/bracket/generate
  // Baut das Bracket (Rounds + Matches) für die erste Stage des Presets.
  // Existierende nicht-completed Matches + deren Rounds werden ersetzt.
  // `stageRoundNumber` (optional) wählt eine andere Stage statt der ersten.
  fastify.post('/instances/:id/bracket/generate', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      const body = request.body || {};
      const stageIndex = Number.isInteger(body.stageIndex) ? body.stageIndex : 0;

      const instance = await fastify.prisma.tournamentInstance.findUnique({
        where: { id: instanceId },
        include: {
          preset: {
            include: { stages: { orderBy: { stageOrder: 'asc' } } },
          },
          teams: { orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }] },
          participants: {
            include: { team: { select: { id: true, name: true, seed: true } } },
            orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });
      if (!instance) return reply.code(404).send({ error: 'Turnier-Instanz nicht gefunden' });
      const stages = instance.preset.stages || [];
      if (stages.length === 0) {
        return reply.code(400).send({ error: 'Preset hat keine Stages' });
      }
      const stage = stages[Math.max(0, Math.min(stageIndex, stages.length - 1))];
      if (!stage) {
        return reply.code(400).send({ error: 'Stage-Index ungueltig' });
      }

      const mode = instance.preset.participantMode || 'team';
      const isTeamMode = mode === 'team' || mode === 'pair';
      const entities = isTeamMode
        ? instance.teams.map((t) => ({ id: t.id, seed: t.seed, displayName: t.name, teamId: null }))
        : instance.participants.map((p) => ({
            id: p.id,
            seed: p.seed,
            displayName: p.displayName || p.user?.name || p.user?.username || p.id,
            teamId: p.teamId,
          }));

      if (entities.length < 2) {
        return reply.code(400).send({ error: 'Mindestens 2 spielende Entities erforderlich' });
      }

      if (entities.length < instance.preset.minParticipants) {
        return reply
          .code(400)
          .send({ error: `Mindestens ${instance.preset.minParticipants} Teilnehmer erforderlich` });
      }

      const generatorOptions = { entityType: isTeamMode ? 'team' : 'participant' };
      if (stage.stageType === 'group_plus_knockout' || stage.stageType === 'group_phase') {
        const groupConfig = (instance.preset.config && instance.preset.config.groupPhase) || {};
        generatorOptions.groupConfig = {
          groupCount: groupConfig.groupCount || 2,
          teamsPerGroup: groupConfig.teamsPerGroup || Math.ceil(entities.length / 2),
        };
        const required = generatorOptions.groupConfig.groupCount * generatorOptions.groupConfig.teamsPerGroup;
        if (entities.length !== required) {
          return reply.code(400).send({
            error: `Group+Knockout braucht ${required} Teams (${generatorOptions.groupConfig.groupCount} × ${generatorOptions.groupConfig.teamsPerGroup}), aber ${entities.length} vorhanden.`,
          });
        }
      }
      const bracket = generateBracket(stage.stageType, entities, generatorOptions);
      if (bracket.skipped) {
        return reply.code(400).send({ error: bracket.skipped });
      }

      // Bestehende nicht-completed Matches dieser Instanz ersetzen.
      // (Matches, die zu completed wurden – z. B. BYE-Matches aus einem früheren Generate –
      // bleiben erhalten, alle anderen gehen verloren.)
      const existing = await fastify.prisma.tournamentMatch.findMany({
        where: { instanceId, status: { not: 'completed' } },
        select: { id: true },
      });
      const existingIds = existing.map((m) => m.id);

      // Bestehende Rounds dieser Instanz auflisten
      const existingRounds = await fastify.prisma.tournamentRound.findMany({
        where: { instanceId },
        orderBy: { roundNumber: 'asc' },
      });

      const result = await fastify.prisma.$transaction(async (tx) => {
        // 1) bestehende nicht-completed Matches löschen
        if (existingIds.length > 0) {
          await tx.tournamentMatch.deleteMany({ where: { id: { in: existingIds } } });
        }

        // 2) bestehende Rounds, die zu nicht-completed Matches gehören würden, sind
        //    bereits weg, weil Matches die Round referenzieren. Hier nur alle löschen
        //    und neu anlegen, wenn keine completed Matches referenzieren.
        const completedMatchRoundIds = new Set(
          (
            await tx.tournamentMatch.findMany({
              where: { instanceId, status: 'completed' },
              select: { roundId: true },
            })
          )
            .map((m) => m.roundId)
            .filter(Boolean)
        );
        const roundsToDelete = existingRounds
          .filter((r) => !completedMatchRoundIds.has(r.id))
          .map((r) => r.id);
        if (roundsToDelete.length > 0) {
          await tx.tournamentRound.deleteMany({ where: { id: { in: roundsToDelete } } });
        }

        // 3) neue Rounds anlegen
        const newRounds = [];
        for (const r of bracket.rounds) {
          const created = await tx.tournamentRound.create({
            data: {
              instanceId,
              roundNumber: r.roundNumber,
              stageKey: r.bracket,
              name: r.name,
              status: 'planned',
            },
          });
          newRounds.push(created);
        }
        const roundIdByRoundNumber = new Map(
          newRounds.map((r) => [r.roundNumber, r.id])
        );

        // 4) neue Matches anlegen via flattenMatchesForDb (entityType-aware)
        const isTeamModeLocal = isTeamMode;
        const matchRows = flattenMatchesForDb(bracket.rounds, {
          instanceId,
          roundIdByRoundNumber,
          entityType: generatorOptions.entityType,
        });
        const tempIdToRealId = new Map();
        for (let idx = 0; idx < bracket.rounds.length; idx += 1) {
          const r = bracket.rounds[idx];
          for (let mi = 0; mi < r.matches.length; mi += 1) {
            const m = r.matches[mi];
            const rowData = matchRows.find(
              (row) =>
                row.roundId === roundIdByRoundNumber.get(r.roundNumber) &&
                row.matchNumber === m.matchNumber
            );
            if (!rowData) continue;
            const created = await tx.tournamentMatch.create({ data: rowData });
            tempIdToRealId.set(`__tmp_match_${m.matchNumber}_${r.roundNumber}`, created.id);
          }
        }

        // 5) BYE-Special: für jedes BYE-Match müssen Folge-Matches ihren Slot mit dem
        //    realen Gewinner befüllen (Auto-Advance für BYE).
        for (const r of bracket.rounds) {
          for (const m of r.matches) {
            if (!m.isBye) continue;
            const winner = m.homeEntityId || m.awayEntityId;
            if (!winner) continue;
            if (!m.nextWinnerMatchId || !m.nextWinnerSlot) continue;
            const data = {};
            if (m.nextWinnerSlot === 'home') {
              if (isTeamModeLocal) data.homeTeamId = winner;
              else data.homeParticipantId = winner;
            } else if (m.nextWinnerSlot === 'away') {
              if (isTeamModeLocal) data.awayTeamId = winner;
              else data.awayParticipantId = winner;
            }
            // Lookup des echten nextWinnerMatchId über das im Generator gesetzte Temp-Schema
            // Da der Generator `__tmp_match_${matchNumber}` verwendet, müssen wir es auf
            // Basis der Round-Struktur auflösen:
            // Wir kennen die Reihenfolge: next-Wert ist in der nächsten Round. Wir suchen
            // das Match in der nächsten Round mit dem passenden slot, indem wir die
            // Reihenfolge der Matches in der Runde nutzen.
            const currentIdx = r.matches.findIndex((mm) => mm === m);
            const nextRound = bracket.rounds.find((rr) => rr.roundNumber === r.roundNumber + 1);
            if (!nextRound) continue;
            const nextIdx = Math.floor(currentIdx / 2);
            const nextMatch = nextRound.matches[nextIdx];
            if (!nextMatch) continue;
            // Echte ID in der DB nachschlagen
            const realNextId = tempIdToRealId.get(
              `__tmp_match_${nextMatch.matchNumber}_${nextRound.roundNumber}`
            );
            if (realNextId && Object.keys(data).length > 0) {
              await tx.tournamentMatch.update({ where: { id: realNextId }, data });
            }
          }
        }

        // 6) 2. Pass: nextWinnerMatchId jetzt mit echten IDs verknüpfen
        for (const r of bracket.rounds) {
          for (const m of r.matches) {
            if (!m.nextWinnerMatchId) continue;
            // m.nextWinnerMatchId ist ein temporärer Marker; wir leiten die echte ID
            // aus der Reihenfolge der nächsten Runde ab (gleiche Logik wie oben)
            const currentIdx = r.matches.findIndex((mm) => mm === m);
            const nextRound = bracket.rounds.find((rr) => rr.roundNumber === r.roundNumber + 1);
            if (!nextRound) continue;
            const nextIdx = Math.floor(currentIdx / 2);
            const nextMatch = nextRound.matches[nextIdx];
            if (!nextMatch) continue;
            const realNextId = tempIdToRealId.get(
              `__tmp_match_${nextMatch.matchNumber}_${nextRound.roundNumber}`
            );
            if (realNextId) {
              // Wir müssen ALLE Matches der aktuellen Runde updaten, die in dasselbe
              // Ziel münden. Hier ist es pro Match eindeutig (currentIdx/2 = nextIdx).
              // Aber das ist erst nach dem Loop nötig; unten sammeln wir.
            }
          }
        }

        // Vereinfachung: direkt alle Updates anwenden
        const updates = [];
        for (const r of bracket.rounds) {
          for (let mi = 0; mi < r.matches.length; mi += 1) {
            const m = r.matches[mi];
            if (!m.nextWinnerMatchId) continue;
            const nextRound = bracket.rounds.find((rr) => rr.roundNumber === r.roundNumber + 1);
            if (!nextRound) continue;
            const nextIdx = Math.floor(mi / 2);
            const nextMatch = nextRound.matches[nextIdx];
            if (!nextMatch) continue;
            const realCurrentId = tempIdToRealId.get(
              `__tmp_match_${m.matchNumber}_${r.roundNumber}`
            );
            const realNextId = tempIdToRealId.get(
              `__tmp_match_${nextMatch.matchNumber}_${nextRound.roundNumber}`
            );
            if (realCurrentId && realNextId) {
              updates.push(
                tx.tournamentMatch.update({
                  where: { id: realCurrentId },
                  data: { nextWinnerMatchId: realNextId },
                })
              );
            }
          }
        }
        if (updates.length > 0) {
          await Promise.all(updates);
        }

        return {
          stages: stages.length,
          matches: tempIdToRealId.size,
          byesApplied: bracket.byesApplied || 0,
          stageType: bracket.stageType,
        };
      });

      return reply.code(201).send({ ok: true, generated: result });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Bracket konnte nicht generiert werden' });
    }
  });

  // GET /api/tournaments/instances/:id
  fastify.get('/instances/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });

      const access = await getInstanceWithAccess(instanceId, request.user.id);
      if (!access.ok) return reply.code(access.code).send({ error: access.error });

      const instance = await fastify.prisma.tournamentInstance.findUnique({
        where: { id: instanceId },
        include: {
          preset: true,
          rounds: {
            orderBy: { roundNumber: 'asc' },
          },
          teams: {
            orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }],
          },
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                  displayNameField: true,
                },
              },
              team: {
                select: { id: true, name: true, seed: true },
              },
            },
            orderBy: [{ points: 'desc' }, { wins: 'desc' }, { createdAt: 'asc' }],
          },
          matches: {
            include: {
              results: true,
              homeParticipant: {
                select: { id: true, user: { select: { name: true, username: true } } },
              },
              awayParticipant: {
                select: { id: true, user: { select: { name: true, username: true } } },
              },
              winnerParticipant: {
                select: { id: true, user: { select: { name: true, username: true } } },
              },
            },
            orderBy: [{ matchNumber: 'asc' }],
          },
        },
      });

      return { instance };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Turnier-Instanz konnte nicht geladen werden' });
    }
  });

  // POST /api/tournaments/instances/:id/teams
  fastify.post('/instances/:id/teams', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      const body = request.body || {};
      const name = String(body.name || '').trim();
      const seed = body.seed === undefined || body.seed === null ? null : Number(body.seed);

      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });
      if (!name) return reply.code(400).send({ error: 'name erforderlich' });
      if (seed !== null && !Number.isInteger(seed)) {
        return reply.code(400).send({ error: 'seed muss eine ganze Zahl sein' });
      }

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      const team = await fastify.prisma.tournamentTeam.create({
        data: {
          instanceId,
          name,
          seed,
          createdBy: request.user.id,
          metadata: toSafeJson(body.metadata),
        },
      });

      return reply.code(201).send({ team });
    } catch (err) {
      fastify.log.error(err);
      if (err?.code === 'P2002') {
        return reply.code(409).send({ error: 'Teamname existiert bereits in dieser Instanz' });
      }
      return reply.code(500).send({ error: 'Team konnte nicht erstellt werden' });
    }
  });

  // POST /api/tournaments/instances/:id/teams/bulk
  // Bulk-Team-Erstellung für Auto-Gen: { count, namePattern }
  //   namePattern: 'Team {n}' (Default), oder beliebiges Pattern mit {n} Platzhalter
  //   Seeds werden automatisch fortlaufend vergeben (1..count)
  fastify.post('/instances/:id/teams/bulk', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      const body = request.body || {};
      const count = Number(body.count);
      const namePattern = String(body.namePattern || 'Team {n}');
      const startSeed = Number.isInteger(body.startSeed) ? body.startSeed : 1;

      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });
      if (!Number.isInteger(count) || count < 1 || count > 128) {
        return reply.code(400).send({ error: 'count muss zwischen 1 und 128 sein' });
      }

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      // Existierende Namen sammeln, um Kollisionen zu vermeiden
      const existing = await fastify.prisma.tournamentTeam.findMany({
        where: { instanceId },
        select: { name: true, seed: true },
      });
      const existingNames = new Set(existing.map((t) => t.name));
      const existingSeeds = new Set(
        existing.map((t) => t.seed).filter((s) => s != null)
      );

      const created = [];
      let nextSeed = startSeed;
      for (let i = 1; i <= count; i += 1) {
        let name = namePattern.replace(/\{n\}/g, String(i));
        // Eindeutigkeit: bei Kollision einen Suffix anhängen
        let suffix = 0;
        while (existingNames.has(name)) {
          suffix += 1;
          name = `${namePattern.replace(/\{n\}/g, String(i))} (${suffix})`;
        }
        existingNames.add(name);
        // Seed: nächste freie Nummer
        while (existingSeeds.has(nextSeed)) nextSeed += 1;
        const seed = nextSeed;
        existingSeeds.add(seed);
        nextSeed += 1;

        const team = await fastify.prisma.tournamentTeam.create({
          data: {
            instanceId,
            name,
            seed,
            createdBy: request.user.id,
          },
        });
        created.push(team);
      }

      return reply.code(201).send({ teams: created, count: created.length });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Teams konnten nicht erstellt werden' });
    }
  });

  // PATCH /api/tournaments/instances/:id/teams/:teamId
  // Team umbenennen / Seed ändern
  fastify.patch('/instances/:id/teams/:teamId', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      const teamId = String(request.params?.teamId || '').trim();
      if (!instanceId || !teamId) {
        return reply.code(400).send({ error: 'id und teamId erforderlich' });
      }

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      const existing = await fastify.prisma.tournamentTeam.findUnique({
        where: { id: teamId },
        select: { id: true, instanceId: true },
      });
      if (!existing || existing.instanceId !== instanceId) {
        return reply.code(404).send({ error: 'Team nicht gefunden' });
      }

      const body = request.body || {};
      const data = {};
      if (isNonEmptyString(body.name)) data.name = body.name.trim();
      if (body.seed !== undefined) {
        const seed = body.seed === null ? null : Number(body.seed);
        if (seed !== null && !Number.isInteger(seed)) {
          return reply.code(400).send({ error: 'seed muss eine ganze Zahl sein' });
        }
        data.seed = seed;
      }
      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'Keine gültigen Felder zum Aktualisieren' });
      }

      const team = await fastify.prisma.tournamentTeam.update({
        where: { id: teamId },
        data,
      });
      return { team };
    } catch (err) {
      fastify.log.error(err);
      if (err?.code === 'P2002') {
        return reply.code(409).send({ error: 'Teamname existiert bereits in dieser Instanz' });
      }
      return reply.code(500).send({ error: 'Team konnte nicht aktualisiert werden' });
    }
  });

  // DELETE /api/tournaments/instances/:id/teams/:teamId
  fastify.delete('/instances/:id/teams/:teamId', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    try {
      const instanceId = String(request.params?.id || '').trim();
      const teamId = String(request.params?.teamId || '').trim();
      if (!instanceId || !teamId) {
        return reply.code(400).send({ error: 'id und teamId erforderlich' });
      }
      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      const existing = await fastify.prisma.tournamentTeam.findUnique({
        where: { id: teamId },
        select: { id: true, instanceId: true },
      });
      if (!existing || existing.instanceId !== instanceId) {
        return reply.code(404).send({ error: 'Team nicht gefunden' });
      }

      await fastify.prisma.tournamentTeam.delete({ where: { id: teamId } });
      return { ok: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Team konnte nicht gelöscht werden' });
    }
  });

  // POST /api/tournaments/instances/:id/participants
  // Erlaubt jetzt "Ghost-Teilnehmer" (kein userId, dafür displayName) für team/pair-Mode.
  // In individual-Modus bleibt userId Pflicht. In team/pair-Modus ist teamId Pflicht.
  fastify.post('/instances/:id/participants', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      const body = request.body || {};
      const userId = body.userId ? String(body.userId).trim() : '';
      const providedDisplayName = isNonEmptyString(body.displayName) ? body.displayName.trim() : null;
      const seed = body.seed === undefined || body.seed === null ? null : Number(body.seed);
      const teamId = body.teamId ? String(body.teamId).trim() : null;
      const status = body.status ? String(body.status).trim() : 'registered';

      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });
      if (seed !== null && !Number.isInteger(seed)) {
        return reply.code(400).send({ error: 'seed muss eine ganze Zahl sein' });
      }
      if (!VALID_PARTICIPANT_STATUS.has(status)) {
        return reply.code(400).send({ error: 'Ungueltiger Teilnehmer-Status' });
      }

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      const instance = await fastify.prisma.tournamentInstance.findUnique({
        where: { id: instanceId },
        include: {
          preset: {
            select: {
              minParticipants: true,
              maxParticipants: true,
              participantMode: true,
            },
          },
        },
      });
      if (!instance) return reply.code(404).send({ error: 'Turnier-Instanz nicht gefunden' });

      const mode = instance.preset.participantMode;

      // Modus-spezifische Validierung
      if (mode === 'individual' && !userId) {
        return reply
          .code(400)
          .send({ error: 'userId erforderlich im individual-Modus' });
      }
      if ((mode === 'team' || mode === 'pair') && !teamId) {
        return reply
          .code(400)
          .send({ error: 'teamId erforderlich im team/pair-Modus' });
      }
      if (!userId && !providedDisplayName) {
        return reply
          .code(400)
          .send({ error: 'userId oder displayName erforderlich' });
      }

      const count = await fastify.prisma.tournamentParticipant.count({ where: { instanceId } });
      if (count >= instance.preset.maxParticipants) {
        return reply.code(409).send({ error: 'Maximale Teilnehmerzahl erreicht' });
      }

      // teamId muss zu dieser Instanz gehören
      let team = null;
      if (teamId) {
        team = await fastify.prisma.tournamentTeam.findUnique({
          where: { id: teamId },
          select: { id: true, instanceId: true, name: true },
        });
        if (!team || team.instanceId !== instanceId) {
          return reply.code(400).send({ error: 'teamId gehoert nicht zu dieser Instanz' });
        }
      }

      // displayName automatisch ableiten, wenn nicht explizit gesetzt
      let displayName = providedDisplayName;
      if (!displayName) {
        if (userId) {
          const u = await fastify.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, username: true, email: true },
          });
          displayName = u?.name || u?.username || u?.email || null;
        } else if (team) {
          displayName = team.name;
        }
      }

      const participant = await fastify.prisma.tournamentParticipant.create({
        data: {
          instanceId,
          userId: userId || null,
          displayName,
          teamId,
          seed,
          status,
          assignedAt: userId ? new Date() : null,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              displayNameField: true,
            },
          },
          team: {
            select: { id: true, name: true, seed: true },
          },
        },
      });

      return reply.code(201).send({ participant });
    } catch (err) {
      fastify.log.error(err);
      if (err?.code === 'P2002') {
        return reply.code(409).send({ error: 'Teilnehmer existiert bereits in dieser Instanz' });
      }
      return reply.code(500).send({ error: 'Teilnehmer konnte nicht hinzugefuegt werden' });
    }
  });

  // PATCH /api/tournaments/instances/:id/participants/:participantId
  // Aktionen über `op`-Body-Feld:
  //   op: 'assign_user'  + userId   -> Ghost-Teilnehmer bekommt User zugeordnet
  //   op: 'unassign_user'           -> User-Zuordnung entfernen, zurück zu Ghost
  //   op: 'update'                  -> seed/teamId/displayName ändern
  fastify.patch('/instances/:id/participants/:participantId', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      const participantId = String(request.params?.participantId || '').trim();
      if (!instanceId || !participantId) {
        return reply.code(400).send({ error: 'id und participantId erforderlich' });
      }

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      const participant = await fastify.prisma.tournamentParticipant.findUnique({
        where: { id: participantId },
        include: {
          team: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, username: true, email: true } },
        },
      });
      if (!participant || participant.instanceId !== instanceId) {
        return reply.code(404).send({ error: 'Teilnehmer nicht gefunden' });
      }

      const body = request.body || {};
      const op = String(body.op || '').trim();
      const data = {};

      if (op === 'assign_user') {
        const newUserId = body.userId ? String(body.userId).trim() : '';
        if (!newUserId) {
          return reply.code(400).send({ error: 'userId erforderlich für op=assign_user' });
        }
        // Existiert der User?
        const targetUser = await fastify.prisma.user.findUnique({
          where: { id: newUserId },
          select: { id: true, name: true, username: true, email: true },
        });
        if (!targetUser) {
          return reply.code(404).send({ error: 'userId nicht gefunden' });
        }
        data.userId = newUserId;
        data.displayName =
          (isNonEmptyString(body.displayName) ? body.displayName.trim() : null) ||
          targetUser.name ||
          targetUser.username ||
          targetUser.email;
        data.assignedAt = new Date();
      } else if (op === 'unassign_user') {
        if (!participant.userId) {
          return reply.code(400).send({ error: 'Teilnehmer hat keinen zugeordneten User' });
        }
        data.userId = null;
        data.assignedAt = null;
        // displayName auf Team-Name zurücksetzen, falls ein Team existiert
        if (participant.team?.name) {
          data.displayName = participant.team.name;
        } else if (isNonEmptyString(body.displayName)) {
          data.displayName = body.displayName.trim();
        }
      } else if (op === 'update') {
        if (body.seed !== undefined) {
          const seed = body.seed === null ? null : Number(body.seed);
          if (seed !== null && !Number.isInteger(seed)) {
            return reply.code(400).send({ error: 'seed muss eine ganze Zahl sein' });
          }
          data.seed = seed;
        }
        if (body.teamId !== undefined) {
          const newTeamId = body.teamId ? String(body.teamId).trim() : null;
          if (newTeamId) {
            const t = await fastify.prisma.tournamentTeam.findUnique({
              where: { id: newTeamId },
              select: { id: true, instanceId: true },
            });
            if (!t || t.instanceId !== instanceId) {
              return reply.code(400).send({ error: 'teamId gehoert nicht zu dieser Instanz' });
            }
          }
          data.teamId = newTeamId;
        }
        if (isNonEmptyString(body.displayName)) {
          data.displayName = body.displayName.trim();
        }
      } else {
        return reply
          .code(400)
          .send({ error: 'Ungueltige op (assign_user | unassign_user | update)' });
      }

      const updated = await fastify.prisma.tournamentParticipant.update({
        where: { id: participantId },
        data,
        include: {
          user: {
            select: { id: true, name: true, username: true, displayNameField: true },
          },
          team: { select: { id: true, name: true, seed: true } },
        },
      });

      return { participant: updated };
    } catch (err) {
      fastify.log.error(err);
      if (err?.code === 'P2002') {
        return reply.code(409).send({ error: 'User ist bereits Teilnehmer dieser Instanz' });
      }
      return reply.code(500).send({ error: 'Teilnehmer konnte nicht aktualisiert werden' });
    }
  });

  // DELETE /api/tournaments/instances/:id/participants/:participantId
  fastify.delete('/instances/:id/participants/:participantId', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      const participantId = String(request.params?.participantId || '').trim();
      if (!instanceId || !participantId) {
        return reply.code(400).send({ error: 'id und participantId erforderlich' });
      }

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      const participant = await fastify.prisma.tournamentParticipant.findUnique({
        where: { id: participantId },
        select: { id: true, instanceId: true },
      });
      if (!participant || participant.instanceId !== instanceId) {
        return reply.code(404).send({ error: 'Teilnehmer nicht gefunden' });
      }

      await fastify.prisma.tournamentParticipant.delete({ where: { id: participantId } });
      return { ok: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Teilnehmer konnte nicht entfernt werden' });
    }
  });

  // POST /api/tournaments/instances/:id/matches
  fastify.post('/instances/:id/matches', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });

      const body = request.body || {};
      const roundId = body.roundId ? String(body.roundId).trim() : null;
      const matchNumber = Number(body.matchNumber);
      const homeParticipantId = body.homeParticipantId ? String(body.homeParticipantId).trim() : null;
      const awayParticipantId = body.awayParticipantId ? String(body.awayParticipantId).trim() : null;
      const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
      const status = body.status ? String(body.status).trim() : 'planned';

      if (!Number.isInteger(matchNumber) || matchNumber < 1) {
        return reply.code(400).send({ error: 'matchNumber muss >= 1 sein' });
      }
      if (!VALID_MATCH_STATUS.has(status)) {
        return reply.code(400).send({ error: 'Ungueltiger Match-Status' });
      }
      if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
        return reply.code(400).send({ error: 'scheduledAt ist ungueltig' });
      }

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      if (roundId) {
        const round = await fastify.prisma.tournamentRound.findUnique({
          where: { id: roundId },
          select: { id: true, instanceId: true },
        });
        if (!round || round.instanceId !== instanceId) {
          return reply.code(400).send({ error: 'roundId gehoert nicht zu dieser Instanz' });
        }
      }

      const match = await fastify.prisma.tournamentMatch.create({
        data: {
          instanceId,
          roundId,
          matchNumber,
          status,
          homeParticipantId,
          awayParticipantId,
          scheduledAt,
          venueLabel: isNonEmptyString(body.venueLabel) ? body.venueLabel.trim() : null,
          metadata: toSafeJson(body.metadata),
        },
      });

      return reply.code(201).send({ match });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Match konnte nicht erstellt werden' });
    }
  });

  // PATCH /api/tournaments/instances/:id/matches/:matchId/result
  fastify.patch('/instances/:id/matches/:matchId/result', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      const matchId = String(request.params?.matchId || '').trim();
      if (!instanceId || !matchId) {
        return reply.code(400).send({ error: 'id und matchId erforderlich' });
      }

      const managed = await getInstanceWithManageRights(instanceId, request.user.id);
      if (!managed.ok) return reply.code(managed.code).send({ error: managed.error });

      const body = request.body || {};
      const winnerParticipantId = body.winnerParticipantId ? String(body.winnerParticipantId).trim() : null;
      const isDraw = body.isDraw === true;
      const results = Array.isArray(body.results) ? body.results : [];
      if (results.length < 2) {
        return reply.code(400).send({ error: 'Mindestens zwei Result-Eintraege erforderlich' });
      }

      const match = await fastify.prisma.tournamentMatch.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          instanceId: true,
          homeParticipantId: true,
          awayParticipantId: true,
          status: true,
          // Für Auto-Advance: muss vor dem Speichern gelesen werden, weil der Generator
          // diese Felder beim Bracket-Build gesetzt hat.
          nextWinnerMatchId: true,
          nextWinnerSlot: true,
        },
      });
      if (!match || match.instanceId !== instanceId) {
        return reply.code(404).send({ error: 'Match nicht gefunden' });
      }

      const expected = new Set([match.homeParticipantId, match.awayParticipantId].filter(Boolean));
      const payloadParticipants = new Set(results.map((entry) => String(entry.participantId || '').trim()));

      if (expected.size > 0) {
        for (const id of expected) {
          if (!payloadParticipants.has(id)) {
            return reply.code(400).send({ error: 'Result-Liste passt nicht zu Match-Teilnehmern' });
          }
        }
      }

      if (winnerParticipantId && !payloadParticipants.has(winnerParticipantId)) {
        return reply.code(400).send({ error: 'winnerParticipantId ist nicht Teil der Result-Liste' });
      }

      for (const entry of results) {
        if (!entry || !isNonEmptyString(entry.participantId)) {
          return reply.code(400).send({ error: 'participantId fehlt in Result-Liste' });
        }
        if (typeof entry.score !== 'number' || Number.isNaN(entry.score)) {
          return reply.code(400).send({ error: 'score muss eine Zahl sein' });
        }
        if (entry.outcome && !['win', 'loss', 'draw', 'forfeit'].includes(entry.outcome)) {
          return reply.code(400).send({ error: 'outcome ungueltig' });
        }
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.tournamentMatchResult.deleteMany({ where: { matchId } });

        await tx.tournamentMatchResult.createMany({
          data: results.map((entry) => ({
            matchId,
            participantId: String(entry.participantId).trim(),
            score: Number(entry.score),
            outcome: entry.outcome ? String(entry.outcome).trim() : null,
            details: toSafeJson(entry.details),
          })),
        });

        // Mode-aware: winnerTeamId ODER winnerParticipantId setzen
        const instForMode = await tx.tournamentInstance.findUnique({
          where: { id: instanceId },
          select: { preset: { select: { participantMode: true } } },
        });
        const modeForMatch = instForMode?.preset?.participantMode || 'team';
        const isTeamModeForMatch = modeForMatch === 'team' || modeForMatch === 'pair';
        await tx.tournamentMatch.update({
          where: { id: matchId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            winnerParticipantId: isTeamModeForMatch ? null : (winnerParticipantId || null),
            winnerTeamId: isTeamModeForMatch ? (winnerParticipantId || null) : null,
            isDraw,
            recordedBy: request.user.id,
          },
        });
      });

      // Mode-aware Stats-Recompute
      try {
        const inst = await fastify.prisma.tournamentInstance.findUnique({
          where: { id: instanceId },
          select: { preset: { select: { participantMode: true } } },
        });
        const mode = inst?.preset?.participantMode || 'team';
        await recomputeStats(instanceId, mode);
      } catch (statsErr) {
        fastify.log.error(statsErr, 'Stats-Recompute fehlgeschlagen');
      }

      // Auto-Advance: Gewinner in das/die Folge-Match(es) eintragen.
      // Verwendet die schon im `match`-Objekt vorhandenen nextWinnerMatchId/Slot
      // Schreibt je nach Modus in homeTeamId/awayTeamId oder homeParticipantId/awayParticipantId.
      try {
        // Mode ermitteln (für richtige Spaltenwahl)
        const inst = await fastify.prisma.tournamentInstance.findUnique({
          where: { id: instanceId },
          select: { preset: { select: { participantMode: true } } },
        });
        const mode = inst?.preset?.participantMode || 'team';
        const isTeamMode = mode === 'team' || mode === 'pair';

        const advances = computeNextAdvancesForResult({
          winnerEntityId: winnerParticipantId,
          isDraw,
          nextWinnerMatchId: match.nextWinnerMatchId || null,
          nextWinnerSlot: match.nextWinnerSlot || null,
        });
        for (const advance of advances) {
          const data = {};
          if (advance.slot === 'home') {
            if (isTeamMode) data.homeTeamId = winnerParticipantId;
            else data.homeParticipantId = winnerParticipantId;
          } else if (advance.slot === 'away') {
            if (isTeamMode) data.awayTeamId = winnerParticipantId;
            else data.awayParticipantId = winnerParticipantId;
          }
          if (Object.keys(data).length > 0) {
            await fastify.prisma.tournamentMatch.update({
              where: { id: advance.matchId },
              data,
            });
          }
        }
      } catch (advanceErr) {
        // Auto-Advance-Fehler dürfen das Hauptergebnis nicht zerschießen
        fastify.log.error(advanceErr, 'Auto-Advance fehlgeschlagen');
      }

      const updatedMatch = await fastify.prisma.tournamentMatch.findUnique({
        where: { id: matchId },
        include: { results: true },
      });

      return { match: updatedMatch };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Match-Ergebnis konnte nicht gespeichert werden' });
    }
  });

  // GET /api/tournaments/instances/:id/standings
  fastify.get('/instances/:id/standings', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });

      const access = await getInstanceWithAccess(instanceId, request.user.id);
      if (!access.ok) return reply.code(access.code).send({ error: access.error });

      const standings = await fastify.prisma.tournamentParticipant.findMany({
        where: { instanceId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              displayNameField: true,
            },
          },
          team: {
            select: {
              id: true,
              name: true,
              seed: true,
            },
          },
        },
        orderBy: [
          { points: 'desc' },
          { wins: 'desc' },
          { draws: 'desc' },
          { losses: 'asc' },
          { createdAt: 'asc' },
        ],
      });

      return {
        standings: standings.map((entry, index) => ({
          rank: index + 1,
          ...entry,
        })),
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Standings konnten nicht geladen werden' });
    }
  });
}
