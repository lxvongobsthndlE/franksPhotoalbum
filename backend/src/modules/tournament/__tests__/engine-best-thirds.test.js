/**
 * Tests: rankBestThirds. Spec §6.3.1 + §10.4.
 */

import { describe, it, expect } from 'vitest';
import { rankBestThirds } from '../engine/best-thirds.js';

describe('rankBestThirds', () => {
  it('nimmt den 3. Platz jeder Gruppe', () => {
    const groupStandings = [
      [{ teamId: 'A1' }, { teamId: 'A2' }, { teamId: 'A3' }],
      [{ teamId: 'B1' }, { teamId: 'B2' }, { teamId: 'B3' }],
      [{ teamId: 'C1' }, { teamId: 'C2' }, { teamId: 'C3' }],
    ];
    const thirds = rankBestThirds(groupStandings);
    expect(thirds.map((r) => r.teamId)).toEqual(['A3', 'B3', 'C3']);
  });

  it('sortiert nach Punkten pro Spiel', () => {
    const groupStandings = [
      [{ teamId: 'A3', played: 3, points: 6, goalsFor: 8, goalsAgainst: 2, goalDiff: 6 }],
      [{ teamId: 'B3', played: 3, points: 3, goalsFor: 4, goalsAgainst: 4, goalDiff: 0 }],
      [{ teamId: 'C3', played: 3, points: 0, goalsFor: 1, goalsAgainst: 7, goalDiff: -6 }],
    ];
    const sorted = rankBestThirds(groupStandings);
    expect(sorted[0].teamId).toBe('A3');
    expect(sorted[2].teamId).toBe('C3');
  });

  it('§10.4: IMMER pro Spiel normalisiert', () => {
    // A3 hat 6 Punkte aus 3 Spielen (2.0 P/S)
    // B3 hat 6 Punkte aus 6 Spielen (1.0 P/S) → schlechter trotz gleicher Punkte
    const groupStandings = [
      [{ teamId: 'A3', played: 3, points: 6, goalsFor: 5, goalsAgainst: 2, goalDiff: 3 }],
      [{ teamId: 'B3', played: 6, points: 6, goalsFor: 8, goalsAgainst: 6, goalDiff: 2 }],
    ];
    const sorted = rankBestThirds(groupStandings);
    expect(sorted[0].teamId).toBe('A3'); // besser normalisiert
  });

  it('2 Gruppen à 4 + 1 Gruppe à 3 → pro Spiel normalisiert', () => {
    // Gruppe mit 4 Spielen (4 Teams): played=3
    // Gruppe mit 3 Spielen (3 Teams): played=2
    // Wenn beide 4 Punkte haben, sind sie gleich normalisiert
    const groupStandings = [
      [{ teamId: 'A3', played: 3, points: 4, goalsFor: 3, goalsAgainst: 2, goalDiff: 1 }], // 1.33 P/S
      [{ teamId: 'B3', played: 3, points: 4, goalsFor: 4, goalsAgainst: 2, goalDiff: 2 }], // 1.33 P/S
      [{ teamId: 'C3', played: 2, points: 4, goalsFor: 3, goalsAgainst: 1, goalDiff: 2 }], // 2.0 P/S
    ];
    const sorted = rankBestThirds(groupStandings);
    expect(sorted[0].teamId).toBe('C3'); // am besten normalisiert
  });

  it('alphabetischer Fallback bei kompletter Gleichheit', () => {
    const groupStandings = [
      [{ teamId: 'Z3', played: 3, points: 3, goalsFor: 2, goalsAgainst: 2, goalDiff: 0 }],
      [{ teamId: 'A3', played: 3, points: 3, goalsFor: 2, goalsAgainst: 2, goalDiff: 0 }],
    ];
    const sorted = rankBestThirds(groupStandings);
    expect(sorted[0].teamId).toBe('A3');
    expect(sorted[1].teamId).toBe('Z3');
  });

  it('null/undefined → leere Liste', () => {
    expect(rankBestThirds(null)).toEqual([]);
  });

  it('Gruppe mit < 3 Teams wird ignoriert', () => {
    const groupStandings = [
      [{ teamId: 'A1' }, { teamId: 'A2' }], // zu klein
      [{ teamId: 'B1' }, { teamId: 'B2' }, { teamId: 'B3' }],
    ];
    const sorted = rankBestThirds(groupStandings);
    expect(sorted.map((r) => r.teamId)).toEqual(['B3']);
  });
});
