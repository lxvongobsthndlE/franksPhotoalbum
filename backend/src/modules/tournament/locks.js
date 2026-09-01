/**
 * Turnier-Lock-Logik — Weiterleitung auf die EINE Implementierung.
 *
 * Die Logik lebt seit 2026-09-01 in `backend/public/script/locks.js`, weil
 * sie im Browser gebraucht wird und nur `backend/public` ausgeliefert wird
 * (app.js, Static-Root). Vorher lag die Datei hier — der Server sah sie,
 * der Browser nie: `window.tournamentLocks` blieb dort undefined, und alle
 * Renderer-Gates, die darauf lesen, fielen still auf ihren Fallback
 * zurueck (Rueckzugs-Knopf nie sichtbar, „Zurueck zu Entwurf" nie
 * sichtbar). Kein Test hat das gesehen, weil jeder die Lock-Tabelle
 * direkt importierte.
 *
 * Bewusst KEIN Zwilling (wie normalize-confirm-name.js), sondern ein
 * Re-Export: eine Wahrheit, zwei Aufrufer — das war die Zusage von
 * Etappe B.8, und eine Kopie mit Paritaetstest ist nur ein Versprechen,
 * dass sie bei jeder Aenderung mitgezogen wird.
 */
export * from '../../../public/script/locks.js';
