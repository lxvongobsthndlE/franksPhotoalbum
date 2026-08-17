/**
 * Tests für die Team-Farbpalette.
 *
 *   P1  paletteColorFor(0..N) liefert die kanonische Reihenfolge
 *   P2  paletteColorFor wrap-around bei Index >= palette.length
 *   P3  nextPaletteColor überspringt bereits vergebene Farben
 *   P4  nextPaletteColor cycelt, wenn alle Palette-Farben vergeben sind
 *   P5  nextPaletteColor mit leerer Liste beginnt bei Index 0
 *   P6  nextPaletteColor unterscheidet case-insensitive
 *
 *   P7  Parität Frontend ↔ Backend: die Hex-Werte in
 *       `backend/public/script/tournament.js` (Konstante
 *       `TEAM_COLOR_PALETTE`) müssen identisch sein mit
 *       `backend/src/modules/tournament/team-colors.js`.
 *       Hintergrund: Beim Anlegen im Wizard wird die Farbe FRONTEND-
 *       seitig gesetzt (Live-Preview), und der Backend `/teams`-Route
 *       legt beim Persistieren NOCHMAL eine Palette-Farbe fest. Wenn
 *       die Paletten auseinanderlaufen, sieht der User vor und nach
 *       dem Save zwei verschiedene Farben.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  TEAM_COLOR_PALETTE,
  paletteColorFor,
  nextPaletteColor,
} from '../team-colors.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('Team-Farbpalette — Server-Seite (team-colors.js)', () => {
  it('P1: paletteColorFor(0..N) liefert die kanonische Reihenfolge', () => {
    for (let i = 0; i < TEAM_COLOR_PALETTE.length; i++) {
      expect(paletteColorFor(i)).toBe(TEAM_COLOR_PALETTE[i]);
    }
  });

  it('P2: paletteColorFor wrap-around bei Index >= palette.length', () => {
    const len = TEAM_COLOR_PALETTE.length;
    expect(paletteColorFor(len)).toBe(TEAM_COLOR_PALETTE[0]);
    expect(paletteColorFor(len + 1)).toBe(TEAM_COLOR_PALETTE[1]);
    expect(paletteColorFor(2 * len)).toBe(TEAM_COLOR_PALETTE[0]);
  });

  it('P3: nextPaletteColor überspringt bereits vergebene Farben', () => {
    const existing = [
      { color: TEAM_COLOR_PALETTE[0] },
      { color: TEAM_COLOR_PALETTE[1] },
    ];
    expect(nextPaletteColor(existing)).toBe(TEAM_COLOR_PALETTE[2]);
  });

  it('P4: nextPaletteColor cycelt, wenn alle Palette-Farben vergeben sind', () => {
    const allAssigned = TEAM_COLOR_PALETTE.map((c) => ({ color: c }));
    // Mit `allAssigned.length` Palette-Einträgen ist `paletteCount = 8`.
    // `palette[8 % 8] = palette[0]` → erste Farbe (cycling).
    expect(nextPaletteColor(allAssigned)).toBe(TEAM_COLOR_PALETTE[0]);
  });

  it('P5: nextPaletteColor mit leerer Liste beginnt bei Index 0', () => {
    expect(nextPaletteColor([])).toBe(TEAM_COLOR_PALETTE[0]);
    expect(nextPaletteColor(null)).toBe(TEAM_COLOR_PALETTE[0]);
    expect(nextPaletteColor(undefined)).toBe(TEAM_COLOR_PALETTE[0]);
  });

  it('P6: nextPaletteColor unterscheidet case-insensitive', () => {
    const existing = [
      { color: TEAM_COLOR_PALETTE[0].toUpperCase() },
      { color: TEAM_COLOR_PALETTE[1] },
    ];
    // Beide sollten als vergeben zählen — die dritte Farbe ist die nächste.
    expect(nextPaletteColor(existing)).toBe(TEAM_COLOR_PALETTE[2]);
  });

  it('Bonus: 9 Teams bekommen alle 8 Palette-Farben + eine Wiederholung', () => {
    // Wir simulieren, wie der Wizard Teams nacheinander anlegt: jedes
    // neue Team bekommt `nextPaletteColor` über die bisher vergebenen
    // Farben — die ALLE aus der Palette stammen.
    const teams = [];
    for (let i = 0; i < 9; i++) {
      const color = nextPaletteColor(teams);
      teams.push({ color });
    }
    const counts = new Map();
    for (const t of teams) counts.set(t.color, (counts.get(t.color) || 0) + 1);
    // Erste Farbe wird zweimal vergeben (Index 0 + Cycling nach 8 Teams).
    expect(counts.get(TEAM_COLOR_PALETTE[0])).toBe(2);
    for (let i = 1; i < TEAM_COLOR_PALETTE.length; i++) {
      expect(counts.get(TEAM_COLOR_PALETTE[i])).toBe(1);
    }
  });
});

describe('Team-Farbpalette — Parität Frontend ↔ Backend', () => {
  it('P7: tournament.js TEAM_COLOR_PALETTE === team-colors.js TEAM_COLOR_PALETTE', () => {
    // Wir lesen die JS-Datei und extrahieren die Hex-Werte aus dem
    // Array-Literal. Wir wollen NICHT, dass die Datei ausgeführt wird
    // — nur dass die Hex-Werte Zeichen-für-Zeichen übereinstimmen.
    const frontendPath = join(
      here,
      '..',
      '..',
      '..',
      '..',
      'public',
      'script',
      'tournament.js',
    );
    const src = readFileSync(frontendPath, 'utf8');

    // Suche das `TEAM_COLOR_PALETTE = [ ... ]`-Literal. Wir nehmen den
    // ersten Block, der mit `const TEAM_COLOR_PALETTE = [` beginnt.
    const marker = 'const TEAM_COLOR_PALETTE = [';
    const start = src.indexOf(marker);
    expect(start, 'TEAM_COLOR_PALETTE nicht in tournament.js gefunden').toBeGreaterThanOrEqual(0);
    const end = src.indexOf('];', start);
    const block = src.slice(start + marker.length, end);

    // Hex-Werte per Regex extrahieren — Reihenfolge bleibt erhalten.
    const frontendHex = [...block.matchAll(/'#([0-9A-Fa-f]{6})'/g)].map((m) => '#' + m[1].toUpperCase());

    // Reihenfolge muss identisch sein.
    expect(frontendHex).toEqual(TEAM_COLOR_PALETTE);

    // Bonus-Check: Länge der Paletten (Backend) gleich.
    expect(frontendHex.length).toBe(TEAM_COLOR_PALETTE.length);
  });
});
