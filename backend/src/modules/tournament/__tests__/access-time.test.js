/**
 * Tests: Zeit-Formatter.
 * Spec §7.
 */

import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatDateShort,
  formatWeekdayDate,
  formatMatchTime,
  formatDuration,
} from '../access/time.js';

describe('formatTime', () => {
  it('formatTime für Date', () => {
    const d = new Date(2026, 8, 5, 14, 20); // 5. Sep 2026, 14:20
    expect(formatTime(d)).toBe('14:20');
  });

  it('formatTime für ISO-String', () => {
    expect(formatTime('2026-09-05T09:05:00Z')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formatTime für null → leerer String', () => {
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined)).toBe('');
  });

  it('formatTime pad bei einstelliger Stunde', () => {
    const d = new Date(2026, 0, 1, 5, 3);
    expect(formatTime(d)).toBe('05:03');
  });
});

describe('formatDateShort', () => {
  it('kurzes deutsches Datumsformat', () => {
    const d = new Date(2026, 8, 5);
    expect(formatDateShort(d)).toBe('05.09.');
  });

  it('null → leer', () => {
    expect(formatDateShort(null)).toBe('');
  });

  it('alle Monate korrekt', () => {
    for (let m = 0; m < 12; m++) {
      const d = new Date(2026, m, 15);
      const expected = `${String(m + 1).padStart(2, '0')}.`;
      expect(formatDateShort(d).endsWith(expected)).toBe(true);
    }
  });
});

describe('formatWeekdayDate', () => {
  it('Sa, 05.09.', () => {
    // 5. Sep 2026 ist ein Samstag
    const d = new Date(2026, 8, 5);
    expect(formatWeekdayDate(d)).toBe('Sa, 05.09.');
  });

  it('Mo, 01.03.', () => {
    const d = new Date(2026, 2, 1); // 1. März 2026 ist Sonntag… korrigieren
    // nehmen wir 2. März 2026 = Mo
    const mo = new Date(2026, 2, 2);
    expect(formatWeekdayDate(mo)).toBe('Mo, 02.03.');
  });
});

describe('formatMatchTime (Spec §7)', () => {
  const d = new Date(2026, 8, 5, 14, 20); // Sa, 05.09.2026 14:20

  it('eintägig → nur Uhrzeit', () => {
    expect(formatMatchTime(d, { singleDay: true })).toBe('14:20');
  });

  it('mehrtägig → Wochentag + Datum + Uhrzeit', () => {
    expect(formatMatchTime(d, { singleDay: false })).toBe('Sa, 05.09. · 14:20');
  });

  it('null bleibt null', () => {
    expect(formatMatchTime(null, { singleDay: false })).toBe('');
  });

  it('Default ist eintägig', () => {
    expect(formatMatchTime(d)).toBe('14:20');
  });
});

describe('formatDuration', () => {
  it('Minuten unter 60 → "X min"', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(5)).toBe('5 min');
  });

  it('exakte Stunde → "X h"', () => {
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(120)).toBe('2 h');
  });

  it('Stunden mit Minuten → "H:MM h"', () => {
    expect(formatDuration(90)).toBe('1:30 h');
    expect(formatDuration(75)).toBe('1:15 h');
  });

  it('null → leer', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(NaN)).toBe('');
  });
});
