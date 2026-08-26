/**
 * Tests: Engine-Config.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from '../engine/config.js';

describe('DEFAULT_CONFIG', () => {
  it('distribution default snake', () => {
    expect(DEFAULT_CONFIG.distribution).toBe('snake');
  });

  it('Standard-Punkte 3/1/0', () => {
    expect(DEFAULT_CONFIG.pointsPerWin).toBe(3);
    expect(DEFAULT_CONFIG.pointsPerDraw).toBe(1);
    expect(DEFAULT_CONFIG.pointsPerLoss).toBe(0);
  });

  it('Standard-Qualifikation Top 2', () => {
    expect(DEFAULT_CONFIG.qualifyPerGroup).toBe(2);
    expect(DEFAULT_CONFIG.bestThirds).toBe(0);
  });

  it('Standard-Tiebreaker enthält headToHead', () => {
    expect(DEFAULT_CONFIG.tiebreakers).toContain('headToHead');
  });

  it('ist eingefroren', () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
  });
});

describe('mergeConfig', () => {
  it('null/undefined → Defaults', () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(mergeConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it('überschreibt einzelne Werte', () => {
    const c = mergeConfig({ qualifyPerGroup: 3 });
    expect(c.qualifyPerGroup).toBe(3);
    expect(c.pointsPerWin).toBe(3);
  });

  it('mutiert Eingabe nicht', () => {
    const input = { qualifyPerGroup: 4 };
    mergeConfig(input);
    expect(input.qualifyPerGroup).toBe(4);
  });

  it('verschachtelte Objekte werden gemerged', () => {
    const c = mergeConfig({
      schedule: { parallelFields: 2 },
    });
    expect(c.schedule.parallelFields).toBe(2);
    expect(c.schedule.startTime).toBe('10:00');
  });

  it('Arrays werden ersetzt, nicht gemerged', () => {
    const c = mergeConfig({ tiebreakers: ['points'] });
    expect(c.tiebreakers).toEqual(['points']);
  });

  it('undefined-Werte werden ignoriert', () => {
    const c = mergeConfig({ qualifyPerGroup: undefined });
    expect(c.qualifyPerGroup).toBe(2);
  });
});
