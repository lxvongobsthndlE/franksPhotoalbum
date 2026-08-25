/**
 * Tests für den Gruppentabellen-Renderer. Spec §13.7.
 *
 * Regressions-Schutz für Bug 8 (2026-08-18): Der Renderer las vorher
 * `s.wins` / `s.draws` / `s.losses` / `s.goalDifference` — die Engine
 * liefert aber `won` / `drawn` / `lost` / `goalDiff`. Folge: alle
 * Werte 0 außer Pkt. Außerdem fehlte Spalte „Sp." und „Becher" wurde
 * als Score-Label in Spalte 3 statt als Doppelwert (gf:ga) in Spalte 7.
 *
 * Die Pure-Function `renderStandingsGroups(groups, scoreLabel)` lebt
 * hier im Test-Modul (nicht in spielplan-helpers.js, weil sie nur für
 * diesen einen Renderer gebraucht wird) — und der eigentliche main.js-
 * Renderer delegiert an sie. So bleibt der Test ohne DOM-Mock.
 */

import { describe, it, expect } from 'vitest';
import { renderStandingsGroups } from '../spielplan-helpers.js';

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('renderStandingsGroups — Bug 8 Regression', () => {
  const fixture = [
    {
      groupKey: 'A',
      groupName: 'Gruppe A',
      standings: [
        // Drei Teams, drei Spiele abgeschlossen.
        {
          teamId: 't1',
          name: 'Team Alpha',
          played: 3, won: 3, drawn: 0, lost: 0,
          goalsFor: 9, goalsAgainst: 2, goalDiff: 7, points: 9,
        },
        {
          teamId: 't2',
          name: 'Team Beta',
          played: 3, won: 1, drawn: 0, lost: 2,
          goalsFor: 5, goalsAgainst: 6, goalDiff: -1, points: 3,
        },
        {
          teamId: 't3',
          name: 'Team Gamma',
          played: 2, won: 0, drawn: 1, lost: 1,
          goalsFor: 2, goalsAgainst: 8, goalDiff: -6, points: 1,
        },
      ],
    },
  ];

  it('Spalten-Reihenfolge: Pl · Team · Sp · S · U · N · Becher · Diff · Pkt', () => {
    const html = renderStandingsGroups(fixture, 'Becher');
    // Header prüfen — exakte Reihenfolge der Spec §13.7.
    // Bug 14 (2026-08-18): <th> bekommen jetzt Ausrichtungs-Klassen
    // (is-rank / is-team / is-num), damit Header-Zellen dieselbe
    // text-align-Eigenschaft haben wie ihre <td>-Gegenstücke.
    // P5 Re-Fix (2026-08-25): <th>/<td> tragen jetzt zusätzlich
    // data-col-Attribute für mobile Spalten-Hide (Pl/played/won/...),
    // Team bleibt ohne Marker (volle Breite).
    const headerMatch = html.match(/<thead>[\s\S]*?<\/thead>/);
    expect(headerMatch).toBeTruthy();
    const header = headerMatch[0];
    // Reihenfolge der th-Labels (mit Ausrichtungs-Klassen + data-col):
    expect(header).toMatch(
      /<th class="is-rank"\s+data-col="pl">Pl\.<\/th>[\s\S]*<th class="is-team">Team<\/th>[\s\S]*<th class="is-num"\s+data-col="played">Sp\.<\/th>[\s\S]*<th class="is-num"\s+data-col="won">S<\/th>[\s\S]*<th class="is-num"\s+data-col="drawn">U<\/th>[\s\S]*<th class="is-num"\s+data-col="lost">N<\/th>[\s\S]*<th class="is-num"\s+data-col="score">Becher<\/th>[\s\S]*<th class="is-num"\s+data-col="diff">Diff<\/th>[\s\S]*<th class="is-num"\s+data-col="points">Pkt\.<\/th>/,
    );
  });

  it('Bug 14: <colgroup> mit festen Spaltenbreiten (table-layout: fixed)', () => {
    const html = renderStandingsGroups(fixture, 'Becher');
    // Genau 9 <col>-Elemente für die 9 Spalten, mit Prozentbreiten.
    expect(html).toMatch(/<colgroup>[\s\S]*<\/colgroup>/);
    const cols = html.match(/<col style="width:[^"]+">/g) || [];
    expect(cols.length).toBe(9);
    // Team-Spalte bekommt den großen Rest (auto), Pl. eine kleine Fix-Breite.
    expect(cols[0]).toMatch(/width:6%/);
    expect(cols[1]).toMatch(/width:auto/);
  });

  it('Spalte „Becher" zeigt erzielt:kassiert (gf:ga) als Doppelwert', () => {
    const html = renderStandingsGroups(fixture, 'Becher');
    // Alpha: 9 erzielt, 2 kassiert → "9:2"
    expect(html).toMatch(/<td[^>]*>9:2<\/td>/);
    // Beta: 5:6
    expect(html).toMatch(/<td[^>]*>5:6<\/td>/);
    // Gamma: 2:8
    expect(html).toMatch(/<td[^>]*>2:8<\/td>/);
  });

  it('S/U/N lesen die richtigen Felder (won/drawn/lost, NICHT wins/draws/losses)', () => {
    // Vor Bug 8: S/U/N waren 0, weil der Renderer `s.wins` las.
    const html = renderStandingsGroups(fixture, 'Becher');
    // Alpha: 3 Siege, 0 Unentschieden, 0 Niederlagen.
    expect(html).toMatch(/<td[^>]*>3<\/td>[\s\S]*<td[^>]*>0<\/td>[\s\S]*<td[^>]*>0<\/td>/);
    // Beta: 1 Sieg, 0 U, 2 N
    expect(html).toMatch(/<td[^>]*>1<\/td>[\s\S]*<td[^>]*>0<\/td>[\s\S]*<td[^>]*>2<\/td>/);
  });

  it('Spalte „Sp." zeigt played', () => {
    const html = renderStandingsGroups(fixture, 'Becher');
    // Alpha hat 3 Spiele, Beta 3, Gamma 2 — direkt nach dem Teamnamen.
    expect(html).toMatch(/Team Alpha<\/td>[\s\S]*<td[^>]*>3<\/td>/);
    expect(html).toMatch(/Team Gamma<\/td>[\s\S]*<td[^>]*>2<\/td>/);
  });

  it('Diff bekommt +/- Vorzeichen + is-positive/is-negative Klasse', () => {
    const html = renderStandingsGroups(fixture, 'Becher');
    // Alpha: +7, is-positive
    expect(html).toMatch(/class="t-standings-num is-positive"\s+data-col="diff">\+7</);
    // Beta: -1, is-negative
    expect(html).toMatch(/class="t-standings-num is-negative"\s+data-col="diff">-1</);
  });

  it('Pkt. wird mit is-points-Klasse gerendert (fett)', () => {
    const html = renderStandingsGroups(fixture, 'Becher');
    expect(html).toMatch(/class="t-standings-num is-points"\s+data-col="points">9</);
    expect(html).toMatch(/class="t-standings-num is-points"\s+data-col="points">3</);
    expect(html).toMatch(/class="t-standings-num is-points"\s+data-col="points">1</);
  });

  it('Top-2 bekommen is-first / is-second Klassen für Qualifikations-Marker', () => {
    const html = renderStandingsGroups(fixture, 'Becher');
    expect(html).toContain('class="t-standings-row is-first"');
    expect(html).toContain('class="t-standings-row is-second"');
    // Gamma ist nicht qualifiziert:
    expect(html).not.toContain('class="t-standings-row is-first"><td class="t-standings-rank" data-col="pl">3');
  });

  it('Score-Label wird in Spalte 7 (nicht 3) gerendert', () => {
    // Wenn das Turnier „Tore" statt „Becher" ist, ändert sich nur die
    // Spalten-ÜBERSCHRIFT in Spalte 7 (gf:ga), nicht die Spalten 3
    // (Sp.) oder 9 (Pkt.).
    const html = renderStandingsGroups(fixture, 'Tore');
    expect(html).toMatch(/<th class="is-num"\s+data-col="score">Tore<\/th>/);
    // Sicherstellen: Spalte 3 hat NICHT das Score-Label.
    expect(html).not.toMatch(/<th class="is-num"\s+data-col="score">Tore<\/th><th class="is-num"\s+data-col="won">S<\/th>/);
  });

  it('P5 Re-Fix: alle TH/TD außer Team tragen data-col (für mobile Spalten-Hide)', () => {
    // Regression: ohne data-col-Attribute kann das mobile CSS keine
    // einzelnen Spalten ausblenden. Team bleibt ohne Marker (volle Breite).
    const html = renderStandingsGroups(fixture, 'Becher');
    // 8 data-col-THs (Pl, played, won, drawn, lost, score, diff, points —
    // Team hat keinen Marker)
    const dataColThs = html.match(/<th[^>]*data-col="[^"]+"/g) || [];
    expect(dataColThs.length).toBe(8);
    // 8 data-col-TDs pro Reihe × 3 Reihen = 24 data-col-TDs
    const dataColTds = html.match(/<td[^>]*data-col="[^"]+"/g) || [];
    expect(dataColTds.length).toBe(24);
    // Team-TH/TD haben KEIN data-col
    expect(html).toMatch(/<th class="is-team">Team<\/th>/);
    expect(html).toMatch(/<td class="t-standings-team">[^<]+<\/td>/);
    expect(html).not.toMatch(/<th[^>]*class="is-team"[^>]*data-col=/);
    expect(html).not.toMatch(/<td[^>]*class="t-standings-team"[^>]*data-col=/);
  });
});

describe('renderStandingsGroups — Edge cases', () => {
  it('leere Gruppe rendert nur Tabelle ohne Body', () => {
    const html = renderStandingsGroups(
      [{ groupKey: 'B', groupName: 'Gruppe B', standings: [] }],
      'Becher',
    );
    expect(html).toContain('<tbody></tbody>');
    expect(html).toContain('Gruppe B');
  });

  it('fehlende Felder werden mit 0 ersetzt (nie undefined)', () => {
    const html = renderStandingsGroups(
      [{ groupKey: 'X', standings: [{ teamId: 't1', name: 'Solo' }] }],
      'Becher',
    );
    // Alle numerischen Spalten sollen "0" zeigen, nicht "undefined".
    expect(html).not.toContain('undefined');
    // Genau 0:0 für Becher, 0 (ohne +) für Diff — bei 0 kein Vorzeichen.
    expect(html).toMatch(/<td[^>]*>0:0<\/td>/);
    expect(html).toMatch(/class="t-standings-num"\s+data-col="drawn">0</);
  });

  it('Score-Label „Punkte" für sonstige Sportarten', () => {
    const html = renderStandingsGroups(
      [{ groupKey: 'X', standings: [{ teamId: 't1', name: 'A', points: 5 }] }],
      'Punkte',
    );
    expect(html).toMatch(/<th class="is-num"\s+data-col="score">Punkte<\/th>/);
  });

  it('HTML-Escape für Teamnamen mit Sonderzeichen', () => {
    const html = renderStandingsGroups(
      [
        {
          groupKey: 'X',
          standings: [{ teamId: 't1', name: 'Team <script>alert(1)</script>' }],
        },
      ],
      'Becher',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});