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
    // Header prüfen — exakte Reihenfolge der Spec §13.7
    const headerMatch = html.match(/<thead>[\s\S]*?<\/thead>/);
    expect(headerMatch).toBeTruthy();
    const header = headerMatch[0];
    // Reihenfolge der th-Labels:
    expect(header).toMatch(
      /<th>Pl\.<\/th>[\s\S]*<th>Team<\/th>[\s\S]*<th>Sp\.<\/th>[\s\S]*<th>S<\/th>[\s\S]*<th>U<\/th>[\s\S]*<th>N<\/th>[\s\S]*<th>Becher<\/th>[\s\S]*<th>Diff<\/th>[\s\S]*<th>Pkt\.<\/th>/,
    );
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
    expect(html).toMatch(/class="t-standings-num is-positive">\+7</);
    // Beta: -1, is-negative
    expect(html).toMatch(/class="t-standings-num is-negative">-1</);
  });

  it('Pkt. wird mit is-points-Klasse gerendert (fett)', () => {
    const html = renderStandingsGroups(fixture, 'Becher');
    expect(html).toMatch(/class="t-standings-num is-points">9</);
    expect(html).toMatch(/class="t-standings-num is-points">3</);
    expect(html).toMatch(/class="t-standings-num is-points">1</);
  });

  it('Top-2 bekommen is-first / is-second Klassen für Qualifikations-Marker', () => {
    const html = renderStandingsGroups(fixture, 'Becher');
    expect(html).toContain('class="t-standings-row is-first"');
    expect(html).toContain('class="t-standings-row is-second"');
    // Gamma ist nicht qualifiziert:
    expect(html).not.toContain('class="t-standings-row is-first"><td class="t-standings-rank">3');
  });

  it('Score-Label wird in Spalte 7 (nicht 3) gerendert', () => {
    // Wenn das Turnier „Tore" statt „Becher" ist, ändert sich nur die
    // Spalten-ÜBERSCHRIFT in Spalte 7 (gf:ga), nicht die Spalten 3
    // (Sp.) oder 9 (Pkt.).
    const html = renderStandingsGroups(fixture, 'Tore');
    expect(html).toMatch(/<th>Tore<\/th>/);
    // Sicherstellen: Spalte 3 hat NICHT das Score-Label.
    expect(html).not.toMatch(/<th>Tore<\/th><th>S<\/th>/);
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
    expect(html).toMatch(/class="t-standings-num">0</);
  });

  it('Score-Label „Punkte" für sonstige Sportarten', () => {
    const html = renderStandingsGroups(
      [{ groupKey: 'X', standings: [{ teamId: 't1', name: 'A', points: 5 }] }],
      'Punkte',
    );
    expect(html).toMatch(/<th>Punkte<\/th>/);
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