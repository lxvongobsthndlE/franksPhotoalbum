import { createNotification } from '../utils/notifications.js';

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

  async function recomputeParticipantStats(instanceId) {
    const participants = await fastify.prisma.tournamentParticipant.findMany({
      where: { instanceId },
      select: { id: true },
    });

    if (participants.length === 0) return;

    const matches = await fastify.prisma.tournamentMatch.findMany({
      where: { instanceId, status: 'completed' },
      include: {
        results: {
          select: {
            participantId: true,
            score: true,
            outcome: true,
          },
        },
      },
    });

    const stats = new Map();
    for (const participant of participants) {
      stats.set(participant.id, { points: 0, wins: 0, losses: 0, draws: 0 });
    }

    for (const match of matches) {
      for (const result of match.results) {
        const current = stats.get(result.participantId);
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

  // POST /api/tournaments/instances/:id/participants
  fastify.post('/instances/:id/participants', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;

    try {
      const instanceId = String(request.params?.id || '').trim();
      const body = request.body || {};
      const userId = String(body.userId || '').trim();
      const seed = body.seed === undefined || body.seed === null ? null : Number(body.seed);
      const teamId = body.teamId ? String(body.teamId).trim() : null;
      const status = body.status ? String(body.status).trim() : 'registered';

      if (!instanceId) return reply.code(400).send({ error: 'id erforderlich' });
      if (!userId) return reply.code(400).send({ error: 'userId erforderlich' });
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

      const count = await fastify.prisma.tournamentParticipant.count({ where: { instanceId } });
      if (count >= instance.preset.maxParticipants) {
        return reply.code(409).send({ error: 'Maximale Teilnehmerzahl erreicht' });
      }

      if (teamId) {
        const team = await fastify.prisma.tournamentTeam.findUnique({
          where: { id: teamId },
          select: { id: true, instanceId: true },
        });
        if (!team || team.instanceId !== instanceId) {
          return reply.code(400).send({ error: 'teamId gehoert nicht zu dieser Instanz' });
        }
      }

      const participant = await fastify.prisma.tournamentParticipant.create({
        data: {
          instanceId,
          userId,
          teamId,
          seed,
          status,
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
        return reply.code(409).send({ error: 'User ist bereits Teilnehmer dieser Instanz' });
      }
      return reply.code(500).send({ error: 'Teilnehmer konnte nicht hinzugefuegt werden' });
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

        await tx.tournamentMatch.update({
          where: { id: matchId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            winnerParticipantId: winnerParticipantId || null,
            isDraw,
            recordedBy: request.user.id,
          },
        });
      });

      await recomputeParticipantStats(instanceId);

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
