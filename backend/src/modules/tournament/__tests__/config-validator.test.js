/**
 * Tests: Config-Validator.
 *
 * Spec §13 ("keine stillen Annahmen"): der Validator MUSS bei Müll
 * hart fehlschlagen (400), nicht still korrigieren. Diese Tests
 * dokumentieren die Vertragsfläche für die PATCH-Route.
 */

import { describe, it, expect } from 'vitest';
import {
  validateConfigPatch,
  ALLOWED_TIEBREAKERS,
  ALLOWED_DISTRIBUTION,
} from '../config-validator.js';

function ok(result) {
  expect(result.ok).toBe(true);
  return result.value;
}

function fail(result) {
  expect(result.ok).toBe(false);
  return result;
}

describe('validateConfigPatch — Smoke', () => {
  it('null / undefined → leere Config', () => {
    expect(ok(validateConfigPatch(null))).toEqual({});
    expect(ok(validateConfigPatch(undefined))).toEqual({});
  });

  it('Array → Fehler', () => {
    const r = fail(validateConfigPatch([]));
    expect(r.error).toBe('invalid_config');
    expect(r.field).toBe(null);
  });

  it('Primitive → Fehler', () => {
    fail(validateConfigPatch(42));
    fail(validateConfigPatch('hallo'));
  });
});

describe('validateConfigPatch — Whitelist', () => {
  it('Unbekannte Schlüssel werden verworfen, bekannte übernommen', () => {
    const r = ok(validateConfigPatch({
      pointsPerWin: 5,
      totallyUnknown: 'value',
      anotherJunk: { nested: true },
    }));
    expect(r.pointsPerWin).toBe(5);
    expect('totallyUnknown' in r).toBe(false);
    expect('anotherJunk' in r).toBe(false);
  });

  it('Komplett leeres Objekt → leere Config', () => {
    expect(ok(validateConfigPatch({}))).toEqual({});
  });
});

describe('validateConfigPatch — distribution', () => {
  it('snake/random/manual akzeptiert', () => {
    for (const d of ALLOWED_DISTRIBUTION) {
      const r = ok(validateConfigPatch({ distribution: d }));
      expect(r.distribution).toBe(d);
    }
  });

  it('Unbekannter Wert abgelehnt', () => {
    const r = fail(validateConfigPatch({ distribution: 'foo' }));
    expect(r.field).toBe('distribution');
  });
});

describe('validateConfigPatch — Punkte', () => {
  it('Punkte müssen integer >= 0 sein', () => {
    expect(ok(validateConfigPatch({ pointsPerWin: 0 })).pointsPerWin).toBe(0);
    expect(ok(validateConfigPatch({ pointsPerWin: 5 })).pointsPerWin).toBe(5);
  });

  it('-1 abgelehnt', () => {
    fail(validateConfigPatch({ pointsPerWin: -1 }));
  });

  it('Float abgelehnt (1.5)', () => {
    fail(validateConfigPatch({ pointsPerDraw: 1.5 }));
  });

  it('String abgelehnt', () => {
    fail(validateConfigPatch({ pointsPerLoss: '0' }));
  });
});

describe('validateConfigPatch — Tiebreaker', () => {
  it('Volle Liste gültig', () => {
    const r = ok(validateConfigPatch({
      tiebreakers: ['points', 'goalDiff', 'headToHead'],
    }));
    expect(r.tiebreakers).toEqual(['points', 'goalDiff', 'headToHead']);
  });

  it('Unbekanntes Kriterium abgelehnt', () => {
    const r = fail(validateConfigPatch({
      tiebreakers: ['points', 'goalDiff', 'geheimesKriterium'],
    }));
    expect(r.field).toBe('tiebreakers');
    expect(r.message).toMatch(/geheimesKriterium/);
  });

  it('Leere Liste abgelehnt', () => {
    fail(validateConfigPatch({ tiebreakers: [] }));
  });

  it('Duplikate abgelehnt', () => {
    const r = fail(validateConfigPatch({
      tiebreakers: ['points', 'goalDiff', 'points'],
    }));
    expect(r.field).toBe('tiebreakers');
    expect(r.message).toMatch(/doppelt/);
  });

  it('Nicht-Array abgelehnt', () => {
    fail(validateConfigPatch({ tiebreakers: 'points' }));
  });

  it('Alle erlaubten Tiebreaker werden akzeptiert', () => {
    for (const t of ALLOWED_TIEBREAKERS) {
      ok(validateConfigPatch({ tiebreakers: [t] }));
    }
  });
});

describe('validateConfigPatch — Qualifikation', () => {
  it('qualifyPerGroup >= 1', () => {
    ok(validateConfigPatch({ qualifyPerGroup: 2 }));
    fail(validateConfigPatch({ qualifyPerGroup: 0 }));
    fail(validateConfigPatch({ qualifyPerGroup: -1 }));
  });

  it('bestThirds >= 0', () => {
    ok(validateConfigPatch({ bestThirds: 0 }));
    ok(validateConfigPatch({ bestThirds: 4 }));
    fail(validateConfigPatch({ bestThirds: -1 }));
  });
});

describe('validateConfigPatch — KO-Konfig', () => {
  it('hasThirdPlacePlayoff boolean', () => {
    ok(validateConfigPatch({ hasThirdPlacePlayoff: true }));
    ok(validateConfigPatch({ hasThirdPlacePlayoff: false }));
    fail(validateConfigPatch({ hasThirdPlacePlayoff: 'ja' }));
  });

  it('seedProtection Whitelist', () => {
    ok(validateConfigPatch({ seedProtection: 'group' }));
    ok(validateConfigPatch({ seedProtection: 'none' }));
    fail(validateConfigPatch({ seedProtection: 'foo' }));
  });
});

describe('validateConfigPatch — schedule', () => {
  it('schedule muss Objekt sein, kein Array', () => {
    ok(validateConfigPatch({ schedule: {} }));
    fail(validateConfigPatch({ schedule: [] }));
  });

  it('matchDurationMinutes > 0', () => {
    ok(validateConfigPatch({ schedule: { matchDurationMinutes: 30 } }));
    fail(validateConfigPatch({ schedule: { matchDurationMinutes: 0 } }));
    fail(validateConfigPatch({ schedule: { matchDurationMinutes: -5 } }));
    fail(validateConfigPatch({ schedule: { matchDurationMinutes: 30.5 } }));
  });

  it('slotMinutes > 0', () => {
    ok(validateConfigPatch({ schedule: { slotMinutes: 15 } }));
    fail(validateConfigPatch({ schedule: { slotMinutes: 0 } }));
  });

  it('pauseAfterMatches >= 0', () => {
    ok(validateConfigPatch({ schedule: { pauseAfterMatches: 0 } }));
    ok(validateConfigPatch({ schedule: { pauseAfterMatches: 5 } }));
    fail(validateConfigPatch({ schedule: { pauseAfterMatches: -1 } }));
  });

  it('parallelFields >= 1', () => {
    ok(validateConfigPatch({ schedule: { parallelFields: 1 } }));
    ok(validateConfigPatch({ schedule: { parallelFields: 4 } }));
    fail(validateConfigPatch({ schedule: { parallelFields: 0 } }));
  });

  it('startTime HH:MM', () => {
    ok(validateConfigPatch({ schedule: { startTime: '10:00' } }));
    ok(validateConfigPatch({ schedule: { startTime: '23:59' } }));
    fail(validateConfigPatch({ schedule: { startTime: '24:00' } }));
    fail(validateConfigPatch({ schedule: { startTime: '9:00' } }));
    fail(validateConfigPatch({ schedule: { startTime: 'zehn' } }));
  });

  it('Unbekannte schedule-Felder werden verworfen', () => {
    const r = ok(validateConfigPatch({
      schedule: { parallelFields: 2, totallyUnknown: 'x' },
    }));
    expect(r.schedule.parallelFields).toBe(2);
    expect('totallyUnknown' in r.schedule).toBe(false);
  });
});

describe('validateConfigPatch — Gesamtbeispiel aus dem Wizard', () => {
  it('Volle Wizard-Config wird unverändert durchgereicht', () => {
    const input = {
      distribution: 'snake',
      pointsPerWin: 3,
      pointsPerDraw: 1,
      pointsPerLoss: 0,
      tiebreakers: ['points', 'goalDiff', 'goalsFor', 'headToHead'],
      qualifyPerGroup: 2,
      bestThirds: 2,
      hasThirdPlacePlayoff: true,
      seedProtection: 'group',
      schedule: {
        slotMinutes: 15,
        matchDurationMinutes: 45,
        pauseAfterMatches: 5,
        parallelFields: 4,
        startTime: '14:00',
      },
    };
    const r = ok(validateConfigPatch(input));
    expect(r).toEqual(input);
  });
});