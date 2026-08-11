// ----------------------------------------------------------------
// Turnier-Bestätigungs-Vergleich (§13.10) — Browser-Quelle.
//
// DIESE LOGIK MUSS IDENTISCH SEIN MIT:
//   backend/src/modules/tournament/normalize-confirm-name.js
//
// Identität wird geprüft durch
//   backend/src/modules/tournament/__tests__/normalize-confirm-name.test.js
//
// Verwendung im Browser:
//   import { normalizeConfirmName } from './normalize-confirm-name.js';
//   if (normalizeConfirmName(a) !== normalizeConfirmName(b)) { ... }
//
export function normalizeConfirmName(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}