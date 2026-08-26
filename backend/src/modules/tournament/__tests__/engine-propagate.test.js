/**
 * Tests: propagateWinner, resetCascade, applyResult.
 * Spec §6.4.
 */

import { describe, it, expect } from 'vitest';
import { propagateWinner, resetCascade, applyResult } from '../engine/propagate.js';

describe('propagateWinner', () => {
  it('wirft wenn Match nicht beendet', () => {
    expect(() =>
      propagateWinner(
        { status: 'scheduled', teamHome: 'A', teamAway: 'B', scoreHome: 1, scoreAway: 0 },
        []
      )
    ).toThrow();
  });

  it('wirft wenn keine Scores', () => {
    expect(() =>
      propagateWinner(
        { status: 'finished', teamHome: 'A', teamAway: 'B', scoreHome: null, scoreAway: null },
        []
      )
    ).toThrow();
  });

  it('setzt Sieger in Folgematch home', () => {
    const all = [
      {
        id: 'm1',
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 2,
        scoreAway: 0,
        winnerAdvancesTo: 'm2',
        loserAdvancesTo: null,
        homeSeed: 1,
        awaySeed: 4,
      },
      {
        id: 'm2',
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        homeSeed: 1,
        awaySeed: 2,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ];
    const after = propagateWinner(all[0], all);
    const m2 = after.find((m) => m.id === 'm2');
    expect(m2.teamHome).toBe('A');
    expect(m2.teamAway).toBeNull();
  });

  it('setzt Sieger in Folgematch away', () => {
    const all = [
      {
        id: 'm1',
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 0,
        scoreAway: 3,
        winnerAdvancesTo: 'm2',
        loserAdvancesTo: null,
        homeSeed: 1,
        awaySeed: 4,
      },
      {
        id: 'm2',
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        homeSeed: 1,
        awaySeed: 2,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ];
    const after = propagateWinner(all[0], all);
    const m2 = after.find((m) => m.id === 'm2');
    expect(m2.teamHome).toBeNull();
    expect(m2.teamAway).toBe('B');
  });

  it('Unentschieden in KO → keine Propagation', () => {
    const all = [
      {
        id: 'm1',
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 2,
        scoreAway: 2,
        winnerAdvancesTo: 'm2',
        loserAdvancesTo: null,
        homeSeed: 1,
        awaySeed: 4,
      },
      {
        id: 'm2',
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        homeSeed: 1,
        awaySeed: 2,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ];
    const after = propagateWinner(all[0], all);
    const m2 = after.find((m) => m.id === 'm2');
    expect(m2.teamHome).toBeNull();
    expect(m2.teamAway).toBeNull();
  });

  it('mutiert Eingabe nicht', () => {
    const original = [
      {
        id: 'm1',
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 1,
        scoreAway: 0,
        winnerAdvancesTo: 'm2',
        loserAdvancesTo: null,
        homeSeed: 1,
        awaySeed: 4,
      },
      {
        id: 'm2',
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        homeSeed: 1,
        awaySeed: 2,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    propagateWinner(original[0], original);
    expect(original).toEqual(snapshot);
  });
});

describe('resetCascade', () => {
  // Bug-Fix (2026-08-18): Ältere Variante hat ALLE downstream-Matches
  // komplett geleert. Das war falsch für den Multi-Source-Fall
  // (siehe routes.real-db.test.js Test 5). Neue Logik: nur der Slot
  // wird geleert, den das Root-Match füllen würde; andere Slots
  // (von anderen Vormatches gefüllt) bleiben stehen. Bereits beendete
  // downstream-Matches werden komplett zurückgesetzt (ihr Score war
  // von Annahmen abhängig, die jetzt ungültig sind).
  it('leert nur den Root-Slot im downstream-Match — andere Slots bleiben stehen', () => {
    const all = [
      // root → next1 (winner), SF1 → final (winner).
      {
        id: 'root',
        bracketPos: 1,
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 1,
        scoreAway: 0,
        winnerAdvancesTo: 'next1',
        loserAdvancesTo: null,
      },
      // next1 hat teamHome='A' (von root) und teamAway='C' (von einem
      // anderen Vormatch). Reset darf nur teamHome leeren.
      {
        id: 'next1',
        bracketPos: 1,
        status: 'scheduled',
        teamHome: 'A',
        teamAway: 'C',
        scoreHome: null,
        scoreAway: null,
        winnerAdvancesTo: 'final',
        loserAdvancesTo: null,
      },
      // final ist noch leer.
      {
        id: 'final',
        bracketPos: 1,
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ];
    const after = resetCascade('root', all);
    // root unverändert.
    const root = after.find((m) => m.id === 'root');
    expect(root.teamHome).toBe('A');
    // next1: Root-Slot (home) geleert, Away-Slot ('C' von anderem Vormatch) bleibt.
    const n1 = after.find((m) => m.id === 'next1');
    expect(n1.teamHome).toBeNull(); // Root-Slot → geleert
    expect(n1.teamAway).toBe('C'); // anderer Vormatch → bleibt
    expect(n1.status).toBe('scheduled');
    // final: Root-Vom-Root-Transitive hat keinen direkten Slot von root,
    // also unverändert.
    const f = after.find((m) => m.id === 'final');
    expect(f.teamHome).toBeNull();
    expect(f.teamAway).toBeNull();
  });

  it('leert beendete downstream-Matches komplett (ihr Score ist ungültig)', () => {
    const all = [
      {
        id: 'root',
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 1,
        scoreAway: 0,
        winnerAdvancesTo: 'next1',
        loserAdvancesTo: null,
      },
      // next1 ist selbst schon beendet — sein Score muss komplett weg.
      {
        id: 'next1',
        status: 'finished',
        teamHome: 'A',
        teamAway: 'X',
        scoreHome: 2,
        scoreAway: 1,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ];
    const after = resetCascade('root', all);
    const n1 = after.find((m) => m.id === 'next1');
    expect(n1.teamHome).toBeNull();
    expect(n1.teamAway).toBeNull();
    expect(n1.scoreHome).toBeNull();
    expect(n1.scoreAway).toBeNull();
    expect(n1.status).toBe('scheduled');
  });

  it('mutiert Eingabe nicht', () => {
    const original = [
      {
        id: 'root',
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 1,
        scoreAway: 0,
        winnerAdvancesTo: 'next',
        loserAdvancesTo: null,
        homeSeed: 1,
        awaySeed: 4,
      },
      {
        id: 'next',
        status: 'scheduled',
        teamHome: 'X',
        teamAway: 'Y',
        scoreHome: 1,
        scoreAway: 1,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
        homeSeed: 1,
        awaySeed: 2,
      },
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    resetCascade('root', original);
    expect(original).toEqual(snapshot);
  });
});

describe('applyResult', () => {
  it('kombiniert Reset + Propagation', () => {
    const all = [
      {
        id: 'sf1',
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 1,
        scoreAway: 0,
        winnerAdvancesTo: 'final',
        loserAdvancesTo: null,
        homeSeed: 1,
        awaySeed: 4,
      },
      {
        id: 'sf2',
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        winnerAdvancesTo: 'final',
        loserAdvancesTo: null,
        homeSeed: 2,
        awaySeed: 3,
      },
      {
        id: 'final',
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ];
    const after = applyResult(all[0], all);
    const f = after.find((m) => m.id === 'final');
    // A ist Sieger von sf1 → kommt in Slot 'home' von final (weil homeSeed<awaySeed)
    expect(f.teamHome).toBe('A');
  });

  // Regression (Bug 2026-08-18): Zwei Halbfinals, beide abgeschlossen.
  // Der vorherige Algorithmus hat BEIDE Sieger in teamHome geschrieben
  // und sich gegenseitig überschrieben. Der User meldete: "Team 1 ist
  // korrekt im Finale. Team 2 nicht — dort steht weiterhin der
  // Platzhalter Sieger HF 2." Beide Sieger MÜSSEN ankommen, einer als
  // Heim, einer als Gast.
  it('Bug 6: 2 HFs finished → BEIDE Sieger landen im Finale (Heim + Gast)', () => {
    const sf1Finished = {
      id: 'sf1',
      round: 'SF',
      bracketPos: 1,
      status: 'finished',
      teamHome: 'T1',
      teamAway: 'T2',
      scoreHome: 2,
      scoreAway: 1,
      winnerAdvancesTo: 'final',
      loserAdvancesTo: null,
    };
    const sf2Finished = {
      id: 'sf2',
      round: 'SF',
      bracketPos: 2,
      status: 'finished',
      teamHome: 'T3',
      teamAway: 'T4',
      scoreHome: 2,
      scoreAway: 1,
      winnerAdvancesTo: 'final',
      loserAdvancesTo: null,
    };
    const finalBefore = {
      id: 'final',
      round: 'F',
      bracketPos: 1,
      status: 'scheduled',
      teamHome: null,
      teamAway: null,
      scoreHome: null,
      scoreAway: null,
      placeholderHome: { type: 'match_winner', matchLabel: 'HF 1' },
      placeholderAway: { type: 'match_winner', matchLabel: 'HF 2' },
      winnerAdvancesTo: null,
      loserAdvancesTo: null,
    };
    const all = [sf1Finished, sf2Finished, finalBefore];

    // Erst sf1 abschließen → T1 muss in teamHome.
    let after = applyResult(sf1Finished, all);
    let f = after.find((m) => m.id === 'final');
    expect(f.teamHome).toBe('T1');
    expect(f.teamAway).toBeNull();

    // Dann sf2 abschließen → T3 (Sieger von sf2) muss in teamAway landen.
    // WICHTIG: Wir müssen after in den State zurückschreiben, denn
    // applyResult gibt ein NEUES Array zurück.
    const after2 = applyResult(sf2Finished, after);
    const f2 = after2.find((m) => m.id === 'final');
    expect(f2.teamHome).toBe('T1'); // unverändert
    expect(f2.teamAway).toBe('T3'); // war vorher der Bug — überschrieben
  });

  // Regression 4-Team-Bracket: VFs → HFs. VF1+VF2 → HF1, VF3+VF4 → HF2.
  it('Bug 6: 4 VFs → 2 HFs → Finale (bracketPos-basiertes Mapping)', () => {
    const matches = [
      // Viertelfinale
      {
        id: 'qf1',
        bracketPos: 1,
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 2,
        scoreAway: 1,
        winnerAdvancesTo: 'sf1',
        loserAdvancesTo: null,
      },
      {
        id: 'qf2',
        bracketPos: 2,
        status: 'finished',
        teamHome: 'C',
        teamAway: 'D',
        scoreHome: 0,
        scoreAway: 2,
        winnerAdvancesTo: 'sf1',
        loserAdvancesTo: null,
      },
      {
        id: 'qf3',
        bracketPos: 3,
        status: 'finished',
        teamHome: 'E',
        teamAway: 'F',
        scoreHome: 3,
        scoreAway: 0,
        winnerAdvancesTo: 'sf2',
        loserAdvancesTo: null,
      },
      {
        id: 'qf4',
        bracketPos: 4,
        status: 'finished',
        teamHome: 'G',
        teamAway: 'H',
        scoreHome: 1,
        scoreAway: 2,
        winnerAdvancesTo: 'sf2',
        loserAdvancesTo: null,
      },
      // Halbfinale
      {
        id: 'sf1',
        bracketPos: 1,
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        winnerAdvancesTo: 'final',
        loserAdvancesTo: null,
      },
      {
        id: 'sf2',
        bracketPos: 2,
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        winnerAdvancesTo: 'final',
        loserAdvancesTo: null,
      },
      // Finale
      {
        id: 'final',
        bracketPos: 1,
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ];

    // VF1 abschließen → Sieger A geht in sf1.home.
    let state = matches;
    state = applyResult(
      state.find((m) => m.id === 'qf1'),
      state
    );
    let sf = state.find((m) => m.id === 'sf1');
    expect(sf.teamHome).toBe('A');

    // VF2 abschließen → Sieger D geht in sf1.away.
    state = applyResult(
      state.find((m) => m.id === 'qf2'),
      state
    );
    sf = state.find((m) => m.id === 'sf1');
    expect(sf.teamHome).toBe('A');
    expect(sf.teamAway).toBe('D');

    // VF3 abschließen → Sieger E geht in sf2.home.
    state = applyResult(
      state.find((m) => m.id === 'qf3'),
      state
    );
    const sf2 = state.find((m) => m.id === 'sf2');
    expect(sf2.teamHome).toBe('E');

    // VF4 abschließen → Sieger H geht in sf2.away.
    state = applyResult(
      state.find((m) => m.id === 'qf4'),
      state
    );
    const sf2After = state.find((m) => m.id === 'sf2');
    expect(sf2After.teamHome).toBe('E');
    expect(sf2After.teamAway).toBe('H');
  });

  // Regression 3RD-Playoff: HFs → Finale (winner) + Spiel um Platz 3 (loser).
  it('Bug 6: HF-Loser → 3RD-Playoff in korrektem Slot', () => {
    const matches = [
      {
        id: 'sf1',
        bracketPos: 1,
        status: 'finished',
        teamHome: 'A',
        teamAway: 'B',
        scoreHome: 2,
        scoreAway: 1,
        winnerAdvancesTo: 'final',
        loserAdvancesTo: 'third',
      },
      {
        id: 'sf2',
        bracketPos: 2,
        status: 'finished',
        teamHome: 'C',
        teamAway: 'D',
        scoreHome: 0,
        scoreAway: 2,
        winnerAdvancesTo: 'final',
        loserAdvancesTo: 'third',
      },
      {
        id: 'final',
        bracketPos: 1,
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
      {
        id: 'third',
        bracketPos: 1,
        status: 'scheduled',
        teamHome: null,
        teamAway: null,
        scoreHome: null,
        scoreAway: null,
        winnerAdvancesTo: null,
        loserAdvancesTo: null,
      },
    ];

    // SF1: A gewinnt → A in final.home, B in third.home.
    let state = applyResult(matches[0], matches);
    expect(state.find((m) => m.id === 'final').teamHome).toBe('A');
    expect(state.find((m) => m.id === 'third').teamHome).toBe('B');
    expect(state.find((m) => m.id === 'third').teamAway).toBeNull();

    // SF2: D gewinnt → D in final.away, C in third.away.
    state = applyResult(
      state.find((m) => m.id === 'sf2'),
      state
    );
    const f = state.find((m) => m.id === 'final');
    const t = state.find((m) => m.id === 'third');
    expect(f.teamHome).toBe('A');
    expect(f.teamAway).toBe('D');
    expect(t.teamHome).toBe('B');
    expect(t.teamAway).toBe('C');
  });
});
