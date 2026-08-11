/**
 * Aufbereitungsschicht — der Trennpunkt zwischen DB-Zeilen und UI-DTOs.
 *
 * Spec §12 Schritt 3: "Kein Bildschirm greift direkt auf Datenbankzeilen zu.
 * Diese Schicht verhindert die gesamte Fehlerklasse aus §8.0 Punkt 12."
 *
 * Die Routes rufen HIER, nicht die Prisma-Client-Methoden direkt. Wenn eine
 * Anzeige ein Feld braucht, das nicht im DTO steht, wird die Render-Funktion
 * in `access/` erweitert — nicht ein Sonder-Property in einer Route.
 *
 * Public-API für Routen:
 *
 *   buildTournamentViewContext(prisma, tournamentId, opts)
 *     → Liefert alle DTO-Listen für eine Detail-Anzeige:
 *       { tournament, teams, stages, groups, matches, stats }
 *
 *   buildTournamentListContext(prisma, groupId, user, isAdmin)
 *     → Liefert eine Tournament-Liste als DTO-Liste.
 *
 *   buildTeamLookup(rawTeams)
 *     → Map<id, preparedTeam> für Folge-Lookups in Match-DTOs.
 *
 *   buildStageLookup(rawStages)
 *   buildGroupLookup(rawGroups)
 *   buildMatchLookup(rawMatches, ctx)
 */

import {
  prepareTournamentView,
  prepareTournamentList,
  prepareTeamList,
  buildTeamLookup,
  prepareMatchList,
  buildMatchLookup,
  prepareGroupList,
  prepareStandings,
  aggregateTournamentStats,
} from './access/index.js';
import { stageTypeLabel } from './access/status.js';
import { buildListWhereClause } from './auth.js';
import { compareTournaments } from './access/visibility.js';

/**
 * Liefert alle für die Detail-Anzeige nötigen Daten als DTOs.
 *
 * @param {object} prisma
 * @param {string} tournamentId
 * @param {object} [opts]
 * @param {boolean} [opts.singleDay]   wird in Match/Tournament-DTOs durchgereicht
 * @returns {Promise<{
 *   tournament: object,
 *   teams: object[],
 *   stages: object[],
 *   groups: object[],
 *   matches: object[],
 *   stats: { teamCount, groupCount, matchCount, finishedCount } | null,
 * }>}
 */
export async function buildTournamentViewContext(prisma, tournamentId, opts = {}) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });
  if (!tournament) {
    const err = new Error('Turnier nicht gefunden');
    err.statusCode = 404;
    throw err;
  }

  const [teams, stages, groups, matches] = await Promise.all([
    prisma.tournamentTeam.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.stage.findMany({
      where: { tournamentId },
      orderBy: { orderIndex: 'asc' },
    }),
    prisma.group_.findMany({
      where: { stage: { tournamentId } },
      orderBy: { key: 'asc' },
      include: {
        memberships: {
          include: { team: true },
          orderBy: { position: 'asc' },
        },
        matches: true,
      },
    }),
    prisma.match.findMany({
      where: { tournamentId },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  // Lookups, auf die Match-/Group-DTOs zurückgreifen.
  const teamsLookup = buildTeamLookup(teams);
  const stagesLookup = buildStageLookup(stages);
  const groupsLookup = buildGroupLookup(groups);
  // Folge-Match-Labels brauchen ein Lookup über bereits präparierte Matches.
  const matchCtx = {
    teams: teamsLookup,
    stages: stagesLookup,
    groups: groupsLookup,
    options: { singleDay: opts.singleDay !== false },
  };
  const matchesLookup = buildMatchLookup(matches, matchCtx);

  const groupDtos = prepareGroupList(groups, {
    teams: teamsLookup,
    stages: stagesLookup,
    groups: groupsLookup,
    matches: matchesLookup,
    options: { singleDay: opts.singleDay !== false },
  });

  const matchDtos = prepareMatchList(matches, {
    teams: teamsLookup,
    stages: stagesLookup,
    groups: groupsLookup,
    matches: matchesLookup,
    options: { singleDay: opts.singleDay !== false },
  });

  const finishedCount = matches.filter((m) => m.status === 'finished').length;

  return {
    tournament: prepareTournamentView(tournament, {
      stats: {
        teamCount: teams.length,
        groupCount: groups.length,
        matchCount: matches.length,
        finishedCount,
      },
      singleDay: opts.singleDay,
    }),
    teams: prepareTeamList(teams),
    stages: stages.map((s) => ({
      id: s.id,
      // technisches Feld, das per DTO-Guard als erlaubt gilt — dient
      // Sortier- und Routing-Logik; das UI greift auf typeLabel zu.
      type: s.type,
      typeLabel: stageTypeLabel(s.type),
      name: s.name,
      orderIndex: s.orderIndex,
    })),
    groups: groupDtos,
    matches: matchDtos,
    // Interne Lookups, die nachgelagerte Helfer brauchen.
    _lookups: { teamsLookup, stagesLookup, groupsLookup, matchesLookup },
    stats: {
      teamCount: teams.length,
      groupCount: groups.length,
      matchCount: matches.length,
      finishedCount,
    },
  };
}

/**
 * Listen-Kontext für eine Gruppe: liefert DTO-Tournaments in der richtigen
 * Sortierung + Counts (Teams/Gruppen/Spiele) für die Karten-Kurzinfo.
 *
 * Spec §13.2: pro Karte braucht das Frontend
 *   "16 Teams · 4 Gruppen · 12 von 24 Spielen gespielt"
 * — also teamCount, groupCount, matchCount, finishedCount.
 *
 * Performance: zwei Aggregations-Queries für ALLE Turniere statt N+1
 * (1× tournament.findMany für Teams/Stages, 1× match.groupBy für Spiele).
 */
export async function buildTournamentListContext(prisma, groupId, user, isAdmin) {
  const where = buildListWhereClause(prisma, groupId, user, isAdmin);
  const raw = await prisma.tournament.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  const sorted = raw.slice().sort(compareTournaments);
  const statsById = await aggregateTournamentStats(
    prisma,
    sorted.map((t) => t.id)
  );
  return {
    tournaments: prepareTournamentList(sorted, { statsById }),
    isAdmin,
    rawCount: raw.length,
  };
}

/**
 * Stage-Lookup.
 */
export function buildStageLookup(rawStages) {
  const map = new Map();
  for (const s of rawStages ?? []) map.set(s.id, s);
  return map;
}

/**
 * Group-Lookup.
 */
export function buildGroupLookup(rawGroups) {
  const map = new Map();
  for (const g of rawGroups ?? []) map.set(g.id, g);
  return map;
}

/**
 * Bereitet Standings inklusive Engine-Berechnung auf.
 * Engine wird hier aufgerufen, NICHT im Route-Layer.
 *
 * @param {object[]} groupMatches - alle finished Matches einer Gruppe (roh)
 * @param {string[]} teamIds
 * @param {object} config
 * @param {object} engineApi - { computeStandings, applyTiebreaker }
 * @returns {object[]}
 */
export function buildStandingsForGroup(groupMatches, teamIds, config, engineApi) {
  const finishedForEngine = groupMatches
    .filter((m) => m.status === 'finished')
    .map((m) => ({
      teamHome: m.teamHome,
      teamAway: m.teamAway,
      scoreHome: m.scoreHome,
      scoreAway: m.scoreAway,
      status: m.status,
    }));
  const rows = engineApi.computeStandings(teamIds, finishedForEngine, config);
  const sorted = engineApi.applyTiebreaker(rows, finishedForEngine, config);
  return prepareStandings(sorted.sortedRows ?? sorted, { qualifyTop: 0 });
}

export { prepareStandings };
