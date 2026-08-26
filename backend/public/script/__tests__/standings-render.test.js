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

import { describe, it, expect, beforeEach } from 'vitest';
import { renderStandingsGroups, setCompactMode } from '../spielplan-helpers.js';

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
          played: 3,
          won: 3,
          drawn: 0,
          lost: 0,
          goalsFor: 9,
          goalsAgainst: 2,
          goalDiff: 7,
          points: 9,
        },
        {
          teamId: 't2',
          name: 'Team Beta',
          played: 3,
          won: 1,
          drawn: 0,
          lost: 2,
          goalsFor: 5,
          goalsAgainst: 6,
          goalDiff: -1,
          points: 3,
        },
        {
          teamId: 't3',
          name: 'Team Gamma',
          played: 2,
          won: 0,
          drawn: 1,
          lost: 1,
          goalsFor: 2,
          goalsAgainst: 8,
          goalDiff: -6,
          points: 1,
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
      /<th class="is-rank"\s+data-col="pl">Pl\.<\/th>[\s\S]*<th class="is-team">Team<\/th>[\s\S]*<th class="is-num"\s+data-col="played">Sp\.<\/th>[\s\S]*<th class="is-num"\s+data-col="won">S<\/th>[\s\S]*<th class="is-num"\s+data-col="drawn">U<\/th>[\s\S]*<th class="is-num"\s+data-col="lost">N<\/th>[\s\S]*<th class="is-num"\s+data-col="score">Becher<\/th>[\s\S]*<th class="is-num"\s+data-col="diff">Diff<\/th>[\s\S]*<th class="is-num"\s+data-col="points">Pkt\.<\/th>/
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

  it('Zeilenklassen kommen aus qualifyPerGroup, nicht aus einer Annahme', () => {
    // Default (kein Wert uebergeben) = 2: Platz 1 fuehrt, Platz 2 ist
    // qualifiziert, ab Platz 3 nichts.
    const html = renderStandingsGroups(fixture, 'Becher');
    expect(html).toContain('class="t-standings-row is-lead"');
    expect(html).toContain('class="t-standings-row is-qualified"');
    // Gamma ist nicht qualifiziert:
    // Die alten Klassen darf es nicht mehr geben.
    expect(html).not.toContain('is-first');
    expect(html).not.toContain('is-second');
  });

  it('Score-Label wird in Spalte 7 (nicht 3) gerendert', () => {
    // Wenn das Turnier „Tore" statt „Becher" ist, ändert sich nur die
    // Spalten-ÜBERSCHRIFT in Spalte 7 (gf:ga), nicht die Spalten 3
    // (Sp.) oder 9 (Pkt.).
    const html = renderStandingsGroups(fixture, 'Tore');
    expect(html).toMatch(/<th class="is-num"\s+data-col="score">Tore<\/th>/);
    // Sicherstellen: Spalte 3 hat NICHT das Score-Label.
    expect(html).not.toMatch(
      /<th class="is-num"\s+data-col="score">Tore<\/th><th class="is-num"\s+data-col="won">S<\/th>/
    );
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
      'Becher'
    );
    expect(html).toContain('<tbody></tbody>');
    expect(html).toContain('Gruppe B');
  });

  it('fehlende Felder werden mit 0 ersetzt (nie undefined)', () => {
    const html = renderStandingsGroups(
      [{ groupKey: 'X', standings: [{ teamId: 't1', name: 'Solo' }] }],
      'Becher'
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
      'Punkte'
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
      'Becher'
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─────────────────────────────────────────────────────────────────
// P5-Truncation 2026-08-25: Compact-Mode-Switch für Standings-Colgroup.
// Vorher: Renderer gab immer das 9er-Colgroup aus — die 8%/7%/7%/7%-
// Geister-Spalten reservierten 29% der Tabellenbreite, obwohl sie per
// CSS display:none ausgeblendet waren. Auf .t-mod ≤600 px blieben für
// die 5 sichtbaren Spalten nur 36% + auto-Team 35% → Becher/Diff/Pkt
// wurden getruncated ("BECH…", "+…", "9…"). Mit 5er-Colgroup summieren
// sich die Fix-Werte zu 56% + auto-Team 44% → ausreichend für "12:10".
// ─────────────────────────────────────────────────────────────────

describe('renderStandingsGroups — Compact-Mode-Switch (P5-Truncation)', () => {
  beforeEach(() => setCompactMode(false)); // jeder Test startet mit Desktop

  const sample = [
    {
      groupKey: 'A',
      groupName: 'Gruppe A',
      standings: [
        {
          teamId: 't1',
          name: 'Team Alpha',
          played: 3,
          won: 3,
          drawn: 0,
          lost: 0,
          goalsFor: 12,
          goalsAgainst: 10,
          goalDiff: 2,
          points: 9,
        },
      ],
    },
  ];

  it('Desktop-Mode: 9 Colgroup-Spalten (6% + auto + 8% + 7% + 7% + 7% + 12% + 9% + 9%)', () => {
    setCompactMode(false);
    const html = renderStandingsGroups(sample, 'Becher');
    const cols = html.match(/<col style="width:[^"]+">/g) || [];
    expect(cols).toHaveLength(9);
    expect(html).toContain('width:6%');
    expect(html).toContain('width:8%');
    expect(html).toContain('width:7%');
    expect(html).toContain('width:12%');
    expect(html).toContain('width:9%');
  });

  it('Mobile-Mode: 5 Colgroup-Spalten (14% + 42% + 14% + 15% + 15%, Summe 100%)', () => {
    // User-Punkt 1 Folge (2026-08-25): Pl-Spalte von 8% auf 14% —
    // 8% war zu schmal für "10." und "Pl." (Header wurde zu "P…"
    // truncated). 14% von 374 px = ~52 px → reicht für Worst-Case-Wert.
    // Entscheid Jonas, 2026-08-26: Becher faellt mobil weg, 'Sp' kommt
    // zurueck. 'Sp' braucht weniger Platz als '12:10', deshalb 14% statt
    // 20% — die frei gewordenen 6 Punkte gehen an die Team-Spalte (42%).
    // Diff/Pkt bleiben bei 15%.
    setCompactMode(true);
    const html = renderStandingsGroups(sample, 'Becher');
    const cols = html.match(/<col style="width:[^"]+">/g) || [];
    expect(cols).toHaveLength(5);
    expect(html).toContain('width:14%');
    expect(html).toContain('width:42%');
    expect(html).not.toContain('width:20%');
    expect(html).toContain('width:15%');
    // Sicherstellen: kein 'auto' mehr im Mobile-Colgroup.
    expect(html).not.toMatch(/<col[^>]*width:auto/);
  });

  it('Mobile-Mode: keine 7%-Geister-Spalten mehr', () => {
    setCompactMode(true);
    const html = renderStandingsGroups(sample, 'Becher');
    // 7% war die Geister-Breite für S/U/N-Spalten im 9er-Colgroup.
    // Im 5er-Mobile-Set kommt 7% nicht mehr vor.
    expect(html).not.toContain('width:7%');
  });

  it('Mobile: Becher steht im Markup, bekommt aber keine Colgroup-Breite', () => {
    // Entscheid Jonas, 2026-08-26: mobil weglassen. Weggelassen heisst
    // ausgeblendet (main.css, @container <=600px), nicht ungerendert —
    // beim Verbreitern muss die Spalte ohne Neu-Rendern wieder da sein.
    // Die Colgroup hat dafuer nur noch fuenf Eintraege; haette sie sechs,
    // rutschten alle folgenden Breiten um eine Spalte nach links. Genau
    // dieser Fehler hat die Dritten-Tabelle 2026-08-25 zerlegt.
    setCompactMode(true);
    const html = renderStandingsGroups(sample, 'Becher');
    expect(html).toContain('12:10');
    expect(html).toContain('data-col="score"');
    const cols = html.match(/<col style="width:[^"]+">/g) || [];
    expect(cols).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────
// Qualifikationszustaende — Markenuebernahme (2026-08-26)
//
// Loest den A3-Satz (is-qualified / is-cutoff / is-pending) ab. Der
// Marken-Entwurf kennt zwei Zustaende, nicht drei:
//   Platz 1        is-lead       Orange, hier faengt der Weg zum Titel an
//   Platz 2..N     is-qualified  Gruen, steigt auf
//   darunter       nichts
//
// Die Grenze braucht keine eigene Linie mehr — sie ist da, wo das
// Farbband links aufhoert. Das Band ist zugleich das farbunabhaengige
// Signal, das vorher die Linie trug: Orange gegen Gruen unterscheidet
// sich nur um 1.02:1, "Band da" gegen "Band nicht da" dagegen immer.
//
// Der urspruengliche Defekt, gegen den diese Tests weiter schuetzen,
// ist unveraendert: der Renderer vergab die Farbe nach Position und
// kodierte damit "immer genau zwei steigen auf". Bei qualifyPerGroup
// 1 oder 3 behauptete die Tabelle schlicht das Falsche.
// ─────────────────────────────────────────────────────────────────

describe('renderStandingsGroups — Qualifikationszustaende', () => {
  const g = (n) => [
    {
      groupKey: 'A',
      groupName: 'Gruppe A',
      standings: Array.from({ length: n }, (_, i) => ({
        teamId: 't' + i,
        name: 'Team ' + i,
        played: 3,
        won: 3 - i,
        drawn: 0,
        lost: i,
        goalsFor: 10 - i,
        goalsAgainst: i,
        goalDiff: 10 - 2 * i,
        points: 9 - 3 * i,
      })),
    },
  ];
  const rowClasses = (html) =>
    [...html.matchAll(/<tr class="t-standings-row([^"]*)"/g)].map((m) => m[1].trim());

  it('qualifyPerGroup=1: nur Platz 1, und der fuehrt', () => {
    expect(rowClasses(renderStandingsGroups(g(4), 'Becher', 1))).toEqual(['is-lead', '', '', '']);
  });

  it('qualifyPerGroup=2: Platz 1 fuehrt, Platz 2 ist qualifiziert', () => {
    expect(rowClasses(renderStandingsGroups(g(4), 'Becher', 2))).toEqual([
      'is-lead',
      'is-qualified',
      '',
      '',
    ]);
  });

  it('qualifyPerGroup=3: drei Baender, nur das erste in Orange', () => {
    expect(rowClasses(renderStandingsGroups(g(5), 'Becher', 3))).toEqual([
      'is-lead',
      'is-qualified',
      'is-qualified',
      '',
      '',
    ]);
  });

  it('ohne Angabe faellt es auf 2 zurueck — bisheriges Verhalten bleibt', () => {
    expect(rowClasses(renderStandingsGroups(g(3), 'Becher'))).toEqual(
      rowClasses(renderStandingsGroups(g(3), 'Becher', 2))
    );
  });

  it('kaputte Konfiguration macht die Tabelle nicht unbrauchbar', () => {
    for (const bad of [0, -1, null, undefined, 'zwei', 2.5]) {
      expect(rowClasses(renderStandingsGroups(g(3), 'Becher', bad))).toEqual([
        'is-lead',
        'is-qualified',
        '',
      ]);
    }
  });

  it('mehr Aufsteiger als Teams: alle tragen ein Band, keine Ausnahme', () => {
    expect(rowClasses(renderStandingsGroups(g(2), 'Becher', 5))).toEqual([
      'is-lead',
      'is-qualified',
    ]);
  });

  it('genau EIN Platz fuehrt, egal wie viele aufsteigen', () => {
    // Orange markiert den Weg zum Titel. Zwei Fuehrende waeren zwei Wege.
    for (const n of [1, 2, 3, 5]) {
      const leads = rowClasses(renderStandingsGroups(g(6), 'Becher', n)).filter((c) =>
        c.includes('is-lead')
      );
      expect(leads).toHaveLength(1);
    }
  });

  it('kein Haekchen, kein Stern, kein Pfeil im Markup', () => {
    const html = renderStandingsGroups(g(4), 'Becher', 2);
    expect(html).not.toContain('✓');
    expect(html).not.toContain('★');
    expect(html).not.toContain('→');
  });

  it('die abgeloesten A3-Klassen kommen nicht mehr vor', () => {
    const html = renderStandingsGroups(g(5), 'Becher', 2);
    expect(html).not.toContain('is-cutoff');
    expect(html).not.toContain('is-pending');
  });
});
