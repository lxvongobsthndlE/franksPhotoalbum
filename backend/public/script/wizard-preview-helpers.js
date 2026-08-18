/**
 * Reine Wizard-Vorschau-Funktionen. Spec §13.3.
 *
 * Regressionsschutz für Bug 10 (2026-08-18): Die Checkbox „Spiel um
 * Platz 3" hat vorher nur state.thirdPlaceMatch gesetzt + notifyChange
 * gerufen, aber KEIN refreshShell() — Preview-Card und Live-EndInfo-
 * Text blieben bei „7 K.-o.-Spiele" stehen, obwohl der korrekte Wert
 * 8 wäre. Die Funktionen hier liefern die korrekten Counts; getrennt
 * davon muss die UI dafür sorgen, dass sie auch aufgerufen werden.
 *
 * Konventionen:
 *   - n Teams / 1 Gruppe Round-Robin       → n*(n-1)/2 Spiele
 *   - bracket-Size = nächste Zweierpotenz ≥ qualifiers
 *   - KO-Spiele im Siegerpfad             → bracket - 1
 *   - Spiel um Platz 3                    → +1 (nur wenn aktiv)
 *   - Reines KO                            → (n-1) + (thirdPlace ? 1 : 0)
 *
 * Wichtig (Spec §10.4): rankBestThirds normalisiert IMMER pro Spiel.
 * Diese Funktion hier rechnet absolute Counts.
 */

import { groupRowSizes } from './tournament-team-helpers.js';

/**
 * Anzahl der Gruppenspiele für die Verteilung `sizes`.
 *
 *   Beispiel: 4 Teams → 6 Spiele, 3 Teams → 3 Spiele, 5 Teams → 10.
 *   Bei Hin- und Rückrunde (doubleRoundRobin=true) × 2.
 */
export function countGroupGames(sizes, doubleRoundRobin) {
  const base = sizes.reduce((sum, n) => sum + (n * (n - 1)) / 2, 0);
  return Math.round(base) * (doubleRoundRobin ? 2 : 1);
}

/**
 * Anzahl der Spiele im KO-Siegerpfad.
 *
 *   bracket = nächste Zweierpotenz ≥ qualifiers
 *   return = bracket - 1
 *
 * Bei qualifiers < 2: 0 (kein KO-Baum möglich).
 *
 * Beispiele:
 *   qualifiers = 2  → bracket=2  → 1 Spiel (Finale)
 *   qualifiers = 3  → bracket=4  → 3 Spiele (HF + F)
 *   qualifiers = 4  → bracket=4  → 3 Spiele
 *   qualifiers = 8  → bracket=8  → 7 Spiele (VF + HF + F)
 */
export function estimateKoGames(qualifiers) {
  if (qualifiers < 2) return 0;
  const bracket = Math.pow(2, Math.ceil(Math.log2(Math.max(2, qualifiers))));
  return bracket - 1;
}

/**
 * Kombinierte Vorschau: Gruppenspiele + KO-Spiele + Endzeit.
 *
 * @param {object} state    Wizard-State mit Feldern:
 *                          teams[], mode, numGroups, advancePerGroup,
 *                          bestThirdsCount, thirdPlaceMatch, matchDuration,
 *                          pauseMinutes, numTables, startTime, doubleRoundRobin
 * @returns {{groupGames:number, koGames:number, totalGames:number,
 *           totalMinutes:number, endLabel:string}}
 */
export function computeEndInfo(state) {
  const sizes = groupRowSizes(state.teams.length, state.numGroups);
  let groupGames = 0;
  let koGames = 0;

  if (state.mode === 'ko_only') {
    // Reines K.-o.: n Teams → n-1 Spiele bis zum Sieger
    // (Siegerpfad). Bei „Spiel um Platz 3" +1.
    // Freilose werden bei der Zeitplanung nicht extra gerechnet — der
    // Bracket hat trotzdem (Zweierpotenz − 1) Slots, aber kein Team
    // bestreitet ein Freilos-Spiel. n-1 ist die ehrliche Aussage.
    koGames = Math.max(0, state.teams.length - 1)
      + (state.thirdPlaceMatch ? 1 : 0);
  } else if (state.mode === 'groups_only') {
    // Reine Gruppenphase, keine K.-o.-Phase.
    groupGames = countGroupGames(sizes, state.doubleRoundRobin);
  } else {
    // groups_ko: Gruppenphase + K.-o.-Baum aus den Qualifikanten.
    groupGames = countGroupGames(sizes, state.doubleRoundRobin);
    const qualifiers = state.numGroups * state.advancePerGroup
      + (state.bestThirdsCount ?? 0);
    koGames = estimateKoGames(qualifiers) + (state.thirdPlaceMatch ? 1 : 0);
  }

  const totalGames = groupGames + koGames;
  const slotMinutes = state.matchDuration + state.pauseMinutes;
  const slots = Math.max(1, Math.ceil(totalGames / Math.max(1, state.numTables)));
  const totalMinutes = slots * slotMinutes;
  const [hh, mm] = (state.startTime || '14:00').split(':').map(Number);
  const endMinutes = (hh * 60 + mm) + totalMinutes;
  const endH = Math.floor((endMinutes / 60) % 24);
  const endM = endMinutes % 60;
  const endLabel = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  return {
    endLabel,
    totalMinutes,
    groupGames,
    koGames,
    totalGames,
  };
}

/**
 * Menschenlesbares Label für die Bracket-Größe.
 *
 *   bracket = 2  → Finale
 *   bracket = 4  → Halbfinale
 *   bracket = 8  → Viertelfinale
 *   bracket = 16 → Achtelfinale
 *   bracket = 32 → Sechzehntelfinale
 *   sonst        → '{n}er-Baum'
 */
export function bracketSizeLabel(qualifiers) {
  if (qualifiers < 2) return 'kein K.-o.-Baum';
  const bracket = Math.pow(2, Math.ceil(Math.log2(qualifiers)));
  if (bracket === 2) return 'Finale';
  if (bracket === 4) return 'Halbfinale';
  if (bracket === 8) return 'Viertelfinale';
  if (bracket === 16) return 'Achtelfinale';
  if (bracket === 32) return 'Sechzehntelfinale';
  return `${bracket}er-Baum`;
}

// Browser-Global-Hook
if (typeof window !== 'undefined') {
  window.wizardPreviewHelpers = {
    countGroupGames,
    estimateKoGames,
    computeEndInfo,
    bracketSizeLabel,
  };
}