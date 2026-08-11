/**
 * Engine-Config — Defaults und mergeConfig.
 * Spec §3.
 *
 * Bewusst flach + serialisierbar: alles, was die Engine entscheidet, soll hier
 * konfigurierbar sein. Wer im UI was überschreibt, dokumentiert das hier.
 */

export const DEFAULT_CONFIG = Object.freeze({
  // ---- Verteilung der Teams in Gruppen (Spec §5.1)
  distribution: 'snake',           // 'snake' | 'random' | 'manual'

  // ---- Punkte (Spec §5.4)
  pointsPerWin: 3,
  pointsPerDraw: 1,
  pointsPerLoss: 0,

  // ---- Tiebreaker-Reihenfolge (Spec §5.4)
  // 'points' | 'goalDiff' | 'goalsFor' | 'headToHead' | 'wins'
  tiebreakers: ['points', 'goalDiff', 'goalsFor', 'headToHead'],

  // ---- §13 Constraint #4: harte Obergrenze für Tiebreaker-Rekursion
  maxTiebreakerDepth: 16,          // Standard > Anzahl Teams in einer Gruppe

  // ---- Qualifikation aus Gruppenphase (Spec §6.1)
  qualifyPerGroup: 2,             // Top N pro Gruppe
  bestThirds: 0,                  // zusätzliche "beste Dritte"

  // ---- KO-Konfiguration
  hasThirdPlacePlayoff: false,    // '3RD'-Match bei 4+ Teams
  seedProtection: 'group',      // 'group' = Same-Group-Spiele möglichst vermeiden

  // ---- Zeitplan (Spec §5.3)
  schedule: {
    slotMinutes: 15,
    matchDurationMinutes: 30,
    pauseAfterMatches: 0,
    parallelFields: 1,
    startTime: '10:00',           // HH:MM
  },
});

/**
 * Tiefes Merge: User-Werte überschreiben Defaults, aber fehlende Keys
 * bleiben auf Default. Eingaben werden NICHT mutiert.
 */
export function mergeConfig(partial) {
  const user = partial ?? {};
  const base = structuredClone(DEFAULT_CONFIG);

  for (const key of Object.keys(user)) {
    const value = user[key];
    if (
      value != null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      base[key] = { ...base[key], ...value };
    } else if (value !== undefined) {
      base[key] = value;
    }
  }

  return base;
}

/**
 * Tiebreaker-Comparator als Cascade (Spec §5.4).
 * Sortiert absteigend nach Hierarchie, dann nach name als finaler Determinismus.
 *
 * Liefert:
 *   { unresolved: [{teamIds, criterion}], sortedTeams: [...] }
 */
export function tiebreakerComparator(stats, order) {
  return (a, b) => {
    for (const criterion of order) {
      const av = stats(a, criterion);
      const bv = stats(b, criterion);
      if (av !== bv) return bv - av; // absteigend
    }
    // Final-Fallback: alphabetisch (deterministisch, nie Loop)
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  };
}