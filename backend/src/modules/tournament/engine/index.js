/**
 * Engine-Barrel + High-Level-Entry `generateTournament`.
 *
 * generateTournament orchestriert:
 *   1. mergeConfig
 *   2. distributeTeamsIntoGroups
 *   3. Pro Gruppe: buildRoundRobin → computeStandings
 *   4. applyTiebreaker pro Gruppe
 *   5. qualifyAndSeed (mit rankBestThirds)
 *   6. buildBracket
 *   7. generateSchedule (über alle Spiele)
 *
 * Rückgabe: vollständiges generiertes Turnier in reinen Daten — kein DB-Zugriff.
 *
 * Wichtig (Spec §10.9): deterministisch. Zwei Aufrufe mit denselben Inputs
 * liefern identische Match-IDs und scheduledAt.
 */

export * from './config.js';
export * from './distribute.js';
export * from './round-robin.js';
export * from './standings.js';
export * from './tiebreaker.js';
export * from './best-thirds.js';
export * from './qualify.js';
export * from './bracket.js';
export * from './propagate.js';
export * from './schedule.js';

import { mergeConfig } from './config.js';
import { distributeTeamsIntoGroups } from './distribute.js';
import { buildRoundRobinMatches } from './round-robin.js';
import { computeStandings } from './standings.js';
import { applyTiebreaker } from './tiebreaker.js';
import { qualifyAndSeed } from './qualify.js';
import { buildBracket } from './bracket.js';
import { generateSchedule } from './schedule.js';

/**
 * Vollständige Generierung.
 *
 * @param {object} input
 * @param {Array<{id,name,seed?}>} input.teams
 * @param {object} input.config
 * @param {string} input.config.mode                'groups_ko' | 'groups_only' | 'ko_only'
 * @param {number} input.config.numGroups           Anzahl Gruppen (z.B. 3)
 * @param {number} [input.config.groupSize]         Teams pro Gruppe (alternativ zu numGroups)
 * @param {Array<{key,name}>} [input.groupKeys]    ['A','B','C'] — Default: A,B,C,...
 * @param {Array} [input.matches]                   wenn vorhanden, Scores zum Re-Ranking
 * @param {string} [input.baseDate]
 * @returns {{
 *   config, groupKeys, groups, groupStage, qualifiers, bracket, schedule, unresolvedConflicts
 * }}
 */
export function generateTournament(input) {
  const config = mergeConfig(input.config ?? {});
  const teams = input.teams ?? [];

  const numGroups =
    input.config?.numGroups ??
    (input.config?.groupSize ? Math.ceil(teams.length / input.config.groupSize) : 1);

  if (numGroups < 1) {
    throw new Error('generateTournament: numGroups muss >= 1 sein');
  }

  // Gruppen-Keys default A, B, C, …
  const groupKeys = input.groupKeys ?? defaultGroupKeys(numGroups);

  // Phase 1: Verteilung
  const rawGroups = distributeTeamsIntoGroups(teams, numGroups, {
    method: config.distribution,
    seed: input.config?.distributionSeed ?? 'default',
  });

  // Phase 2: Round-Robin + Standings + Tiebreaker pro Gruppe
  const groupStage = [];
  for (let g = 0; g < rawGroups.length; g++) {
    const grpTeams = rawGroups[g];
    const grpTeamIds = grpTeams.map((t) => t.id);
    const matches = buildRoundRobinMatches(grpTeamIds).map((m, idx) => ({
      ...m,
      id: `g_${groupKeys[g]}_${idx + 1}`,
      stageType: 'group',
      groupKey: groupKeys[g],
      groupIndex: g,
      status: 'scheduled',
    }));

    const standingsRows = computeStandings(grpTeamIds, input.matches ?? [], config);
    const { sortedRows, unresolved } = applyTiebreaker(
      standingsRows.map((r) => ({ ...r, name: grpTeams.find((t) => t.id === r.teamId)?.name })),
      input.matches ?? [],
      config,
    );

    groupStage.push({
      groupKey: groupKeys[g],
      groupName: input.groupNames?.[g] ?? `Gruppe ${groupKeys[g]}`,
      members: grpTeams,
      matches,
      standings: sortedRows,
      unresolved,
    });
  }

  // Phase 3: Qualifikation
  const qualify = qualifyAndSeed(
    {
      groupStandings: groupStage.map((g) => g.standings),
      groupKeys,
    },
    config,
  );

  // Phase 4: Bracket (nur wenn Modus KO beinhaltet)
  let bracket = { matches: [], bracketSize: 0, byeSeeds: [], unresolvedConflicts: [] };
  if (config.mode === 'groups_ko' || config.mode === 'ko_only' || config.mode === 'double_elim') {
    bracket = buildBracket(qualify.qualifiers, {
      hasThirdPlacePlayoff: config.hasThirdPlacePlayoff,
      maxTiebreakerDepth: config.maxTiebreakerDepth,
    });
  }

  // Phase 5: Schedule (für alle Spiele: Gruppenphase + KO)
  const allMatches = [
    ...groupStage.flatMap((g) => g.matches),
    ...bracket.matches,
  ];
  const baseDate = input.baseDate ? new Date(input.baseDate) : new Date('2026-09-05');
  const schedule = generateSchedule(allMatches, config, baseDate);

  // Kombiniere scheduledAt + field zurück in die Original-Strukturen
  const scheduleById = new Map(schedule.map((m) => [m.id, m]));
  for (const g of groupStage) {
    g.matches = g.matches.map((m) => ({ ...m, ...(scheduleById.get(m.id) ?? {}) }));
  }
  for (let i = 0; i < bracket.matches.length; i++) {
    const m = bracket.matches[i];
    bracket.matches[i] = { ...m, ...(scheduleById.get(m.id) ?? {}) };
  }

  // Konflikte
  const unresolvedConflicts = [
    ...groupStage.flatMap((g) => g.unresolved),
    ...bracket.unresolvedConflicts,
  ];

  return {
    config,
    groupKeys,
    groups: groupStage,
    qualifiers: qualify.qualifiers,
    bestThirdsUsed: qualify.bestThirdsUsed,
    bracket,
    unresolvedConflicts,
  };
}

function defaultGroupKeys(n) {
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(String.fromCharCode(65 + i));
  return keys;
}