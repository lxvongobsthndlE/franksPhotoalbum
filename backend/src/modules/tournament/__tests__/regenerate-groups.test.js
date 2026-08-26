/**
 * „Die Spiele ziehen mit" — Entscheid Jonas, 2026-08-26.
 *
 * Vorgeschichte
 * -------------
 *   Die Gruppeneinteilung liess sich nach der Generierung noch aendern,
 *   und die Spiele blieben, wo sie waren. Danach sagten Mitgliederliste
 *   und Spielplan Verschiedenes: an der echten Datenbank gemessen waren
 *   in JEDER Gruppe drei von vier Mitgliedern Teams, die dort kein Spiel
 *   haben. Die Tabellen standen auf 0, obwohl Ergebnisse eingetragen
 *   waren — und aus diesen Tabellen kommen die Qualifikanten der
 *   K.-o.-Phase.
 *
 *   Jonas' Wahl zwischen „sperren" und „mitziehen" fiel auf mitziehen.
 *
 * Was hier geprueft wird
 * ----------------------
 *   Nicht, dass die Funktion laeuft — dass der WIDERSPRUCH danach nicht
 *   mehr existieren KANN. Das ist die Zusicherung, an der alles haengt:
 *   wer in einer Gruppe spielt, ist auch ihr Mitglied, und umgekehrt.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { regeneriereGruppenphase } from '../regenerate-groups.js';
import {
  buildRoundRobinMatches,
  generateSchedule,
  mergeConfig,
  makeCuid,
} from '../engine/index.js';

const engine = { buildRoundRobinMatches, generateSchedule, mergeConfig, makeCuid };

/**
 * Ein sehr kleiner Prisma-Ersatz mit Tabellen im Speicher.
 *
 * Bewusst KEIN Mock mit vorgegebenen Antworten: der Test soll die FOLGEN
 * der Funktion sehen (was steht danach in den Tabellen), nicht nur
 * welche Aufrufe sie macht. Ein Mock haette hier bestaetigt, dass
 * gelöscht und eingefügt wird — nicht, dass danach alles zusammenpasst.
 */
function fakeDb(zustand) {
  const db = {
    tournament: {
      findUnique: async () => zustand.tournament,
    },
    stage: {
      findMany: async () => zustand.stages,
    },
    group_: {
      findMany: async ({ where }) => zustand.groups
        .filter((g) => where.stageId.in.includes(g.stageId))
        .map((g) => ({
          ...g,
          memberships: zustand.memberships
            .filter((m) => m.groupId === g.id)
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
        })),
    },
    match: {
      count: async ({ where }) => zustand.matches.filter(
        (m) => where.stageId.in.includes(m.stageId),
      ).length,
      deleteMany: async ({ where }) => {
        const vorher = zustand.matches.length;
        zustand.matches = zustand.matches.filter(
          (m) => !where.stageId.in.includes(m.stageId),
        );
        return { count: vorher - zustand.matches.length };
      },
      createMany: async ({ data }) => {
        zustand.matches.push(...data.map((d) => ({ ...d })));
        return { count: data.length };
      },
      updateMany: async ({ where, data }) => {
        let n = 0;
        for (const m of zustand.matches) {
          if (where.stageId.in.includes(m.stageId)) { Object.assign(m, data); n++; }
        }
        return { count: n };
      },
      update: async ({ where, data }) => {
        const m = zustand.matches.find((x) => x.id === where.id);
        if (m) Object.assign(m, data);
        return m;
      },
      findMany: async () => zustand.matches.map((m) => ({
        ...m,
        stage: zustand.stages.find((s) => s.id === m.stageId) ?? null,
      })),
    },
  };
  return db;
}

/** Vier Teams, zwei Gruppen zu zwei, plus eine K.-o.-Runde. */
function ausgangslage() {
  return {
    tournament: {
      id: 'T', name: 'Testturnier',
      config: { mode: 'groups_ko', numGroups: 2, qualifyPerGroup: 1 },
    },
    stages: [
      { id: 'sg', tournamentId: 'T', type: 'group', orderIndex: 0 },
      { id: 'sk', tournamentId: 'T', type: 'ko', orderIndex: 1 },
    ],
    groups: [
      { id: 'gA', stageId: 'sg', key: 'A' },
      { id: 'gB', stageId: 'sg', key: 'B' },
    ],
    // Der kaputte Zustand: A hat 1+2, B hat 3+4 …
    memberships: [
      { id: 'm1', groupId: 'gA', teamId: 't1', position: 0 },
      { id: 'm2', groupId: 'gA', teamId: 't2', position: 1 },
      { id: 'm3', groupId: 'gB', teamId: 't3', position: 0 },
      { id: 'm4', groupId: 'gB', teamId: 't4', position: 1 },
    ],
    // … aber gespielt wird in A zwischen t3 und t4. Genau der Widerspruch.
    matches: [
      {
        id: 'alt1', tournamentId: 'T', stageId: 'sg', groupId: 'gA',
        teamHome: 't3', teamAway: 't4', scoreHome: 2, scoreAway: 1,
        status: 'finished', round: '1', scheduledAt: new Date('2026-09-05T10:00:00Z'), field: 1,
      },
      {
        id: 'alt2', tournamentId: 'T', stageId: 'sg', groupId: 'gB',
        teamHome: 't1', teamAway: 't2', scoreHome: null, scoreAway: null,
        status: 'scheduled', round: '1', scheduledAt: new Date('2026-09-05T10:30:00Z'), field: 1,
      },
      {
        id: 'ko1', tournamentId: 'T', stageId: 'sk', groupId: null,
        teamHome: 't3', teamAway: 't1', scoreHome: 3, scoreAway: 0,
        status: 'finished', round: '1', scheduledAt: new Date('2026-09-05T11:00:00Z'), field: 1,
      },
    ],
  };
}

describe('regeneriereGruppenphase', () => {
  let zustand;
  beforeEach(() => { zustand = ausgangslage(); });

  it('macht den Widerspruch unmöglich: wer hier spielt, ist hier Mitglied', async () => {
    // DIE Zusicherung. Alles andere in dieser Datei ist Beiwerk.
    const db = fakeDb(zustand);
    await regeneriereGruppenphase(db, 'T', engine);

    for (const g of zustand.groups) {
      const mitglieder = new Set(
        zustand.memberships.filter((m) => m.groupId === g.id).map((m) => m.teamId),
      );
      const spieler = new Set();
      for (const m of zustand.matches.filter((x) => x.groupId === g.id)) {
        if (m.teamHome) spieler.add(m.teamHome);
        if (m.teamAway) spieler.add(m.teamAway);
      }
      for (const id of spieler) {
        expect(mitglieder.has(id), `${id} spielt in ${g.key}, ist dort aber kein Mitglied`).toBe(true);
      }
      for (const id of mitglieder) {
        expect(spieler.has(id), `${id} ist Mitglied von ${g.key}, spielt dort aber nicht`).toBe(true);
      }
    }
  });

  it('erzeugt je Gruppe ein vollständiges Jeder-gegen-jeden', async () => {
    const db = fakeDb(zustand);
    const bilanz = await regeneriereGruppenphase(db, 'T', engine);
    // Zwei Gruppen zu zwei Teams → je 1 Spiel.
    expect(bilanz.spieleNachher).toBe(2);
    expect(zustand.matches.filter((m) => m.stageId === 'sg')).toHaveLength(2);
  });

  it('setzt die K.-o.-Phase auf ihr Skelett zurück', async () => {
    // Die Qualifikanten sind mit den Gruppen hinfällig. Ein Bracket mit
    // Teams aus der alten Einteilung wäre die zweite Wahrheit, die diese
    // Änderung gerade abschafft.
    const db = fakeDb(zustand);
    const bilanz = await regeneriereGruppenphase(db, 'T', engine);
    expect(bilanz.koZurueckgesetzt).toBe(1);
    const ko = zustand.matches.find((m) => m.id === 'ko1');
    expect(ko.teamHome).toBeNull();
    expect(ko.teamAway).toBeNull();
    expect(ko.scoreHome).toBeNull();
    expect(ko.status).toBe('scheduled');
  });

  it('behält die STRUKTUR der K.-o.-Phase — sie wird geleert, nicht gelöscht', async () => {
    const db = fakeDb(zustand);
    await regeneriereGruppenphase(db, 'T', engine);
    expect(zustand.matches.filter((m) => m.stageId === 'sk')).toHaveLength(1);
  });

  it('gibt den neuen Spielen Zeiten und bleibt am urspruenglichen Turniertag', async () => {
    // Ein Turnier, das am 5. September beginnen sollte, darf nach einer
    // Neuverteilung nicht auf heute rutschen. Die UHRZEIT kommt aus der
    // Konfiguration und ist hier nicht der Pruefpunkt — mein erster
    // Entwurf hat auf 10 UTC bestanden und uebersehen, dass 08:00 UTC
    // genau die 10:00 Ortszeit IST, die er erwartete.
    const db = fakeDb(zustand);
    await regeneriereGruppenphase(db, 'T', engine);
    const neue = zustand.matches.filter((m) => m.stageId === 'sg');
    expect(neue.length).toBeGreaterThan(0);
    expect(neue.every((m) => m.scheduledAt != null)).toBe(true);
    const frueheste = new Date(Math.min(...neue.map((m) => new Date(m.scheduledAt).getTime())));
    expect(frueheste.getUTCFullYear()).toBe(2026);
    expect(frueheste.getUTCMonth()).toBe(8); // September
    expect(frueheste.getUTCDate()).toBe(5);
  });

  it('lässt ein reines K.-o.-Turnier unangetastet', async () => {
    zustand.stages = [{ id: 'sk', tournamentId: 'T', type: 'ko', orderIndex: 0 }];
    zustand.groups = [];
    const vorher = zustand.matches.length;
    const db = fakeDb(zustand);
    const bilanz = await regeneriereGruppenphase(db, 'T', engine);
    expect(bilanz.gruppen).toBe(0);
    expect(zustand.matches).toHaveLength(vorher);
  });

  it('verträgt eine Gruppe mit nur einem Team', async () => {
    // Gültiger Zwischenzustand, kein Fehler: eine Paarung braucht zwei.
    zustand.memberships = [{ id: 'm1', groupId: 'gA', teamId: 't1', position: 0 }];
    zustand.groups = [{ id: 'gA', stageId: 'sg', key: 'A' }];
    const db = fakeDb(zustand);
    const bilanz = await regeneriereGruppenphase(db, 'T', engine);
    expect(bilanz.spieleNachher).toBe(0);
  });
});
