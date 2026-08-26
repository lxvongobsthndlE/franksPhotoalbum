/**
 * Tiebreaker mit harter Obergrenze. Spec §5.4 + §13 Constraint #4.
 *
 * Standard-Hierarchie:
 *   1. Punkte
 *   2. Tordifferenz
 *   3. Erzielte Tore
 *   4. Direkter Vergleich (Sub-Tabelle)
 *   5. Siege
 *   6. Alphabet / ID (deterministisches Finale)
 *
 * Wenn nach allen Kriterien noch Gleichstand → { unresolved: [...] }.
 * Wirft NICHT — der UI muss das Feld auswerten und manuell entscheiden.
 *
 * §13 #4: Iterative Auflösung mit `maxDepth` als Obergrenze für die Anzahl
 * der Tie-Gruppen, die wir per Head-to-Head-Sub-Tabelle aufzulösen versuchen.
 * Keine Rekursion, kein Stack-Overflow.
 */

import { computeHeadToHeadSubTable } from './standings.js';

const TIEBREAKER_FIELDS = {
  points: (row) => row.points ?? 0,
  goalDiff: (row) => row.goalDiff ?? 0,
  goalsFor: (row) => row.goalsFor ?? 0,
  goalsAgainst: (row) => -(row.goalsAgainst ?? 0), // weniger ist besser
  headToHead: (row) => row.h2hPoints ?? 0,
  wins: (row) => row.won ?? 0,
};

/**
 * Wendet Tiebreaker-Hierarchie iterativ an.
 *
 * @param {Array} standingsRows    von computeStandings
 * @param {Array} finishedMatches
 * @param {object} config          { tiebreakers, maxTiebreakerDepth }
 * @returns {{ sortedRows: Array, unresolved: Array }}
 */
export function applyTiebreaker(standingsRows, finishedMatches, config) {
  const order = config?.tiebreakers ?? ['points', 'goalDiff', 'goalsFor', 'headToHead'];
  const maxDepth = config?.maxTiebreakerDepth ?? 16;

  // Head-to-Head-Punkte in jede Row injizieren (falls als Tiebreaker gewünscht)
  const h2hRows = computeHeadToHeadSubTable(
    standingsRows.map((r) => r.teamId),
    finishedMatches
  );
  const h2hPoints = new Map(h2hRows.map((r) => [r.teamId, r.points]));

  const enriched = standingsRows.map((r) => ({
    ...r,
    h2hPoints: h2hPoints.get(r.teamId) ?? 0,
    _name: r.name ?? r.teamId,
  }));

  // Sortierung mit Tiebreaker-Hierarchie (Comparator macht auch alphabetisches
  // Finale als deterministischer Fallback).
  const sorted = enriched.slice().sort(comparatorWith(order));

  // Iterative Auflösung der Tie-Gruppen per Head-to-Head.
  // maxDepth = Anzahl Tie-Gruppen, die wir per H2H aufzulösen versuchen.
  const { sortedRows, unresolved } = resolveTieGroups(sorted, order, finishedMatches, maxDepth);

  return { sortedRows, unresolved };
}

function comparatorWith(order) {
  return (a, b) => {
    for (const criterion of order) {
      const getter = TIEBREAKER_FIELDS[criterion] ?? TIEBREAKER_FIELDS.points;
      const av = getter(a);
      const bv = getter(b);
      if (av !== bv) return bv - av;
    }
    if (a._name < b._name) return -1;
    if (a._name > b._name) return 1;
    return 0;
  };
}

/**
 * Iterative Auflösung von Tie-Gruppen. Spec §10.7 + §13 #4.
 *
 *   1. Laufe durch `sorted` und finde zusammenhängende Gruppen gleicher Werte
 *      über alle Tiebreaker-Kriterien.
 *   2. Für jede Gruppe: versuche, mit Head-to-Head-Sub-Tabelle zu trennen.
 *   3. Tie-Gruppen werden bis zu `maxDepth` Mal per H2H aufgelöst.
 *      Danach oder wenn H2H nichts trennt → als `unresolved` markiert.
 *
 * @returns {{ sortedRows: Array, unresolved: Array }}
 */
function resolveTieGroups(sorted, order, finishedMatches, maxDepth) {
  const unresolved = [];
  const result = [];
  let depth = 0;

  let i = 0;
  while (i < sorted.length) {
    const front = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && sameTie(sorted[i], sorted[j], order)) {
      front.push(sorted[j]);
      j++;
    }

    if (front.length === 1) {
      result.push(sorted[i]);
      i = j;
      continue;
    }

    // Tie-Gruppe ≥ 2 Teams
    depth += 1;
    if (depth > maxDepth) {
      unresolved.push({
        teamIds: front.map((r) => r.teamId),
        criterion: 'maxDepth',
      });
      result.push(...front);
      i = j;
      continue;
    }

    if (order.includes('headToHead')) {
      const subRows = computeHeadToHeadSubTable(
        front.map((r) => r.teamId),
        finishedMatches
      );
      const h2hMap = new Map(subRows.map((r) => [r.teamId, r]));

      // Innerhalb der Gruppe nach H2H-Punkten sortieren.
      // Bei weiteren Kriterien (Tordiff etc.) wird der H2H-Comparator angewendet.
      const h2hSorted = front.slice().sort(h2hComparator(h2hMap));

      // Prüfe, ob die H2H-Sub-Tabelle trennt.
      const stillTied = isGroupStillTied(h2hSorted, h2hMap);
      if (stillTied) {
        unresolved.push({
          teamIds: front.map((r) => r.teamId),
          criterion: order[order.length - 1] ?? 'headToHead',
        });
      }
      result.push(...h2hSorted);
    } else {
      unresolved.push({
        teamIds: front.map((r) => r.teamId),
        criterion: order[order.length - 1] ?? 'unknown',
      });
      result.push(...front);
    }

    i = j;
  }

  return { sortedRows: result, unresolved };
}

function h2hComparator(h2hMap) {
  return (a, b) => {
    const aRow = h2hMap.get(a.teamId);
    const bRow = h2hMap.get(b.teamId);
    const ap = aRow?.points ?? 0;
    const bp = bRow?.points ?? 0;
    if (ap !== bp) return bp - ap;
    const agd = (aRow?.gf ?? 0) - (aRow?.ga ?? 0);
    const bgd = (bRow?.gf ?? 0) - (bRow?.ga ?? 0);
    if (agd !== bgd) return bgd - agd;
    const agf = aRow?.gf ?? 0;
    const bgf = bRow?.gf ?? 0;
    if (agf !== bgf) return bgf - agf;
    return 0;
  };
}

function isGroupStillTied(sortedGroup, h2hMap) {
  if (sortedGroup.length < 2) return false;
  const first = h2hMap.get(sortedGroup[0].teamId);
  return sortedGroup.slice(1).every((row) => {
    const other = h2hMap.get(row.teamId);
    if (!first || !other) return false;
    return (
      first.points === other.points &&
      (first.gf ?? 0) - (first.ga ?? 0) === (other.gf ?? 0) - (other.ga ?? 0) &&
      (first.gf ?? 0) === (other.gf ?? 0)
    );
  });
}

function sameTie(a, b, order) {
  for (const criterion of order) {
    const getter = TIEBREAKER_FIELDS[criterion] ?? TIEBREAKER_FIELDS.points;
    if (getter(a) !== getter(b)) return false;
  }
  return true;
}
