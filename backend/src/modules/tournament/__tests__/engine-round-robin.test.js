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
describe('Vollständigkeit: jede Begegnung genau einmal (Regression 2026-08-26)', () => {
  // Der Bug, den diese Gruppe verhindert: Die frühere Implementierung
  // rotierte ALLE Positionen zyklisch statt einer festen Ankerposition.
  // Eine Vollrotation hat die Periode n/2, nicht n-1 — ab der Hälfte
  // wiederholten sich die Paarungen spiegelbildlich. Bei 8 Teams kamen so
  // 12 der 28 Begegnungen doppelt vor und 12 überhaupt nicht.
  //
  // Bemerkenswert ist, was dabei NICHT auffiel: Die Anzahl der Spiele war
  // korrekt, die Anzahl Spiele je Team war korrekt, die Heimbalance war
  // korrekt. Alle vier damaligen Tests waren grün. Gezählt wurde, was
  // leicht zu zählen ist; niemand fragte, ob die Paarungen stimmen.
  const paare = (ids) => {
    const { schedule } = buildRoundRobin(ids);
    const raus = [];
    for (const runde of schedule) {
      for (const m of runde) {
        if (m.isBye) continue;
        raus.push([m.home, m.away].sort().join('|'));
      }
    }
    return raus;
  };

  for (const n of [3, 4, 5, 6, 7, 8, 9, 10, 12, 16]) {
    it(`${n} Teams: alle ${(n * (n - 1)) / 2} Begegnungen, keine doppelt`, () => {
      const ids = Array.from({ length: n }, (_, i) => `T${i + 1}`);
      const gespielt = paare(ids);

      const zaehler = new Map();
      for (const p of gespielt) zaehler.set(p, (zaehler.get(p) ?? 0) + 1);

      const doppelt = [...zaehler].filter(([, c]) => c > 1).map(([p]) => p);
      expect(doppelt).toEqual([]);

      const fehlend = [];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const k = [ids[i], ids[j]].sort().join('|');
          if (!zaehler.has(k)) fehlend.push(k);
        }
      }
      expect(fehlend).toEqual([]);
      expect(gespielt.length).toBe((n * (n - 1)) / 2);
    });
  }

  it('kein Team spielt zweimal in derselben Runde', () => {
    for (const n of [4, 5, 6, 7, 8, 9]) {
      const ids = Array.from({ length: n }, (_, i) => `T${i + 1}`);
      const { schedule } = buildRoundRobin(ids);
      for (const runde of schedule) {
        const gesehen = new Set();
        for (const m of runde) {
          for (const t of [m.home, m.away]) {
            if (t === 'BYE') continue;
            expect(gesehen.has(t), `${t} zweimal in einer Runde (n=${n})`).toBe(false);
            gesehen.add(t);
          }
        }
      }
    }
  });

  it('Heimbalance bleibt ≤ 1 bei gerader Teamzahl — für jedes n, nicht nur für 4', () => {
    // Der feste Anker war der Verdacht, an dem die alte Implementierung
    // scheiterte: Er hätte in jeder Runde Heimrecht. Die alternierende
    // Seite löst das, ohne die Paarungen anzufassen.
    for (const n of [4, 6, 8, 10, 12, 16]) {
      const ids = Array.from({ length: n }, (_, i) => `T${i + 1}`);
      const { schedule } = buildRoundRobin(ids);
      const heim = new Map(ids.map((t) => [t, 0]));
      for (const runde of schedule) {
        for (const m of runde) {
          if (m.isBye) continue;
          heim.set(m.home, heim.get(m.home) + 1);
        }
      }
      const werte = [...heim.values()];
      expect(Math.max(...werte) - Math.min(...werte), `n=${n}`).toBeLessThanOrEqual(1);
    }
  });
});
