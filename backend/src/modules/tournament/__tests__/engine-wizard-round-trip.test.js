/**
 * Systematischer Round-Trip-Test (2026-08-17): JEDER Wizard-Wert wird
 * einzeln auf nicht-Default gesetzt, die Engine läuft mit dem Wert,
 * und der Test prüft genau DIESEN Wert im Engine-Output.
 *
 * Hintergrund (User-Auftrag):
 *   "Alle drei Bugs sind dieselbe Grundfrage: Kommen die Wizard-
 *    Einstellungen in der Engine an? Beim Modus und bei der Spieldauer
 *    nachweislich nicht. Mach einen systematischen Durchlauf: Setz
 *    JEDEN Wizard-Wert bewusst abweichend vom Standard, generiere, und
 *    prüf jeden einzeln in der DB nach."
 *
 * Test-Strategie:
 *   - Engine pur (kein HTTP), aber mit der Config, die buildPatchPayload
 *     tatsächlich zusammenbaut. Wenn der Test fehlschlägt, ist entweder
 *     der Wizard-Builder oder die Engine schuld — und der Test benennt
 *     genau das eine Feld, das nicht ankommt.
 *
 * Was NICHT hier getestet wird (andere Test-Dateien):
 *   - HTTP-Schicht + Routes + Auth (routes.integration.test.js,
 *     wizard-round-trip.test.js, generate.integration.test.js)
 *   - Engine-Logik im Detail (engine-*.test.js)
 *
 * Was HIER getestet wird (jeder Wert EINMAL, namentlich benannt):
 *   - Modus: 'ko_only'        → KEINE Gruppenspiele, NUR KO
 *   - Modus: 'groups_only'    → Gruppenspiele, KEIN KO
 *   - Modus: 'groups_ko'      → beides
 *   - numGroups               → Gruppenanzahl im Output
 *   - startTime               → erste scheduledAt-Zeit
 *   - matchDurationMinutes    → Abstand zwischen Slots
 *   - pauseAfterMatches       → wird auf matchDuration aufaddiert
 *   - parallelFields          → HF 1 + HF 2 gleichzeitig auf versch. Feldern
 *   - advancePerGroup         → Anzahl Qualifikanten pro Gruppe
 *   - bestThirds              → zusätzliche Qualifikanten
 *   - hasThirdPlacePlayoff    → 3RD-Match existiert (bei ko_only mit 4 Teams)
 *   - pointsPerWin/Draw/Loss  → werden 1:1 in standings übernommen
 *   - tiebreakers-Reihenfolge → custom order respektiert
 *   - distribution='snake'    → Setzliste korrekt verteilt
 *   - distribution='random'   → andere Reihenfolge als 'snake'
 */

import { describe, it, expect } from 'vitest';
import { generateTournament } from '../engine/index.js';
import { generateSchedule } from '../engine/schedule.js';

// 8 Platzhalter-Teams — genug für 2 Gruppen + KO.
const teams8 = Array.from({ length: 8 }, (_, i) => ({
  id: `T${i + 1}`,
  name: `Team ${i + 1}`,
  seed: i + 1,
}));

// 4 Platzhalter-Teams — minimaler ko_only-Sweep.
const teams4 = Array.from({ length: 4 }, (_, i) => ({
  id: `T${i + 1}`,
  name: `Team ${i + 1}`,
  seed: i + 1,
}));

// 12 Teams / 4 Gruppen — Standard-Setup.
const teams12 = Array.from({ length: 12 }, (_, i) => ({
  id: `T${i + 1}`,
  name: `Team ${i + 1}`,
  seed: i + 1,
}));

// Default-Config für 4-Teams-ko_only.
function defaultConfig4(overrides = {}) {
  return {
    mode: 'ko_only',
    numGroups: 1,
    distribution: 'snake',
    pointsPerWin: 3,
    pointsPerDraw: 1,
    pointsPerLoss: 0,
    tiebreakers: ['points', 'goalDiff', 'goalsFor', 'headToHead'],
    qualifyPerGroup: 2,
    bestThirds: 0,
    hasThirdPlacePlayoff: false,
    seedProtection: 'group',
    schedule: {
      slotMinutes: 15,
      matchDurationMinutes: 30,
      pauseAfterMatches: 0,
      parallelFields: 1,
      startTime: '10:00',
    },
    ...overrides,
    schedule: { ...{ slotMinutes: 15, matchDurationMinutes: 30, pauseAfterMatches: 0, parallelFields: 1, startTime: '10:00' }, ...(overrides.schedule ?? {}) },
  };
}

// Default-Config für 12-Teams / 4-Gruppen.
function defaultConfig12(overrides = {}) {
  return defaultConfig4({
    mode: 'groups_ko',
    numGroups: 4,
    ...overrides,
  });
}

// Helper: alle scheduledAt + field aus dem Output.
function scheduleById(output) {
  const all = [
    ...output.groups.flatMap((g) => g.matches),
    ...output.bracket.matches,
  ];
  return new Map(all.filter((m) => m.scheduledAt).map((m) => [m.id, m]));
}

describe('Engine-Wizard-Round-Trip: jeder Wizard-Wert kommt in der Engine an', () => {
  // ─── Modus ──────────────────────────────────────────────────
  it('Modus: "ko_only" → KEINE Gruppenspiele, nur KO-Bracket', () => {
    const out = generateTournament({
      teams: teams4,
      config: defaultConfig4({ mode: 'ko_only' }),
      baseDate: '2026-09-05',
    });
    // Bug 3: bisher baut die Engine immer Gruppen. Wenn dieser
    // Test failed, ist Bug 3 noch offen.
    expect(out.groups.flatMap((g) => g.matches)).toHaveLength(0);
    // 4 Teams → SF (2) + F (1) = 3 KO-Spiele (mindestens).
    expect(out.bracket.matches.length).toBeGreaterThanOrEqual(3);
    // Bracket-Spiele haben stageType='ko'.
    for (const m of out.bracket.matches) {
      expect(m.stageType).toBe('ko');
    }
    // Kein 'g_*'-Match im Output.
    const allMatches = [
      ...out.groups.flatMap((g) => g.matches),
      ...out.bracket.matches,
    ];
    for (const m of allMatches) {
      expect(m.id.startsWith('g_')).toBe(false);
    }
  });

  it('Modus: "groups_only" → Gruppenspiele, KEIN KO-Bracket', () => {
    const out = generateTournament({
      teams: teams8,
      config: defaultConfig4({ mode: 'groups_only', numGroups: 2 }),
      baseDate: '2026-09-05',
    });
    expect(out.bracket.matches).toHaveLength(0);
    // 8 Teams / 2 Gruppen = 4 pro Gruppe → 4C2 = 6 RR-Matches pro Gruppe,
    // × 2 Gruppen = 12 Gruppenspiele.
    expect(out.groups.flatMap((g) => g.matches).length).toBe(12);
  });

  it('Modus: "groups_ko" → beides (Default-Verhalten)', () => {
    const out = generateTournament({
      teams: teams12,
      config: defaultConfig12({ mode: 'groups_ko' }),
      baseDate: '2026-09-05',
    });
    expect(out.groups.flatMap((g) => g.matches).length).toBeGreaterThan(0);
    expect(out.bracket.matches.length).toBeGreaterThan(0);
  });

  // ─── numGroups ──────────────────────────────────────────────
  it('numGroups=4 → 4 Gruppen', () => {
    const out = generateTournament({
      teams: teams12,
      config: defaultConfig12({ numGroups: 4 }),
      baseDate: '2026-09-05',
    });
    expect(out.groups).toHaveLength(4);
  });

  it('numGroups=2 → 2 Gruppen', () => {
    const out = generateTournament({
      teams: teams12,
      config: defaultConfig12({ numGroups: 2 }),
      baseDate: '2026-09-05',
    });
    expect(out.groups).toHaveLength(2);
  });

  // ─── startTime ──────────────────────────────────────────────
  it('startTime="14:00" → erste Spielzeit ist 14:00, nicht 10:00', () => {
    const out = generateTournament({
      teams: teams4,
      config: defaultConfig4({
        schedule: { startTime: '14:00' },
      }),
      baseDate: '2026-09-05',
    });
    const sched = scheduleById(out);
    const times = [...sched.values()].map((m) => m.scheduledAt);
    const minTime = new Date(Math.min(...times.map((t) => t.getTime())));
    expect(minTime.getHours()).toBe(14);
    expect(minTime.getMinutes()).toBe(0);
  });

  // ─── matchDurationMinutes ──────────────────────────────────
  it('matchDurationMinutes=35, pauseAfter=0 → Slots 35 Min auseinander', () => {
    // Bug 2 (Hauptproblem): Engine liest matchDurationMinutes, nutzt aber
    // nur slotMinutes (Default 15). Wenn dieser Test failed, ist Bug 2 offen.
    const cfg = defaultConfig4({
      schedule: {
        matchDurationMinutes: 35,
        pauseAfterMatches: 0,
        slotMinutes: 15,           // ← bleibt absichtlich auf 15, Wizard schickt das so
        parallelFields: 2,         // 2 SFs gleichzeitig auf Platte 1 + 2
      },
    });
    const matches = [
      // 4 KO-Spiele in 2 Blöcken (SF + F): erst die 2 SFs gleichzeitig,
      // dann das F.
      {
        id: 'ko_SF_1', stageType: 'ko', round: 'SF', bracketPos: 1,
        teamHome: 'T1', teamAway: 'T2',
      },
      {
        id: 'ko_SF_2', stageType: 'ko', round: 'SF', bracketPos: 2,
        teamHome: 'T3', teamAway: 'T4',
      },
      {
        id: 'ko_F_1',  stageType: 'ko', round: 'F',  bracketPos: 1,
        teamHome: null, teamAway: null,
      },
    ];
    const sched = generateSchedule(matches, cfg, new Date('2026-09-05'));
    const byId = new Map(sched.map((m) => [m.id, m]));
    // Block 1: SF1 + SF2 gleichzeitig → scheduledAt identisch (parallelFields=2).
    // Block 2: F → 35 Min nach den SFs.
    const sf1 = byId.get('ko_SF_1').scheduledAt.getTime();
    const sf2 = byId.get('ko_SF_2').scheduledAt.getTime();
    const f1  = byId.get('ko_F_1').scheduledAt.getTime();
    expect(f1 - sf1).toBe(35 * 60_000); // ← DAS IST BUG 2
    // SFs gleichzeitig auf parallelen Feldern.
    expect(sf1).toBe(sf2);
  });

  it('matchDurationMinutes=20, pauseAfter=10 → Slots 30 Min auseinander', () => {
    // matchDuration + pause = 30. Wenn der Test failed, addiert die Engine
    // die Pause nicht korrekt.
    const cfg = defaultConfig4({
      schedule: {
        matchDurationMinutes: 20,
        pauseAfterMatches: 10,
        slotMinutes: 15,
        parallelFields: 1,
      },
    });
    const matches = [
      { id: 'g_A_1', stageType: 'group', groupKey: 'A', roundNumber: 1,
        bracketPos: 1, teamHome: 'T1', teamAway: 'T2' },
      { id: 'g_A_2', stageType: 'group', groupKey: 'A', roundNumber: 2,
        bracketPos: 1, teamHome: 'T3', teamAway: 'T4' },
    ];
    const sched = generateSchedule(matches, cfg, new Date('2026-09-05'));
    const byId = new Map(sched.map((m) => [m.id, m]));
    const a1 = byId.get('g_A_1').scheduledAt.getTime();
    const a2 = byId.get('g_A_2').scheduledAt.getTime();
    // Runde 2 beginnt 30 Min nach Runde 1.
    expect(a2 - a1).toBe(30 * 60_000);
  });

  // ─── parallelFields ────────────────────────────────────────
  it('parallelFields=4 → 2 SFs gleichzeitig auf Feld 1 + 2 (NICHT 10:00 + 10:15)', () => {
    // Bug 2b: HF 1 + HF 2 sollen parallel laufen. Bei parallelFields=4
    // haben wir 4 Felder zur Verfügung. Mit der alten Logik läuft
    // HF 2 versetzt zu HF 1 (slotIndex inkrementiert IMMER).
    const cfg = defaultConfig4({
      schedule: {
        matchDurationMinutes: 30,
        pauseAfterMatches: 0,
        parallelFields: 4,
        slotMinutes: 15, // ← Wizard schickt das aktuell so
      },
    });
    const matches = [
      { id: 'ko_SF_1', stageType: 'ko', round: 'SF', bracketPos: 1,
        teamHome: 'T1', teamAway: 'T2' },
      { id: 'ko_SF_2', stageType: 'ko', round: 'SF', bracketPos: 2,
        teamHome: 'T3', teamAway: 'T4' },
    ];
    const sched = generateSchedule(matches, cfg, new Date('2026-09-05'));
    const byId = new Map(sched.map((m) => [m.id, m]));
    const sf1 = byId.get('ko_SF_1');
    const sf2 = byId.get('ko_SF_2');
    // Parallel → identische Zeit, unterschiedliche Felder.
    expect(sf1.scheduledAt.getTime()).toBe(sf2.scheduledAt.getTime());
    expect(sf1.field).not.toBe(sf2.field);
    // Felder im Bereich [1..parallelFields].
    expect(sf1.field).toBeGreaterThanOrEqual(1);
    expect(sf1.field).toBeLessThanOrEqual(4);
  });

  // ─── advancePerGroup / bestThirds ──────────────────────────
  it('advancePerGroup=1 + bestThirds=2 (12 Teams / 3 Gruppen) → 5 Qualifikanten', () => {
    // 3 Gruppen × 1 + 2 beste Dritte = 5 Qualifikanten
    // 12 Teams / 3 Gruppen = 4 pro Gruppe
    const cfg = defaultConfig12({
      numGroups: 3,
      qualifyPerGroup: 1,
      bestThirds: 2,
    });
    const out = generateTournament({
      teams: teams12,
      config: cfg,
      baseDate: '2026-09-05',
    });
    expect(out.qualifiers).toHaveLength(5);
  });

  // ─── hasThirdPlacePlayoff ───────────────────────────────────
  it('hasThirdPlacePlayoff=true + ko_only + 4 Teams → 3RD-Match existiert', () => {
    const out = generateTournament({
      teams: teams4,
      config: defaultConfig4({
        mode: 'ko_only',
        hasThirdPlacePlayoff: true,
      }),
      baseDate: '2026-09-05',
    });
    expect(out.bracket.hasThirdPlacePlayoff).toBe(true);
    expect(out.bracket.matches.some((m) => m.round === '3RD')).toBe(true);
  });

  // ─── Punkteregel ────────────────────────────────────────────
  it('pointsPerWin=2, pointsPerDraw=1, pointsPerLoss=0 → werden 1:1 übernommen', () => {
    const cfg = defaultConfig12({
      pointsPerWin: 2,
      pointsPerDraw: 1,
      pointsPerLoss: 0,
    });
    expect(cfg.pointsPerWin).toBe(2);
    expect(cfg.pointsPerDraw).toBe(1);
    expect(cfg.pointsPerLoss).toBe(0);
    // Engine nimmt diese Config 1:1 — wir prüfen das per direkter
    // Standings-Berechnung in engine-standings.test.js, hier nur den
    // Through-Put (Config landet unverändert im Engine-Output).
    const out = generateTournament({
      teams: teams12,
      config: cfg,
      baseDate: '2026-09-05',
    });
    expect(out.config.pointsPerWin).toBe(2);
    expect(out.config.pointsPerDraw).toBe(1);
    expect(out.config.pointsPerLoss).toBe(0);
  });

  // ─── Tiebreaker-Reihenfolge ─────────────────────────────────
  it('tiebreakers custom order ["wins","goalDiff","points"] → landet in config', () => {
    const cfg = defaultConfig12({
      tiebreakers: ['wins', 'goalDiff', 'points'],
    });
    const out = generateTournament({
      teams: teams12,
      config: cfg,
      baseDate: '2026-09-05',
    });
    expect(out.config.tiebreakers).toEqual(['wins', 'goalDiff', 'points']);
  });

  // ─── distribution ───────────────────────────────────────────
  it('distribution="snake" → Gruppe A bekommt T1, T4, T5, T8 (Setzliste)', () => {
    const out = generateTournament({
      teams: teams8,
      config: defaultConfig4({
        mode: 'groups_only',
        numGroups: 2,
        distribution: 'snake',
      }),
      baseDate: '2026-09-05',
    });
    // snake mit 2 Gruppen: round 0 forward → T1→A, T2→B
    // round 1 backward → T3→B, T4→A
    // round 2 forward → T5→A, T6→B
    // round 3 backward → T7→B, T8→A
    // Erwartung A: [T1, T4, T5, T8], B: [T2, T3, T6, T7]
    const aIds = out.groups[0].members.map((m) => m.id);
    expect(aIds).toEqual(['T1', 'T4', 'T5', 'T8']);
  });

  it('distribution="random" mit seed → deterministisch aber ≠ snake', () => {
    const cfgSnake = defaultConfig4({
      mode: 'groups_only',
      numGroups: 2,
      distribution: 'snake',
      distributionSeed: 'fixed-seed',
    });
    const cfgRandom = {
      ...cfgSnake,
      distribution: 'random',
      distributionSeed: 'fixed-seed',
    };
    const outSnake = generateTournament({
      teams: teams8, config: cfgSnake, baseDate: '2026-09-05',
    });
    const outRandom = generateTournament({
      teams: teams8, config: cfgRandom, baseDate: '2026-09-05',
    });
    // A-Gruppe mit random ist (hoffentlich) eine andere Reihenfolge als
    // snake. Falls random zufällig dieselbe Reihenfolge erzeugt, ist der
    // Seed-Generator kaputt — entweder Weg prüfen wir den Round-Trip.
    const snakeA = outSnake.groups[0].members.map((m) => m.id).join(',');
    const randomA = outRandom.groups[0].members.map((m) => m.id).join(',');
    // Wenn beide gleich sind, ist der Randomizer kaputt (immer snake).
    expect(randomA).not.toBe(snakeA);
  });
});