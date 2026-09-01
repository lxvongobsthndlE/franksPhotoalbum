/**
 * Volle Platten in der Gruppenphase, strenge Reihenfolge in der K.-o.-Phase.
 * Spec §5.3. Befund vom 2026-08-28.
 *
 * Der Betreiber, wörtlich: „es sollen immer auf allen tischen parallel
 * gespielt werden in der gruppenphase. und wenn am ende noch ein spiel übrig
 * ist oder so, dann natürlich das noch am ende. aber möglichst alle tische
 * sollen zu jeder spielzeit belegt sein! außer natürlich in der ko phase, da
 * gilt weiterhin die regel: erst vf, dann hf, dann spiel um platz 3, dann
 * finale."
 *
 * Warum dieser Test als INVARIANTE formuliert ist und nicht als erwartete
 * Zahlenliste: Im selben Modul ist eine teure Lehre belegt (Round-Robin,
 * 2026-08-26) — vier grüne Tests zählten Größen, die von der eigentlichen
 * Regel unberührt bleiben, während die Paarungen selbst falsch waren. Eine
 * Belegungsliste „Fenster 1 hat 3 Spiele" wäre wieder so ein Test: Sie ist
 * grün, solange die Zahlen stimmen, und sagt nichts darüber, ob ein Feld
 * hätte belegt werden KÖNNEN. Deshalb prüfen wir hier die Regel selbst:
 *
 *   Ein Feld darf in einem Zeitfenster nur dann leer bleiben, wenn KEIN
 *   noch nicht eingeplantes Gruppenspiel dort hätte stattfinden können,
 *   ohne H1 zu brechen (kein Team zweimal im selben Fenster).
 *
 * Diese Formulierung ist unabhängig von Teamzahl, Gruppenzuschnitt und
 * Feldzahl — und sie fällt, sobald die Auswahl-Logik wieder ein Feld für
 * eine Pause, einen Spieltag-Wechsel oder sonst eine weiche Regel opfert.
 */

import { describe, it, expect } from 'vitest';
import {
  generateSchedule,
  detectScheduleConflicts,
  detectRoundOverlaps,
} from '../engine/schedule.js';
import { buildRoundRobinMatches } from '../engine/round-robin.js';

const baseDate = new Date('2026-09-05');

/** Gruppenspiele für `gruppen` Gruppen à `teamsProGruppe` Teams. */
function gruppenSpiele(gruppen, teamsProGruppe) {
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
}

const cfg = (parallelFields) => ({
  schedule: {
    matchDurationMinutes: 30,
    pauseAfterMatches: 0,
    parallelFields,
    startTime: '10:00',
  },
});

/**
 * Gruppiert einen fertigen Plan nach Anstoßzeit, aufsteigend.
 * @returns {Array<{ zeit: number, spiele: Array }>}
 */
function fensterAus(plan) {
  const nach = new Map();
  for (const m of plan) {
    if (m?.scheduledAt == null) continue;
    const z = new Date(m.scheduledAt).getTime();
    if (!nach.has(z)) nach.set(z, []);
    nach.get(z).push(m);
  }
  return [...nach.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([zeit, spiele]) => ({ zeit, spiele }));
}

const teamsVon = (spiele) => {
  const s = new Set();
  for (const m of spiele) {
    if (m.teamHome != null) s.add(m.teamHome);
    if (m.teamAway != null) s.add(m.teamAway);
  }
  return s;
};

/**
 * DIE Invariante. Liefert eine Liste lesbarer Verstöße (leer = in Ordnung).
 *
 * Ein nicht volles Zeitfenster ist nur erlaubt, wenn
 *   a) es das LETZTE Fenster der Gruppenphase ist („wenn am Ende noch ein
 *      Spiel übrig ist"), oder
 *   b) jedes später angesetzte Gruppenspiel mindestens ein Team mit diesem
 *      Fenster teilt — dann verbietet H1 die Platzierung.
 */
function auslastungsVerstoesse(plan, felder) {
  const fenster = fensterAus(plan);
  const verstoesse = [];
  for (let i = 0; i < fenster.length; i++) {
    const f = fenster[i];
    if (f.spiele.length >= felder) continue; // voll
    if (i === fenster.length - 1) continue; // letztes Fenster darf teilbelegt sein
    const belegt = teamsVon(f.spiele);
    for (let j = i + 1; j < fenster.length; j++) {
      for (const s of fenster[j].spiele) {
        const kollidiert =
          (s.teamHome != null && belegt.has(s.teamHome)) ||
          (s.teamAway != null && belegt.has(s.teamAway));
        if (!kollidiert) {
          verstoesse.push(
            `Fenster #${i} (${f.spiele.length}/${felder} belegt): ${s.id} ` +
              `(${s.teamHome} vs ${s.teamAway}) hätte hier spielen können`
          );
        }
      }
    }
  }
  return verstoesse;
}

/** Kein Zeitfenster wird übersprungen (das Raster bleibt lückenlos). */
function luecken(plan, rasterMinuten) {
  const fenster = fensterAus(plan);
  const raus = [];
  for (let i = 1; i < fenster.length; i++) {
    const d = (fenster[i].zeit - fenster[i - 1].zeit) / 60_000;
    if (d !== rasterMinuten) {
      raus.push(
        `${new Date(fenster[i - 1].zeit).toISOString()} → +${d} min statt ${rasterMinuten}`
      );
    }
  }
  return raus;
}

// Die vom Betreiber genannten Konstellationen plus zwei, in denen H1 das
// Füllen beweisbar begrenzt (4 Teams können nie mehr als 2 Platten belegen).
const konstellationen = [
  { gruppen: 2, teams: 4, felder: 2 },
  { gruppen: 4, teams: 4, felder: 3 },
  { gruppen: 3, teams: 5, felder: 4 },
  { gruppen: 1, teams: 6, felder: 3 },
  { gruppen: 2, teams: 4, felder: 1 }, // 8 Teams, 1 Tisch
  { gruppen: 1, teams: 4, felder: 3 }, // H1 begrenzt: max 2 Platten belegbar
  { gruppen: 3, teams: 4, felder: 4 },
  { gruppen: 6, teams: 4, felder: 3 },
  { gruppen: 4, teams: 5, felder: 3 },
];

describe('Gruppenphase: jede Platte, die belegt werden kann, ist belegt', () => {
  for (const { gruppen, teams, felder } of konstellationen) {
    const etikett = `${gruppen} Gruppen à ${teams} Teams auf ${felder} Feld(ern)`;

    it(`${etikett}: kein Feld bleibt frei, das H1 nicht blockiert`, () => {
      const plan = generateSchedule(gruppenSpiele(gruppen, teams), cfg(felder), baseDate);
      expect(auslastungsVerstoesse(plan, felder)).toEqual([]);
    });

    it(`${etikett}: das Raster hat keine Löcher`, () => {
      // Die alte Puffer-Logik ließ ganze Anstoßzeiten aus, damit ein Team
      // Pause bekommt. Aus 5 Zeitfenstern wurden so 9 — belegt waren
      // trotzdem nur 5. Genau das ist die Beschwerde vom 2026-08-28.
      const plan = generateSchedule(gruppenSpiele(gruppen, teams), cfg(felder), baseDate);
      expect(luecken(plan, 30)).toEqual([]);
    });

    it(`${etikett}: kein Team spielt zweimal im selben Zeitfenster`, () => {
      const plan = generateSchedule(gruppenSpiele(gruppen, teams), cfg(felder), baseDate);
      for (const f of fensterAus(plan)) {
        const namen = f.spiele.flatMap((m) => [m.teamHome, m.teamAway]).filter((t) => t != null);
        expect(new Set(namen).size, `${new Date(f.zeit).toISOString()}: ${namen.join(', ')}`).toBe(
          namen.length
        );
      }
      expect(detectScheduleConflicts(plan)).toEqual([]);
    });

    it(`${etikett}: §10.9 — zweimal derselbe Aufruf, derselbe Plan`, () => {
      const spiele = gruppenSpiele(gruppen, teams);
      const abdruck = (plan) =>
        plan.map((x) => `${x.id}@${x.scheduledAt?.getTime()}#${x.field}`).join('|');
      expect(abdruck(generateSchedule(spiele, cfg(felder), baseDate))).toBe(
        abdruck(generateSchedule(spiele, cfg(felder), baseDate))
      );
    });
  }

  it('höchstens das letzte Zeitfenster ist teilbelegt, wenn H1 nicht begrenzt', () => {
    // 4 Gruppen à 4 Teams auf 3 Feldern: 24 Spiele, 8 Fenster. Vorher endete
    // JEDER Spieltag mit einem halbleeren Fenster (3+3+2 je Spieltag), der
    // Plan brauchte 9 statt 8 Fenster. Positivprobe zur Invariante oben:
    // Die zählt nur Verstöße; hier steht, wie voll es tatsächlich ist.
    const plan = generateSchedule(gruppenSpiele(4, 4), cfg(3), baseDate);
    const fenster = fensterAus(plan);
    expect(fenster).toHaveLength(8);
    for (let i = 0; i < fenster.length - 1; i++) {
      expect(fenster[i].spiele.length, `Fenster #${i}`).toBe(3);
    }
  });

  it('ein Team spielt seine Spieltage der Reihe nach, und niemand ist mehr als einen voraus', () => {
    // Die Fach-Entscheidung vom 2026-08-28: Ein sonst halbleeres Fenster
    // darf Spiele des NÄCHSTEN Spieltags vorziehen — höchstens einen. Sonst
    // spielte Gruppe A schon Spieltag 3, während Gruppe D bei Spieltag 1
    // steht. Der Vorlauf ist begrenzt und die Reihenfolge je Team bleibt.
    const plan = generateSchedule(gruppenSpiele(4, 4), cfg(3), baseDate);
    const fenster = fensterAus(plan);

    // (a) je Team: Spieltage in aufsteigender Reihenfolge.
    const jeTeam = new Map();
    fenster.forEach((f, i) => {
      for (const m of f.spiele) {
        for (const t of [m.teamHome, m.teamAway]) {
          if (t == null) continue;
          if (!jeTeam.has(t)) jeTeam.set(t, []);
          jeTeam.get(t).push({ fenster: i, runde: m.roundNumber });
        }
      }
    });
    for (const [team, eintraege] of jeTeam) {
      const runden = eintraege.sort((a, b) => a.fenster - b.fenster).map((e) => e.runde);
      expect(runden, `Team ${team}`).toEqual([...runden].sort((a, b) => a - b));
    }

    // (b) in keinem Fenster klaffen die Spieltage weiter als einen auseinander.
    for (const f of fenster) {
      const runden = f.spiele.map((m) => m.roundNumber);
      expect(Math.max(...runden) - Math.min(...runden)).toBeLessThanOrEqual(1);
    }
  });
});

describe('K.-o.-Phase: nacheinander, aber innerhalb einer Runde parallel', () => {
  const ko = (id, round, pos) => ({
    id,
    teamHome: `${round}${pos}H`,
    teamAway: `${round}${pos}A`,
    stageType: 'ko',
    round,
    bracketPos: pos,
  });

  const baum = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ko(`r16_${i}`, 'R16', i)),
    ...[1, 2, 3, 4].map((i) => ko(`qf${i}`, 'QF', i)),
    ...[1, 2].map((i) => ko(`sf${i}`, 'SF', i)),
    ko('p3', '3RD', 1),
    ko('fin', 'F', 1),
  ];

  const ordnung = { R16: 0, QF: 1, SF: 2, '3RD': 3, F: 4 };

  it('kein Zeitfenster enthält Spiele aus zwei verschiedenen K.-o.-Runden', () => {
    // Acht Plätze und nur ein Finale: Der Planer KÖNNTE das Halbfinale
    // danebenlegen. Er darf nicht — die Halbfinalisten stehen erst fest,
    // wenn das Viertelfinale gespielt ist.
    for (const felder of [1, 2, 4, 8]) {
      const plan = generateSchedule(baum, cfg(felder), baseDate);
      for (const f of fensterAus(plan)) {
        const runden = [...new Set(f.spiele.map((m) => m.round))];
        expect(runden, `${felder} Felder, ${new Date(f.zeit).toISOString()}`).toHaveLength(1);
      }
      expect(detectRoundOverlaps(plan), `${felder} Felder`).toEqual([]);
    }
  });

  it('die Runden folgen streng aufsteigend: R16 → VF → HF → Platz 3 → Finale', () => {
    for (const felder of [1, 2, 4, 8]) {
      const plan = generateSchedule(baum, cfg(felder), baseDate);
      const spanne = new Map();
      for (const m of plan) {
        const t = m.scheduledAt.getTime();
        const cur = spanne.get(m.round);
        if (!cur) spanne.set(m.round, { min: t, max: t });
        else {
          cur.min = Math.min(cur.min, t);
          cur.max = Math.max(cur.max, t);
        }
      }
      const folge = [...spanne.entries()].sort((a, b) => ordnung[a[0]] - ordnung[b[0]]);
      for (let i = 1; i < folge.length; i++) {
        expect(
          folge[i][1].min,
          `${felder} Felder: ${folge[i][0]} startet nicht nach ${folge[i - 1][0]}`
        ).toBeGreaterThan(folge[i - 1][1].max);
      }
    }
  });

  it('mehrere Spiele DERSELBEN Runde laufen parallel — das ist gewollt', () => {
    // Positivprobe: Der Test darüber wäre auch dann grün, wenn der Planer
    // jedes K.-o.-Spiel einzeln hintereinander legte. Vier Viertelfinals
    // auf vier Platten müssen zur selben Zeit anstoßen.
    const plan = generateSchedule(baum, cfg(4), baseDate);
    const zeitenQf = new Set(
      plan.filter((m) => m.round === 'QF').map((m) => m.scheduledAt.getTime())
    );
    expect(zeitenQf.size).toBe(1);
    const zeitenR16 = new Set(
      plan.filter((m) => m.round === 'R16').map((m) => m.scheduledAt.getTime())
    );
    expect(zeitenR16.size).toBe(2); // 8 Spiele auf 4 Platten
    const zeitenSf = new Set(
      plan.filter((m) => m.round === 'SF').map((m) => m.scheduledAt.getTime())
    );
    expect(zeitenSf.size).toBe(1);
  });

  it('die Gruppenphase liegt vollständig vor der K.-o.-Phase (H2)', () => {
    const alle = [...gruppenSpiele(4, 4), ...baum];
    const plan = generateSchedule(alle, cfg(3), baseDate);
    const letzteGruppe = Math.max(
      ...plan.filter((m) => m.stageType === 'group').map((m) => m.scheduledAt.getTime())
    );
    const ersteKo = Math.min(
      ...plan.filter((m) => m.stageType === 'ko').map((m) => m.scheduledAt.getTime())
    );
    expect(ersteKo).toBeGreaterThan(letzteGruppe);
  });
});


/**
 * Gruppenspiele für UNGLEICH große Gruppen — die Form, die nach einem
 * Team-Rückzug entsteht.
 *
 * `gruppenSpiele` oben nimmt eine Größe für alle Gruppen an. Genau das
 * trifft den Rückzugsfall nicht: aus 4/4/4/4 wird 4/4/4/3, und die
 * interessante Frage ist, ob der Planer die drei vollen Gruppen weiter
 * dicht packt, obwohl die vierte in jedem Spieltag ein Spiel weniger
 * liefert.
 */
function gemischteGruppenSpiele(groessen) {
  const alle = [];
  groessen.forEach((n, g) => {
    const key = String.fromCharCode(65 + g);
    const ids = Array.from({ length: n }, (_, i) => `${key}${i + 1}`);
    for (const rm of buildRoundRobinMatches(ids)) {
      alle.push({ ...rm, id: `${key}-${rm.bracketPos}`, stageType: 'group', groupKey: key });
    }
  });
  return alle;
}

/**
 * Der Zustand NACH einem Rückzug (Fachentscheid 2026-09-01).
 *
 * Ein Team sagt kurz vor Turnierbeginn ab; seine Spiele werden gelöscht,
 * die übrigen Paarungen bleiben, der Plan wird neu gepackt. Jonas dazu:
 * „dann muss ja auch der spielplan verschoben werden, sodass alle felder
 * wie schon zuvor geklärt zu jeder zeit besetzt sind in der gruppenphase."
 *
 * Deshalb steht hier KEINE Belegungsliste, sondern dieselbe Invariante wie
 * oben — sie ist von Gruppengrößen unabhängig und fällt genau dann, wenn
 * der Planer wegen der schiefen Gruppe eine Platte verschenkt. Eine
 * Erwartung wie „Fenster 1 hat 3 Spiele" wäre wieder der Testtyp, der im
 * Round-Robin-Fall (26.08.) grün blieb, während die Sache selbst falsch war.
 */
describe('nach einem Team-Rückzug: schiefe Gruppen packen genauso dicht', () => {
  const faelle = [
    { groessen: [4, 4, 4, 3], felder: 3, etikett: '16 Teams minus eins → 4/4/4/3 auf 3 Platten' },
    { groessen: [4, 4, 3], felder: 2, etikett: '12 Teams minus eins → 4/4/3 auf 2 Platten' },
    { groessen: [5, 4], felder: 3, etikett: '10 Teams minus eins → 5/4 auf 3 Platten' },
    { groessen: [3, 3], felder: 2, etikett: '8 Teams minus zwei → 3/3 auf 2 Platten' },
  ];

  for (const { groessen, felder, etikett } of faelle) {
    it(`${etikett}: kein Feld bleibt frei, das H1 nicht blockiert`, () => {
      const plan = generateSchedule(gemischteGruppenSpiele(groessen), cfg(felder), baseDate);
      expect(auslastungsVerstoesse(plan, felder)).toEqual([]);
    });

    it(`${etikett}: das Raster hat keine Löcher`, () => {
      const plan = generateSchedule(gemischteGruppenSpiele(groessen), cfg(felder), baseDate);
      expect(luecken(plan, 30)).toEqual([]);
    });

    it(`${etikett}: kein Team spielt zweimal im selben Zeitfenster`, () => {
      const plan = generateSchedule(gemischteGruppenSpiele(groessen), cfg(felder), baseDate);
      for (const f of fensterAus(plan)) {
        const namen = [];
        for (const m of f.spiele) {
          if (m.teamHome != null) namen.push(m.teamHome);
          if (m.teamAway != null) namen.push(m.teamAway);
        }
        expect(namen.length).toBe(new Set(namen).size);
      }
    });
  }

  it('die verbleibenden Paarungen sind vollständig — der Rückzug löscht nur, was das Team betraf', () => {
    // 4er-Gruppe A verliert A4: übrig bleiben genau die drei Paarungen
    // unter A1..A3, jede genau einmal.
    const voll = gemischteGruppenSpiele([4]);
    const nachRueckzug = voll.filter((m) => m.teamHome !== 'A4' && m.teamAway !== 'A4');
    expect(nachRueckzug).toHaveLength(3);
    const paare = nachRueckzug.map((m) => [m.teamHome, m.teamAway].sort().join('-')).sort();
    expect(paare).toEqual(['A1-A2', 'A1-A3', 'A2-A3']);
  });
});
