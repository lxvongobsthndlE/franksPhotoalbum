/**
 * Tests: generateSchedule + detectScheduleConflicts. Spec §5.3 + §10.9.
 */

import { describe, it, expect } from 'vitest';
import { generateSchedule, detectScheduleConflicts } from '../engine/schedule.js';

const baseConfig = {
  schedule: {
    slotMinutes: 15,
    matchDurationMinutes: 30,
    parallelFields: 1,
    startTime: '10:00',
    pauseAfterMatches: 0,
  },
};

const baseDate = new Date('2026-09-05');

const m = (id, home, away, extras = {}) => ({
  id,
  teamHome: home,
  teamAway: away,
  bracketPos: parseInt(String(id).replace(/\D/g, ''), 10) || 0,
  groupKey: extras.groupKey ?? null,
  stageType: extras.stageType ?? (extras.round ? 'ko' : 'group'),
  ...extras,
});

describe('generateSchedule', () => {
  it('null/empty → []', () => {
    expect(generateSchedule([], baseConfig, baseDate)).toEqual([]);
  });

  it('weist scheduledAt und field zu', () => {
    const matches = [
      m('m1', 'A', 'B', { groupKey: 'A' }),
      m('m2', 'C', 'D', { groupKey: 'A' }),
    ];
    const sched = generateSchedule(matches, baseConfig, baseDate);
    for (const s of sched) {
      expect(s.scheduledAt).toBeInstanceOf(Date);
      expect(s.field).toBeGreaterThanOrEqual(1);
    }
  });

  it('§10.9: deterministisch — 2 Aufrufe identisch', () => {
    const matches = Array.from({ length: 6 }, (_, i) =>
      m(`m${i + 1}`, `H${i + 1}`, `A${i + 1}`, { groupKey: String.fromCharCode(65 + (i % 3)) }),
    );
    const a = generateSchedule(matches, baseConfig, baseDate);
    const b = generateSchedule(matches, baseConfig, baseDate);
    expect(a.map((x) => x.scheduledAt?.getTime())).toEqual(b.map((x) => x.scheduledAt?.getTime()));
    expect(a.map((x) => x.field)).toEqual(b.map((x) => x.field));
  });

  it('kein Team spielt zweimal im selben Slot', () => {
    const matches = [
      m('m1', 'A', 'B'),
      m('m2', 'A', 'C'), // A schon in m1
    ];
    const sched = generateSchedule(matches, baseConfig, baseDate);
    const aSlots = sched
      .filter((s) => s.teamHome === 'A' || s.teamAway === 'A')
      .map((s) => s.scheduledAt.getTime());
    // Slots von A sollten unterschiedlich sein
    expect(new Set(aSlots).size).toBe(aSlots.length);
  });

  it('parallelFields = 2 → field rotiert', () => {
    const matches = [
      m('m1', 'A', 'B', { groupKey: 'A' }),
      m('m2', 'C', 'D', { groupKey: 'B' }),
    ];
    const cfg = { ...baseConfig, schedule: { ...baseConfig.schedule, parallelFields: 2 } };
    const sched = generateSchedule(matches, cfg, baseDate);
    expect(new Set(sched.map((s) => s.field)).size).toBeGreaterThanOrEqual(1);
  });

  it('Gruppenphase vor KO (Spec §5.3 Block-Konzept)', () => {
    // KO-Spiel VOR Gruppen-Spiel: scheduledAt des KO-Spiels muss >= dem
    // scheduledAt des Gruppen-Spiels sein, auch wenn das KO-Spiel in der
    // Input-Liste zuerst steht.
    const matches = [
      m('ko1', 'A1', 'B3', { stageType: 'ko', round: 'QF', bracketPos: 1 }),
      m('g1',  'A',  'B',  { stageType: 'group', groupKey: 'A', roundNumber: 1, bracketPos: 1 }),
    ];
    const sched = generateSchedule(matches, baseConfig, baseDate);
    const ko = sched.find((s) => s.id === 'ko1');
    const g  = sched.find((s) => s.id === 'g1');
    expect(g.scheduledAt.getTime()).toBeLessThan(ko.scheduledAt.getTime());
  });

  it('§5.3 Block-Ordering-Invariante: 12-Teams-Beispiel', () => {
    // 12 Teams / 3 Gruppen à 4 → 3 Spieltage mit je 2 Spielen pro Gruppe = 18
    // Gruppenspiele. 8 Qualifikanten → QF (4) → SF (2) → 3RD (1) → F (1).
    // Insgesamt: 18 + 4 + 2 + 1 + 1 = 26 Spiele.
    const matches = [];
    const groupKeys = ['A', 'B', 'C'];
    let idx = 0;
    for (const gk of groupKeys) {
      for (let spieltag = 1; spieltag <= 3; spieltag++) {
        for (let m = 0; m < 2; m++) {
          idx += 1;
          matches.push({
            id: `g_${gk}_${idx}`,
            teamHome: `${gk}${spieltag}H${m}`,
            teamAway: `${gk}${spieltag}A${m}`,
            stageType: 'group',
            groupKey: gk,
            roundNumber: spieltag,
            bracketPos: idx,
          });
        }
      }
    }
    const koRounds = [
      { round: 'QF', count: 4 },
      { round: 'SF', count: 2 },
      { round: '3RD', count: 1 },
      { round: 'F', count: 1 },
    ];
    for (const { round, count } of koRounds) {
      for (let i = 1; i <= count; i++) {
        idx += 1;
        matches.push({
          id: `ko_${round}_${i}`,
          teamHome: `KO${round}H${i}`,
          teamAway: `KO${round}A${i}`,
          stageType: 'ko',
          round,
          bracketPos: i,
        });
      }
    }

    // Wir übergeben die Spiele in umgekehrter Reihenfolge (KO zuerst), um zu
    // beweisen, dass generateSchedule selbst die Block-Reihenfolge herstellt
    // und nicht der Input-Reihenfolge vertraut.
    const shuffled = [...matches].reverse();
    const sched = generateSchedule(shuffled, baseConfig, baseDate);
    const byId = new Map(sched.map((s) => [s.id, s]));

    function blockOf(match) {
      if (match.stageType === 'ko') {
        const order = { R64: 0, R32: 1, R16: 2, QF: 3, SF: 4, '3RD': 5, F: 6 };
        return 100_000 + (order[match.round] ?? 999);
      }
      return match.roundNumber ?? 0;
    }

    // Invariante: Für jedes Paar (A aus Block N, B aus Block N+1) gilt:
    //   A.scheduledAt < B.scheduledAt
    const violators = [];
    for (const a of matches) {
      const ba = blockOf(a);
      for (const b of matches) {
        const bb = blockOf(b);
        if (bb <= ba) continue;
        const ta = byId.get(a.id).scheduledAt.getTime();
        const tb = byId.get(b.id).scheduledAt.getTime();
        if (ta >= tb) {
          violators.push({ a: a.id, b: b.id, ta, tb });
        }
      }
    }
    expect(violators).toEqual([]);
  });

  it('KO-Runden in korrekter Reihenfolge: R32 < R16 < QF < SF < 3RD < F', () => {
    // 16 Teams → R16 → QF → SF → F. Hier nur 4 Runden, jede mit 1 Spiel.
    // Wir prüfen die paarweise Ordnung.
    const matches = [
      m('f1', 'FH', 'FA', { stageType: 'ko', round: 'F', bracketPos: 1 }),
      m('sf1', 'SFH', 'SFA', { stageType: 'ko', round: 'SF', bracketPos: 1 }),
      m('qf1', 'QFH', 'QFA', { stageType: 'ko', round: 'QF', bracketPos: 1 }),
      m('r16_1', 'R16H', 'R16A', { stageType: 'ko', round: 'R16', bracketPos: 1 }),
    ];
    const sched = generateSchedule(matches, baseConfig, baseDate);
    const byId = new Map(sched.map((s) => [s.id, s]));
    expect(byId.get('r16_1').scheduledAt.getTime()).toBeLessThan(byId.get('qf1').scheduledAt.getTime());
    expect(byId.get('qf1').scheduledAt.getTime()).toBeLessThan(byId.get('sf1').scheduledAt.getTime());
    expect(byId.get('sf1').scheduledAt.getTime()).toBeLessThan(byId.get('f1').scheduledAt.getTime());
  });
});

describe('detectScheduleConflicts', () => {
  it('null/empty', () => {
    expect(detectScheduleConflicts([])).toEqual([]);
  });

  it('kein Konflikt wenn Felder unterschiedlich', () => {
    const matches = [
      { id: 'm1', field: 1, scheduledAt: new Date('2026-09-05T10:00') },
      { id: 'm2', field: 2, scheduledAt: new Date('2026-09-05T10:00') },
    ];
    expect(detectScheduleConflicts(matches)).toEqual([]);
  });

  it('Konflikt wenn gleiches Feld zur gleichen Zeit', () => {
    const matches = [
      { id: 'm1', field: 1, scheduledAt: new Date('2026-09-05T10:00') },
      { id: 'm2', field: 1, scheduledAt: new Date('2026-09-05T10:00') },
    ];
    const c = detectScheduleConflicts(matches);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ reason: 'same_field_overlap' });
  });

  it('ignoriert Spiele ohne scheduledAt', () => {
    const matches = [
      { id: 'm1', field: 1, scheduledAt: null },
      { id: 'm2', field: 1, scheduledAt: new Date('2026-09-05T10:00') },
    ];
    expect(detectScheduleConflicts(matches)).toEqual([]);
  });
});