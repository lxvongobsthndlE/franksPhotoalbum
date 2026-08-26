/**
 * Tests: computeStandings. Spec §5.4.
 */

import { describe, it, expect } from 'vitest';
import { computeStandings, computeHeadToHeadSubTable } from '../engine/standings.js';

const cfg = { pointsPerWin: 3, pointsPerDraw: 1, pointsPerLoss: 0 };

describe('computeStandings', () => {
  it('null/empty → leere Liste', () => {
    expect(computeStandings(null, [], cfg)).toEqual([]);
  });

  it('0 Spiele gespielt → alle 0', () => {
    const rows = computeStandings(['A', 'B', 'C'], [], cfg);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.played).toBe(0);
      expect(r.won).toBe(0);
      expect(r.points).toBe(0);
      expect(r.goalDiff).toBe(0);
    }
  });

  it('Punkte 3/1/0', () => {
    const matches = [
      { teamHome: 'A', teamAway: 'B', scoreHome: 2, scoreAway: 1, status: 'finished' },
    ];
    const rows = computeStandings(['A', 'B'], matches, cfg);
    const a = rows.find((r) => r.teamId === 'A');
    const b = rows.find((r) => r.teamId === 'B');
    expect(a.points).toBe(3);
    expect(b.points).toBe(0);
    expect(a.won).toBe(1);
    expect(b.lost).toBe(1);
  });

  it('Unentschieden: 1 Punkt pro Team', () => {
    const matches = [
      { teamHome: 'A', teamAway: 'B', scoreHome: 1, scoreAway: 1, status: 'finished' },
    ];
    const rows = computeStandings(['A', 'B'], matches, cfg);
    expect(rows.find((r) => r.teamId === 'A').points).toBe(1);
    expect(rows.find((r) => r.teamId === 'B').points).toBe(1);
  });

  it('Tordifferenz korrekt', () => {
    const matches = [
      { teamHome: 'A', teamAway: 'B', scoreHome: 5, scoreAway: 1, status: 'finished' },
    ];
    const rows = computeStandings(['A', 'B'], matches, cfg);
    expect(rows.find((r) => r.teamId === 'A').goalDiff).toBe(4);
    expect(rows.find((r) => r.teamId === 'A').goalsFor).toBe(5);
    expect(rows.find((r) => r.teamId === 'A').goalsAgainst).toBe(1);
  });

  it('scheduled-Matches werden ignoriert', () => {
    const matches = [
      { teamHome: 'A', teamAway: 'B', scoreHome: 5, scoreAway: 1, status: 'scheduled' },
    ];
    const rows = computeStandings(['A', 'B'], matches, cfg);
    expect(rows.find((r) => r.teamId === 'A').points).toBe(0);
  });

  it('h2h Map wird gefüllt', () => {
    const matches = [
      { teamHome: 'A', teamAway: 'B', scoreHome: 2, scoreAway: 0, status: 'finished' },
    ];
    const rows = computeStandings(['A', 'B'], matches, cfg);
    const a = rows.find((r) => r.teamId === 'A');
    expect(a.h2h.get('B')).toEqual({ gf: 2, ga: 0 });
  });

  it('Team ohne Spiele wird trotzdem gelistet', () => {
    const matches = [
      { teamHome: 'A', teamAway: 'B', scoreHome: 1, scoreAway: 0, status: 'finished' },
    ];
    const rows = computeStandings(['A', 'B', 'C'], matches, cfg);
    expect(rows.find((r) => r.teamId === 'C').played).toBe(0);
  });

  it('alternative Punkte (2/1/0)', () => {
    const c2 = { pointsPerWin: 2, pointsPerDraw: 1, pointsPerLoss: 0 };
    const matches = [
      { teamHome: 'A', teamAway: 'B', scoreHome: 2, scoreAway: 1, status: 'finished' },
    ];
    const rows = computeStandings(['A', 'B'], matches, c2);
    expect(rows.find((r) => r.teamId === 'A').points).toBe(2);
  });
});

describe('computeHeadToHeadSubTable', () => {
  it('nur Spiele zwischen den ausgewählten Teams zählen', () => {
    const matches = [
      { teamHome: 'A', teamAway: 'B', scoreHome: 2, scoreAway: 1, status: 'finished' },
      { teamHome: 'A', teamAway: 'C', scoreHome: 0, scoreAway: 3, status: 'finished' },
    ];
    const sub = computeHeadToHeadSubTable(['A', 'B'], matches);
    expect(sub).toHaveLength(2);
    const a = sub.find((r) => r.teamId === 'A');
    expect(a.played).toBe(1);
    expect(a.points).toBe(3);
  });

  it('null/empty', () => {
    expect(computeHeadToHeadSubTable([], [])).toEqual([]);
  });
});
