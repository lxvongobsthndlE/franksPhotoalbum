/**
 * Tests: qualifyAndSeed. Spec §6.1.
 */

import { describe, it, expect } from 'vitest';
import { qualifyAndSeed } from '../engine/qualify.js';

describe('qualifyAndSeed', () => {
  it('wirft ohne groupStandings oder groupKeys', () => {
    expect(() => qualifyAndSeed({}, {})).toThrow();
  });

  it('Top 2 pro Gruppe, keine Dritten', () => {
    const input = {
      groupStandings: [
        [{ teamId: 'A1' }, { teamId: 'A2' }, { teamId: 'A3' }],
        [{ teamId: 'B1' }, { teamId: 'B2' }, { teamId: 'B3' }],
      ],
      groupKeys: ['A', 'B'],
    };
    const r = qualifyAndSeed(input, { qualifyPerGroup: 2, bestThirds: 0 });
    expect(r.qualifiers.map((q) => q.teamId)).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(r.qualifiers.map((q) => q.seed)).toEqual([1, 2, 3, 4]);
    expect(r.bestThirdsUsed).toEqual([]);
  });

  it('Top 1 pro Gruppe', () => {
    const input = {
      groupStandings: [
        [{ teamId: 'A1' }, { teamId: 'A2' }],
        [{ teamId: 'B1' }, { teamId: 'B2' }],
      ],
      groupKeys: ['A', 'B'],
    };
    const r = qualifyAndSeed(input, { qualifyPerGroup: 1 });
    expect(r.qualifiers.map((q) => q.teamId)).toEqual(['A1', 'B1']);
  });

  it('+ 2 beste Dritte', () => {
    const input = {
      groupStandings: [
        [
          { teamId: 'A1' },
          { teamId: 'A2' },
          { teamId: 'A3', played: 3, points: 4, goalsFor: 4, goalsAgainst: 2, goalDiff: 2 },
        ],
        [
          { teamId: 'B1' },
          { teamId: 'B2' },
          { teamId: 'B3', played: 3, points: 3, goalsFor: 2, goalsAgainst: 2, goalDiff: 0 },
        ],
        [
          { teamId: 'C1' },
          { teamId: 'C2' },
          { teamId: 'C3', played: 3, points: 1, goalsFor: 1, goalsAgainst: 5, goalDiff: -4 },
        ],
      ],
      groupKeys: ['A', 'B', 'C'],
    };
    const r = qualifyAndSeed(input, { qualifyPerGroup: 2, bestThirds: 2 });
    expect(r.qualifiers.map((q) => q.teamId)).toEqual([
      'A1',
      'A2',
      'B1',
      'B2',
      'C1',
      'C2',
      'A3',
      'B3',
    ]);
    expect(r.qualifiers.map((q) => q.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(r.bestThirdsUsed.map((t) => t.teamId)).toEqual(['A3', 'B3']);
  });

  it('source.groupKey wird gesetzt', () => {
    const input = {
      groupStandings: [
        [{ teamId: 'A1' }, { teamId: 'A2' }],
        [{ teamId: 'B1' }, { teamId: 'B2' }],
      ],
      groupKeys: ['A', 'B'],
    };
    const r = qualifyAndSeed(input, { qualifyPerGroup: 2 });
    expect(r.qualifiers[0].source).toEqual({ groupKey: 'A', groupIndex: 0, rank: 1 });
    expect(r.qualifiers[1].source).toEqual({ groupKey: 'A', groupIndex: 0, rank: 2 });
    expect(r.qualifiers[2].source).toEqual({ groupKey: 'B', groupIndex: 1, rank: 1 });
  });
});
