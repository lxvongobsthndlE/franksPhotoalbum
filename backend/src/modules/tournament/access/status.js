/**
 * Status-/Modus-Enums → deutsche Labels.
 * Spec §1.2, §4, §7, §8.6.
 *
 * Bewusst nicht im UI: "group_stage", "groups_ko", "scheduled".
 * Bewusst hier: "Gruppenphase", "Gruppen + K.-o.", "offen".
 */

export const TOURNAMENT_STATUS = Object.freeze({
  draft: 'Entwurf',
  generated: 'Bereit',
  group_stage: 'Gruppenphase',
  ko_stage: 'K.-o.-Runde',
  finished: 'Beendet',
});

export const TOURNAMENT_MODE = Object.freeze({
  groups_ko: 'Gruppen + K.-o.',
  groups_only: 'Nur Gruppen',
  ko_only: 'Nur K.-o.',
  double_elim: 'Doppel-K.O.',
});

// Spec §7: "Es gibt keinen Live-Ticker. Ergebnisse werden ausschließlich
// vom Admin nachträglich eingetragen. Ein Spiel hat nur zwei Zustände: offen
// und beendet. Ein Zwischenzustand läuft ist optional."
//
// Wir behalten 'live' im DB-Wert (für künftige Erweiterungen), mappen hier
// aber auf "läuft", damit das UI nie einen englischen Status sieht.
export const MATCH_STATUS = Object.freeze({
  scheduled: 'offen',
  live: 'läuft',
  finished: 'beendet',
});

export const STAGE_TYPE = Object.freeze({
  group: 'Gruppenphase',
  ko: 'K.-o.-Runde',
  intermediate_group: 'Zwischenrunde',
  losers: 'Loser-Bracket',
});

// KO-Rundenkürzel → sprechender Name (Spec §6.5)
export const ROUND_LABEL = Object.freeze({
  R32: 'Sechzehntelfinale',
  R16: 'Achtelfinale',
  QF: 'Viertelfinale',
  SF: 'Halbfinale',
  F: 'Finale',
  '3RD': 'Spiel um Platz 3',
});

export function tournamentStatusLabel(status) {
  if (status == null) return '';
  return TOURNAMENT_STATUS[status] ?? String(status);
}

/**
 * Badge-Label für die Listen-Karte (Spec §13.2).
 *
 * Verdichtet die Phase ("Gruppenphase" / "K.-o.-Runde") auf "Läuft",
 * weil die Karte nur zeigen soll, ob das Turnier aktuell läuft — das
 * "Was gerade läuft" wird im Detail-View aufgelöst.
 *
 * Mapping:
 *   draft        → Entwurf
 *   generated    → Bereit
 *   group_stage  → Läuft
 *   ko_stage     → Läuft
 *   finished     → Beendet
 */
export function tournamentCardStatusLabel(status) {
  if (status === 'group_stage' || status === 'ko_stage') return 'Läuft';
  return tournamentStatusLabel(status);
}

/**
 * Phasen-Label für Listen-Karte und Seitenleiste (ab 2026-09-01).
 *
 * Ersetzt tournamentCardStatusLabel als Quelle für `cardStatusLabel`: der
 * Status allein kennt „läuft" nicht mehr, seit der Start nur startedAt
 * setzt. Die Phase kommt aus locks.js (tournamentPhase) — hier steht nur
 * der Text dazu.
 */
export const TOURNAMENT_PHASE = Object.freeze({
  draft: 'Entwurf',
  ready: 'Bereit',
  live: 'Läuft',
  finished: 'Beendet',
  other: 'Sonstige',
});

export function tournamentPhaseLabel(phase) {
  return TOURNAMENT_PHASE[phase] ?? TOURNAMENT_PHASE.other;
}

export function tournamentModeLabel(mode) {
  if (mode == null) return '';
  return TOURNAMENT_MODE[mode] ?? String(mode);
}

export function matchStatusLabel(status) {
  if (status == null) return 'offen';
  return MATCH_STATUS[status] ?? String(status);
}

export function stageTypeLabel(type) {
  if (type == null) return '';
  return STAGE_TYPE[type] ?? String(type);
}

export function roundLabel(round) {
  if (round == null) return '';
  return ROUND_LABEL[round] ?? String(round);
}
