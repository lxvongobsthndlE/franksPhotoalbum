/**
 * Tests: distributeTeamsIntoGroups. Spec §5.1.
 */

import { describe, it, expect } from 'vitest';
import { distributeTeamsIntoGroups } from '../engine/distribute.js';

const makeTeams = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}`, seed: i + 1 }));

describe('distributeTeamsIntoGroups', () => {
  it('wirft bei leerer Teams-Liste', () => {
    expect(() => distributeTeamsIntoGroups([], 2)).toThrow();
  });

  it('wirft bei zu vielen Gruppen', () => {
    expect(() => distributeTeamsIntoGroups(makeTeams(2), 5)).toThrow();
  });

  it('wirft bei ungültiger Gruppenzahl', () => {
    expect(() => distributeTeamsIntoGroups(makeTeams(4), 0)).toThrow();
  });

  it('12 Teams / 4 Gruppen: A=[1,4,5,8], B=[2,3,6,7], C=[9,10,11,12]? Nein: snake', () => {
    // snake-Algorithmus:
    //   forward round 1: t1→A, t2→B, t3→C, t4→D
    //   backward round 2: t5→D, t6→C, t7→B, t8→A
    //   forward round 3: t9→A, t10→B, t11→C, t12→D
    const result = distributeTeamsIntoGroups(makeTeams(12), 4, { method: 'snake' });
    expect(result).toHaveLength(4);
    const flatIds = result.map((g) => g.map((t) => t.id).join(','));
    expect(flatIds).toEqual(['t1,t8,t9', 't2,t7,t10', 't3,t6,t11', 't4,t5,t12']);
  });

  it('snake bei ungleicher Verteilung füllt von vorne', () => {
    // 10 Teams / 3 Gruppen → 4/3/3
    const result = distributeTeamsIntoGroups(makeTeams(10), 3, { method: 'snake' });
    expect(result.map((g) => g.length)).toEqual([4, 3, 3]);
  });

  it('random ist deterministisch mit gleichem seed', () => {
    const teams = makeTeams(12);
    const a = distributeTeamsIntoGroups(teams, 4, { method: 'random', seed: 'fixed-seed' });
    const b = distributeTeamsIntoGroups(teams, 4, { method: 'random', seed: 'fixed-seed' });
    expect(a.map((g) => g.map((t) => t.id).join(','))).toEqual(
      b.map((g) => g.map((t) => t.id).join(','))
    );
  });

  it('random mit verschiedenen seeds liefert unterschiedliche Verteilungen', () => {
    const teams = makeTeams(12);
    const a = distributeTeamsIntoGroups(teams, 4, { method: 'random', seed: 'alpha' });
    const b = distributeTeamsIntoGroups(teams, 4, { method: 'random', seed: 'beta' });
    expect(a.map((g) => g.map((t) => t.id).join(','))).not.toEqual(
      b.map((g) => g.map((t) => t.id).join(','))
    );
  });

  it('manual: Reihenfolge unverändert, zyklisch', () => {
    const result = distributeTeamsIntoGroups(makeTeams(7), 3, { method: 'manual' });
    expect(result.map((g) => g.map((t) => t.id).join(','))).toEqual(['t1,t4,t7', 't2,t5', 't3,t6']);
  });
});
