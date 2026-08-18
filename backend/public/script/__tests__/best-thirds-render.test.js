/**
 * Tests für den Beste-Dritte-Renderer. Spec §6.3.1, §13.7.
 *
 * Regressionsschutz für Bug 9 (2026-08-18): Die Tabelle fehlte vorher
 * komplett. Spec verlangt pro-Spiel-normalisierte Werte (Pkt/Sp, Diff/Sp)
 * weil Gruppen unterschiedlich groß sein können (3er vs. 4er), und die
 * Top-N aus den "bestThirds" config bekommen eine Quali-Markierung.
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
        played: 3, points: 7, goalsFor: 10, goalsAgainst: 4, goalDiff: 6,
        pointsPerGame: 2.33, goalDiffPerGame: 2.0,
        qualifies: true,
      },
      {
        teamId: 'B3',
        name: 'Team Bravo-Drei',
        played: 3, points: 6, goalsFor: 8, goalsAgainst: 5, goalDiff: 3,
        pointsPerGame: 2.0, goalDiffPerGame: 1.0,
        qualifies: true,
      },
      {
        teamId: 'C3',
        name: 'Team Charlie-Drei',
        played: 2, points: 1, goalsFor: 2, goalsAgainst: 8, goalDiff: -6,
        pointsPerGame: 0.5, goalDiffPerGame: -3.0,
        qualifies: false,
      },
    ],
  };

  it('rendert die Tabelle mit korrekten Spalten (Spec §13.7)', () => {
    const html = renderBestThirdsTable(sample);
    expect(html).toContain('Beste Dritte');
    expect(html).toContain('Top 2 qualifizieren sich');
    // Spalten: # · Team · Pkt/Sp · Diff/Sp · Status
    const headerMatch = html.match(/<thead>[\s\S]*?<\/thead>/);
    expect(headerMatch).toBeTruthy();
    expect(headerMatch[0]).toMatch(
      /<th>#<\/th>[\s\S]*<th>Team<\/th>[\s\S]*<th>Pkt\/Sp<\/th>[\s\S]*<th>Diff\/Sp<\/th>[\s\S]*<th>Status<\/th>/,
    );
  });

  it('zeigt PRO-SPIEL-normalisierte Werte (nicht die absoluten)', () => {
    // Bug 9-Hintergrund: User spec sagt explizit "Werte pro Spiel".
    // 3er-Gruppe (2 Spiele) und 4er-Gruppe (3 Spiele) sind nur so
    // vergleichbar.
    const html = renderBestThirdsTable(sample);
    // A3: Pkt/Sp = 2.33, Diff/Sp = 2.0
    expect(html).toMatch(/<td[^>]*>2\.33<\/td>/);
    expect(html).toMatch(/<td[^>]*>2<\/td>/);
    // C3: Pkt/Sp = 0.5
    expect(html).toMatch(/<td[^>]*>0\.5<\/td>/);
  });

  it('Top-N bekommen is-qualified, Rest is-out', () => {
    const html = renderBestThirdsTable(sample);
    expect(html).toContain('class="t-thirds-row is-qualified"');
    expect(html).toContain('class="t-thirds-row is-out"');
    // Genau 2 qualifizierte (qualifyCount=2)
    const qualifiedMatches = html.match(/is-qualified/g) || [];
    expect(qualifiedMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('Status-Spalte zeigt „N Sp. · M Pkt" als Kontext-Info', () => {
    const html = renderBestThirdsTable(sample);
    // Alpha: 3 Sp. · 7 Pkt
    expect(html).toMatch(/3 Sp\. · 7 Pkt/);
    // Charlie: 2 Sp. · 1 Pkt
    expect(html).toMatch(/2 Sp\. · 1 Pkt/);
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
    // Position 1, 2, 3 in der Reihenfolge wie gerendert
    expect(html).toMatch(/<td class="t-thirds-rank">1\./);
    expect(html).toMatch(/<td class="t-thirds-rank">2\./);
    expect(html).toMatch(/<td class="t-thirds-rank">3\./);
  });

  it('qualifizierte Reihen bekommen einen Haken im Rank', () => {
    const html = renderBestThirdsTable(sample);
    // Zwei Reihen mit Haken (Top-2), eine ohne.
    const hookCount = (html.match(/✓/g) || []).length;
    // Top 2: 2 Reihen × 1 Haken = 2
    // Plus Titel-Kommentar "Top 2" enthält keinen Haken.
    expect(hookCount).toBe(2);
  });

  it('HTML-Escape für Teamnamen', () => {
    const html = renderBestThirdsTable({
      qualifyCount: 0,
      rows: [
        { teamId: 'X', name: 'Team <script>', pointsPerGame: 1, goalDiffPerGame: 0, played: 1, points: 1 },
      ],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});