/**
 * Ranking der drittplatzierten Teams über alle Gruppen. Spec §6.3.1.
 *
 * WICHTIG (Spec §10.4): "rankBestThirds liefert IMMER pro Spiel normalisiert,
 * kein Konfig-Toggle."
 *
 *   score = points / played
 *   gdNorm = goalDiff / played
 *   gfNorm = goalsFor / played
 *
 * Bei gleicher Normalisierung: alphabetische Reihenfolge (deterministisch).
 *
 * @param {Array<Array>} groupStandingsRows
 *        Zwei akzeptierte Eingabeformen:
 *          (a) Pro Gruppe ein Array mit der vollen Tabelle (≥3 Teams):
 *              rows[2] = der Drittplatzierte.
 *          (b) Pro Gruppe ein Array mit genau 1 Element (= bereits
 *              herausgezogener Drittplatzierter-Row).
 *        Gruppen mit < 3 Teams (also 0 oder 2 Rows) werden ignoriert,
 *        weil dort kein dritter Platz existiert.
 * @returns {Array}   sortierte Drittplatzierte (bestes zuerst)
 */
export function rankBestThirds(groupStandingsRows) {
  if (!Array.isArray(groupStandingsRows)) return [];
  const thirds = [];

  for (const rows of groupStandingsRows) {
    const third = pickThird(rows);
    if (third) thirds.push(third);
  }

  const norm = (row) => {
    const played = row.played > 0 ? row.played : 1;
    return {
      ...row,
      _pointsPerGame: (row.points ?? 0) / played,
      _goalDiffPerGame: (row.goalDiff ?? 0) / played,
      _goalsForPerGame: (row.goalsFor ?? 0) / played,
    };
  };

  const normalized = thirds.map(norm);

  normalized.sort((a, b) => {
    if (a._pointsPerGame !== b._pointsPerGame) {
      return b._pointsPerGame - a._pointsPerGame;
    }
    if (a._goalDiffPerGame !== b._goalDiffPerGame) {
      return b._goalDiffPerGame - a._goalDiffPerGame;
    }
    if (a._goalsForPerGame !== b._goalsForPerGame) {
      return b._goalsForPerGame - a._goalsForPerGame;
    }
    // Final-Fallback: deterministisch
    const an = a.name ?? a.teamId ?? '';
    const bn = b.name ?? b.teamId ?? '';
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

  return normalized.map((r) => ({
    teamId: r.teamId,
    name: r.name ?? null,
    points: r.points,
    played: r.played,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    goalDiff: r.goalDiff,
    pointsPerGame: r._pointsPerGame,
    goalDiffPerGame: r._goalDiffPerGame,
    goalsForPerGame: r._goalsForPerGame,
  }));
}

/**
 * Holt die Drittplatzierten-Row aus einer Gruppen-Eingabe.
 * Unterstützt zwei Formen:
 *   - rows.length === 1 → bereits extrahierte Drittplatzierten-Row.
 *   - rows.length >= 3  → volle Tabelle, Index 2 ist der Drittplatzierte.
 *   - sonst (0 oder 2 Zeilen) → null, Gruppe wird ignoriert.
 */
function pickThird(rows) {
  if (!Array.isArray(rows)) return null;
  if (rows.length === 1) return rows[0] ?? null;
  if (rows.length >= 3) return rows[2] ?? null;
  return null;
}
