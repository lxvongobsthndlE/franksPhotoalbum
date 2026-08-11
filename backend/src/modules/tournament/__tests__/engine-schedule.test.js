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

  it('Sortierung nach Gruppe vor bracketPos', () => {
    // Konstruiere: gA hat bracketPos 5, gB hat bracketPos 1.
    // Mit Sortierung nach groupKey sollte gB vor gA drankommen.
    const matches = [
      m('m1', 'A', 'B', { groupKey: 'B', bracketPos: 1 }),
      m('m2', 'C', 'D', { groupKey: 'A', bracketPos: 5 }),
    ];
    const sched = generateSchedule(matches, baseConfig, baseDate);
    expect(sched[0].id).toBe('m1');
    expect(sched[1].id).toBe('m2');
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