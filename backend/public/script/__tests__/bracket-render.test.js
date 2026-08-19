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
 *
 * Bug-16-NACHSCHLAG-2 (2026-08-19): HORIZONTALES Card-Layout
 * (Team-A · Score · Team-B in einer Zeile statt untereinander).
 * User-Direktive: "egal welches Handy, schön und vollständig". Vertikales
 * Layout brauchte 90px min-height und wirkte auf Mobile leer. Horizontal
 * hält die Card ~52px hoch, Score zentral prominent, Name schrumpft mit
 * ellipsis. Sieger wird fett markiert, Verlierer grau. Meta-Zeile
 * ("Beendet" oder "14:30 · Platte 2") nur wenn sinnvoll — leerer String
 * bei offenen Matches ohne Zeit/Platte (früher "–" als Platzhalter).
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
  it('HORIZONTAL-Layout (Bug-16-Nachschlag-2): Team A · Score · Team B in einer Zeile', () => {
    const m = makeKoMatch({
      home: { kind: 'team', name: 'Heimteam A', color: '#abc' },
      away: { kind: 'team', name: 'Gastteam B', color: '#def' },
      scoreHome: 2, scoreAway: 1,
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('t-match--bracket');
    expect(html).toContain('Heimteam A');
    expect(html).toContain('Gastteam B');
    // Score-Wrap existiert: enthält home-score, ":", away-score.
    expect(html).toContain('data-area="score"');
    expect(html).toContain('t-match-score-sep');
    expect(html).toContain('data-area="home-score">2</span>');
    expect(html).toContain('data-area="away-score">1</span>');
    // Kein kombinierter "2 : 1" String im HTML
    expect(html).not.toContain('>2 : 1<');
    expect(html).not.toContain('t-match--placeholder');
    expect(html).not.toContain('empty');
  });

  it('offenes Match zeigt zwei "–" als Scores (NICHT kombinierter "– : –")', () => {
    const m = makeKoMatch({ scoreHome: null, scoreAway: null });
    const html = renderMatchCardBracket(m);
    // Score ist jetzt <span>, nicht <div>. Wichtig ist nur: leerer Slot,
    // getrennte Spans, kein "– : –" als kombinierter String.
    expect(html).toContain('class="t-match-score empty" data-area="home-score">–</span>');
    expect(html).toContain('class="t-match-score empty" data-area="away-score">–</span>');
    expect(html).not.toContain('>– : –<');
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

  it('beendet-Match mit Score rendert "Beendet" in Meta-Zeile + Sieger-Highlighting', () => {
    const m = makeKoMatch({
      scoreHome: 3, scoreAway: 2, isFinished: true,
      scheduledTime: '14:30', field: 2,
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('Beendet');
    expect(html).toContain('t-match--done');
    expect(html).not.toContain('14:30');
    expect(html).not.toContain('Platte 2');
    // Sieger bekommt is-winner Klasse, Verlierer nicht
    expect(html).toContain('class="t-match-team is-winner" data-area="home"');
    expect(html).toContain('data-area="away"');
    expect(html).toContain('t-match--home-wins');
    expect(html).not.toContain('t-match--away-wins');
  });

  it('offenes Match mit scheduledTime + field rendert "14:30 · Platte 2"', () => {
    const m = makeKoMatch({
      scheduledTime: '14:30', field: 2,
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('14:30 · Platte 2');
    expect(html).not.toContain('Beendet');
  });

  it('offenes Match ohne Zeit/Platte: Meta-Zeile wird komplett weggelassen (kein leeres "–")', () => {
    // Bug-16-Nachschlag-2: kein "–"-Platzhalter mehr. Wenn weder Zeit
    // noch "Beendet" gesetzt sind, fehlt die Meta-Zeile einfach — die
    // Card ist dann 2 Zeilen hoch statt 3, wirkt ruhiger.
    const m = makeKoMatch({ scheduledTime: null, field: null });
    const html = renderMatchCardBracket(m);
    expect(html).not.toContain('data-area="meta"');
    expect(html).not.toContain('t-match-meta-line');
  });

  it('Unentschieden zeigt keine is-winner-Klasse auf einem der Teams', () => {
    const m = makeKoMatch({
      scoreHome: 2, scoreAway: 2, isFinished: true,
    });
    const html = renderMatchCardBracket(m);
    expect(html).toContain('t-match--done');
    expect(html).not.toContain('is-winner');
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
    expect(html).toContain('data-area="score"');
    expect(html).toContain('data-area="home-score"');
    expect(html).toContain('data-area="away-score"');
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

  it('3RD-Match liegt INNERHALB der Finale-Spalte (Bug-16-Nachschlag 2026-08-19)', () => {
    // User-Korrektur 2026-08-19: "3RD gehört in die Finale-Spalte, unter
    // das Finale, mit der kleinen Beschriftung darüber. Auf dem Handy
    // komme ich aktuell gar nicht hin — es fehlt in der Tab-Leiste.
    // Wenn es in der Finale-Spalte sitzt, löst sich das von selbst."
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
    // 3RD-Block heißt jetzt .bracket-3rd (nicht mehr .bracket-3rd-row)
    expect(html).toContain('bracket-3rd');
    expect(html).toContain('Spiel um Platz 3');
    // 3RD-Block liegt INNERHALB der Final-Spalte: zwischen
    // data-bracket-col="Finale" und der Halbfinal-Spalte (die im DOM
    // davor kommt) muss die 3RD-Card erscheinen.
    const idxFinalCol = html.indexOf('data-bracket-col="Finale"');
    const idxFCard = html.indexOf('data-match-id="f1"');
    const idx3rdCard = html.indexOf('data-match-id="3rd_1"');
    expect(idxFinalCol).toBeGreaterThan(-1);
    expect(idxFCard).toBeGreaterThan(idxFinalCol);
    expect(idx3rdCard).toBeGreaterThan(idxFCard);
    // 3RD-Card kommt NACH Final-Spalte aber VOR dem Wrapper-Close.
    // Da das die einzige Spalte mit 3RD-Block ist, ist diese Bedingung
    // sicher. (Echte Spalten-Lage testet der nächste Test.)
  });

  it('3RD-Block ist INNERHALB der Final-Spalte (kein Geschwister-Wrapper)', () => {
    // Sicherheitscheck: 3RD darf NICHT in einer eigenen 4. .bracket-col landen.
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
    // Es gibt 2 Winner-Bracket-Spalten (Halbfinale, Finale) — KEIN 3RD als 3. Spalte.
    // Wir bauen dafür die HTML-Struktur manuell nach, indem wir den String
    // zwischen Final-Spalte-Open und dem nächsten .bracket-col-Open prüfen.
    const finalColOpen = html.indexOf('data-bracket-col="Finale"');
    // Suche rückwärts den vorherigen .bracket-col-Open (= Halbfinale-Spalte).
    const prevColOpen = html.lastIndexOf('class="bracket-col"', finalColOpen);
    // Suche vorwärts den nächsten .bracket-col-Open — gibt es keinen,
    // endet die Final-Spalte am Schluss des Wrappers.
    const nextColOpen = html.indexOf('class="bracket-col"', finalColOpen + 1);
    // 3RD-Card-Index muss zwischen Final-Col-Open und nächstem .bracket-col-Open
    // liegen (oder am Ende, wenn keine weitere Spalte folgt).
    const idx3rdCard = html.indexOf('data-match-id="3rd_1"');
    expect(idx3rdCard).toBeGreaterThan(finalColOpen);
    if (nextColOpen > -1) {
      expect(idx3rdCard).toBeLessThan(nextColOpen);
    }
  });

  it('BUG-16-NACHSCHLAG (2026-08-19): KEIN Card hat margin-top (Konvergenz raus)', () => {
    // User-Korrektur 2026-08-19: "Vier normale Spalten nebeneinander, jede
    // mit ihren Karten. KEINE Konvergenz-Rechnung, kein grid-row span."
    const matches = [
      makeKoMatch({ id: 'qf1', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'qf2', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'sf2', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale', bracketPos: 1 }),
    ];
    const html = renderBracket(matches);
    // Auf keiner Card darf margin-top im style-Attribut stehen.
    expect(html).not.toMatch(/data-match-id="[^"]+"[^>]*margin-top/);
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

  it('8er-Baum: keine inline grid-column/grid-row und kein margin-top (Bug-16-Nachschlag Architektur-Reset)', () => {
    // Doppelte Sicherheit: weder grid-column/grid-row (alte display:contents-
    // Architektur) noch margin-top (Konvergenz-Architektur) im Output.
    const matches = [
      makeKoMatch({ id: 'qf1', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'qf2', round: 'QF', roundLabel: 'Viertelfinale', bracketPos: 2 }),
      makeKoMatch({ id: 'sf1', round: 'SF', roundLabel: 'Halbfinale', bracketPos: 1 }),
      makeKoMatch({ id: 'f1',  round: 'F',  roundLabel: 'Finale', bracketPos: 1 }),
    ];
    const html = renderBracket(matches);
    expect(html).not.toContain('grid-column:');
    expect(html).not.toContain('grid-row:');
    expect(html).not.toMatch(/data-match-id="[^"]+"[^>]*margin-top/);
  });
});
