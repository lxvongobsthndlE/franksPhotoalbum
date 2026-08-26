/**
 * Qualifikation und Setzliste für die KO-Runde. Spec §6.1.
 *
 * Eingabe: vollständige Tabellen pro Gruppe + rankBestThirds-Output.
 * Ausgabe: deterministisch gesetzte Liste von Qualifikanten mit Seed 1..N
 *
 *   1. Top-N je Gruppe (in Reihenfolge A, B, C, …)
 *   2. Die besten "bestThirds" Dritten
 *   3. Setzliste: A1=1, B1=2, C1=3, …, A2=groupCount+1, …
 *      A3/bestThirds werden nach Setzschlüssel an die Positionen groupCount+2..
 *      verteilt — aber ihre ursprüngliche Gruppenzugehörigkeit bleibt für die
 *      Konfliktauflösung erhalten.
 */

import { rankBestThirds } from './best-thirds.js';

/**
 * Erzeugt die Qualifikanten-Liste.
 *
 * @param {object} input
 * @param {Array<Array>} input.groupStandings   sortierte Standings pro Gruppe
 * @param {Array<{key}>} input.groupKeys        ['A','B','C',…]
 * @param {Array<{name}>} input.groupNames      [optional]
 * @param {object} config                       { qualifyPerGroup, bestThirds }
 * @returns {{
 *   qualifiers: Array<{ seed, teamId, name, source: { groupKey, rank } }>,
 *   bestThirdsUsed: Array,
 * }}
 */
export function qualifyAndSeed(input, config) {
  const { groupStandings, groupKeys } = input;
  const qualifyPerGroup = config?.qualifyPerGroup ?? 2;
  const bestThirdsCount = config?.bestThirds ?? 0;

  if (!Array.isArray(groupStandings) || !Array.isArray(groupKeys)) {
    throw new Error('qualifyAndSeed: groupStandings und groupKeys erforderlich');
  }

  const qualifiers = [];
  const groupCount = groupKeys.length;

  // Phase 1: Top-N jeder Gruppe
  for (let g = 0; g < groupCount; g++) {
    const rows = groupStandings[g] ?? [];
    for (let rank = 0; rank < qualifyPerGroup; rank++) {
      const row = rows[rank];
      if (!row) continue;
      qualifiers.push({
        seed: null, // wird nach Phase 2 gesetzt
        teamId: row.teamId,
        name: row.name ?? row.teamId,
        source: { groupKey: groupKeys[g], groupIndex: g, rank: rank + 1 },
      });
    }
  }

  // Phase 2: zusätzliche beste Dritte
  const bestThirds = rankBestThirds(groupStandings);
  const bestThirdsUsed = bestThirds.slice(0, bestThirdsCount);
  for (const third of bestThirdsUsed) {
    // Gruppenkey herausfinden
    let sourceKey = null;
    let sourceIdx = null;
    for (let g = 0; g < groupCount; g++) {
      const rows = groupStandings[g] ?? [];
      if (rows[2]?.teamId === third.teamId) {
        sourceKey = groupKeys[g];
        sourceIdx = g;
        break;
      }
    }
    qualifiers.push({
      seed: null,
      teamId: third.teamId,
      name: third.name ?? third.teamId,
      source: { groupKey: sourceKey, groupIndex: sourceIdx, rank: 3 },
      isBestThird: true,
    });
  }

  // Phase 3: Setzliste (Seeds deterministisch zuweisen)
  //
  //   - Reihenfolge: in Gruppenreihenfolge A1, B1, C1, …, dann A2, B2, C2, …,
  //     dann beste Dritte (in deren rankBestThirds-Reihenfolge).
  //   - Seeds 1..qualifiers.length.
  qualifiers.forEach((q, idx) => {
    q.seed = idx + 1;
  });

  return {
    qualifiers,
    bestThirdsUsed,
    totalQualifiers: qualifiers.length,
  };
}
