/**
 * Tests: buildRoundRobin. Spec §5.2.
 */

import { describe, it, expect } from 'vitest';
import { buildRoundRobin, buildRoundRobinMatches } from '../engine/round-robin.js';

describe('buildRoundRobin', () => {
  it('wirft bei < 2 Teams', () => {
    expect(() => buildRoundRobin([])).toThrow();
    expect(() => buildRoundRobin(['only'])).toThrow();
  });

  it('4 Teams → 6 Spiele (n(n-1)/2)', () => {
    const { schedule } = buildRoundRobin(['A', 'B', 'C', 'D']);
    const matches = schedule.flat();
    expect(matches).toHaveLength(6);
  });

  it('6 Teams → 15 Spiele', () => {
    const { schedule } = buildRoundRobin(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(schedule.flat()).toHaveLength(15);
  });

  it('8 Teams → 28 Spiele', () => {
    const { schedule } = buildRoundRobin(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(schedule.flat()).toHaveLength(28);
  });

  it('3 Teams (ungerade) → 3 Runden, 1 BYE pro Runde', () => {
    const { schedule, hasBye } = buildRoundRobin(['A', 'B', 'C']);
    expect(hasBye).toBe(true);
    expect(schedule).toHaveLength(3);
    const byes = schedule.flat().filter((m) => m.isBye);
    expect(byes.length).toBe(3);
  });

  it('Heimbalance: Differenz max-min ≤ 1', () => {
    // Bei geradem n (z.B. 4) ist strikte Gleichverteilung unmöglich:
    //   n=4 → 6 Heim-Slots / 4 Teams = 1,5 pro Team (kein Integer).
    // Die zyklische Rotation garantiert max-min ≤ 1 (= bestmögliche Balance).
    // Für ungerades n (z.B. 5) wäre sogar strikt = 2 möglich.
    const { schedule } = buildRoundRobin(['A', 'B', 'C', 'D']);
    const homeCount = {};
    for (const round of schedule) {
      for (const m of round) {
        if (m.isBye) continue;
        homeCount[m.home] = (homeCount[m.home] ?? 0) + 1;
      }
    }
    const counts = Object.values(homeCount);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    expect(max - min).toBeLessThanOrEqual(1);
  });
});

describe('buildRoundRobinMatches', () => {
  it('filtert BYE-Spiele raus', () => {
    const matches = buildRoundRobinMatches(['A', 'B', 'C']);
    expect(matches.every((m) => m.teamHome !== 'BYE' && m.teamAway !== 'BYE')).toBe(true);
    expect(matches).toHaveLength(3);
  });

  it('bracketPos fortlaufend', () => {
    const matches = buildRoundRobinMatches(['A', 'B', 'C', 'D']);
    expect(matches.map((m) => m.bracketPos)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('jedes Team genau n-1 Spiele', () => {
    const teams = ['A', 'B', 'C', 'D'];
    const matches = buildRoundRobinMatches(teams);
    for (const t of teams) {
      const count = matches.filter((m) => m.teamHome === t || m.teamAway === t).length;
      expect(count).toBe(3);
    }
  });

  it('roundNumber ist 1-basiert', () => {
    const matches = buildRoundRobinMatches(['A', 'B', 'C', 'D']);
    const rounds = [...new Set(matches.map((m) => m.roundNumber))].sort();
    expect(rounds).toEqual([1, 2, 3]);
  });
});