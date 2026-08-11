/**
 * Tests: propagateWinner, resetCascade, applyResult.
 * Spec §6.4.
 */

import { describe, it, expect } from 'vitest';
import { propagateWinner, resetCascade, applyResult } from '../engine/propagate.js';

describe('propagateWinner', () => {
  it('wirft wenn Match nicht beendet', () => {
    expect(() =>
      propagateWinner({ status: 'scheduled', teamHome: 'A', teamAway: 'B', scoreHome: 1, scoreAway: 0 }, []),
    ).toThrow();
  });

  it('wirft wenn keine Scores', () => {
    expect(() =>
      propagateWinner({ status: 'finished', teamHome: 'A', teamAway: 'B', scoreHome: null, scoreAway: null }, []),
    ).toThrow();
  });

  it('setzt Sieger in Folgematch home', () => {
    const all = [
      { id: 'm1', status: 'finished', teamHome: 'A', teamAway: 'B', scoreHome: 2, scoreAway: 0, winnerAdvancesTo: 'm2', loserAdvancesTo: null, homeSeed: 1, awaySeed: 4 },
      { id: 'm2', status: 'scheduled', teamHome: null, teamAway: null, homeSeed: 1, awaySeed: 2, winnerAdvancesTo: null, loserAdvancesTo: null },
    ];
    const after = propagateWinner(all[0], all);
    const m2 = after.find((m) => m.id === 'm2');
    expect(m2.teamHome).toBe('A');
    expect(m2.teamAway).toBeNull();
  });

  it('setzt Sieger in Folgematch away', () => {
    const all = [
      { id: 'm1', status: 'finished', teamHome: 'A', teamAway: 'B', scoreHome: 0, scoreAway: 3, winnerAdvancesTo: 'm2', loserAdvancesTo: null, homeSeed: 1, awaySeed: 4 },
      { id: 'm2', status: 'scheduled', teamHome: null, teamAway: null, homeSeed: 1, awaySeed: 2, winnerAdvancesTo: null, loserAdvancesTo: null },
    ];
    const after = propagateWinner(all[0], all);
    const m2 = after.find((m) => m.id === 'm2');
    expect(m2.teamHome).toBeNull();
    expect(m2.teamAway).toBe('B');
  });

  it('Unentschieden in KO → keine Propagation', () => {
    const all = [
      { id: 'm1', status: 'finished', teamHome: 'A', teamAway: 'B', scoreHome: 2, scoreAway: 2, winnerAdvancesTo: 'm2', loserAdvancesTo: null, homeSeed: 1, awaySeed: 4 },
      { id: 'm2', status: 'scheduled', teamHome: null, teamAway: null, homeSeed: 1, awaySeed: 2, winnerAdvancesTo: null, loserAdvancesTo: null },
    ];
    const after = propagateWinner(all[0], all);
    const m2 = after.find((m) => m.id === 'm2');
    expect(m2.teamHome).toBeNull();
    expect(m2.teamAway).toBeNull();
  });

  it('mutiert Eingabe nicht', () => {
    const original = [
      { id: 'm1', status: 'finished', teamHome: 'A', teamAway: 'B', scoreHome: 1, scoreAway: 0, winnerAdvancesTo: 'm2', loserAdvancesTo: null, homeSeed: 1, awaySeed: 4 },
      { id: 'm2', status: 'scheduled', teamHome: null, teamAway: null, homeSeed: 1, awaySeed: 2, winnerAdvancesTo: null, loserAdvancesTo: null },
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    propagateWinner(original[0], original);
    expect(original).toEqual(snapshot);
  });
});

describe('resetCascade', () => {
  it('leert alle downstream-Matches', () => {
    const all = [
      { id: 'root', status: 'finished', teamHome: 'A', teamAway: 'B', scoreHome: 1, scoreAway: 0, winnerAdvancesTo: 'next1', loserAdvancesTo: null, homeSeed: 1, awaySeed: 4 },
      { id: 'next1', status: 'scheduled', teamHome: 'A', teamAway: 'C', scoreHome: null, scoreAway: null, winnerAdvancesTo: 'final', loserAdvancesTo: null, homeSeed: 1, awaySeed: 2 },
      { id: 'final', status: 'scheduled', teamHome: null, teamAway: null, scoreHome: null, scoreAway: null, winnerAdvancesTo: null, loserAdvancesTo: null },
    ];
    const after = resetCascade('root', all);
    // root unverändert
    const root = after.find((m) => m.id === 'root');
    expect(root.teamHome).toBe('A');
    // next1 + final geleert
    const n1 = after.find((m) => m.id === 'next1');
    expect(n1.teamHome).toBeNull();
    expect(n1.teamAway).toBeNull();
    expect(n1.status).toBe('scheduled');
    const f = after.find((m) => m.id === 'final');
    expect(f.teamHome).toBeNull();
    expect(f.teamAway).toBeNull();
  });

  it('mutiert Eingabe nicht', () => {
    const original = [
      { id: 'root', status: 'finished', teamHome: 'A', teamAway: 'B', scoreHome: 1, scoreAway: 0, winnerAdvancesTo: 'next', loserAdvancesTo: null, homeSeed: 1, awaySeed: 4 },
      { id: 'next', status: 'scheduled', teamHome: 'X', teamAway: 'Y', scoreHome: 1, scoreAway: 1, winnerAdvancesTo: null, loserAdvancesTo: null, homeSeed: 1, awaySeed: 2 },
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    resetCascade('root', original);
    expect(original).toEqual(snapshot);
  });
});

describe('applyResult', () => {
  it('kombiniert Reset + Propagation', () => {
    const all = [
      { id: 'sf1', status: 'finished', teamHome: 'A', teamAway: 'B', scoreHome: 1, scoreAway: 0, winnerAdvancesTo: 'final', loserAdvancesTo: null, homeSeed: 1, awaySeed: 4 },
      { id: 'sf2', status: 'scheduled', teamHome: null, teamAway: null, scoreHome: null, scoreAway: null, winnerAdvancesTo: 'final', loserAdvancesTo: null, homeSeed: 2, awaySeed: 3 },
      { id: 'final', status: 'scheduled', teamHome: null, teamAway: null, scoreHome: null, scoreAway: null, winnerAdvancesTo: null, loserAdvancesTo: null },
    ];
    const after = applyResult(all[0], all);
    const f = after.find((m) => m.id === 'final');
    // A ist Sieger von sf1 → kommt in Slot 'home' von final (weil homeSeed<awaySeed)
    expect(f.teamHome).toBe('A');
  });
});