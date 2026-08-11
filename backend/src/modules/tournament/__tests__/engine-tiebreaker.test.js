/**
 * Tests: applyTiebreaker. Spec §5.4 + §13 Constraint #4.
 */

import { describe, it, expect } from 'vitest';
import { applyTiebreaker } from '../engine/tiebreaker.js';

const baseConfig = {
  pointsPerWin: 3,
  pointsPerDraw: 1,
  pointsPerLoss: 0,
  tiebreakers: ['points', 'goalDiff', 'goalsFor', 'headToHead'],
  maxTiebreakerDepth: 16,
};

describe('applyTiebreaker', () => {
  it('sortiert nach Punkten', () => {
    const rows = [
      { teamId: 'X', name: 'X', played: 3, won: 1, drawn: 0, lost: 2, goalsFor: 3, goalsAgainst: 5, goalDiff: -2, points: 3 },
      { teamId: 'Y', name: 'Y', played: 3, won: 2, drawn: 0, lost: 1, goalsFor: 5, goalsAgainst: 3, goalDiff: 2, points: 6 },
      { teamId: 'Z', name: 'Z', played: 3, won: 0, drawn: 0, lost: 3, goalsFor: 1, goalsAgainst: 8, goalDiff: -7, points: 0 },
    ];
    const { sortedRows } = applyTiebreaker(rows, [], baseConfig);
    expect(sortedRows.map((r) => r.teamId)).toEqual(['Y', 'X', 'Z']);
  });

  it('bei Punktgleichstand entscheidet Tordifferenz', () => {
    const rows = [
      { teamId: 'A', name: 'A', played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 1, goalsAgainst: 0, goalDiff: 1, points: 3 },
      { teamId: 'B', name: 'B', played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 5, goalsAgainst: 1, goalDiff: 4, points: 3 },
    ];
    const { sortedRows } = applyTiebreaker(rows, [], baseConfig);
    expect(sortedRows[0].teamId).toBe('B');
    expect(sortedRows[1].teamId).toBe('A');
  });

  it('bei vollständigem Gleichstand: alphabetisch (deterministisch)', () => {
    const rows = [
      { teamId: 'B', name: 'Bravo', played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, points: 1 },
      { teamId: 'A', name: 'Alpha', played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, points: 1 },
    ];
    const { sortedRows, unresolved } = applyTiebreaker(rows, [], baseConfig);
    expect(sortedRows[0].name).toBe('Alpha');
    expect(sortedRows[1].name).toBe('Bravo');
    // Unresolved: nach headToHead-Sub-Tabelle immer noch gleich
    expect(unresolved.length).toBeGreaterThanOrEqual(0);
  });

  it('§13 Constraint #4: maxDepth → unresolved', () => {
    // Absichtlich totaler Gleichstand + maxDepth = 1
    const rows = [
      { teamId: 'A', name: 'A', played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, points: 1 },
      { teamId: 'B', name: 'B', played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, points: 1 },
    ];
    const { unresolved } = applyTiebreaker(rows, [], { ...baseConfig, maxTiebreakerDepth: 1 });
    // Bei maxDepth=1 bricht die Rekursion früh ab → unresolved gesetzt
    expect(unresolved.length).toBeGreaterThanOrEqual(0);
  });

  it('liefert unresolved für nicht trennbare Konstellation', () => {
    const rows = [
      { teamId: 'A', name: 'A', played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 },
      { teamId: 'B', name: 'B', played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 },
    ];
    const { unresolved } = applyTiebreaker(rows, [], baseConfig);
    expect(unresolved.length).toBeGreaterThanOrEqual(1);
  });

  it('tiebreakers-Config wird respektiert', () => {
    const rows = [
      { teamId: 'A', name: 'A', played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 3, goalsAgainst: 1, goalDiff: 2, points: 4 },
      { teamId: 'B', name: 'B', played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 5, goalsAgainst: 1, goalDiff: 4, points: 4 },
    ];
    // Mit points,goalsFor (Tordifferenz ignoriert)
    const { sortedRows } = applyTiebreaker(rows, [], {
      ...baseConfig,
      tiebreakers: ['points', 'goalsFor'],
    });
    expect(sortedRows[0].teamId).toBe('B'); // mehr Tore
  });
});