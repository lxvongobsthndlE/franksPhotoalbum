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
 *   - renderBracket: Top-Level-Wrapper mit Flex-Spalten + 3RD-Row.
 *
 * Bug-16 (2026-08-19): Architektur wurde zurückgebaut von CSS-Grid +
 * grid-row span N auf echte Flex-Spalten-Container mit Konvergenz via
 * margin-top. Grund: display:contents auf .bracket-col + inline grid-column:1
 * auf allen Cards ließ alle Karten in Spalte 1 des Wrappers landeten.
 * Die Tests hier sind dem neuen Layout angepasst.
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
    expect(html).toContain('class="t-match-score empty" data-area="home-score">–</div>');
    expect(html).toContain('class="t-match-score empty" data-area="away-score">–</div>');
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
    expect(html).toContain('<div class="t-match-meta-line" data-area="meta">–</div>');
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

  it('BUG-16 (2026-08-19): Card verwendet data-area Attribute (KEIN nth-of-type)', () => {
    // Hintergrund: nth-of-type ist BRÜCHIG wenn alle Kinder divs sind
    // — die "erste Score" wäre dann das t-match-bar-Element. Das führte
    // zum "spiegelverkehrten" Layout-User-Bericht. Der Renderer setzt
    // jetzt data-area="home" / "away" / "home-score" / "away-score".
    const m = makeKoMatch({ scoreHome: 2, scoreAway: 1 });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('data-area="bar"');
    expect(html).toContain('data-area="home"');
    expect(html).toContain('data-area="away"');
    expect(html).toContain('data-area="home-score"');
    expect(html).toContain('data-area="away-score"');
    expect(html).toContain('data-area="meta"');
    // NICHT mehr nth-of-type-Selectoren im CSS — der Renderer verlässt
    // sich auf data-area, semantisch eindeutig.
  });
});

// ──────────────────────────────────────────────────────────────────────────
// renderBracket
// ──────────────────────────────────────────────────────────────────────────
describe('renderBracket', () => {
  it('voller 8er-Baum → HTML enthält 3 .bracket-col, --bracket-cols:3, alle 7 KO-Matches', () => {
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

  it('3RD-Match erscheint in separater .bracket-3rd-row UNTER dem Winner-Bracket', () => {
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
    // 3RD-Reihenfolge im DOM: nach den bracket-cols
    const idxFirstCol = html.indexOf('class="bracket-col"');
    const idx3rd = html.indexOf('bracket-3rd-row');
    expect(idx3rd).toBeGreaterThan(idxFirstCol);
  });

  it('BUG-16 (2026-08-19): Spalte-0-Cards haben KEIN margin-top (Stack-Via-Flex-Gap)', () => {
    const matches = [
      makeKoMatch({ id: 'qf1', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'qf2', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'qf3', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 3 }),
      makeKoMatch({ id: 'qf4', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 4 }),
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale', bracketPos: 1 }),
    ];
    const html = renderBracket(matches);
    // Spalte 0 (Viertelfinale): alle 4 Cards ohne margin-top
    // (sie stapeln per Flex-Column-Gap, das ist robuster als pixelbasiert)
    // Wir prüfen das, indem wir die qf1-Card isolieren und schauen, dass
    // KEIN style="margin-top..." in ihr steckt.
    const qf1Idx = html.indexOf('data-match-id="qf1"');
    const qf1NextIdx = html.indexOf('data-match-id="qf2"');
    const qf1Block = html.slice(qf1Idx, qf1NextIdx);
    expect(qf1Block).not.toContain('margin-top');
  });

  it('BUG-16 (2026-08-19): Spalte-1+ mIdx=0 hat margin-top = 0.5 step (mittig zwischen Source-Paar 0)', () => {
    // 8er-Baum: SF mIdx=0 soll mit margin-top = 0.5 step eingefügt werden
    // (Center der Card fällt auf halber Höhe zwischen VF1 und VF2).
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
    // sf1 (Spalte 1, mIdx=0): margin-top = 0.5 * step
    expect(html).toMatch(/data-match-id="sf1"[^>]*margin-top: calc\(var\(--bracket-card-step\) \* 0\.5\)/);
    // sf2 (Spalte 1, mIdx=1): margin-top = (2*1 + 0.5) * step = 2.5 * step
    expect(html).toMatch(/data-match-id="sf2"[^>]*margin-top: calc\(var\(--bracket-card-step\) \* 2\.5\)/);
    // f1 (Spalte 2, mIdx=0): margin-top = 0.5 * step
    expect(html).toMatch(/data-match-id="f1"[^>]*margin-top: calc\(var\(--bracket-card-step\) \* 0\.5\)/);
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

  it('8er-Baum: keine inline grid-column/grid-row mehr (Bug-16 Architektur-Reset)', () => {
    // Die alte Architektur (display:contents + grid-row: span N) ist tot.
    // Der Renderer setzt KEIN grid-column/grid-row mehr — die Spalten
    // sind jetzt echte Flex-Container, Konvergenz via margin-top.
    const matches = [
      makeKoMatch({ id: 'qf1', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'qf2', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale', bracketPos: 1 }),
    ];
    const html = renderBracket(matches);
    expect(html).not.toContain('grid-column:');
    expect(html).not.toContain('grid-row:');
  });
});
