/**
 * Kleine cuid-Generator-Hilfe für Stellen, an denen wir eine eindeutige
 * Match-ID BRAUCHEN, BEVOR die Row in der DB ist.
 *
 * Hintergrund (Issue 1, 2026-08-12):
 *   Die Engine produziert deterministische Match-IDs im Format `g_A_1`,
 *   `ko_QF_1`, `ko_SF_1`. Die sind INNERHALB EINES Turniers stabil und
 *   nützlich für die internen Verweise (`winnerAdvancesTo`, `loserAdvancesTo`),
 *   aber sie sind NICHT global eindeutig. Wenn zwei Turniere mit derselben
 *   Konfig existieren, kollidieren die IDs beim Insert mit "Unique
 *   constraint failed on the (not available)" — das ist die PRIMARY KEY
 *   auf `matches.id`. Das vorherige defensive `match.deleteMany({where:
 *   {tournamentId}})` greift nur bei Re-Generate DESSELBEN Turniers, nicht
 *   wenn ein NEUES Turnier kollidierende IDs produziert.
 *
 *   Lösung: Engine behält ihre sprechenden IDs als interne Labels. Beim
 *   Persist wird JEDE Match-ID auf einen frischen cuid gemappt, BEVOR sie
 *   in die DB geht. So bleibt die Engine pur und testbar, und die DB-
 *   IDs sind garantiert global eindeutig.
 *
 * Format-Anlehnung an Prisma-Cuids: beginnt mit 'c', gefolgt von einer
 * Zeitkomponente (base36) und 16 Hex-Zeichen Entropie. Kollisions-
 * wahrscheinlichkeit bei 16 Hex-Zeichen Entropie ist für unsere Zwecke
 * (<< 1 Million Matches pro Prozess-Laufzeit) praktisch null.
 */

import { randomBytes } from 'node:crypto';

/**
 * Erzeugt eine neue cuid-ähnliche ID.
 *
 * Format: `c<8-stellige base36-Zeit><16-Hex-Entropie>`
 * Beispiel: `cmsq6kwyy00ebf201ace01baa`
 *
 * @returns {string}
 */
export function makeCuid() {
  const time = Date.now().toString(36).padStart(8, '0');
  const entropy = randomBytes(8).toString('hex'); // 16 Hex-Zeichen
  return `c${time}${entropy}`;
}
