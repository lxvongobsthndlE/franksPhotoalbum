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
        played: 3, won: 2, drawn: 1, lost: 0,
        goalsFor: 10, goalsAgainst: 4, goalDiff: 6, points: 7,
        pointsPerGame: 2.33, goalDiffPerGame: 2.0,
        qualifies: true,
      },
      {
        teamId: 'B3',
        name: 'Team Bravo-Drei',
        groupKey: 'B',
        played: 3, won: 2, drawn: 0, lost: 1,
        goalsFor: 8, goalsAgainst: 5, goalDiff: 3, points: 6,
        pointsPerGame: 2.0, goalDiffPerGame: 1.0,
        qualifies: true,
      },
      {
        teamId: 'C3',
        name: 'Team Charlie-Drei',
        groupKey: 'C',
        played: 2, won: 0, drawn: 1, lost: 1,
        goalsFor: 2, goalsAgainst: 8, goalDiff: -6, points: 1,
        pointsPerGame: 0.5, goalDiffPerGame: -3.0,
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
      /<th class="is-rank"\s+data-col="pl">Pl\.<\/th>[\s\S]*<th class="is-team">Team<\/th>[\s\S]*<th class="is-group"\s+data-col="group">Gruppe<\/th>[\s\S]*<th class="is-num"\s+data-col="played">Sp\.<\/th>[\s\S]*<th class="is-num"\s+data-col="won">S<\/th>[\s\S]*<th class="is-num"\s+data-col="drawn">U<\/th>[\s\S]*<th class="is-num"\s+data-col="lost">N<\/th>[\s\S]*<th class="is-num"\s+data-col="score">Becher<\/th>[\s\S]*<th class="is-num"\s+data-col="diff">Diff<\/th>[\s\S]*<th class="is-num"\s+data-col="points">Pkt\.<\/th>/,
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

  it('zeigt Haken für qualifizierte Reihen (Bug 14: Haken in der Rank-Zelle, nicht eigener Spalte)', () => {
    const html = renderBestThirdsTable(sample);
    // Genau 2 Reihen bekommen die is-qualified-Klasse — der Haken
    // wird per ::after an die Rank-Zelle gehängt, nicht als <td>.
    const qualifiedRows = (html.match(/<tr class="t-thirds-row is-qualified">/g) || []);
    expect(qualifiedRows.length).toBe(2);
    const outRows = (html.match(/<tr class="t-thirds-row is-out">/g) || []);
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
          teamId: 'X', name: 'Team <script>', groupKey: 'A',
          played: 1, won: 0, drawn: 0, lost: 1,
          goalsFor: 1, goalsAgainst: 2, goalDiff: -1, points: 0,
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
          teamId: 'P', name: 'Plus', groupKey: 'A',
          played: 2, won: 2, drawn: 0, lost: 0,
          goalsFor: 5, goalsAgainst: 1, goalDiff: 4, points: 6,
        },
        {
          teamId: 'Z', name: 'Zero', groupKey: 'B',
          played: 2, won: 1, drawn: 0, lost: 1,
          goalsFor: 3, goalsAgainst: 3, goalDiff: 0, points: 3,
        },
        {
          teamId: 'N', name: 'Neg', groupKey: 'C',
          played: 2, won: 0, drawn: 0, lost: 2,
          goalsFor: 1, goalsAgainst: 5, goalDiff: -4, points: 0,
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
    teamId: 'A3', name: 'Team Alpha-Drei', groupKey: 'A',
    played: 3, won: 2, drawn: 1, lost: 0,
    goalsFor: 12, goalsAgainst: 10, goalDiff: 2, points: 7,
    qualifies: true,
  };
  const sample = { qualifyCount: 1, rows: [row] };

  afterEach(() => setCompactMode(false));

  it('Desktop: 10 <col> für 10 sichtbare Spalten', () => {
    setCompactMode(false);
    const cols = (renderBestThirdsTable(sample).match(/<col style="width:[^"]+">/g) || []);
    expect(cols).toHaveLength(10);
  });

  it('Mobile: 6 <col> für 6 sichtbare Spalten (Sp/S/U/N sind versteckt)', () => {
    setCompactMode(true);
    const cols = (renderBestThirdsTable(sample).match(/<col style="width:[^"]+">/g) || []);
    expect(cols).toHaveLength(6);
  });

  it('Mobile: exakte Breiten in DOM-Reihenfolge Pl · Team · Gruppe · Becher · Diff · Pkt', () => {
    setCompactMode(true);
    const cols = (renderBestThirdsTable(sample).match(/<col style="width:([^"]+)">/g) || [])
      .map((c) => c.match(/width:([^"]+)"/)[1]);
    expect(cols).toEqual(['12%', '28%', '19%', '19%', '11%', '11%']);
  });

  it('Mobile: Summe der Breiten ist genau 100% und es gibt kein auto', () => {
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    const cols = (html.match(/<col style="width:([^"]+)">/g) || [])
      .map((c) => c.match(/width:([^"]+)"/)[1]);
    expect(html).not.toMatch(/<col[^>]*width:auto/);
    const sum = cols.reduce((acc, w) => acc + parseFloat(w), 0);
    expect(sum).toBe(100);
  });

  it('Mobile: keine Geister-Breiten der versteckten Zahlenspalten mehr', () => {
    // 10% war im kaputten 7er-Set die Breite, die auf "Becher" rutschte;
    // 18% und 13% die verschobenen Nachbarn. Keiner der drei Werte kommt
    // im korrigierten Set vor.
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    expect(html).not.toContain('width:10%');
    expect(html).not.toContain('width:18%');
    expect(html).not.toContain('width:8%');
    expect(html).not.toContain('width:13%');
  });

  it('Mobile: "12:10" wird gerendert und die Becher-Spalte hat 16%', () => {
    // 19% der Becher-Spalte: 55px bei 288px Tabellenbreite (390px Viewport),
    // 49px bei 258px (360px Viewport). "12:10" braucht gemessen 44px, die
    // Ueberschrift "BECHER" 48px — beides passt in beiden Faellen.
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    expect(html).toContain('12:10');
    expect(html).toContain('width:19%');
  });

  it('Mobile-Spaltenzahl passt zur Zahl der nicht versteckten data-col-Spalten', () => {
    // Bindet die Colgroup-Länge an das Markup statt an eine Konstante:
    // main.css versteckt auf ≤600px genau played/won/drawn/lost.
    const HIDDEN_ON_MOBILE = ['played', 'won', 'drawn', 'lost'];
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    const thead = html.match(/<thead>[\s\S]*?<\/thead>/)[0];
    const ths = thead.match(/<th\s[^>]*>/g) || [];
    const visible = ths.filter((th) => {
      const m = th.match(/data-col="([^"]+)"/);
      return !m || !HIDDEN_ON_MOBILE.includes(m[1]);
    });
    const cols = (html.match(/<col style="width:[^"]+">/g) || []);
    // Nicht leer-gegen-leer vergleichen: der Test soll fehlschlagen, wenn
    // die Regex nichts findet, nicht stillschweigend 0 === 0 bestaetigen.
    expect(visible).toHaveLength(6);
    expect(cols).toHaveLength(visible.length);
  });
});
