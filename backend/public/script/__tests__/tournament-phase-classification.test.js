/**
 * Tests für Phasen-Klassifikation und -Label v3-Status.
 *
 * Hintergrund (Issue 6, 2026-08-13):
 *   - Vorher hatte main.js eine v2-Phase-Mapping (`registration`,
 *     `in_progress`, `completed`), die v3-Status
 *     (`draft`, `generated`, `group_stage`, `ko_stage`, `finished`)
 *     NICHT abdeckte. Folge: Turniere mit Status `generated`
 *     (kurz nach Generierung) tauchten in der Liste NICHT auf.
 *   - Unbekannte Status-Werte führten stillschweigend zu
 *     `phase = 'draft'` → alle unklassifizierten Turniere landeten
 *     unter "Entwurf" statt sichtbar zu sein.
 *
 * Spec §13.5 ("Keine stillen Annahmen"): unbekannter Status MUSS
 * unter "Sonstige" erscheinen, nicht verschwinden und nicht falsch
 * einsortiert werden.
 *
 * Diese Tests prüfen:
 *   - v3-Status → Phase + Label
 *   - v2-Aliase (registration/scheduled/in_progress/completed) → v3-Phase
 *   - Unbekannter Status → "Sonstige" (nicht 'Entwurf')
 *   - Phasen-Reihenfolge (Entwurf / Bereit / Läuft / Beendet / Sonstige)
 *     für die Listen-Gruppierung
 */

import { describe, it, expect } from 'vitest';
import {
  tournamentStatusPhase,
  tournamentPhaseLabel,
  tournamentStatusLabel,
  tournamentModeLabel,
  TOURNAMENT_PHASE_ORDER,
} from '../tournament.js';

describe('tournamentStatusPhase — v3-Status-Klassifikation', () => {
  it.each([
    ['draft', 'draft'],
    ['generated', 'ready'],
    ['group_stage', 'live'],
    ['ko_stage', 'live'],
    ['finished', 'finished'],
    ['cancelled', 'finished'],
  ])('Status "%s" → Phase "%s"', (status, expected) => {
    expect(tournamentStatusPhase(status)).toBe(expected);
  });
});

describe('tournamentStatusPhase — v2-Aliase werden auf v3-Phasen gemappt', () => {
  it('registration → ready (v3: "generated")', () => {
    expect(tournamentStatusPhase('registration')).toBe('ready');
  });
  it('scheduled → ready', () => {
    expect(tournamentStatusPhase('scheduled')).toBe('ready');
  });
  it('in_progress → live', () => {
    expect(tournamentStatusPhase('in_progress')).toBe('live');
  });
  it('completed → finished', () => {
    expect(tournamentStatusPhase('completed')).toBe('finished');
  });
});

describe('tournamentStatusPhase — Unbekannter Status → "Sonstige"', () => {
  it('null → "other"', () => {
    expect(tournamentStatusPhase(null)).toBe('other');
  });
  it('undefined → "other"', () => {
    expect(tournamentStatusPhase(undefined)).toBe('other');
  });
  it('"" (leerer String) → "other"', () => {
    expect(tournamentStatusPhase('')).toBe('other');
  });
  it('"garbage" → "other" — keine stillen Annahmen, kein falsches Einsortieren', () => {
    expect(tournamentStatusPhase('garbage')).toBe('other');
  });
  it('"v4_in_distant_future" → "other" — zukunftssicher', () => {
    expect(tournamentStatusPhase('v4_in_distant_future')).toBe('other');
  });
});

describe('tournamentPhaseLabel — deutsche Bezeichnungen', () => {
  it.each([
    ['draft', 'Entwurf'],
    ['ready', 'Bereit'],
    ['live', 'Läuft'],
    ['finished', 'Beendet'],
    ['cancelled', 'Abgebrochen'],
    ['other', 'Sonstige'],
  ])('Phase "%s" → Label "%s"', (phase, expected) => {
    expect(tournamentPhaseLabel(phase)).toBe(expected);
  });
});

describe('TOURNAMENT_PHASE_ORDER — Reihenfolge in der Listen-Gruppierung', () => {
  it('enthält genau die 5 v3-Phasen-Keys in fester Reihenfolge', () => {
    expect(TOURNAMENT_PHASE_ORDER).toEqual([
      'draft',
      'ready',
      'live',
      'finished',
      'other',
    ]);
  });
});

describe('tournamentModeLabel — deutsche Bezeichnungen (Issue 6 Folgefehler)', () => {
  // Hintergrund (2026-08-13): Detail-View zeigte "Modus: groups_ko" — ein
  // DB-Token, der direkt ins UI durchschlug. Spec §8.0 Punkt 8 verbietet
  // solche Rohwerte explizit ("Klartext statt technischer Bezeichner").
  it.each([
    ['groups_ko', 'Gruppen + K.-o.'],
    ['groups_only', 'Nur Gruppenphase'],
    ['ko_only', 'Nur K.-o.'],
    ['double_elim', 'Double Elimination'],
  ])('Modus "%s" → Label "%s"', (mode, expected) => {
    expect(tournamentModeLabel(mode)).toBe(expected);
  });

  it('Unbekannter Modus → "Sonstiges" (kein Rohwert durchschlagen lassen)', () => {
    expect(tournamentModeLabel('something_else')).toBe('Sonstiges');
    expect(tournamentModeLabel(null)).toBe('Sonstiges');
    expect(tournamentModeLabel(undefined)).toBe('Sonstiges');
    expect(tournamentModeLabel('')).toBe('Sonstiges');
  });
});
