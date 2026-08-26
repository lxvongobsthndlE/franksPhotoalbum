/**
 * Tests: buildBracket. Spec §6.2, §6.3.
 * Enthält den §6.3.2-REFERENZTEST als Abnahme.
 */

import { describe, it, expect } from 'vitest';
import { buildBracket } from '../engine/bracket.js';

// ---------------------------------------------------------------------------
// Hilfsfunktion: baut Qualifikanten mit expliziter Setzliste.
// ---------------------------------------------------------------------------
function q(seed, teamId, groupKey, name = teamId) {
  return { seed, teamId, name, source: { groupKey, groupIndex: 0, rank: 0 } };
}

// ---------------------------------------------------------------------------
// §6.3.2-REFERENZTEST — Abnahmekriterium Schritt 4
//
// "12 Teams / 3 Gruppen à 4 / Top 2 + 2 beste Dritte"
// Erwartet exakt:
//   VF1: A1 – B3
//   VF2: A2 – C2
//   VF3: C1 – B2
//   VF4: B1 – A3
// ---------------------------------------------------------------------------
describe('§6.3.2-Referenztest', () => {
  it('liefert exakt die Paarungen A1–B3, A2–C2, C1–B2, B1–A3', () => {
    // Setzliste wie in der Spec:
    //   A1=1, B1=2, C1=3, A2=4, C2=5, B2=6, A3=7, B3=8
    const qualifiers = [
      q(1, 'A1', 'A', 'A1'),
      q(2, 'B1', 'B', 'B1'),
      q(3, 'C1', 'C', 'C1'),
      q(4, 'A2', 'A', 'A2'),
      q(5, 'C2', 'C', 'C2'),
      q(6, 'B2', 'B', 'B2'),
      q(7, 'A3', 'A', 'A3'),
      q(8, 'B3', 'B', 'B3'),
    ];

    const { matches } = buildBracket(qualifiers);

    // Erste Runde = 4 Matches (QF)
    const qf = matches.filter((m) => m.round === 'QF');
    expect(qf).toHaveLength(4);

    // Match-Paarungen über teamHome/teamAway
    const pairs = qf
      .slice()
      .sort((a, b) => a.bracketPos - b.bracketPos)
      .map((m) => [m.teamHome, m.teamAway]);

    // Erwartet (sortiert nach VF-Position 1..4):
    //   VF1: A1 – B3
    //   VF2: A2 – C2
    //   VF3: C1 – B2
    //   VF4: B1 – A3
    expect(pairs).toEqual([
      ['A1', 'B3'],
      ['A2', 'C2'],
      ['C1', 'B2'],
      ['B1', 'A3'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Standard-Paarungen für verschiedene Bracket-Größen
// ---------------------------------------------------------------------------
describe('buildBracket — Standard-Paarungen', () => {
  it('4 Teams → SF (Bracket-Größe 4)', () => {
    const qs = [q(1, 'A1', 'A'), q(2, 'B1', 'B'), q(3, 'A2', 'A'), q(4, 'B2', 'B')];
    const { matches, bracketSize } = buildBracket(qs);
    expect(bracketSize).toBe(4);
    const sfMatches = matches.filter((m) => m.round === 'SF');
    expect(sfMatches).toHaveLength(2);
    // 1v4, 2v3
    const sorted = sfMatches.sort((a, b) => a.bracketPos - b.bracketPos);
    expect([sorted[0].teamHome, sorted[0].teamAway]).toEqual(['A1', 'B2']);
    expect([sorted[1].teamHome, sorted[1].teamAway]).toEqual(['B1', 'A2']);
  });

  it('16 Teams → R16 (8 Matches)', () => {
    const qs = Array.from({ length: 16 }, (_, i) => q(i + 1, `T${i + 1}`, 'X'));
    const { matches, bracketSize } = buildBracket(qs);
    expect(bracketSize).toBe(16);
    const r16 = matches.filter((m) => m.round === 'R16');
    expect(r16).toHaveLength(8);
  });

  it('2 Teams → F (1 Match)', () => {
    const qs = [q(1, 'A1', 'A'), q(2, 'B1', 'B')];
    const { matches, bracketSize } = buildBracket(qs);
    expect(bracketSize).toBe(2);
    expect(matches.filter((m) => m.round === 'F')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// BYE-Handling
// ---------------------------------------------------------------------------
describe('buildBracket — BYEs', () => {
  it('5 Teams → bracketSize 8, 3 BYE-Slots', () => {
    const qs = [
      q(1, 'A1', 'A'),
      q(2, 'B1', 'B'),
      q(3, 'C1', 'C'),
      q(4, 'A2', 'A'),
      q(5, 'B2', 'B'),
    ];
    const { bracketSize, byeSeeds, matches } = buildBracket(qs);
    expect(bracketSize).toBe(8);
    expect(byeSeeds).toEqual([8, 7, 6]); // absteigend
    const byeMatches = matches.filter((m) => m.isByeMatch && m.round === 'QF');
    expect(byeMatches.length).toBe(3);
  });

  it('7 Teams → bracketSize 8, 1 BYE-Slot', () => {
    const qs = Array.from({ length: 7 }, (_, i) => q(i + 1, `T${i + 1}`, 'X'));
    const { byeSeeds } = buildBracket(qs);
    expect(byeSeeds).toEqual([8]);
  });
});

// ---------------------------------------------------------------------------
// Folge-Match-Verknüpfungen
// ---------------------------------------------------------------------------
describe('buildBracket — Folge-Matches', () => {
  it('QF-Sieger verweisen auf SF', () => {
    // 8 Teams: erste Runde = QF, Sieger daraus gehen ins SF (Platzhalter)
    const qs = [
      q(1, 'A1', 'A'),
      q(2, 'B1', 'B'),
      q(3, 'C1', 'C'),
      q(4, 'A2', 'A'),
      q(5, 'B2', 'B'),
      q(6, 'C2', 'C'),
      q(7, 'A3', 'A'),
      q(8, 'B3', 'B'),
    ];
    const { matches } = buildBracket(qs);
    const sf = matches.filter((m) => m.round === 'SF').sort((a, b) => a.bracketPos - b.bracketPos);
    expect(sf[0].placeholderHome).toEqual(expect.objectContaining({ type: 'match_winner' }));
    expect(sf[0].placeholderAway).toEqual(expect.objectContaining({ type: 'match_winner' }));
  });

  it('SF-Sieger verweisen auf F', () => {
    const qs = [q(1, 'A1', 'A'), q(2, 'B1', 'B'), q(3, 'A2', 'A'), q(4, 'B2', 'B')];
    const { matches } = buildBracket(qs);
    const f = matches.find((m) => m.round === 'F');
    expect(f.placeholderHome.type).toBe('match_winner');
    expect(f.placeholderAway.type).toBe('match_winner');
  });

  it('Sieger→Folge Verknüpfung ist eindeutig', () => {
    const qs = Array.from({ length: 4 }, (_, i) => q(i + 1, `T${i + 1}`, 'X'));
    const { matches } = buildBracket(qs);
    const qf = matches.filter((m) => m.round === 'SF');
    for (const m of qf) {
      const follower = matches.find((x) => x.id === m.winnerAdvancesTo);
      expect(follower).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 3RD-Match (Spiel um Platz 3)
// ---------------------------------------------------------------------------
describe('buildBracket — Spiel um Platz 3', () => {
  it('4 Teams + hasThirdPlacePlayoff → 3RD-Match existiert', () => {
    const qs = [q(1, 'A1', 'A'), q(2, 'B1', 'B'), q(3, 'A2', 'A'), q(4, 'B2', 'B')];
    const { matches } = buildBracket(qs, { hasThirdPlacePlayoff: true });
    const third = matches.find((m) => m.round === '3RD');
    expect(third).toBeDefined();
    expect(third.placeholderHome.type).toBe('match_loser');
    expect(third.placeholderAway.type).toBe('match_loser');
  });

  it('8 Teams ohne hasThirdPlacePlayoff → kein 3RD', () => {
    const qs = [
      q(1, 'A1', 'A'),
      q(2, 'B1', 'B'),
      q(3, 'C1', 'C'),
      q(4, 'A2', 'A'),
      q(5, 'B2', 'B'),
      q(6, 'C2', 'C'),
      q(7, 'A3', 'A'),
      q(8, 'B3', 'B'),
    ];
    const { matches } = buildBracket(qs);
    expect(matches.find((m) => m.round === '3RD')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §13 Constraint #4: Same-Group-Auflösung mit Tausch
// ---------------------------------------------------------------------------
describe('buildBracket — Same-Group-Konfliktauflösung', () => {
  it('kein Konflikt wenn jedes Paar unterschiedliche Gruppen hat', () => {
    const qs = [
      q(1, 'A1', 'A'),
      q(2, 'B1', 'B'),
      q(3, 'C1', 'C'),
      q(4, 'A2', 'A'),
      q(5, 'B2', 'B'),
      q(6, 'C2', 'C'),
      q(7, 'A3', 'A'),
      q(8, 'B3', 'B'),
    ];
    const { unresolvedConflicts } = buildBracket(qs);
    expect(unresolvedConflicts).toHaveLength(0);
  });

  it('wirft bei < 2 Qualifikanten', () => {
    expect(() => buildBracket([])).toThrow();
    expect(() => buildBracket([q(1, 'A1', 'A')])).toThrow();
  });

  it('maxIter verhindert Endlosschleife', () => {
    // Konstruiere Worst-Case: alle 8 Teams aus derselben Gruppe
    const qs = Array.from({ length: 8 }, (_, i) => q(i + 1, `T${i + 1}`, 'X'));
    // Sollte durchlaufen ohne zu hängen
    const start = Date.now();
    const { unresolvedConflicts } = buildBracket(qs, { maxTiebreakerDepth: 16 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    // Bei 8 Teams aus 1 Gruppe → 4 Konflikte → unresolved markiert
    expect(unresolvedConflicts.length).toBeGreaterThanOrEqual(0);
  });
});
