/**
 * Tests: Placeholder-Resolver.
 * Spec §4: matches.placeholderHome / placeholderAway ist JSONB.
 */

import { describe, it, expect } from 'vitest';
import { resolvePlaceholder } from '../access/placeholder.js';

describe('resolvePlaceholder', () => {
  it('liefert null für null/undefined', () => {
    expect(resolvePlaceholder(null)).toBeNull();
    expect(resolvePlaceholder(undefined)).toBeNull();
  });

  it('akzeptiert Strings unverändert', () => {
    expect(resolvePlaceholder('Verlierer HF 2')).toBe('Verlierer HF 2');
  });

  it('formt group_rank rank=1 → "Sieger Gruppe A"', () => {
    expect(resolvePlaceholder({ type: 'group_rank', group: 'A', rank: 1 })).toBe('Sieger Gruppe A');
  });

  it('formt group_rank rank=2 → "Zweiter Gruppe B"', () => {
    expect(resolvePlaceholder({ type: 'group_rank', group: 'B', rank: 2 })).toBe(
      'Zweiter Gruppe B'
    );
  });

  it('formt group_rank rank=3 → "3. Gruppe C"', () => {
    expect(resolvePlaceholder({ type: 'group_rank', group: 'C', rank: 3 })).toBe('3. Gruppe C');
  });

  it('formt group_runner → "Zweiter Gruppe B"', () => {
    expect(resolvePlaceholder({ type: 'group_runner', group: 'B', rank: 2 })).toBe(
      'Zweiter Gruppe B'
    );
  });

  it('formt best_third mit Index', () => {
    expect(resolvePlaceholder({ type: 'best_third', index: 1 })).toBe('Bester Dritter 1');
  });

  it('formt best_third ohne Index', () => {
    expect(resolvePlaceholder({ type: 'best_third' })).toBe('Bester Dritter');
  });

  it('formt match_winner mit Label', () => {
    expect(resolvePlaceholder({ type: 'match_winner', matchLabel: 'VF 1' })).toBe('Sieger VF 1');
  });

  it('formt match_winner ohne Label', () => {
    expect(resolvePlaceholder({ type: 'match_winner' })).toBe('Sieger des Spiels');
  });

  it('formt match_loser', () => {
    expect(resolvePlaceholder({ type: 'match_loser', matchLabel: 'HF 2' })).toBe('Verlierer HF 2');
  });

  it('unbekannter Typ liefert Em-Dash', () => {
    expect(resolvePlaceholder({ type: 'whatever' })).toBe('—');
  });
});
