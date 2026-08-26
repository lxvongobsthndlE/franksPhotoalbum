/**
 * Tests: generateSchedule + detectScheduleConflicts. Spec §5.3 + §10.9.
 */

import { describe, it, expect } from 'vitest';
import {
  generateSchedule,
  detectScheduleConflicts,
  detectRoundOverlaps,
  scheduleMetrics,
} from '../engine/schedule.js';
import { buildRoundRobinMatches } from '../engine/round-robin.js';

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

describe('Runden laufen nacheinander, nicht gleichzeitig', () => {
  // Spec §5.3. Der Befund vom 2026-08-26: im Spielplan lagen Spiel um
  // Platz 3 und Finale um 12:15, das Viertelfinale erst um 12:30.
  const koCfg = {
    schedule: {
      matchDurationMinutes: 10,
      pauseAfterMatches: 5,
      parallelFields: 4,   // bewusst mehr Plätze als Spiele pro Runde
      startTime: '10:00',
    },
  };
  const ko = (id, round, pos) => ({
    id, teamHome: null, teamAway: null, stageType: 'ko', round, bracketPos: pos,
  });
  const baum = [
    ko('qf1', 'QF', 1), ko('qf2', 'QF', 2), ko('qf3', 'QF', 3), ko('qf4', 'QF', 4),
    ko('sf1', 'SF', 1), ko('sf2', 'SF', 2),
    ko('p3', '3RD', 1), ko('fin', 'F', 1),
  ];

  it('vier freie Plätze verführen nicht dazu, VF und HF zusammenzulegen', () => {
    // Vier Plätze und vier Viertelfinals: der Planer KÖNNTE ab 10:15
    // das Halbfinale danebenlegen. Er darf nicht — die Halbfinalisten
    // stehen erst fest, wenn das Viertelfinale gespielt ist.
    const sched = generateSchedule(baum, koCfg, baseDate);
    const at = (id) => sched.find((m) => m.id === id).scheduledAt.getTime();
    const qfEnde = Math.max(at('qf1'), at('qf2'), at('qf3'), at('qf4'));
    const sfStart = Math.min(at('sf1'), at('sf2'));
    expect(sfStart).toBeGreaterThan(qfEnde);
    expect(at('p3')).toBeGreaterThan(Math.max(at('sf1'), at('sf2')));
    expect(at('fin')).toBeGreaterThan(at('p3'));
  });

  it('detectRoundOverlaps meldet nichts an einem sauberen Plan', () => {
    const sched = generateSchedule(baum, koCfg, baseDate);
    expect(detectRoundOverlaps(sched)).toEqual([]);
  });

  it('detectRoundOverlaps erkennt Gleichzeitigkeit und verkehrte Reihenfolge', () => {
    // Ein von Hand gebauter, unmöglicher Plan: alle Runden um 12:00,
    // das Finale sogar davor. Ressourcenfrei (verschiedene Plätze) und
    // trotzdem kein Turnier — genau die Lücke, die
    // detectScheduleConflicts nicht sieht.
    const t = (iso) => new Date(iso);
    const kaputt = [
      { ...ko('qf1', 'QF', 1), scheduledAt: t('2026-09-05T12:00:00Z'), field: 1 },
      { ...ko('sf1', 'SF', 1), scheduledAt: t('2026-09-05T12:00:00Z'), field: 2 },
      { ...ko('fin', 'F', 1),  scheduledAt: t('2026-09-05T11:45:00Z'), field: 3 },
    ];
    expect(detectScheduleConflicts(kaputt)).toEqual([]);   // Plätze sind frei
    const gruende = detectRoundOverlaps(kaputt).map((v) => v.reason);
    expect(gruende).toContain('round_overlap');
    expect(gruende).toContain('round_out_of_order');
  });

  it('ein unbekanntes Rundenkürzel bekommt einen eigenen Block, keinen Sammelblock', () => {
    // Fällt ein Kürzel aus der Tabelle (Tippfehler, neuer Modus, ein
    // Aufrufer der `round` unterwegs zur Zahl macht), dann lagen vorher
    // ALLE betroffenen Spiele auf demselben Anstoß. Unbekannt heißt
    // jetzt „Reihenfolge geraten", nicht mehr „alles gleichzeitig".
    const fremd = [
      ko('a1', 'ACHTELFINALE', 1), ko('a2', 'ACHTELFINALE', 2),
      ko('b1', 'ZWISCHENRUNDE', 1),
    ];
    const sched = generateSchedule(fremd, koCfg, baseDate);
    const at = (id) => sched.find((m) => m.id === id).scheduledAt.getTime();
    expect(at('b1')).not.toBe(at('a1'));
    expect(at('a1')).toBe(at('a2'));   // gleiche Runde bleibt parallel
  });

  it('Gruppen-Spieltage bleiben getrennt: erst Spieltag 1 aller Gruppen', () => {
    const g = (id, gk, rn, home, away) => ({
      id, teamHome: home, teamAway: away, stageType: 'group',
      groupKey: gk, roundNumber: rn, bracketPos: 1,
    });
    const matches = [
      g('a1', 'A', 1, 't1', 't2'), g('a2', 'A', 2, 't1', 't3'),
      g('b1', 'B', 1, 't5', 't6'), g('b2', 'B', 2, 't5', 't7'),
    ];
    const sched = generateSchedule(matches, koCfg, baseDate);
    const at = (id) => sched.find((m) => m.id === id).scheduledAt.getTime();
    expect(at('b1')).toBe(at('a1'));                 // Spieltag 1 parallel
    expect(at('a2')).toBeGreaterThan(at('b1'));      // Spieltag 2 danach
    expect(at('b2')).toBe(at('a2'));
  });
});

describe('Wartezeiten: Mindestruhe und gleichmäßige Abstände (2026-08-26)', () => {
  // Vorher kannte der Planer nur „nicht zweimal im selben Slot". Dass
  // trotzdem meist nichts direkt hintereinander lag, war Nebenwirkung der
  // Blocksortierung — bei 4 und 5 Teams auf einem Feld lag es eben doch.
  const gruppenSpiele = (gruppen, teamsProGruppe) => {
    const alle = [];
    for (let g = 0; g < gruppen; g++) {
      const key = String.fromCharCode(65 + g);
      const ids = Array.from({ length: teamsProGruppe }, (_, i) => `${key}${i + 1}`);
      for (const rm of buildRoundRobinMatches(ids)) {
        alle.push({
          ...rm,
          id: `${key}-${rm.bracketPos}`,
          stageType: 'group',
          groupKey: key,
        });
      }
    }
    return alle;
  };

  const cfg = (parallelFields) => ({
    schedule: { matchDurationMinutes: 15, parallelFields, startTime: '10:00', slotMinutes: 15 },
  });

  const konstellationen = [
    [1, 4, 1], [1, 5, 1], [1, 6, 1], [1, 8, 1],
    [2, 4, 1], [2, 4, 2], [3, 4, 2], [4, 4, 2],
    [2, 5, 2], [4, 5, 3], [2, 6, 2], [3, 5, 2],
    [4, 4, 4], [6, 4, 3], [8, 4, 4], [2, 8, 2],
  ];

  for (const [gruppen, teams, felder] of konstellationen) {
    it(`${gruppen} Gruppen à ${teams} Teams auf ${felder} Feld(ern): niemand spielt direkt hintereinander`, () => {
      const plan = generateSchedule(gruppenSpiele(gruppen, teams), cfg(felder), baseDate);
      const k = scheduleMetrics(plan);
      expect(k.backToBack, `betroffen: ${k.betroffeneTeams.join(', ')}`).toBe(0);
      expect(k.abstandMin).toBeGreaterThanOrEqual(2);
      expect(detectScheduleConflicts(plan)).toEqual([]);
    });
  }

  it('bei gerader Teamzahl bleibt der Abstand im Korridor S ± 1', () => {
    // S = Slots je Runde = ceil(Spiele je Runde / Felder). Weil jedes Team
    // genau einmal pro Runde spielt, ist S der natürliche Abstand; jede
    // Abweichung ist Positionsdrift zwischen den Runden.
    //
    // Nur gerade Teamzahlen: bei ungerader pausiert je Runde ein Team
    // (BYE), sein Abstand ist dann 2S und das ist kein Mangel.
    for (const [gruppen, teams, felder] of [[2, 4, 2], [3, 4, 2], [4, 4, 2], [8, 4, 4], [2, 6, 2], [2, 8, 2]]) {
      const spiele = gruppenSpiele(gruppen, teams);
      const spieleJeRunde = spiele.length / (teams - 1);
      const S = Math.ceil(spieleJeRunde / felder);
      const k = scheduleMetrics(generateSchedule(spiele, cfg(felder), baseDate));
      const etikett = `${gruppen}G/${teams}T/${felder}F (S=${S})`;
      expect(k.abstandMin, etikett).toBeGreaterThanOrEqual(S - 1);
      expect(k.abstandMax, etikett).toBeLessThanOrEqual(S + 1);
    }
  });

  it('der Puffer wird nur verbraucht, wo die Mindestruhe ihn braucht', () => {
    // 4 Gruppen à 4 Teams auf 2 Feldern: 8 Spiele je Runde, 4 Slots je
    // Runde, jedes Team hält von allein Abstand 4. Der Block darf dann
    // KEINEN Slot länger werden als das Minimum.
    const plan = generateSchedule(gruppenSpiele(4, 4), cfg(2), baseDate);
    const k = scheduleMetrics(plan);
    expect(k.leerSlots).toBe(0);
    expect(k.slots).toBe(12); // 24 Spiele / 2 Felder
  });

  it('minRestSlots: 0 schaltet die Mindestruhe ab und packt den Plan dicht', () => {
    // Der Ausweg für Turnierleiter mit engem Zeitfenster: Wer lieber früher
    // fertig ist als Pausen garantiert, sagt das der Config — und bekommt
    // dann auch Spiele direkt hintereinander. Das ist eine Entscheidung,
    // keine Panne, und deshalb steht sie in der Config und nicht im Code.
    const spiele = gruppenSpiele(1, 4);
    const ohneRuhe = {
      schedule: { matchDurationMinutes: 15, parallelFields: 1, startTime: '10:00', slotMinutes: 15, minRestSlots: 0 },
    };
    const dicht = scheduleMetrics(generateSchedule(spiele, ohneRuhe, baseDate));
    const locker = scheduleMetrics(generateSchedule(spiele, cfg(1), baseDate));

    expect(dicht.leerSlots).toBe(0);
    expect(dicht.slots).toBe(6);          // 6 Spiele, 6 Slots, kein Leerlauf
    expect(dicht.backToBack).toBeGreaterThan(0);

    // Mit Mindestruhe kostet dieselbe Gruppe zwei Slots mehr — bei 4 Teams
    // auf einem Feld ist Back-to-Back-Freiheit nicht gratis zu haben:
    // jedes Team hat 3 Spiele in 6 Slots, und die einzige nachbarschaftsfreie
    // Aufteilung verlangte, dass zwei Teams dreimal gegeneinander spielen.
    expect(locker.backToBack).toBe(0);
    expect(locker.slots).toBeGreaterThan(dicht.slots);
  });

  it('§10.9 bleibt gültig: der Planer ist weiterhin deterministisch', () => {
    const spiele = gruppenSpiele(3, 5);
    const a = generateSchedule(spiele, cfg(2), baseDate);
    const b = generateSchedule(spiele, cfg(2), baseDate);
    expect(a.map((x) => `${x.id}@${x.scheduledAt?.getTime()}#${x.field}`))
      .toEqual(b.map((x) => `${x.id}@${x.scheduledAt?.getTime()}#${x.field}`));
  });
});

describe('scheduleMetrics', () => {
  it('leerer Plan', () => {
    expect(scheduleMetrics([]).backToBack).toBe(0);
    expect(scheduleMetrics([]).abstandMin).toBeNull();
  });

  it('ein bewusst leer gelassener Slot ist keine Back-to-Back-Paarung', () => {
    // Der Messfehler, an dem die Entwicklung dieser Regel fast gescheitert
    // wäre: Zählt man die vorkommenden Anstoßzeiten durch, statt das
    // Zeitraster zu benutzen, dann fehlt ein leerer Slot in der Zählung —
    // und die beiden Spiele davor und danach rücken auf benachbarte
    // Indizes zusammen. Ausgerechnet die Pause, die der Planer erkämpft
    // hat, wird dann als „direkt hintereinander" gemeldet.
    const t = (min) => new Date(new Date(baseDate).setHours(10, min, 0, 0));
    const plan = [
      { id: 'm1', teamHome: 'A', teamAway: 'B', field: 1, scheduledAt: t(0) },
      // 10:15 bleibt frei — hier hat Team A seine Pause.
      { id: 'm2', teamHome: 'A', teamAway: 'C', field: 1, scheduledAt: t(30) },
    ];
    const k = scheduleMetrics(plan, { slotMinutes: 15 });
    expect(k.backToBack).toBe(0);
    expect(k.abstandMin).toBe(2);
    expect(k.slots).toBe(3);       // 10:00, (10:15 leer), 10:30
    expect(k.slotMinuten).toBe(15);
  });

  it('meldet Back-to-Back samt betroffenem Team', () => {
    const t = (min) => new Date(new Date(baseDate).setHours(10, min, 0, 0));
    const plan = [
      { id: 'm1', teamHome: 'A', teamAway: 'B', field: 1, scheduledAt: t(0) },
      { id: 'm2', teamHome: 'A', teamAway: 'C', field: 1, scheduledAt: t(15) },
    ];
    const k = scheduleMetrics(plan);
    expect(k.backToBack).toBe(1);
    expect(k.betroffeneTeams).toEqual(['A']);
    expect(k.maxPauseMinuten).toBe(15);
  });
});
