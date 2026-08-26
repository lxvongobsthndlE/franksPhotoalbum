/**
 * Team-Farbpalette.
 *
 * Wird beim Anlegen eines Teams automatisch ein Eintrag aus dieser Palette
 * zugewiesen, wenn das Team noch keine eigene Farbe hat. Der Index zählt
 * monoton — das 9. Team bekommt wieder die erste Farbe, das 17. wieder die
 * erste usw. (cycling). Damit ist die Zuweisung deterministisch und
 * "benachbarte Teams" bekommen deutlich unterscheidbare Farben.
 *
 * Wichtig: Diese Palette MUSS identisch sein mit der im Frontend
 * (siehe `backend/public/script/tournament.js` — Konstante
 * `TEAM_COLOR_PALETTE`). Wir prüfen das per Test in
 * `team-colors-parity.test.js`.
 *
 * Kontrast: alle Werte sind auf hellem UND dunklem Hintergrund
 * ausreichend kontrastreich (kein Pastell).
 */

export const TEAM_COLOR_PALETTE = [
  '#4F46E5', // Indigo
  '#059669', // Emerald
  '#D97706', // Amber
  '#E11D48', // Rose
  '#0284C7', // Sky
  '#7C3AED', // Violet
  '#0D9488', // Teal
  '#EA580C', // Orange
];

/**
 * Liefert die Palette-Farbe für den n-ten Eintrag (0-indexiert).
 * Cycling: bei mehr als PALETTE.length Teams beginnt die Palette
 * wieder von vorne — kein Anlass, hier zu erroren.
 */
export function paletteColorFor(index) {
  const palette = TEAM_COLOR_PALETTE;
  if (palette.length === 0) return null;
  const i = ((index % palette.length) + palette.length) % palette.length;
  return palette[i];
}

/**
 * Liefert die nächste freie Palette-Farbe für ein Turnier, d. h.
 * die erste Farbe, die noch von KEINEM anderen Team dieses Turniers
 * benutzt wird. Wenn alle Palette-Farben schon vergeben sind,
 * wird gecycled (Team 9 bekommt wieder die erste Farbe).
 *
 * @param {Array<{color: string|null}>} existingTeams
 *        Die Teams, die dem Turnier schon angehören — in `createdAt asc`.
 * @returns {string|null} Hex-Farbe oder null, wenn die Palette leer ist.
 */
export function nextPaletteColor(existingTeams) {
  const palette = TEAM_COLOR_PALETTE;
  if (palette.length === 0) return null;

  const usedColors = new Set(
    (existingTeams || [])
      .map((t) => (typeof t?.color === 'string' ? t.color.toLowerCase() : null))
      .filter(Boolean)
  );

  // Suche die erste Palette-Farbe, die noch nicht vergeben ist.
  for (const color of palette) {
    if (!usedColors.has(color.toLowerCase())) return color;
  }
  // Alle Palette-Farben belegt → zähle, wie viele Teams eine Palette-Farbe
  // haben, und nimm modulo. Damit bekommt Team 9 die erste Farbe, Team 10
  // die zweite, usw.
  const paletteCount = (existingTeams || []).filter((t) => {
    const c = (t?.color ?? '').toLowerCase();
    return palette.some((p) => p.toLowerCase() === c);
  }).length;
  return palette[paletteCount % palette.length];
}
