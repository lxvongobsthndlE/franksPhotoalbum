/**
 * Gruppentabellen — Form der Ausgabe.
 *
 * Geschichte dieser Datei an einem einzigen Tag
 * ---------------------------------------------
 *   Vormittag: Jonas' Beschwerde 2 lautete „bei tabellen: wieso sind die
 *   untereinander". Daraufhin stand hier ein Segment-Umschalter mit genau
 *   EINER sichtbaren Tabelle, wie die Vorlage ihn zeigt, und diese Datei
 *   bewachte ihn.
 *
 *   Nachmittag, nach dem Blick im Browser: „es sieht zwar schön aus aber
 *   ich glaube wenn die gruppen mit etwas abstand alle untereinander
 *   wären, wäre ich glücklicher."
 *
 * Warum die Datei bleibt statt zu verschwinden
 * --------------------------------------------
 *   Weil die Rücknahme NICHT der Ausgangszustand ist. Der war: Tabellen
 *   ohne Luft dazwischen, ohne Kopfzeile mit Spielstand, ohne Fusszeile
 *   mit der Aufstiegsregel. Geblieben ist alles davon — es fällt nur die
 *   Regel „genau eine sichtbar". Diese Tests halten genau diese Grenze
 *   fest: was aus der Markenübernahme stammt, bleibt; was aus dem
 *   Umschalter stammt, ist weg.
 *
 *   Ein gelöschter Test hätte beides zusammen preisgegeben.
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

describe('Gruppentabellen', () => {
  it('rendert ALLE Gruppen untereinander — kein Umschalter, nichts versteckt', () => {
    const html = renderStandingsGroups([gruppe('A'), gruppe('B'), gruppe('C')], 'Becher', 2);
    // Kein Segment-Control und keine Panel-Mechanik mehr.
    expect(html).not.toContain('t-seg');
    expect(html).not.toContain('t-standings-panel');
    expect(html).not.toContain('is-active');
    expect(html).not.toContain('gruppen-umschalter');
    // Dafür drei vollständige Karten.
    const karten = html.match(/class="t-card t-standings-karte"/g) || [];
    expect(karten).toHaveLength(3);
    for (const name of ['Gruppe A', 'Gruppe B', 'Gruppe C']) {
      expect(html).toContain(name);
    }
  });

  it('jede Gruppe trägt ihre eigenen Zeilen, keine vermischt', () => {
    // Der teuerste denkbare Fehler beim Stapeln waere, dass alle Karten
    // dieselben Zeilen zeigen. Deshalb hier namentlich geprueft.
    const html = renderStandingsGroups([gruppe('A'), gruppe('B')], 'Becher', 2);
    expect(html).toContain('A-Eins');
    expect(html).toContain('B-Eins');
    const aIdx = html.indexOf('A-Eins');
    const bIdx = html.indexOf('B-Eins');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it('behält die Kopfzeile mit dem Spielstand (aus der Markenübernahme)', () => {
    const html = renderStandingsGroups([gruppe('A')], 'Becher', 2);
    const kopf = html.match(/<div class="t-standings-head">[\s\S]*?<\/div>/)[0];
    expect(kopf).toContain('Gruppe A');
    expect(kopf).toMatch(/3 von 3 Spielen/);
  });

  it('behält die Fusszeile mit der Aufstiegsregel und dem Streifen', () => {
    const html = renderStandingsGroups([gruppe('A')], 'Becher', 2);
    const fuss = html.match(/<div class="t-standings-foot">[\s\S]*?<\/div>\s*<\/div>/)[0];
    expect(fuss).toContain('steigen auf');
    // Der Stand steht oben, nicht noch einmal unten.
    expect(fuss).not.toMatch(/von \d+ Spielen/);
    const streifen = html.match(/<span class="t-standings-prog"[^>]*>([\s\S]*?)<\/span>/)[1];
    expect(streifen.match(/<i[^>]*>/g) || []).toHaveLength(3);
  });

  it('behält die zwei Rang-Zustände: Platz 1 führt, Platz 2..N qualifiziert', () => {
    const html = renderStandingsGroups([gruppe('A')], 'Becher', 2);
    expect(html).toContain('t-standings-row is-lead');
    expect(html).toContain('t-standings-row is-qualified');
  });
});
