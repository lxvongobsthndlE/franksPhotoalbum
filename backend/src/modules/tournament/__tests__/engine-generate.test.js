/**
 * Tests: generateTournament — High-Level-Orchestrierung.
 * Spec §12 (Pipeline).
 */

import { describe, it, expect } from 'vitest';
import { generateTournament } from '../engine/index.js';

const teams12 = [
  { id: 'A1', name: 'A1', seed: 1 },
  { id: 'A2', name: 'A2', seed: 2 },
  { id: 'A3', name: 'A3', seed: 3 },
  { id: 'A4', name: 'A4', seed: 4 },
  { id: 'B1', name: 'B1', seed: 5 },
  { id: 'B2', name: 'B2', seed: 6 },
  { id: 'B3', name: 'B3', seed: 7 },
  { id: 'B4', name: 'B4', seed: 8 },
  { id: 'C1', name: 'C1', seed: 9 },
  { id: 'C2', name: 'C2', seed: 10 },
  { id: 'C3', name: 'C3', seed: 11 },
  { id: 'C4', name: 'C4', seed: 12 },
];

describe('generateTournament', () => {
  it('verteilt 12 Teams auf 3 Gruppen à 4', () => {
    const r = generateTournament({
      teams: teams12,
      config: { mode: 'groups_ko', numGroups: 3, bestThirds: 2 },
    });
    expect(r.groups).toHaveLength(3);
    expect(r.groups.every((g) => g.matches.length === 6)).toBe(true); // 4 Teams → 6 Spiele
    expect(r.groups.every((g) => g.standings.length === 4)).toBe(true);
  });

  it('qualifiziert KEINE Teams bei generate — Gruppenphase noch nicht gespielt', () => {
    // BUG-FIX 2026-08-20: Vorher wurden Qualifikanten bei generate-time
    // aus den leeren Standings berechnet. Tiebreaker-Fallback "alphabetisch"
    // selektierte die alphabetisch ersten Teams jeder Gruppe als Phantome.
    // buildBracket schrieb diese Phantome in die KO-Slots. Fix: bei
    // generate ohne gespielte Gruppenphase → qualifiers = []. Das Bracket
    // wird als Skelett mit Platzhaltern gebaut (siehe buildBracket).
    // Das eigentliche Befüllen passiert in routes.js /result, sobald das
    // letzte Gruppen-Match gespeichert wird.
    const r = generateTournament({
      teams: teams12,
      config: { mode: 'groups_ko', numGroups: 3, bestThirds: 2 },
    });
    expect(r.qualifiers).toHaveLength(0);
  });

  it('KO-Bracket bei generate ist Skelett mit Platzhaltern, kein Phantomeam', () => {
    // Skelett: Bracket-Struktur (Runden + Slots) steht, aber QF-Slots
    // haben null-Teams + placeholders ("Sieger VF X"). So sieht der User
    // sofort, dass die KO-Phase noch leer ist.
    const r = generateTournament({
      teams: teams12,
      config: { mode: 'groups_ko', numGroups: 3, bestThirds: 2 },
    });
    const ko = r.bracket.matches;
    expect(ko.filter((m) => m.round === 'QF')).toHaveLength(4);
    expect(ko.filter((m) => m.round === 'SF')).toHaveLength(2);
    expect(ko.filter((m) => m.round === 'F')).toHaveLength(1);
    // QF-Slots haben noch keine echten Teams (Skelett).
    const qf = ko.filter((m) => m.round === 'QF');
    for (const m of qf) {
      expect(m.teamHome === null || m.teamAway === null).toBe(true);
    }
  });

  it('§10.9: deterministisch — 2 Aufrufe identische Match-IDs + scheduledAt', () => {
    const a = generateTournament({
      teams: teams12,
      config: { mode: 'groups_ko', numGroups: 3, bestThirds: 2 },
    });
    const b = generateTournament({
      teams: teams12,
      config: { mode: 'groups_ko', numGroups: 3, bestThirds: 2 },
    });
    const idsA = a.groups
      .flatMap((g) => g.matches.map((m) => m.id))
      .concat(a.bracket.matches.map((m) => m.id));
    const idsB = b.groups
      .flatMap((g) => g.matches.map((m) => m.id))
      .concat(b.bracket.matches.map((m) => m.id));
    expect(idsA).toEqual(idsB);

    const timesA = a.groups
      .flatMap((g) => g.matches.map((m) => m.scheduledAt?.getTime()))
      .concat(a.bracket.matches.map((m) => m.scheduledAt?.getTime()));
    const timesB = b.groups
      .flatMap((g) => g.matches.map((m) => m.scheduledAt?.getTime()))
      .concat(b.bracket.matches.map((m) => m.scheduledAt?.getTime()));
    expect(timesA).toEqual(timesB);
  });

  it('jedes Match hat scheduledAt + field gesetzt', () => {
    const r = generateTournament({
      teams: teams12,
      config: { mode: 'groups_ko', numGroups: 3, bestThirds: 2 },
    });
    const all = [...r.groups.flatMap((g) => g.matches), ...r.bracket.matches];
    for (const m of all) {
      expect(m.scheduledAt).toBeInstanceOf(Date);
      expect(typeof m.field).toBe('number');
    }
  });

  it('groups_only → kein Bracket', () => {
    const r = generateTournament({
      teams: teams12,
      config: { mode: 'groups_only', numGroups: 3 },
    });
    expect(r.bracket.matches).toHaveLength(0);
  });

  it('kein Same-Group-Konflikt in QF für 12 Teams / 3 Gruppen', () => {
    const r = generateTournament({
      teams: teams12,
      config: { mode: 'groups_ko', numGroups: 3, bestThirds: 2 },
    });
    expect(r.bracket.unresolvedConflicts).toHaveLength(0);
  });

  it('qualifiziert 8 Teams, wenn alle Gruppen-Matches mit `finished` übergeben werden', () => {
    // Wenn der Aufrufer (z.B. fillKoFromQualifiers in routes.js) die
    // schon existierenden Gruppenspiele als `finished` markiert übergibt,
    // muss die Engine qualifizieren. Das ist der Pfad nach dem letzten
    // Spielergebnis.
    //
    // Wir bauen zuerst die "Skelett"-Variante, lesen die generierten
    // RR-Match-IDs aus, und übergeben dann einen matches-Override mit
    // genau diesen IDs + status:'finished' + echten scores, sodass
    // computeStandings auch Punkte verteilt.
    const skeleton = generateTournament({
      teams: teams12,
      config: { mode: 'groups_ko', numGroups: 3, bestThirds: 2 },
    });
    const allGroupMatches = skeleton.groups.flatMap((g) =>
      g.matches.map((m, idx) => ({
        id: m.id,
        stageType: 'group',
        groupKey: g.groupKey,
        teamHome: m.teamHome,
        teamAway: m.teamAway,
        // Pro RR-Match: Heim gewinnt knapp, damit es überhaupt
        // Punkte und einen klaren Sieger gibt.
        scoreHome: 2 + (idx % 2),
        scoreAway: 1 + ((idx + 1) % 2),
        status: 'finished',
      }))
    );
    const r = generateTournament({
      teams: teams12,
      config: { mode: 'groups_ko', numGroups: 3, bestThirds: 2 },
      matches: allGroupMatches,
    });
    expect(r.qualifiers).toHaveLength(8);
    // Und die QF-Slots haben jetzt echte Teams (keine Skeleton mehr).
    const qf = r.bracket.matches.filter((m) => m.round === 'QF');
    for (const m of qf) {
      expect(typeof m.teamHome).toBe('string');
      expect(typeof m.teamAway).toBe('string');
    }
  });

  it('ko_only: alle Teams sind Qualifikanten, kein Skeleton', () => {
    // Bei ko_only entfällt die Gruppenphase (Spec §6.1) — jedes Team
    // ist sofort Qualifikant.
    const r = generateTournament({
      teams: teams12.slice(0, 8),
      config: { mode: 'ko_only' },
    });
    expect(r.qualifiers).toHaveLength(8);
    expect(r.groups).toHaveLength(0);
  });
});
