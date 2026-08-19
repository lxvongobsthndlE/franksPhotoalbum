/**
 * Etappe B.4 — Turnierbaum-Renderer Tests.
 *
 * Diese Tests prüfen die Pure-Functions aus spielplan-helpers.js:
 *   - groupMatchesByRound: Erkennung 3RD via round==='3RD' (NICHT
 *     bracketType), Runden-Reihenfolge über KO_ROUND_ORDER (sodass
 *     Freilose nicht zu Fehl-Sortierung führen).
 *   - renderMatchCardBracket: home.name / away.name sind bereits
 *     resolved, KEIN Zugriff auf winnerLabel/loserLabel (die meinen
 *     das Folge-Match-Label, nicht den aktuellen Slot-Text).
 *   - renderBracket: Top-Level-Wrapper mit Grid + 3RD-Zeile.
 *
 * Hintergrund: Der Bracket-Tab ist neu in Etappe B.4. Die Renderer-
 * Logik greift tief in das DTO aus access/match.js, und mehrere
 * DTO-Felder sind NICHT was sie auf den ersten Blick scheinen
 * (3RD hat bracketType='winner', nicht 'loser'; home.name ist bei
 * Placeholder-Slots bereits via resolvePlaceholder() aufgelöst).
 * Diese Datei sichert die richtige Verwendung ab.
 */

import { describe, it, expect } from 'vitest';
import {
  bracket,
} from '../spielplan-helpers.js';

const { groupMatchesByRound, renderMatchCardBracket, renderBracket } = bracket;

// ── Hilfsfabrik: minimaler KO-Match-Stub.
function makeKoMatch(overrides = {}) {
  return {
    id: 'ko-match-1',
    round: 'QF',
    roundLabel: 'Viertelfinale',
    bracketType: 'winner',
    bracketPos: 1,
    home: { kind: 'team', teamId: 't1', name: 'Heimteam A', color: '#abc' },
    away: { kind: 'team', teamId: 't2', name: 'Gastteam B', color: '#def' },
    scoreHome: null,
    scoreAway: null,
    isFinished: false,
    isLive: false,
    isKoMatch: true,
    scheduledTime: '14:30',
    field: 2,
    // Diese Felder sind NICHT für den Slot-Text — der Renderer darf
    // sie nicht lesen (Bug-Fallen aus dem DTO-Verständnis).
    winnerLabel: null,
    loserLabel: null,
    winnerAdvancesToId: null,
    loserAdvancesToId: null,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// groupMatchesByRound
// ──────────────────────────────────────────────────────────────────────────
describe('groupMatchesByRound', () => {
  it('leere Liste → winnerBracket leer, thirdPlace null', () => {
    const out = groupMatchesByRound([]);
    expect(out.winnerBracket).toEqual([]);
    expect(out.thirdPlace).toBeNull();
  });

  it('null/undefined Eingabe → leeres Ergebnis ohne Crash', () => {
    expect(groupMatchesByRound(null)).toEqual({ winnerBracket: [], thirdPlace: null });
    expect(groupMatchesByRound(undefined)).toEqual({ winnerBracket: [], thirdPlace: null });
  });

  it('8er-Baum (QF + SF + F) → 3 Spalten in Reihenfolge [QF, SF, F] (LINKS nach RECHTS)', () => {
    const matches = [
      makeKoMatch({ id: 'qf1', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'qf2', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'qf3', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 3 }),
      makeKoMatch({ id: 'qf4', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 4 }),
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'sf2', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale',       bracketPos: 1 }),
    ];
    const out = groupMatchesByRound(matches);
    expect(out.winnerBracket.map((r) => r.label)).toEqual([
      'Viertelfinale', 'Halbfinale', 'Finale',
    ]);
    expect(out.thirdPlace).toBeNull();
    expect(out.winnerBracket[0].matches.map((m) => m.id)).toEqual(['qf1', 'qf2', 'qf3', 'qf4']);
    expect(out.winnerBracket[1].matches.map((m) => m.id)).toEqual(['sf1', 'sf2']);
    expect(out.winnerBracket[2].matches.map((m) => m.id)).toEqual(['f1']);
  });

  it('16er-Baum (R16 + QF + SF + F) → 4 Spalten in Reihenfolge [Achtelfinale, Viertelfinale, Halbfinale, Finale]', () => {
    const r16 = Array.from({ length: 8 }, (_, i) =>
      makeKoMatch({ id: `r16_${i + 1}`, round: 'R16', roundLabel: 'Achtelfinale', bracketPos: i + 1 }));
    const qf = Array.from({ length: 4 }, (_, i) =>
      makeKoMatch({ id: `qf_${i + 1}`, round: 'QF', roundLabel: 'Viertelfinale', bracketPos: i + 1 }));
    const sf = Array.from({ length: 2 }, (_, i) =>
      makeKoMatch({ id: `sf_${i + 1}`, round: 'SF', roundLabel: 'Halbfinale', bracketPos: i + 1 }));
    const f  = [makeKoMatch({ id: 'f_1', round: 'F', roundLabel: 'Finale', bracketPos: 1 })];
    const out = groupMatchesByRound([...r16, ...qf, ...sf, ...f]);
    expect(out.winnerBracket.map((r) => r.label)).toEqual([
      'Achtelfinale', 'Viertelfinale', 'Halbfinale', 'Finale',
    ]);
  });

  it('Spiel um Platz 3 wird korrekt über round==="3RD" (NICHT bracketType) abgetrennt', () => {
    const matches = [
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'sf2', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale', bracketPos: 1 }),
      // DTO hat fälschlich bracketType='winner' (siehe bracket.js:407).
      // Unsere Erkennung nutzt round='3RD' — das MUSS funktionieren.
      makeKoMatch({
        id: '3rd_1', round: '3RD', roundLabel: 'Spiel um Platz 3',
        bracketType: 'winner', bracketPos: 1,
        home: { kind: 'placeholder', teamId: null, name: 'Verlierer HF 1', color: null },
        away: { kind: 'placeholder', teamId: null, name: 'Verlierer HF 2', color: null },
      }),
    ];
    const out = groupMatchesByRound(matches);
    expect(out.thirdPlace).not.toBeNull();
    expect(out.thirdPlace.id).toBe('3rd_1');
    expect(out.winnerBracket.map((r) => r.label)).toEqual(['Halbfinale', 'Finale']);
  });

  it('3RD mit bracketType="loser" wird auch gefunden (defensiv)', () => {
    const matches = [
      makeKoMatch({ id: 'f1', round: 'F', roundLabel: 'Finale', bracketPos: 1 }),
      makeKoMatch({
        id: '3rd_2', round: '3RD', roundLabel: 'Spiel um Platz 3',
        bracketType: 'loser', bracketPos: 1,
      }),
    ];
    const out = groupMatchesByRound(matches);
    expect(out.thirdPlace.id).toBe('3rd_2');
  });

  it('Matches innerhalb einer Runde werden nach bracketPos sortiert', () => {
    const matches = [
      makeKoMatch({ id: 'qf3', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 3 }),
      makeKoMatch({ id: 'qf1', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'qf4', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 4 }),
      makeKoMatch({ id: 'qf2', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 2 }),
    ];
    const out = groupMatchesByRound(matches);
    expect(out.winnerBracket[0].matches.map((m) => m.id)).toEqual(['qf1', 'qf2', 'qf3', 'qf4']);
  });

  it('Freilos-Turnier: 16er-Runde mit nur 6 statt 8 Matches bleibt in korrekter Reihenfolge', () => {
    // Realistisches Szenario: 14 Teams → 2 BYEs → R16 hat nur 6 Matches
    // (4 echte + 2 BYE-Spiele). Nach Anzahl-Matches zu sortieren wäre
    // eine Falle. KO_ROUND_ORDER hingegen liefert weiter [R16, QF, SF, F].
    const r16 = Array.from({ length: 6 }, (_, i) =>
      makeKoMatch({ id: `r16_${i + 1}`, round: 'R16', roundLabel: 'Achtelfinale', bracketPos: i + 1 }));
    const qf = Array.from({ length: 4 }, (_, i) =>
      makeKoMatch({ id: `qf_${i + 1}`, round: 'QF', roundLabel: 'Viertelfinale', bracketPos: i + 1 }));
    const sf = [makeKoMatch({ id: 'sf_1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
                makeKoMatch({ id: 'sf_2', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 2 })];
    const f  = [makeKoMatch({ id: 'f_1', round: 'F', roundLabel: 'Finale', bracketPos: 1 })];
    const out = groupMatchesByRound([...r16, ...qf, ...sf, ...f]);
    expect(out.winnerBracket.map((r) => r.label)).toEqual([
      'Achtelfinale', 'Viertelfinale', 'Halbfinale', 'Finale',
    ]);
    expect(out.winnerBracket[0].matches.length).toBe(6);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// renderMatchCardBracket
// ──────────────────────────────────────────────────────────────────────────
describe('renderMatchCardBracket', () => {
  it('team-Heim/team-Auswärts rendert beide Namen + getrennte Scores (User-Korrektur 2026-08-18)', () => {
    const m = makeKoMatch({
      home: { kind: 'team', name: 'Heimteam A', color: '#abc' },
      away: { kind: 'team', name: 'Gastteam B', color: '#def' },
      scoreHome: 2, scoreAway: 1,
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('t-match--bracket');
    expect(html).toContain('Heimteam A');
    expect(html).toContain('Gastteam B');
    // Wimbledon-/Champions-League-Pattern: getrennte Scores statt "2 : 1"
    expect(html).toContain('>2</div>');
    expect(html).toContain('>1</div>');
    expect(html).not.toContain('2 : 1');
    expect(html).not.toContain('t-match--placeholder');
    expect(html).not.toContain('empty');
  });

  it('offenes Match zeigt zwei "–" als Scores (NICHT "– : –")', () => {
    const m = makeKoMatch({ scoreHome: null, scoreAway: null });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('class="t-match-score empty">–</div>');
    expect(html).not.toContain('– : –');
  });

  it('placeholder-Heim rendert home.name ("Sieger VF 1") kursiv (via t-match--placeholder Klasse)', () => {
    const m = makeKoMatch({
      round: 'SF', roundLabel: 'Halbfinale',
      home: { kind: 'placeholder', teamId: null, name: 'Sieger VF 1', color: null },
      away: { kind: 'placeholder', teamId: null, name: 'Sieger VF 2', color: null },
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('Sieger VF 1');
    expect(html).toContain('Sieger VF 2');
    expect(html).toContain('t-match--placeholder');
    expect(html).toContain('t-dot--placeholder');
  });

  it('3RD-Match rendert "Verlierer HF 1" / "Verlierer HF 2" (NICHT "Sieger")', () => {
    const m = makeKoMatch({
      round: '3RD', roundLabel: 'Spiel um Platz 3',
      home: { kind: 'placeholder', teamId: null, name: 'Verlierer HF 1', color: null },
      away: { kind: 'placeholder', teamId: null, name: 'Verlierer HF 2', color: null },
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('Verlierer HF 1');
    expect(html).toContain('Verlierer HF 2');
    expect(html).not.toContain('Sieger HF');
  });

  it('beendet-Match mit Score rendert "Beendet" in Meta-Zeile', () => {
    const m = makeKoMatch({
      scoreHome: 3, scoreAway: 2, isFinished: true,
      scheduledTime: '14:30', field: 2,
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('Beendet');
    expect(html).toContain('t-match--done');
    expect(html).not.toContain('14:30');
    expect(html).not.toContain('Platte 2');
  });

  it('offenes Match mit scheduledTime + field rendert "14:30 · Platte 2"', () => {
    const m = makeKoMatch({
      scheduledTime: '14:30', field: 2,
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('14:30 · Platte 2');
    expect(html).not.toContain('Beendet');
  });

  it('offenes Match ohne Zeit/Platte rendert "–"', () => {
    const m = makeKoMatch({ scheduledTime: null, field: null });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('<div class="t-match-meta-line">–</div>');
  });

  it('XSS-Escape: <script> im Teamname wird escaped', () => {
    const m = makeKoMatch({
      home: { kind: 'team', name: '<script>alert(1)</script>', color: null },
    });
    const html = renderMatchCardBracket(m);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('Negativtest: liest NICHT m.winnerLabel/m.loserLabel (die meinen das Folge-Match)', () => {
    // Im DTO zeigen winnerLabel/loserLabel auf das Folge-Match. Wenn
    // der Renderer sie fälschlich für den Slot-Text benutzt, würde hier
    // "Sieger Finale" statt des echten Heimteam-Namens erscheinen.
    const m = makeKoMatch({
      home: { kind: 'team', name: 'Heimteam A', color: '#abc' },
      away: { kind: 'team', name: 'Gastteam B', color: '#def' },
      winnerLabel: 'Sieger Finale',
      loserLabel: 'Verlierer Finale',
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('Heimteam A');
    expect(html).toContain('Gastteam B');
    expect(html).not.toContain('Sieger Finale');
    expect(html).not.toContain('Verlierer Finale');
  });

  it('fehlende home/away Objekte führen zu "—" ohne Crash', () => {
    const m = { id: 'x', scoreHome: null, scoreAway: null, isFinished: false };
    const html = renderMatchCardBracket(m);
    expect(html).toContain('—');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// renderBracket
// ──────────────────────────────────────────────────────────────────────────
describe('renderBracket', () => {
  it('voller 8er-Baum → HTML enthält 3 .bracket-col, --bracket-cols:3, --bracket-rows:4, --bracket-3rd-col:3 (Finale-Spalte), alle 7 KO-Matches', () => {
    const matches = [
      makeKoMatch({ id: 'qf1', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'qf2', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'qf3', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 3 }),
      makeKoMatch({ id: 'qf4', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 4 }),
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'sf2', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale', bracketPos: 1 }),
    ];
    const html = renderBracket(matches);
    expect(html).toContain('bracket-wrap');
    expect(html).toContain('--bracket-cols:3');
    expect(html).toContain('--bracket-rows:4');                     // 4 Spiele in erster Runde (Viertelfinale)
    expect(html).toContain('--bracket-3rd-col:3');                   // Finale-Spalte (cols, NICHT cols-1)
    expect((html.match(/class="bracket-col"/g) || []).length).toBe(3);
    expect((html.match(/data-match-id="/g) || []).length).toBe(7);
    // Reihenfolge der Spaltenlabels: Viertelfinale zuerst, Finale zuletzt
    const labels = ['Viertelfinale', 'Halbfinale', 'Finale'];
    const indices = labels.map((l) => html.indexOf(`>${l}</div>`));
    expect(indices[0]).toBeGreaterThan(-1);
    expect(indices[0]).toBeLessThan(indices[1]);
    expect(indices[1]).toBeLessThan(indices[2]);
  });

  it('empty matches → Hinweistext "Der Turnierbaum erscheint..."', () => {
    expect(renderBracket([])).toContain('Der Turnierbaum erscheint, sobald die KO-Phase generiert wurde.');
    expect(renderBracket(null)).toContain('Der Turnierbaum erscheint, sobald die KO-Phase generiert wurde.');
  });

  it('3RD-Match erscheint in separater .bracket-3rd-row DIREKT UNTER dem Finale (User-Korrektur 2026-08-18)', () => {
    const matches = [
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale', bracketPos: 1 }),
      makeKoMatch({
        id: '3rd_1', round: '3RD', roundLabel: 'Spiel um Platz 3',
        bracketType: 'winner', bracketPos: 1,
        home: { kind: 'placeholder', teamId: null, name: 'Verlierer HF 1', color: null },
        away: { kind: 'placeholder', teamId: null, name: 'Verlierer HF 2', color: null },
      }),
    ];
    const html = renderBracket(matches);
    expect(html).toContain('bracket-3rd-row');
    expect(html).toContain('Spiel um Platz 3');
    // 3RD-Reihenfolge im DOM: erst .bracket, dann .bracket-3rd-row
    const idxBracket = html.indexOf('class="bracket"');
    const idx3rd = html.indexOf('bracket-3rd-row');
    expect(idxBracket).toBeGreaterThan(-1);
    expect(idx3rd).toBeGreaterThan(idxBracket);
    // --bracket-3rd-col muss auf Finale-Spalte zeigen (= cols = 2 für 2-spaltigen Winner-Bracket)
    expect(html).toContain('--bracket-3rd-col:2');
  });

  it('Jede Card hat Inline grid-column UND grid-row (Bug-16 Architektur-Fix)', () => {
    const matches = [
      makeKoMatch({ id: 'qf1', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'qf2', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'qf3', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 3 }),
      makeKoMatch({ id: 'qf4', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 4 }),
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale', bracketPos: 1 }),
    ];
    const html = renderBracket(matches);
    // Spalte 1 (Viertelfinale): Cards in Zeilen 2..5 (Zeile 1 = Label)
    // Konvergenz rowSpan für Spalte 1 = 1, daher card row N = N+1.
    expect(html).toContain('grid-column:1; grid-row:2 / 3');  // qf1
    expect(html).toContain('grid-column:1; grid-row:3 / 4');  // qf2
    expect(html).toContain('grid-column:1; grid-row:4 / 5');  // qf3
    expect(html).toContain('grid-column:1; grid-row:5 / 6');  // qf4
    // Spalte 2 (Halbfinale, rowSpan=2): sf1 erstreckt sich über 2 Zeilen,
    // beginnend bei row 2 → grid-row: 2 / 4
    expect(html).toContain('grid-column:2; grid-row:2 / 4');
    // Spalte 3 (Finale, rowSpan=4): f1 erstreckt sich über 4 Zeilen,
    // beginnend bei row 2 → grid-row: 2 / 6
    expect(html).toContain('grid-column:3; grid-row:2 / 6');
  });

  it('bracket-tabs-Block mit einem Button pro Runde wird OBERHALB von .bracket-wrap gerendert (Mobile-Tab-Springer)', () => {
    const matches = [
      makeKoMatch({ id: 'qf1', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale', bracketPos: 1 }),
    ];
    const html = renderBracket(matches);
    expect(html).toContain('class="bracket-tabs"');
    expect((html.match(/class="bracket-tab"/g) || []).length).toBe(3);
    expect(html).toContain('data-bracket-tab="Viertelfinale"');
    expect(html).toContain('data-bracket-tab="Halbfinale"');
    expect(html).toContain('data-bracket-tab="Finale"');
    // Reihenfolge: bracket-tabs VOR bracket-wrap
    const idxTabs = html.indexOf('class="bracket-tabs"');
    const idxWrap = html.indexOf('class="bracket-wrap"');
    expect(idxTabs).toBeGreaterThan(-1);
    expect(idxTabs).toBeLessThan(idxWrap);
  });
});
