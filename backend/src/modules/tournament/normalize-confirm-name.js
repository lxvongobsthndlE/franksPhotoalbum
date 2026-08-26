// ----------------------------------------------------------------
// Turnier-Bestätigungs-Vergleich (§13.10) — Server-Quelle.
//
// Spec verlangt: case-insensitiv, führender/folgender Whitespace
// ignoriert. "Sommer-Cup 2026" matched auf "  sommer-cup 2026  ".
//
// DIESE LOGIK MUSS IDENTISCH SEIN MIT:
//   backend/public/script/normalize-confirm-name.js
//
// Identität wird geprüft durch
//   backend/src/modules/tournament/__tests__/normalize-confirm-name.test.js
// Bei Änderungen: BEIDE Dateien anpassen, Test laufen lassen.
//

export function normalizeConfirmName(name) {
  return String(name == null ? '' : name)
    .trim()
    .toLowerCase();
}
