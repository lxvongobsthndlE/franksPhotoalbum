/**
 * Tests für den Beste-Dritte-Renderer. Spec §6.3.1, §13.7.
 *
 * Regressionsschutz für Bug 9 (2026-08-18, fehlte komplett) und
 * Bug 13 (2026-08-18, User-Punkt 2:„Wertung unverständlich").
 *
 * Nach Bug 13 zeigt die Tabelle dieselben Spalten wie die normale
 * Gruppentabelle (Pl. · Team · Gruppe · Sp. · S · U · N · Becher ·
 * Diff · Pkt.) plus eine Quali-Markierung. Die Sortierung BERUHT
 * weiterhin auf den pro-Spiel-normalisierten Werten (Spec §10.4
 * verlangt das), aber die Anzeige zeigt die absoluten Werte und
 * blendet einen erklärenden Hinweis nur ein, wenn die zugrunde
 * liegenden Gruppen unterschiedlich groß sind.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { renderBestThirdsTable, setCompactMode } from '../spielplan-helpers.js';

describe('renderBestThirdsTable', () => {
  // Beispiel: 3 Gruppen, Drittplatzierte mit unterschiedlichen Quoten.
  const sample = {
    qualifyCount: 2,
    rows: [
      {
        teamId: 'A3',
        name: 'Team Alpha-Drei',
        groupKey: 'A',
        played: 3,
        won: 2,
        drawn: 1,
        lost: 0,
        goalsFor: 10,
        goalsAgainst: 4,
        goalDiff: 6,
        points: 7,
        pointsPerGame: 2.33,
        goalDiffPerGame: 2.0,
        qualifies: true,
      },
      {
        teamId: 'B3',
        name: 'Team Bravo-Drei',
        groupKey: 'B',
        played: 3,
        won: 2,
        drawn: 0,
        lost: 1,
        goalsFor: 8,
        goalsAgainst: 5,
        goalDiff: 3,
        points: 6,
        pointsPerGame: 2.0,
        goalDiffPerGame: 1.0,
        qualifies: true,
      },
      {
        teamId: 'C3',
        name: 'Team Charlie-Drei',
        groupKey: 'C',
        played: 2,
        won: 0,
        drawn: 1,
        lost: 1,
        goalsFor: 2,
        goalsAgainst: 8,
        goalDiff: -6,
        points: 1,
        pointsPerGame: 0.5,
        goalDiffPerGame: -3.0,
        qualifies: false,
      },
    ],
  };

  it('rendert die Tabelle mit korrekten Spalten (Spec §13.7)', () => {
    const html = renderBestThirdsTable(sample);
    expect(html).toContain('Beste Dritte');
    expect(html).toContain('Top 2 qualifizieren sich');
    // Spalten: Pl. · Team · Gruppe · Sp. · S · U · N · Becher · Diff · Pkt.
    // Bug 14 (2026-08-18): <th> haben jetzt Ausrichtungs-Klassen, und
    // die separate Mark-Spalte ist weg — der Quali-Haken hängt jetzt
    // per ::after an der Rank-Zelle, damit alle Tabellen (Gruppe +
    // Dritte) dieselbe Spaltenaufteilung haben.
    // P2 (2026-08-24): TH haben jetzt zusätzlich data-col-Attribute
    // für Container-Query-Hide auf Mobile.
    const headerMatch = html.match(/<thead>[\s\S]*?<\/thead>/);
    expect(headerMatch).toBeTruthy();
    expect(headerMatch[0]).toMatch(
      /<th class="is-rank"\s+data-col="pl">Pl\.<\/th>[\s\S]*<th class="is-team">Team<\/th>[\s\S]*<th class="is-group"\s+data-col="group">Gruppe<\/th>[\s\S]*<th class="is-num"\s+data-col="played">Sp\.<\/th>[\s\S]*<th class="is-num"\s+data-col="won">S<\/th>[\s\S]*<th class="is-num"\s+data-col="drawn">U<\/th>[\s\S]*<th class="is-num"\s+data-col="lost">N<\/th>[\s\S]*<th class="is-num"\s+data-col="score">Becher<\/th>[\s\S]*<th class="is-num"\s+data-col="diff">Diff<\/th>[\s\S]*<th class="is-num"\s+data-col="points">Pkt\.<\/th>/
    );
  });

  it('Bug 14: <colgroup> mit festen Spaltenbreiten für Dritte-Tabelle', () => {
    setCompactMode(false); // Desktop-Pfad explizit, nicht dem Zufall überlassen
    const html = renderBestThirdsTable(sample);
    expect(html).toMatch(/<colgroup>[\s\S]*<\/colgroup>/);
    const cols = html.match(/<col style="width:[^"]+">/g) || [];
    // 10 Spalten: Pl. · Team · Gruppe · Sp. · S · U · N · Becher · Diff · Pkt.
    expect(cols.length).toBe(10);
    expect(cols[0]).toMatch(/width:6%/);
    expect(cols[1]).toMatch(/width:auto/);
    expect(cols[2]).toMatch(/width:8%/); // Gruppe
  });

  it('zeigt absolute Werte (Pkt, Sp, S, U, N, Becher), NICHT pro-Spiel-normalisiert', () => {
    // Bug 13-Hintergrund: User sah vorher Pkt/Sp und Diff/Sp — wirkte
    // wie eine ganz andere Sportart. Jetzt: dieselben Spalten wie in
    // den Gruppen, mit Absolut-Werten.
    const html = renderBestThirdsTable(sample);
    // Alpha: 7 Pkt, 3 Sp, 2 S, 1 U, 0 N, Becher 10:4, Diff +6
    expect(html).toMatch(/<td[^>]*>7<\/td>/); // points
    expect(html).toMatch(/<td[^>]*>3<\/td>/); // played
    expect(html).toMatch(/<td[^>]*>2<\/td>/); // won
    expect(html).toMatch(/<td[^>]*>1<\/td>/); // drawn
    expect(html).toMatch(/<td[^>]*>0<\/td>/); // lost
    expect(html).toContain('10:4');
    expect(html).toContain('+6');
  });

  it('zeigt Gruppenzugehörigkeit (groupKey)', () => {
    const html = renderBestThirdsTable(sample);
    // Bug 13: User-Vorschlag — „plus Gruppenzugehörigkeit"
    // P2 (2026-08-24): data-col="group" hinzugefügt für CSS-Hide.
    expect(html).toMatch(/<td class="t-thirds-group"\s+data-col="group">A<\/td>/);
    expect(html).toMatch(/<td class="t-thirds-group"\s+data-col="group">B<\/td>/);
    expect(html).toMatch(/<td class="t-thirds-group"\s+data-col="group">C<\/td>/);
  });

  it('Top-N bekommen is-qualified, Rest is-out', () => {
    const html = renderBestThirdsTable(sample);
    expect(html).toContain('class="t-thirds-row is-qualified"');
    expect(html).toContain('class="t-thirds-row is-out"');
    // Genau 2 qualifizierte (qualifyCount=2)
    const qualifiedMatches = html.match(/is-qualified/g) || [];
    expect(qualifiedMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('markiert qualifizierte Reihen per Klasse an der Zeile (kein eigenes Mark-<td>)', () => {
    const html = renderBestThirdsTable(sample);
    // Genau 2 Reihen bekommen die is-qualified-Klasse. Die Markierung
    // haengt an der ZEILE, nicht an einer eigenen Spalte (Bug 14) und
    // nicht mehr an einem Haken-Pseudoelement (2026-08-29, siehe unten).
    const qualifiedRows = html.match(/<tr class="t-thirds-row is-qualified">/g) || [];
    expect(qualifiedRows.length).toBe(2);
    const outRows = html.match(/<tr class="t-thirds-row is-out">/g) || [];
    expect(outRows.length).toBe(1);
    // Es gibt keine <td class="t-thirds-mark"> mehr (Bug 14).
    expect(html).not.toContain('t-thirds-mark');
  });

  it('zeigt IMMER den Hinweis "Gewertet wird nach Punkten pro Spiel."', () => {
    // P6 (2026-08-24, User-Liste): Hinweis ist unconditional, nicht
    // mehr abhängig von mixedGroupSizes. User-Begründung: konstanter
    // Einzehler erklärt die Normierung generell.
    const html = renderBestThirdsTable(sample);
    expect(html).toContain('Gewertet wird nach Punkten pro Spiel.');
    // Egal ob Gruppen gleich groß oder nicht — Hinweis ist IMMER da.
    const samePlayed = {
      qualifyCount: 2,
      rows: sample.rows.map((r) => ({ ...r, played: 3 })),
    };
    const html2 = renderBestThirdsTable(samePlayed);
    expect(html2).toContain('Gewertet wird nach Punkten pro Spiel.');
    // Der alte "unterschiedlich groß"-Text ist weg.
    expect(html).not.toContain('unterschiedlich groß');
    expect(html2).not.toContain('unterschiedlich groß');
  });

  it('gibt leeren String zurück wenn bestThirds null (kein bestThirds-Modus)', () => {
    expect(renderBestThirdsTable(null)).toBe('');
    expect(renderBestThirdsTable(undefined)).toBe('');
  });

  it('gibt leeren String zurück wenn rows leer (z. B. erst 1 Gruppe aktiv)', () => {
    expect(renderBestThirdsTable({ qualifyCount: 2, rows: [] })).toBe('');
  });

  it('zeigt die Rank-Spalte mit Position 1, 2, 3, … (auch bei 0-basierten Rows)', () => {
    const html = renderBestThirdsTable(sample);
    // P2 (2026-08-24): data-col="pl" hinzugefügt für CSS-Hide.
    expect(html).toMatch(/<td class="t-thirds-rank"\s+data-col="pl">1\./);
    expect(html).toMatch(/<td class="t-thirds-rank"\s+data-col="pl">2\./);
    expect(html).toMatch(/<td class="t-thirds-rank"\s+data-col="pl">3\./);
  });

  it('HTML-Escape für Teamnamen', () => {
    const html = renderBestThirdsTable({
      qualifyCount: 0,
      rows: [
        {
          teamId: 'X',
          name: 'Team <script>',
          groupKey: 'A',
          played: 1,
          won: 0,
          drawn: 0,
          lost: 1,
          goalsFor: 1,
          goalsAgainst: 2,
          goalDiff: -1,
          points: 0,
        },
      ],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('Diff-Spalte: positive Werte mit +, negative und 0 ohne Vorzeichen', () => {
    const html = renderBestThirdsTable({
      qualifyCount: 0,
      rows: [
        {
          teamId: 'P',
          name: 'Plus',
          groupKey: 'A',
          played: 2,
          won: 2,
          drawn: 0,
          lost: 0,
          goalsFor: 5,
          goalsAgainst: 1,
          goalDiff: 4,
          points: 6,
        },
        {
          teamId: 'Z',
          name: 'Zero',
          groupKey: 'B',
          played: 2,
          won: 1,
          drawn: 0,
          lost: 1,
          goalsFor: 3,
          goalsAgainst: 3,
          goalDiff: 0,
          points: 3,
        },
        {
          teamId: 'N',
          name: 'Neg',
          groupKey: 'C',
          played: 2,
          won: 0,
          drawn: 0,
          lost: 2,
          goalsFor: 1,
          goalsAgainst: 5,
          goalDiff: -4,
          points: 0,
        },
      ],
    });
    expect(html).toContain('+4');
    // P2 (2026-08-24): data-col="diff" hinzugefügt für CSS-Hide.
    expect(html).toMatch(/<td class="t-thirds-num"\s+data-col="diff">0<\/td>/); // zero diff: kein +
    expect(html).toContain('-4');
  });
});

// ─────────────────────────────────────────────────────────────────
// Colgroup-Spaltenzahl (Korrektur 2026-08-25)
//
// Der Defekt, gegen den diese Tests schützen: das Mobile-Colgroup der
// Dritten-Tabelle hatte SIEBEN <col> für SECHS sichtbare Spalten. <col>
// wird bei table-layout: fixed positionsweise auf die tatsächlich
// gerenderten Spalten gelegt — eine per display:none entfernte Spalte
// verschiebt alle folgenden Breiten um eins. "Becher" bekam dadurch die
// 10%-Breite, die für die versteckte "Sp."-Spalte gedacht war, und
// "12:10" wurde zu "12:…".
//
// Die Zahl 6 ist KEINE Kosmetik: sie muss der Anzahl der Spalten
// entsprechen, die main.css im Block @container (max-width: 600px)
// übrig lässt (versteckt werden played/won/drawn/lost). Wer dort eine
// Spalte zusätzlich versteckt, muss THIRDS_COL_WIDTHS_MOBILE mitziehen
// — und dieser Test schlägt dann fehl, was genau der Sinn ist.
// ─────────────────────────────────────────────────────────────────

describe('renderBestThirdsTable — Colgroup-Spaltenzahl', () => {
  const row = {
    teamId: 'A3',
    name: 'Team Alpha-Drei',
    groupKey: 'A',
    played: 3,
    won: 2,
    drawn: 1,
    lost: 0,
    goalsFor: 12,
    goalsAgainst: 10,
    goalDiff: 2,
    points: 7,
    qualifies: true,
  };
  const sample = { qualifyCount: 1, rows: [row] };

  afterEach(() => setCompactMode(false));

  it('Desktop: 10 <col> für 10 sichtbare Spalten', () => {
    setCompactMode(false);
    const cols = renderBestThirdsTable(sample).match(/<col style="width:[^"]+">/g) || [];
    expect(cols).toHaveLength(10);
  });

  it('Mobile: 5 <col> für 5 sichtbare Spalten (Sp/S/U/N/Becher sind versteckt)', () => {
    setCompactMode(true);
    const cols = renderBestThirdsTable(sample).match(/<col style="width:[^"]+">/g) || [];
    expect(cols).toHaveLength(5);
  });

  it('Mobile: exakte Breiten in DOM-Reihenfolge Pl · Team · Gruppe · Diff · Pkt', () => {
    setCompactMode(true);
    const cols = (renderBestThirdsTable(sample).match(/<col style="width:([^"]+)">/g) || []).map(
      (c) => c.match(/width:([^"]+)"/)[1]
    );
    expect(cols).toEqual(['14%', '44%', '12%', '15%', '15%']);
    // Die Invariante, an der die Flucht mit der Standings-Tabelle haengt:
    // Team + Gruppe muss hier so breit sein wie dort Team + Sp. (42 + 14),
    // sonst beginnen Diff und Pkt. in den beiden Tabellen nicht an
    // derselben Stelle. Seit dem Wegfall der Becher-Spalte (Entscheid
    // Jonas, 2026-08-26) ist das 56 statt 36.
    expect(parseFloat(cols[1]) + parseFloat(cols[2])).toBe(56);
  });

  it('Mobile: Summe der Breiten ist genau 100% und es gibt kein auto', () => {
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    const cols = (html.match(/<col style="width:([^"]+)">/g) || []).map(
      (c) => c.match(/width:([^"]+)"/)[1]
    );
    expect(html).not.toMatch(/<col[^>]*width:auto/);
    const sum = cols.reduce((acc, w) => acc + parseFloat(w), 0);
    expect(sum).toBe(100);
  });

  it('Mobile: keine Geister-Breiten der versteckten Zahlenspalten mehr', () => {
    // 10% war im kaputten 7er-Set die Breite, die auf "Becher" rutschte;
    // 18% und 13% die verschobenen Nachbarn. Keiner der drei Werte kommt
    // im korrigierten Set vor.
    //
    // 8% stand hier urspruenglich mit auf der schwarzen Liste — es war im
    // 7er-Set die Breite der Pl.-Spalte. Seit der Flucht-Angleichung
    // (2026-08-25) traegt die Gruppen-Spalte legitim 10%, weil sie einen
    // einzigen Buchstaben zeigt. Der Wert ist damit kein Geist mehr und
    // muss aus der Liste raus: ein Test, der einen gueltigen Zustand
    // verbietet, wird beim naechsten Rot abgeschaltet statt gelesen.
    // Die eigentliche Absicherung leistet ohnehin der Test darueber, der
    // das Set als Ganzes gegen die dokumentierte Konstante haelt.
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    // 20% war bis zum 26.08. die Becher-Breite; seit die Spalte mobil
    // wegfaellt (Entscheid Jonas) darf sie nicht mehr auftauchen.
    expect(html).not.toContain('width:20%');
    expect(html).not.toContain('width:18%');
    expect(html).not.toContain('width:13%');
    // 12% ist am 26.08. von der schwarzen Liste geflogen: es ist jetzt
    // legitim die Breite der Gruppen-Spalte. Genau derselbe Vorgang wie
    // 2026-08-25 bei 8% — und aus demselben Grund, der oben schon steht:
    // ein Test, der einen gueltigen Zustand verbietet, wird beim naechsten
    // Rot abgeschaltet statt gelesen. Die Absicherung leistet der Test,
    // der das Set als Ganzes gegen die dokumentierte Konstante haelt.
  });

  it('Mobile: die Becher-Spalte ist weg, ihre Werte stehen aber im Markup', () => {
    // Entscheid Jonas, 2026-08-26: "Becher weglassen" auf dem Handy.
    // Weggelassen heisst AUSGEBLENDET, nicht ungerendert — die Zelle
    // bleibt im DOM (main.css blendet sie per @container aus) und ist auf
    // dem Desktop wieder da. Wer sie hier aus dem Markup entfernte,
    // muesste beim Verbreitern neu rendern statt nur einzublenden.
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    expect(html).toContain('12:10');
    expect(html).toContain('data-col="score"');
    // Aber keine Colgroup-Breite mehr fuer sie.
    const cols = html.match(/<col style="width:([^"]+)">/g) || [];
    expect(cols).toHaveLength(5);
  });

  it('Mobile: gemeinsame Spalten fluchten mit der Standings-Tabelle', () => {
    // Die eigentliche Absicht der Flucht-Angleichung, als Test statt als
    // Kommentar. Beide Tabellen sind gleich breit; wenn die kumulierten
    // Prozente der gemeinsamen Endspalten uebereinstimmen, stehen ihre
    // rechten Kanten uebereinander. Standings mobil: Pl 14 · Team 36 ·
    // Sp 14 · Diff 15 · Pkt 15. Dritte mobil: Pl 14 · Team 44 ·
    // Gr 12 · Diff 15 · Pkt 15. (Becher ist mobil seit 26.08. weg.)
    setCompactMode(true);
    const cols = (renderBestThirdsTable(sample).match(/<col style="width:([^"]+)">/g) || []).map(
      (c) => parseFloat(c.match(/width:([^"]+)%/)[1])
    );
    const kanteVorDiff = cols.slice(0, 3).reduce((a, b) => a + b, 0);
    const kanteVorPkt = cols.slice(0, 4).reduce((a, b) => a + b, 0);
    // Standings mobil: 14+42+14 = 70 bis zur Diff-Kante, +15 = 85 bis Pkt.
    expect(kanteVorDiff).toBe(70);
    expect(kanteVorPkt).toBe(85);
  });

  it('Mobile-Spaltenzahl passt zur Zahl der nicht versteckten data-col-Spalten', () => {
    // Bindet die Colgroup-Länge an das Markup statt an eine Konstante:
    // main.css versteckt auf ≤600px genau played/won/drawn/lost.
    // Stand 26.08.: main.css versteckt auf <=600px zusaetzlich 'score'.
    const HIDDEN_ON_MOBILE = ['played', 'won', 'drawn', 'lost', 'score'];
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    const thead = html.match(/<thead>[\s\S]*?<\/thead>/)[0];
    const ths = thead.match(/<th\s[^>]*>/g) || [];
    const visible = ths.filter((th) => {
      const m = th.match(/data-col="([^"]+)"/);
      return !m || !HIDDEN_ON_MOBILE.includes(m[1]);
    });
    const cols = html.match(/<col style="width:[^"]+">/g) || [];
    // Nicht leer-gegen-leer vergleichen: der Test soll fehlschlagen, wenn
    // die Regex nichts findet, nicht stillschweigend 0 === 0 bestaetigen.
    expect(visible).toHaveLength(5);
    expect(cols).toHaveLength(visible.length);
  });
});

// ─────────────────────────────────────────────────────────────────
// ANGLEICHUNG AN DIE GRUPPENTABELLE — 2026-08-29
//
// User: „Beste dritte tabelle ist zu weit links, soll auf gleicher Höhe
// sein wie Gruppen und die Tabelle soll auch gleich aussehen und nicht
// mit dem Häkchen."
//
// Drei Forderungen, drei Prüfungen. Zwei davon sind Markup-Tests, die
// dritte MUSS ein Quelltext-Scan über das Stylesheet sein: der Haken war
// nie im HTML, er stand als `content: ' ✓'` in einem ::after in main.css
// (Zeile ~5941). Ein Renderer-Test kann ihn deshalb weder sehen noch
// beweisen, dass er weg ist — er würde grün bleiben, während der Haken
// weiter auf dem Schirm steht. Genau diese Sorte grüner Test hat in
// diesem Modul schon zweimal einen Befund verdeckt.
// ─────────────────────────────────────────────────────────────────

describe('renderBestThirdsTable — Machart wie eine Gruppenkarte (2026-08-29)', () => {
  const sample = {
    qualifyCount: 2,
    rows: [
      {
        teamId: 'A3',
        name: 'Alpha',
        groupKey: 'A',
        played: 3,
        won: 2,
        drawn: 1,
        lost: 0,
        goalsFor: 10,
        goalsAgainst: 4,
        goalDiff: 6,
        points: 7,
        qualifies: true,
      },
      {
        teamId: 'B3',
        name: 'Bravo',
        groupKey: 'B',
        played: 3,
        won: 1,
        drawn: 1,
        lost: 1,
        goalsFor: 5,
        goalsAgainst: 5,
        goalDiff: 0,
        points: 4,
        qualifies: false,
      },
    ],
  };

  it('Titel steht in .t-standings-head — dieselbe Kopfzeile wie die Gruppenkarte', () => {
    // DIE URSACHE DES VERSATZES, als Test festgehalten:
    // Der Gruppentitel sitzt in `.t-standings-head`, und dieser Kopf trägt
    // `padding: var(--s5) …` (tournament.css, Block „Tabelle ohne Huelle").
    // „Beste Dritte" hing dagegen nackt im `.t-card-body`, dessen Polster
    // auf 0 steht — gemessen im Prüfstand: Gruppentitel x = 444,
    // „Beste Dritte" x = 424, auf 375px x = 34 gegen x = 14.
    // Die Tabellenzellen fluchteten längst (Polster auf der ersten Spalte),
    // nur die Überschrift nicht. Wer den Kopf hier wieder entfernt, holt
    // die 20px zurück.
    const html = renderBestThirdsTable(sample);
    expect(html).toMatch(
      /<div class="t-standings-head">\s*<h3 class="t-thirds-title">Beste Dritte<\/h3>/
    );
    // Die Legende steht daneben, dort wo die Gruppenkarte ihren Spielstand
    // führt — mit demselben Strich-Element, das die Gruppen-Fusszeile nutzt.
    expect(html).toMatch(
      /<span class="t-standings-sub"><span class="t-foot-mark" aria-hidden="true"><\/span>Top 2 qualifizieren sich<\/span>/
    );
  });

  it('Fusszeile ist eine .t-standings-foot, kein Sonderelement', () => {
    const html = renderBestThirdsTable(sample);
    expect(html).toContain('<div class="t-standings-foot t-thirds-foot">');
    // Kein .t-foot-mark in der Fusszeile: der Strich ist die Legende des
    // Rangbandes und steht oben. Unten würde er eine Farbe erklären, um
    // die es in dem Satz gar nicht geht.
    const foot = html.match(/<div class="t-standings-foot t-thirds-foot">[\s\S]*?<\/div>/)[0];
    expect(foot).not.toContain('t-foot-mark');
    expect(foot).toContain('Gewertet wird nach Punkten pro Spiel.');
  });

  it('Der Haken ist im Stylesheet abgeschaltet — und die Aussage bleibt', () => {
    const cssPfad = new URL('../../style/tournament.css', import.meta.url);
    const css = readFileSync(cssPfad, 'utf8');

    // 1. Der Haken ist neutralisiert. Der Selektor MUSS spezifischer sein
    //    als der in main.css (`.t-thirds-row.is-qualified .t-thirds-rank::after`,
    //    (0,0,3,0)) — sonst hängt die Abschaltung allein an der
    //    Ladereihenfolge der beiden Stylesheets, und genau daran ist in
    //    diesem Modul schon mehrfach still etwas gestorben.
    expect(css).toMatch(
      /\.t-thirds-table \.t-thirds-row\.is-qualified \.t-thirds-rank::after \{\s*content: none;/
    );

    // 2. Die Aussage „diese steigen auf" bleibt sichtbar — als dasselbe
    //    3-px-Band, mit dem die Gruppentabelle sie macht. Ohne diese Regel
    //    wäre der Haken nur gelöscht und die Fachaussage mit ihm.
    expect(css).toMatch(
      /\.t-thirds-row\.is-qualified \.t-thirds-rank::before \{[\s\S]{0,220}background: var\(--qual\);/
    );
    // Und die Fläche kommt aus demselben Token wie bei den Gruppen, nicht
    // mehr aus dem hartcodierten rgba(46, 125, 50, .06) in main.css.
    expect(css).toMatch(/\.t-thirds-row\.is-qualified td \{\s*background: var\(--qual-soft\);/);

    // 3. Nicht qualifizierte Zeilen werden nicht mehr ausgegraut
    //    (main.css: opacity .55). In der Gruppentabelle stehen sie normal
    //    da; die Unterscheidung trägt das Band, nicht der Kontrast.
    expect(css).toMatch(/\.t-thirds-row\.is-out \{\s*opacity: 1;/);
  });

  it('Der Leerzustand-Modifier des Spielplans ist im Stylesheet definiert', () => {
    // Aufgabe A derselben Runde: der Renderer gibt
    // `.t-empty-state t-empty-state--filter` aus. Ohne den Modifier im
    // Stylesheet bliebe die 240px-Mindesthöhe des Seiten-Leerzustands
    // stehen und risse mitten in der Ansicht ein Loch.
    const css = readFileSync(new URL('../../style/tournament.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.t-empty-state--filter \{/);
    expect(css).toMatch(/\.t-empty-state--filter \.t-empty-state-text \{/);
  });
});
