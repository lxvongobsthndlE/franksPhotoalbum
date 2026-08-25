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

import { describe, it, expect } from 'vitest';
import { renderBestThirdsTable } from '../spielplan-helpers.js';

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
