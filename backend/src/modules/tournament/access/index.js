/**
 * Barrel — Aufbereitungsschicht.
 *
 * Ein Bildschirm importiert ausschließlich von hier; niemals direkt aus einer
 * DB-Zeile. Spec §0 + §12: "Kein Bildschirm greift direkt auf Datenbankzeilen
 * zu. Diese Schicht verhindert die gesamte Fehlerklasse aus §8.0 Punkt 12."
 */

export * from './placeholder.js';
export * from './status.js';
export * from './time.js';
export * from './team.js';
export * from './match.js';
export * from './group.js';
export * from './tournament.js';