/**
 * Beschwerde 2 (2026-08-26): „bei tabellen: wieso sind die untereinander"
 *
 * Fehlerklasse
 * ------------
 *   `renderStandingsGroups` hat ALLE Gruppen gemappt und mit join('')
 *   aneinandergeklebt. Bei drei Gruppen standen drei volle Tabellen
 *   untereinander; die Vorlage zeigt an dieser Stelle eine Segment-
 *   Leiste und genau EINE Tabelle.
 *
 *   Das Bemerkenswerte daran: `.t-seg` stand vollständig im Stylesheet
 *   und wurde von keiner Zeile Javascript je gerendert. Die Komponente
 *   war umgefärbt, die Struktur nie nachgebaut — der rote Faden durch
 *   alle acht Beschwerden.
 *
 * Warum dieser Test und nicht der Blick auf den Screenshot
 * --------------------------------------------------------
 *   Ein Screenshot zeigt, dass EINE Tabelle sichtbar ist. Er zeigt
 *   nicht, dass die anderen es nicht sind, weil sie `is-active` nicht
 *   tragen — sie könnten auch einfach unter der Falzkante liegen.
 *   Deshalb wird hier die Struktur geprüft, nicht das Bild.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { renderStandingsGroups, setCompactMode } from '../spielplan-helpers.js';

const team = (name, sp, pkt) => ({
  name, played: sp, won: 0, drawn: 0, lost: 0,
  goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: pkt,
});
const gruppe = (key) => ({
  groupKey: key,
  groupName: `Gruppe ${key}`,
  standings: [team(`${key}-Eins`, 2, 6), team(`${key}-Zwei`, 2, 3), team(`${key}-Drei`, 2, 0)],
});

afterEach(() => setCompactMode(null));

describe('Gruppen-Umschalter', () => {
  it('rendert bei mehreren Gruppen eine Segment-Leiste mit einem Knopf je Gruppe', () => {
    const html = renderStandingsGroups([gruppe('A'), gruppe('B'), gruppe('C')], 'Becher', 2);
    expect(html).toContain('class="t-seg"');
    for (const key of ['A', 'B', 'C']) {
      expect(html).toContain(`data-gruppe="${key}"`);
    }
    const knoepfe = html.match(/<button[^>]*data-gruppe=/g) || [];
    expect(knoepfe).toHaveLength(3);
  });

  it('macht GENAU EIN Panel aktiv — das ist der eigentliche Punkt der Beschwerde', () => {
    const html = renderStandingsGroups([gruppe('A'), gruppe('B'), gruppe('C')], 'Becher', 2);
    const panels = html.match(/class="t-card t-standings-panel[^"]*"/g) || [];
    expect(panels).toHaveLength(3);
    expect(panels.filter((p) => p.includes('is-active'))).toHaveLength(1);
    // …und zwar das erste, nicht irgendeins.
    expect(panels[0]).toContain('is-active');
  });

  it('lässt den Umschalter bei EINER Gruppe weg, zeigt sie aber trotzdem', () => {
    // Ein Schalter mit einer Stellung ist eine Bedienung, die nichts
    // bedient. Die Tabelle muss dann trotzdem sichtbar sein — sonst
    // hätte die Entscheidung „kein Schalter" eine leere Seite erzeugt.
    const html = renderStandingsGroups([gruppe('A')], 'Becher', 2);
    expect(html).not.toContain('class="t-seg"');
    const panels = html.match(/class="t-card t-standings-panel[^"]*"/g) || [];
    expect(panels).toHaveLength(1);
    expect(panels[0]).toContain('is-active');
  });

  it('trägt aria-selected passend zur aktiven Stellung', () => {
    const html = renderStandingsGroups([gruppe('A'), gruppe('B')], 'Becher', 2);
    expect((html.match(/aria-selected="true"/g) || [])).toHaveLength(1);
    expect((html.match(/aria-selected="false"/g) || [])).toHaveLength(1);
  });

  it('schreibt den Spielstand in den Tabellenkopf, die Regel in die Fusszeile', () => {
    // Die Vorlage trennt das: oben WIE WEIT, unten NACH WELCHER REGEL.
    // Vorher standen beide Angaben nebeneinander in der Fusszeile.
    const html = renderStandingsGroups([gruppe('A')], 'Becher', 2);
    const kopf = html.match(/<div class="t-standings-head">[\s\S]*?<\/div>/)[0];
    expect(kopf).toContain('Gruppe A');
    expect(kopf).toMatch(/3 von 3 Spielen/);

    const fuss = html.match(/<div class="t-standings-foot">[\s\S]*?<\/div>\s*<\/div>/)[0];
    expect(fuss).toContain('steigen auf');
    expect(fuss).not.toMatch(/von \d+ Spielen/);
  });

  it('zeichnet ein Streifen-Segment je Gruppenspiel, gespielte gefüllt', () => {
    // 3 Teams → 3 Spiele. Jedes Team hat 2 gespielt → 6/2 = 3 gespielt.
    const html = renderStandingsGroups([gruppe('A')], 'Becher', 2);
    const streifen = html.match(/<span class="t-standings-prog"[^>]*>([\s\S]*?)<\/span>/)[1];
    const alle = streifen.match(/<i[^>]*>/g) || [];
    expect(alle).toHaveLength(3);
    expect(alle.filter((i) => i.includes('is-done'))).toHaveLength(3);
  });
});
