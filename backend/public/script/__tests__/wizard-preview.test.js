/**
 * Tests für die Wizard-Vorschau-Funktionen (Spec §13.3).
 *
 * Regressions-Schutz für Bug 10 (2026-08-18): Die Checkbox „Spiel um
 * Platz 3" hat vorher nur state.thirdPlaceMatch gesetzt + notifyChange
 * gerufen, aber KEIN refreshShell() — Preview-Card und Live-EndInfo-
 * Text blieben bei „7 K.-o.-Spiele" stehen, obwohl der korrekte Wert
 * 8 wäre. Diese Tests sichern die Pure-Function-Seite: computeEndInfo
 * muss thirdPlaceMatch korrekt einrechnen.
 *
 * Die UI-Seite (refreshShell-Aufruf) wird manuell im Browser geprüft.
 */

import { describe, it, expect } from 'vitest';
import {
  computeEndInfo,
  estimateKoGames,
  bracketSizeLabel,
  countGroupGames,
} from '../wizard-preview-helpers.js';

// ─────────────────────────────────────────────────────────────────
// Basisfixtures
// ─────────────────────────────────────────────────────────────────

// 8 Teams in 1 Gruppe, alle 8 steigen auf → bracket=8 → 7 Siegerpfad-Spiele.
// (Bug 10-Original-Szenario: User sah „4 VF + 2 HF + Finale" = 7.)
const baseEightQualifiers = () => ({
  teams: Array.from({ length: 8 }, (_, i) => ({ name: `T${i + 1}` })),
  mode: 'groups_ko',
  numGroups: 1,
  advancePerGroup: 8,
  bestThirdsCount: 0,
  thirdPlaceMatch: false,
  matchDuration: 30,
  pauseMinutes: 5,
  numTables: 2,
  startTime: '14:00',
  doubleRoundRobin: false,
});

// ─────────────────────────────────────────────────────────────────
// Bug 10 Regression: thirdPlaceMatch erhöht koGames um 1
// ─────────────────────────────────────────────────────────────────

describe('computeEndInfo — Bug 10 Regression', () => {
  it('8 Qualifikanten + thirdPlaceMatch=false → 7 K.-o.-Spiele (4 VF + 2 HF + Finale)', () => {
    // Bug 10-Ausgangslage: ohne Checkbox zeigt Preview 7.
    const info = computeEndInfo(baseEightQualifiers());
    expect(info.koGames).toBe(7);
    expect(info.groupGames).toBeGreaterThan(0);
    expect(info.totalGames).toBe(info.groupGames + info.koGames);
  });

  it('8 Qualifikanten + thirdPlaceMatch=true → 8 K.-o.-Spiele (4 VF + 2 HF + Finale + Spiel um Platz 3)', () => {
    // Bug 10-Fix-Ziel: mit Checkbox muss Preview 8 zeigen.
    const state = { ...baseEightQualifiers(), thirdPlaceMatch: true };
    const info = computeEndInfo(state);
    expect(info.koGames).toBe(8);
  });

  it('4 Qualifikanten + thirdPlaceMatch=true → 4 K.-o.-Spiele (2 HF + Finale + Spiel um Platz 3)', () => {
    const state = {
      ...baseEightQualifiers(),
      numGroups: 1,
      advancePerGroup: 4,
      bestThirdsCount: 0,
      thirdPlaceMatch: true,
      teams: Array.from({ length: 4 }, (_, i) => ({ name: `T${i + 1}` })),
    };
    const info = computeEndInfo(state);
    // bracket=4 → 3 Siegerpfad-Spiele + 1 für Platz 3 = 4.
    expect(info.koGames).toBe(4);
  });

  it('2 Qualifikanten + thirdPlaceMatch=true → 2 K.-o.-Spiele (Finale + Spiel um Platz 3)', () => {
    const state = {
      ...baseEightQualifiers(),
      numGroups: 1,
      advancePerGroup: 2,
      teams: Array.from({ length: 2 }, (_, i) => ({ name: `T${i + 1}` })),
      thirdPlaceMatch: true,
    };
    const info = computeEndInfo(state);
    // bracket=2 → 1 Siegerpfad-Spiel + 1 für Platz 3 = 2.
    expect(info.koGames).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// Modus groups_only
// ─────────────────────────────────────────────────────────────────

describe('computeEndInfo — groups_only', () => {
  it('reine Gruppenphase: koGames=0, groupGames > 0', () => {
    const state = { ...baseEightQualifiers(), mode: 'groups_only', thirdPlaceMatch: true };
    const info = computeEndInfo(state);
    expect(info.koGames).toBe(0);
    expect(info.groupGames).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Modus ko_only
// ─────────────────────────────────────────────────────────────────

describe('computeEndInfo — ko_only', () => {
  it('4 Teams + thirdPlaceMatch=false → 3 K.-o.-Spiele', () => {
    const state = {
      ...baseEightQualifiers(),
      mode: 'ko_only',
      numGroups: 1,
      advancePerGroup: 0,
      teams: Array.from({ length: 4 }, (_, i) => ({ name: `T${i + 1}` })),
      thirdPlaceMatch: false,
    };
    const info = computeEndInfo(state);
    expect(info.koGames).toBe(3);
    expect(info.groupGames).toBe(0);
  });

  it('4 Teams + thirdPlaceMatch=true → 4 K.-o.-Spiele (3 Siegerpfad + Platz 3)', () => {
    const state = {
      ...baseEightQualifiers(),
      mode: 'ko_only',
      numGroups: 1,
      advancePerGroup: 0,
      teams: Array.from({ length: 4 }, (_, i) => ({ name: `T${i + 1}` })),
      thirdPlaceMatch: true,
    };
    const info = computeEndInfo(state);
    expect(info.koGames).toBe(4);
    expect(info.groupGames).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Beste Dritte fließen in Qualifikanten-Count
// ─────────────────────────────────────────────────────────────────

describe('computeEndInfo — bestThirds', () => {
  it('6 Teams / 3 Gruppen / 2 auf + 2 beste Dritte / thirdPlaceMatch=false → 7 KO-Spiele', () => {
    // 3*2 + 2 = 8 Qualifikanten → bracket=8 → 7 Siegerpfad-Spiele.
    const state = {
      ...baseEightQualifiers(),
      mode: 'groups_ko',
      numGroups: 3,
      advancePerGroup: 2,
      bestThirdsCount: 2,
      teams: Array.from({ length: 6 }, (_, i) => ({ name: `T${i + 1}` })),
      thirdPlaceMatch: false,
    };
    const info = computeEndInfo(state);
    expect(info.koGames).toBe(7);
  });

  it('… + thirdPlaceMatch=true → 8 KO-Spiele', () => {
    const state = {
      ...baseEightQualifiers(),
      mode: 'groups_ko',
      numGroups: 3,
      advancePerGroup: 2,
      bestThirdsCount: 2,
      teams: Array.from({ length: 6 }, (_, i) => ({ name: `T${i + 1}` })),
      thirdPlaceMatch: true,
    };
    const info = computeEndInfo(state);
    expect(info.koGames).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────
// Endzeit-Berechnung
// ─────────────────────────────────────────────────────────────────

describe('computeEndInfo — Endzeit', () => {
  it('Start 14:00 + 1 Spiel × 35 Min → Ende 14:35', () => {
    const state = {
      ...baseEightQualifiers(),
      matchDuration: 30,
      pauseMinutes: 5,
      numTables: 1,
      startTime: '14:00',
      teams: Array.from({ length: 2 }, (_, i) => ({ name: `T${i + 1}` })),
      numGroups: 1,
      advancePerGroup: 2,
      mode: 'ko_only',
      thirdPlaceMatch: false,
    };
    // 1 Spiel × (30+5) = 35 Min → 14:35.
    const info = computeEndInfo(state);
    expect(info.endLabel).toBe('14:35');
    expect(info.totalMinutes).toBe(35);
  });

  it('Start 23:50 + 30 min → Ende 00:20 (Tagesüberlauf)', () => {
    const state = {
      ...baseEightQualifiers(),
      matchDuration: 25,
      pauseMinutes: 5,
      numTables: 1,
      startTime: '23:50',
      teams: Array.from({ length: 2 }, (_, i) => ({ name: `T${i + 1}` })),
      numGroups: 1,
      advancePerGroup: 2,
      mode: 'ko_only',
      thirdPlaceMatch: false,
    };
    // 30 Min → 23:50 + 0:30 = 00:20.
    const info = computeEndInfo(state);
    expect(info.endLabel).toBe('00:20');
  });

  it('Fallback startTime wenn leer/undefined', () => {
    const state = {
      ...baseEightQualifiers(),
      startTime: undefined,
      matchDuration: 30,
      pauseMinutes: 5,
      numTables: 1,
      teams: Array.from({ length: 2 }, (_, i) => ({ name: `T${i + 1}` })),
      numGroups: 1,
      advancePerGroup: 2,
      mode: 'ko_only',
      thirdPlaceMatch: false,
    };
    const info = computeEndInfo(state);
    // Default 14:00 + 35 Min = 14:35.
    expect(info.endLabel).toBe('14:35');
  });
});

// ─────────────────────────────────────────────────────────────────
// estimateKoGames / bracketSizeLabel / countGroupGames
// ─────────────────────────────────────────────────────────────────

describe('estimateKoGames', () => {
  it('qualifiers=2 → 1 (Finale)', () => expect(estimateKoGames(2)).toBe(1));
  it('qualifiers=3 → 3 (HF + F, bracket=4)', () => expect(estimateKoGames(3)).toBe(3));
  it('qualifiers=4 → 3', () => expect(estimateKoGames(4)).toBe(3));
  it('qualifiers=5 → 7 (bracket=8)', () => expect(estimateKoGames(5)).toBe(7));
  it('qualifiers=8 → 7', () => expect(estimateKoGames(8)).toBe(7));
  it('qualifiers < 2 → 0', () => {
    expect(estimateKoGames(0)).toBe(0);
    expect(estimateKoGames(1)).toBe(0);
  });
});

describe('bracketSizeLabel', () => {
  it('bracket=2 → Finale', () => expect(bracketSizeLabel(2)).toBe('Finale'));
  it('bracket=4 → Halbfinale', () => expect(bracketSizeLabel(4)).toBe('Halbfinale'));
  it('bracket=8 → Viertelfinale', () => expect(bracketSizeLabel(8)).toBe('Viertelfinale'));
  it('bracket=16 → Achtelfinale', () => expect(bracketSizeLabel(16)).toBe('Achtelfinale'));
  it('qualifiers < 2 → kein K.-o.-Baum', () => expect(bracketSizeLabel(1)).toBe('kein K.-o.-Baum'));
});

describe('countGroupGames', () => {
  it('4 Teams / 1 Gruppe → 6 Spiele (Einfachrunde)', () => {
    expect(countGroupGames([4], false)).toBe(6);
  });
  it('3 Teams / 1 Gruppe → 3 Spiele', () => {
    expect(countGroupGames([3], false)).toBe(3);
  });
  it('Hin- und Rückrunde → × 2', () => {
    expect(countGroupGames([4], true)).toBe(12);
  });
  it('mehrere Gruppen summieren', () => {
    // [4, 4] → 6 + 6 = 12.
    expect(countGroupGames([4, 4], false)).toBe(12);
  });
});
