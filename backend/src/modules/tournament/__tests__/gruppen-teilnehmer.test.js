/**
 * Gruppentabellen zeigten 0 Spiele, obwohl Ergebnisse eingetragen waren.
 *
 * Befund vom 2026-08-26, an der echten Datenbank gemessen
 * ------------------------------------------------------
 *   Turnier „Franks Bierpong Turnier 2.0", drei Gruppen zu vier Teams.
 *   In JEDER Gruppe waren drei von vier Mitgliedern Teams, die dort kein
 *   einziges Spiel haben — und drei von vier Teams, die dort spielen,
 *   waren keine Mitglieder.
 *
 *     Gruppe A  Mitglieder:   Team 12, Team 3, Team 7, Team 10
 *               spielen dort: Team 6,  Team 3, Team 5, Team 4
 *
 * Ursache
 * -------
 *   Die Gruppeneinteilung lässt sich nach der Generierung ändern
 *   („Zufällig verteilen", Paar-Tausch). Die Matches bleiben dabei
 *   bewusst, wo sie sind — der Hinweis im Einstellungen-Tab sagt es
 *   ausdrücklich: „DnD ändert nur die Anzeige der Gruppentabellen — die
 *   Spielpaarungen bleiben gleich."
 *
 *   Nur stimmte der letzte Halbsatz nicht. `computeStandings` zählt ein
 *   Spiel nur, wenn BEIDE Teams in der übergebenen Liste stehen. Wurde
 *   die Mitgliederliste neu gewürfelt, zählte gar nichts mehr: alle
 *   Teams standen bei 0 Spielen, während im Spielplan die Ergebnisse
 *   sichtbar waren.
 *
 *   Das ist die teuerste Sorte Fehler in diesem Modul — nicht weil er
 *   schwer zu finden wäre, sondern weil er wie ein Anzeigefehler
 *   aussieht und einer in der Rechnung ist.
 */

import { describe, it, expect } from 'vitest';
import { teilnehmerDerGruppe, buildStandingsForGroup } from '../view.js';
import { mergeConfig, computeStandings, applyTiebreaker } from '../engine/index.js';

const engineApi = { computeStandings, applyTiebreaker };
const config = mergeConfig({});

const spiel = (heim, gast, sh, sa) => ({
  teamHome: heim,
  teamAway: gast,
  scoreHome: sh,
  scoreAway: sa,
  status: sh === null ? 'scheduled' : 'finished',
});

describe('teilnehmerDerGruppe', () => {
  it('nimmt die Teams aus den SPIELEN, nicht aus der Mitgliederliste', () => {
    // Genau der gemessene Fall: die Liste sagt A/B/C/D, gespielt wird E gegen F.
    const matches = [spiel('E', 'F', 2, 1)];
    expect(teilnehmerDerGruppe(matches, ['A', 'B', 'C', 'D']).sort()).toEqual(['E', 'F']);
  });

  it('fällt auf die Mitgliederliste zurück, solange es keine Spiele gibt', () => {
    // Im Entwurf ist die Liste die einzige Auskunft — und dann die richtige.
    expect(teilnehmerDerGruppe([], ['A', 'B'])).toEqual(['A', 'B']);
    expect(teilnehmerDerGruppe(undefined, ['A', 'B'])).toEqual(['A', 'B']);
  });

  it('behält die Reihenfolge der Mitgliederliste, wo sie deckungsgleich ist', () => {
    // Die Liste trägt die Setzreihenfolge. Wo sie stimmt, bleibt sie.
    const matches = [spiel('B', 'A', 1, 0), spiel('C', 'B', 2, 2)];
    expect(teilnehmerDerGruppe(matches, ['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('zählt auch Teams aus Spielen OHNE Ergebnis', () => {
    // Wer angesetzt ist, gehört in die Tabelle — mit 0 Spielen, bis er
    // gespielt hat. Sonst erschiene ein Team erst mit seinem ersten
    // Ergebnis und die Tabelle wüchse während des Turniers.
    const matches = [spiel('X', 'Y', null, null)];
    expect(teilnehmerDerGruppe(matches, ['A']).sort()).toEqual(['X', 'Y']);
  });

  it('nimmt KEIN Mitglied auf, das in dieser Gruppe nicht spielt', () => {
    // Eine Vereinigung beider Mengen wäre die bequeme Antwort — und
    // falsch: sie behauptet eine Teilnahme, die es nicht gibt.
    const matches = [spiel('E', 'F', 1, 0)];
    expect(teilnehmerDerGruppe(matches, ['A', 'E'])).not.toContain('A');
  });

  it('verträgt Platzhalter-Spiele ohne Teams', () => {
    const matches = [{ teamHome: null, teamAway: null, status: 'scheduled' }];
    expect(teilnehmerDerGruppe(matches, ['A', 'B'])).toEqual(['A', 'B']);
  });
});

describe('buildStandingsForGroup — nach dem Neuverteilen der Gruppen', () => {
  it('zählt die Spiele, obwohl die Mitgliederliste andere Teams nennt', () => {
    // DAS ist der Regressionstest zum Befund. Vorher: alles 0.
    const matches = [spiel('E', 'F', 2, 1), spiel('G', 'H', 0, 2)];
    const rows = buildStandingsForGroup(matches, ['A', 'B', 'C', 'D'], config, engineApi);

    const gespielt = rows.reduce((n, r) => n + (r.played ?? 0), 0);
    expect(gespielt, 'kein einziges Spiel gezählt — der Fehler ist zurück').toBe(4);
    expect(rows).toHaveLength(4);

    const nachId = new Map(rows.map((r) => [r.teamId, r]));
    expect(nachId.get('E').points).toBe(3);
    expect(nachId.get('F').points).toBe(0);
    expect(nachId.get('H').points).toBe(3);
    expect(nachId.get('G').points).toBe(0);
  });

  it('rechnet unverändert richtig, wenn Liste und Spielplan übereinstimmen', () => {
    // Die Gegenprobe: der Normalfall darf sich nicht ändern.
    const matches = [spiel('A', 'B', 3, 1), spiel('C', 'D', 1, 1)];
    const rows = buildStandingsForGroup(matches, ['A', 'B', 'C', 'D'], config, engineApi);
    expect(rows).toHaveLength(4);
    const nachId = new Map(rows.map((r) => [r.teamId, r]));
    expect(nachId.get('A').points).toBe(3);
    expect(nachId.get('B').points).toBe(0);
    expect(nachId.get('C').points).toBe(1);
    expect(nachId.get('D').points).toBe(1);
  });

  it('liefert im Entwurf die Mitglieder mit 0 Spielen', () => {
    const rows = buildStandingsForGroup([], ['A', 'B'], config, engineApi);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => (r.played ?? 0) === 0)).toBe(true);
  });
});
