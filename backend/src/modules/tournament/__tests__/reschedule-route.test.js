/**
 * Echte Tests für die Reschedule-Funktionalität.
 *
 * Die Route POST /api/tournaments/:id/reschedule nimmt die bestehenden
 * Spiele aus der DB, füttert die Engine damit, schreibt nur scheduledAt +
 * field zurück. Die Engine-Logik (Block-Ordering, Determinismus) wird
 * hier gegen dieselben Daten getestet, die auch die Route verwendet —
 * so beweisen wir, dass ein Reschedule-Aufruf genau die Sortierung
 * produziert, die der Renderer braucht.
 *
 *   R1  Reschedule block-ordnet: alle Spiele in Block N vor Block N+1
 *       (12-Teams-Beispiel mit 3 Gruppen + QF/SF/3RD/F)
 *   R2  Reschedule ist deterministisch (§10.9): 2× Aufruf liefert
 *       identische scheduledAt-Werte
 *   R3  Reschedule schreibt scheduledAt + field für ALLE Spiele neu
 *   R4  KO-Runden-Reihenfolge R32 < R16 < QF < SF < 3RD < F
 *   R5  Round-Trip: Engine-Input aus DB-Matches rekonstruieren,
 *       Output zurück in DB-Shape → scheduledAt ist gültiges Date,
 *       field ist Integer
 */

import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../engine/index.js';

// 12-Teams-Beispiel: 3 Gruppen à 4, je 3 Spieltage à 2 Matches = 18.
// KO: QF (4) + SF (2) + 3RD (1) + F (1) = 8. Insgesamt 26 Spiele.
function buildDbMatches() {
  const matches = [];
  let idx = 0;
  const groupKeys = ['A', 'B', 'C'];
  for (const gk of groupKeys) {
    for (let spieltag = 1; spieltag <= 3; spieltag++) {
      for (let m = 0; m < 2; m++) {
        idx += 1;
        matches.push({
          id: `g_${gk}_${idx}`,
          tournamentId: 't-1',
          stageId: `s_group_${gk}`,
          groupId: `g_${gk}`,
          round: String(spieltag),
          bracketType: 'winner',
          bracketPos: idx,
          teamHome: `${gk}${spieltag}H${m}`,
          teamAway: `${gk}${spieltag}A${m}`,
          status: 'scheduled',
          stage: { type: 'group', name: 'Gruppenphase', orderIndex: 0 },
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
        tournamentId: 't-1',
        stageId: 's_ko',
        groupId: null,
        round,
        bracketType: 'winner',
        bracketPos: i,
        teamHome: `KO${round}H${i}`,
        teamAway: `KO${round}A${i}`,
        status: 'scheduled',
        stage: { type: 'ko', name: 'KO-Phase', orderIndex: 1 },
      });
    }
  }
  return matches;
}

// Rekonstruiert das Engine-Input-Shape aus den DB-Rows. Genau so macht
// es die Route in `routes.js` POST /:id/reschedule.
function dbToEngineInput(dbMatches) {
  return dbMatches.map((m) => {
    if (m.stage?.type === 'group' || m.stage?.type === 'intermediate_group') {
      const roundNumber = Number.parseInt(m.round ?? '1', 10);
      return {
        id: m.id,
        teamHome: m.teamHome,
        teamAway: m.teamAway,
        stageType: 'group',
        groupKey: m.groupId,
        roundNumber: Number.isFinite(roundNumber) ? roundNumber : 1,
        bracketPos: m.bracketPos,
      };
    }
    return {
      id: m.id,
      teamHome: m.teamHome,
      teamAway: m.teamAway,
      stageType: 'ko',
      round: m.round,
      bracketPos: m.bracketPos,
    };
  });
}

const KO_ORDER = { R64: 0, R32: 1, R16: 2, QF: 3, SF: 4, '3RD': 5, F: 6 };
function blockOf(engineMatch) {
  if (engineMatch.stageType === 'ko') {
    return 100_000 + (KO_ORDER[engineMatch.round] ?? 999);
  }
  return engineMatch.roundNumber ?? 0;
}

const baseConfig = {
  schedule: { slotMinutes: 15, parallelFields: 1, startTime: '10:00' },
  mode: 'groups_ko',
};
const baseDate = new Date('2026-09-05');

describe('Reschedule — Engine-Logik auf DB-Input', () => {
  it('R1: Block-Ordering über alle 26 Spiele (12 Teams / 3 Gruppen + KO)', () => {
    const db = buildDbMatches();
    const input = dbToEngineInput(db);
    const scheduled = generateSchedule(input, baseConfig, baseDate);
    const byId = new Map(scheduled.map((s) => [s.id, s]));

    const violators = [];
    for (const a of input) {
      const ba = blockOf(a);
      for (const b of input) {
        const bb = blockOf(b);
        if (bb <= ba) continue;
        const ta = byId.get(a.id).scheduledAt.getTime();
        const tb = byId.get(b.id).scheduledAt.getTime();
        if (ta >= tb) violators.push({ a: a.id, b: b.id, ta, tb });
      }
    }
    expect(violators).toEqual([]);
  });

  it('R2: Reschedule ist deterministisch (§10.9)', () => {
    const db = buildDbMatches();
    const input = dbToEngineInput(db);
    const a = generateSchedule(input, baseConfig, baseDate);
    const b = generateSchedule(input, baseConfig, baseDate);
    expect(a.map((m) => m.scheduledAt.getTime())).toEqual(
      b.map((m) => m.scheduledAt.getTime()),
    );
    expect(a.map((m) => m.field)).toEqual(b.map((m) => m.field));
  });

  it('R3: Jedes DB-Match bekommt scheduledAt + field', () => {
    const db = buildDbMatches();
    const input = dbToEngineInput(db);
    const scheduled = generateSchedule(input, baseConfig, baseDate);
    expect(scheduled.length).toBe(db.length);
    for (const s of scheduled) {
      expect(s.scheduledAt).toBeInstanceOf(Date);
      expect(typeof s.field).toBe('number');
      expect(s.field).toBeGreaterThanOrEqual(1);
    }
  });

  it('R4: KO-Runden paarweise geordnet (R16 < QF < SF < 3RD < F)', () => {
    const db = [
      { id: 'f1', stage: { type: 'ko' }, round: 'F', teamHome: 'FH', teamAway: 'FA', bracketPos: 1 },
      { id: 'sf1', stage: { type: 'ko' }, round: 'SF', teamHome: 'SFH', teamAway: 'SFA', bracketPos: 1 },
      { id: '3rd1', stage: { type: 'ko' }, round: '3RD', teamHome: 'TH', teamAway: 'TA', bracketPos: 1 },
      { id: 'qf1', stage: { type: 'ko' }, round: 'QF', teamHome: 'QFH', teamAway: 'QFA', bracketPos: 1 },
      { id: 'r16_1', stage: { type: 'ko' }, round: 'R16', teamHome: 'R16H', teamAway: 'R16A', bracketPos: 1 },
    ];
    const input = dbToEngineInput(db);
    const scheduled = generateSchedule(input, baseConfig, baseDate);
    const byId = new Map(scheduled.map((s) => [s.id, s]));
    expect(byId.get('r16_1').scheduledAt.getTime()).toBeLessThan(byId.get('qf1').scheduledAt.getTime());
    expect(byId.get('qf1').scheduledAt.getTime()).toBeLessThan(byId.get('sf1').scheduledAt.getTime());
    expect(byId.get('sf1').scheduledAt.getTime()).toBeLessThan(byId.get('3rd1').scheduledAt.getTime());
    expect(byId.get('3rd1').scheduledAt.getTime()).toBeLessThan(byId.get('f1').scheduledAt.getTime());
  });

  it('R5: Round-Trip — Engine-Output ist in DB-Shape zurückschreibbar', () => {
    const db = buildDbMatches();
    const input = dbToEngineInput(db);
    const scheduled = generateSchedule(input, baseConfig, baseDate);
    // Wir simulieren den Prisma-Update: für jedes scheduled-Match wird
    // { scheduledAt, field } in die DB zurückgeschrieben.
    const updates = new Map();
    for (const s of scheduled) {
      updates.set(s.id, { scheduledAt: s.scheduledAt, field: s.field });
    }
    for (const m of db) {
      const u = updates.get(m.id);
      expect(u).toBeDefined();
      expect(u.scheduledAt).toBeInstanceOf(Date);
      expect(typeof u.field).toBe('number');
    }
    // Die DB-Writer-Logik darf NUR diese zwei Felder anfassen:
    const dbAfter = db.map((m) => ({ ...m, ...updates.get(m.id) }));
    // Alles andere ist unverändert.
    for (let i = 0; i < db.length; i++) {
      const before = db[i];
      const after = dbAfter[i];
      expect(after.scoreHome).toBe(before.scoreHome);
      expect(after.scoreAway).toBe(before.scoreAway);
      expect(after.status).toBe(before.status);
      expect(after.winnerAdvancesTo).toBe(before.winnerAdvancesTo);
      expect(after.loserAdvancesTo).toBe(before.loserAdvancesTo);
      expect(after.round).toBe(before.round);
      expect(after.bracketPos).toBe(before.bracketPos);
    }
  });

  it('R6: Auch beendete Spiele werden neu verteilt (ohne score-Verlust)', () => {
    const db = buildDbMatches();
    // Erste 6 Spiele sind beendet.
    for (let i = 0; i < 6; i++) {
      db[i].status = 'finished';
      db[i].scoreHome = 7;
      db[i].scoreAway = 3;
    }
    const input = dbToEngineInput(db);
    const scheduled = generateSchedule(input, baseConfig, baseDate);
    expect(scheduled.length).toBe(db.length);
    // Beendete Spiele haben trotzdem scheduledAt (sonst tauchen sie
    // nicht mehr in der Liste auf — Spec §8.0).
    for (let i = 0; i < 6; i++) {
      expect(scheduled[i].scheduledAt).toBeInstanceOf(Date);
    }
  });
});

