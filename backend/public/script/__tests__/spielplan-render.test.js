/**
 * Etappe B.3 — Spielplan-Renderer Tests.
 *
 * Diese Tests prüfen die Pure-Functions aus spielplan-helpers.js:
 *   - sortMatchesBySchedule: stabile Sortierung nach Zeitplan
 *   - applySpielplanFilter: alle / offen / beendet / gruppe / ko / g:<id>
 *   - renderFilterChips: dynamische Chips, Counts aus UNGefilterter Liste
 *   - renderMatchCard: DTO → Karten-HTML (Admin/Member-Gating,
 *     Sieger-Highlight, Score-Empty)
 *   - renderMatchCardCompact: Aside-Variante
 *   - renderMatchList: Wrapper mit Empty-Fallback
 *   - renderAsideNext / renderAsideTables: Top-N offene Spiele
 *
 * Was NICHT hier getestet wird (und warum):
 *   - renderSpielplan (DOM-Schreiber) — braucht jsdom oder
 *     DOM-Mocks. Bleibt als Integrations-Test dem Browser überlassen.
 *   - bindSpielplanInteractions (Event-Delegation) — dito.
 *
 * Hintergrund: Der Spielplan-Renderer ist in Etappe B komplett neu
 * geschrieben worden (v2-HTML-Tabelle → v3-Match-Karten mit Filtern).
 * Vorher war die Logik über mehrere Funktionen in main.js verstreut
 * und hatte mindestens drei Bugs:
 *   1. `m.status === 'completed'` statt `m.isFinished` (war ein
 *      v2-DTO-Feld, gibt's nicht mehr)
 *   2. `result.cascadeAffected` statt `result.propagated` (v3-API)
 *   3. leere Aktion-Spalte → unsichtbare Lücke im Grid
 * Diese Datei sichert die v3-Logik ab.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  sortMatchesBySchedule,
  applySpielplanFilter,
  renderFilterChips,
  renderMatchCard,
  renderMatchCardCompact,
  renderMatchList,
  renderAsideNext,
  renderAsideTables,
  renderBestThirdsTable,
  setCompactMode,
} from '../spielplan-helpers.js';

// ── Hilfsfabrik: minimaler Match-Stub, der zu den Feldern passt,
// die der Renderer tatsächlich liest. Wenn wir später ein Feld
// dazubekommen, knackt das hier — gewollt.
function makeMatch(overrides = {}) {
  return {
    id: 'm-1',
    home: { name: 'Heim', color: '#abc' },
    away: { name: 'Gast', color: '#def' },
    scoreHome: null,
    scoreAway: null,
    isFinished: false,
    isLive: false,
    isGroupMatch: false,
    isKoMatch: false,
    groupId: null,
    field: 1,
    scheduledAt: '2026-09-12T10:00:00Z',
    scheduledTime: '10:00',
    label: null,
    sub: null,
    ...overrides,
  };
}

describe('sortMatchesBySchedule', () => {
  it('leere Liste → leere Liste', () => {
    expect(sortMatchesBySchedule([])).toEqual([]);
    expect(sortMatchesBySchedule(null)).toEqual([]);
    expect(sortMatchesBySchedule(undefined)).toEqual([]);
  });

  it('sortiert strikt nach scheduledAt asc', () => {
    const m1 = makeMatch({ id: 'm1', scheduledAt: '2026-09-12T14:00:00Z' });
    const m2 = makeMatch({ id: 'm2', scheduledAt: '2026-09-12T10:00:00Z' });
    const m3 = makeMatch({ id: 'm3', scheduledAt: '2026-09-12T12:00:00Z' });
    const sorted = sortMatchesBySchedule([m1, m2, m3]);
    expect(sorted.map((m) => m.id)).toEqual(['m2', 'm3', 'm1']);
  });

  it('nulls last: Matches ohne scheduledAt ans Ende', () => {
    const a = makeMatch({ id: 'a', scheduledAt: '2026-09-12T10:00:00Z' });
    const b = makeMatch({ id: 'b', scheduledAt: null });
    const c = makeMatch({ id: 'c', scheduledAt: '2026-09-12T12:00:00Z' });
    const d = makeMatch({ id: 'd', scheduledAt: null });
    const sorted = sortMatchesBySchedule([b, a, d, c]);
    expect(sorted.map((m) => m.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('Tie: field asc, nulls last', () => {
    const a = makeMatch({ id: 'a', scheduledAt: '2026-09-12T10:00:00Z', field: 3 });
    const b = makeMatch({ id: 'b', scheduledAt: '2026-09-12T10:00:00Z', field: 1 });
    const c = makeMatch({ id: 'c', scheduledAt: '2026-09-12T10:00:00Z', field: null });
    const d = makeMatch({ id: 'd', scheduledAt: '2026-09-12T10:00:00Z', field: 2 });
    const sorted = sortMatchesBySchedule([a, b, c, d]);
    expect(sorted.map((m) => m.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('verändert das Input-Array NICHT (immutabel)', () => {
    const a = makeMatch({ id: 'a', scheduledAt: '2026-09-12T14:00:00Z' });
    const b = makeMatch({ id: 'b', scheduledAt: '2026-09-12T10:00:00Z' });
    const input = [a, b];
    sortMatchesBySchedule(input);
    expect(input.map((m) => m.id)).toEqual(['a', 'b']); // unverändert
  });
});

describe('applySpielplanFilter', () => {
  // Vier Filter, genau die der Vorlage (Entscheid Jonas, 2026-08-26:
  // „benutz auch nur die filter die er im artefakt hat und nicht noch
  // gruppenfilter"). Gruppenphase, K.O. und ein Filter je Gruppe sind
  // ersatzlos entfallen — sie waren der Grund, warum die Chip-Reihe
  // scrollen musste, und eine Dublette zur Gruppen-Ansicht.
  const offenesGruppenspiel = makeMatch({ id: 'g-offen', isGroupMatch: true, isFinished: false });
  const beendetesGruppenspiel = makeMatch({
    id: 'g-done', isGroupMatch: true, isFinished: true, scoreHome: 3, scoreAway: 1,
  });
  const laufendesKo = makeMatch({ id: 'ko-live', isKoMatch: true, isLive: true });
  const beendetesKo = makeMatch({
    id: 'ko-done', isKoMatch: true, isFinished: true, scoreHome: 2, scoreAway: 0,
  });
  const alle = [offenesGruppenspiel, beendetesGruppenspiel, laufendesKo, beendetesKo];

  it('"alle" liefert alle Matches unverändert', () => {
    expect(applySpielplanFilter(alle, 'alle')).toEqual(alle);
  });

  it('"offen" heißt: weder fertig NOCH gerade laufend', () => {
    // Ein laufendes Spiel ist nicht „offen" im Sinne von „steht noch an" —
    // es ist der Fall, für den es einen eigenen Chip gibt. Stünde es in
    // beiden, wäre die Summe der Chips größer als „Alle".
    const r = applySpielplanFilter(alle, 'offen');
    expect(r.map((m) => m.id)).toEqual(['g-offen']);
  });

  it('"laeuft" liefert nur isLive', () => {
    const r = applySpielplanFilter(alle, 'laeuft');
    expect(r.map((m) => m.id)).toEqual(['ko-live']);
  });

  it('"beendet" liefert nur isFinished', () => {
    const r = applySpielplanFilter(alle, 'beendet');
    expect(r.map((m) => m.id)).toEqual(['g-done', 'ko-done']);
  });

  it('die vier Filter zerlegen die Liste vollständig und überschneidungsfrei', () => {
    // Die Probe aufs Ganze: Offen + Läuft + Fertig muss genau Alle ergeben.
    // Ohne sie könnte ein Spiel in keinem Chip auftauchen und wäre nur noch
    // über „Alle" zu finden — schlimmer als ein fehlender Filter, weil man
    // es nicht bemerkt.
    const teile = ['offen', 'laeuft', 'beendet']
      .flatMap((f) => applySpielplanFilter(alle, f).map((m) => m.id));
    expect(teile.sort()).toEqual(alle.map((m) => m.id).sort());
    expect(new Set(teile).size).toBe(teile.length);
  });

  it('entfernte Filter liefern ALLES statt einer leeren Liste', () => {
    // „gruppe", „ko" und „g:<id>" gibt es nicht mehr. Ein gespeicherter
    // Filterzustand aus der Zeit davor darf keine leere Ansicht erzeugen —
    // die sieht aus wie „keine Spiele" und nicht wie „alter Filter".
    for (const alt of ['gruppe', 'ko', 'g:A', 'kaputt']) {
      expect(applySpielplanFilter(alle, alt), alt).toEqual(alle);
    }
  });

  it('null/undefined Matches → leere Liste', () => {
    expect(applySpielplanFilter(null, 'alle')).toEqual([]);
    expect(applySpielplanFilter(undefined, 'offen')).toEqual([]);
  });
});

describe('renderFilterChips', () => {
  const offen = makeMatch({ isGroupMatch: true, isFinished: false });
  const fertig = makeMatch({ isGroupMatch: true, isFinished: true });
  const laeuft = makeMatch({ isKoMatch: true, isLive: true });
  const matches = [offen, fertig, laeuft];

  it('rendert GENAU vier Chips — die der Vorlage', () => {
    const html = renderFilterChips(matches, [], 'alle');
    const chips = html.match(/<button[^>]*data-filter="([a-z]+)"/g) || [];
    expect(chips).toHaveLength(4);
    for (const id of ['alle', 'offen', 'laeuft', 'beendet']) {
      expect(html).toContain('data-filter="' + id + '"');
    }
  });

  it('rendert KEINE Gruppen- oder Phasenfilter mehr', () => {
    const groups = [{ id: 'g1', key: 'A' }, { id: 'g2', key: 'B' }];
    const mitGruppen = [
      makeMatch({ id: 'm1', groupId: 'g1' }),
      makeMatch({ id: 'm2', groupId: 'g2' }),
    ];
    const html = renderFilterChips(mitGruppen, groups, 'alle');
    expect(html).not.toContain('Gruppe A');
    expect(html).not.toContain('data-filter="gruppe"');
    expect(html).not.toContain('data-filter="ko"');
    expect(html).not.toContain('data-filter="g:');
  });

  it('die Reihe kann nicht seitwärts scrollen — es gibt nichts zu scrollen', () => {
    // Die Bedingung von Jonas: „muss alles ohne zur seite zu scrollen, auf
    // eine seite passen." Im Markup laesst sich das nur negativ pruefen:
    // keine Scroll-Huelle, kein Aufklappmenue, kein Auswahlfeld.
    const html = renderFilterChips(matches, [], 'alle');
    expect(html).toContain('class="t-chips"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('toggle-filter-dropdown');
  });

  it('jeder Chip trägt seine Anzahl — aus der UNgefilterten Liste', () => {
    const html = renderFilterChips(matches, [], 'offen');
    expect(html).toMatch(/Alle <span class="count">3<\/span>/);
    expect(html).toMatch(/Offen <span class="count">1<\/span>/);
    expect(html).toMatch(/Läuft <span class="count">1<\/span>/);
    expect(html).toMatch(/Fertig <span class="count">1<\/span>/);
  });

  it('genau EIN Chip ist aktiv', () => {
    const html = renderFilterChips(matches, [], 'laeuft');
    expect((html.match(/is-active/g) || [])).toHaveLength(1);
    expect(html).toMatch(/data-filter="laeuft"[^>]*aria-pressed="true"/);
    expect((html.match(/aria-pressed="true"/g) || [])).toHaveLength(1);
  });

  it('ein unbekannter Filter faellt auf „Alle" zurueck, nicht auf gar keinen', () => {
    const html = renderFilterChips(matches, [], 'g:A');
    expect((html.match(/is-active/g) || [])).toHaveLength(1);
    expect(html).toMatch(/data-filter="alle"[^>]*aria-pressed="true"/);
  });

  it('null/undefined Matches rendert ohne Crash', () => {
    expect(() => renderFilterChips(null, [], 'alle')).not.toThrow();


    expect(() => renderFilterChips(undefined, [], 'alle')).not.toThrow();
  });
});

describe('renderMatchCard', () => {
  it('volles Match mit Score, Sieger wird hervorgehoben', () => {
    const m = makeMatch({
      scoreHome: 3,
      scoreAway: 1,
      isFinished: true,
      scheduledTime: '14:30',
      field: 2,
      label: 'VF 1',
    });
    const html = renderMatchCard(m, true);
    expect(html).toContain('data-match-id="m-1"');
    expect(html).toContain('t-match--done');
        // Geschuetztes Leerzeichen zwischen "Platte" und der Nummer
    // (2026-08-26, Fund von Jonas am iPhone SE): die Meta-Zeile darf
    // umbrechen, damit lange Feldnamen nicht abgeschnitten werden — sie
    // hat das genutzt und die Nummer auf eine eigene Zeile geschoben.
    // Der Test prueft das \u00A0 ausdruecklich, weil ein normales
    // Leerzeichen hier optisch gleich aussieht und trotzdem falsch ist.
    //
    // Artefakt „Turniermodul ohne Kaestchen“, dritte Fassung (Abnahme
    // 2026-08-26): das Fussband der Karte traegt den ORT, nicht die
    // Uhrzeit — in der Vorlage steht dort „Gruppe A · Platte 1“. Die
    // Uhrzeit gliedert stattdessen einmal je Block die Zeitachse
    // (renderZeitmarke, geprueft in zeitachse.test.js). Vorher trugen
    // achtzehn Karten achtzehnmal dieselbe Zeile.
    expect(html).toContain('VF 1 · Platte 2');
    expect(html).not.toContain('14:30');
    // Anzeigetafel-Layout (Redesign A2): zwei separate Score-Felder.
    expect(html).toContain('data-area="home-score">3<');
    expect(html).toContain('data-area="away-score">1<');
    expect(html).not.toContain('3 : 1');
    // Heim hat gewonnen (3 > 1)
    expect(html).toMatch(/<div class="t-match-team is-winner">[^<]*<i class="t-dot"[^>]*><\/i><span class="name">Heim<\/span><\/div>/);
    // A2 Redesign: beide Teams haben jetzt den Dot LINKS (Indikator),
    // einheitlich — auch Away, kein nachgestellter Dot mehr.
    expect(html).toMatch(/<div class="t-match-team right"><i class="t-dot"[^>]*><\/i><span class="name">Gast<\/span><\/div>/);
  });

  it('Auswärts-Sieger wird rechts hervorgehoben', () => {
    const m = makeMatch({
      scoreHome: 0,
      scoreAway: 2,
      isFinished: true,
    });
    const html = renderMatchCard(m, true);
    expect(html).toContain('<div class="t-match-team"><i class="t-dot"');
    expect(html).toContain('<div class="t-match-team right is-winner">');
  });

  it('Score fehlt → "–" in BEIDEN Feldern mit .empty-Klasse', () => {
    const m = makeMatch({ scoreHome: null, scoreAway: null, isFinished: false });
    const html = renderMatchCard(m, false);
    expect(html).not.toContain('– : –');
    expect(html).toContain('t-match-score empty');
    // Zwei leere Felder — eines pro Team
    expect(html.match(/t-match-score empty/g)?.length).toBe(2);
    expect(html).not.toContain('t-match--done');
    expect(html).not.toContain('is-winner');
  });

  it('isLive-Match bekommt t-match--live (zusätzlich zu t-match)', () => {
    const m = makeMatch({ isLive: true });
    const html = renderMatchCard(m, false);
    expect(html).toContain('t-match--live');
  });

  it('A2.2: t-match-rows umschließt die 4 Team+Score-Elemente (Anzeigetafel-Layout)', () => {
    // Etappe A2 (2026-08-20): Wir wrappen Team+Score-Paare in einem
    // .t-match-rows-Container. So bleibt das CSS-Grid stabil und
    // Meta/Action-Zeilen liegen oben/unten auf voller Breite, statt
    // von den Grid-Spalten zerquetscht zu werden.
    const m = makeMatch({});
    const html = renderMatchCard(m, false);
    // 1) Der Wrapper existiert genau einmal.
    expect(html.match(/class="t-match-rows"/g)?.length).toBe(1);
    // 2) Innerhalb des Wrappers kommen die 4 inneren Elemente in der
    //    korrekten Reihenfolge: Team-home → Score-home → Team-away → Score-away.
    const rowsMatch = html.match(/<div class="t-match-rows">([\s\S]*?)<\/div>\s*<\/div>/);
    expect(rowsMatch).not.toBeNull();
    const inner = rowsMatch[1];
    const homeTeamIdx = inner.indexOf('t-match-team');
    const homeScoreIdx = inner.indexOf('data-area="home-score"');
    const awayTeamIdx = inner.indexOf('t-match-team right');
    const awayScoreIdx = inner.indexOf('data-area="away-score"');
    expect(homeTeamIdx).toBeGreaterThanOrEqual(0);
    expect(homeScoreIdx).toBeGreaterThan(homeTeamIdx);
    expect(awayTeamIdx).toBeGreaterThan(homeScoreIdx);
    expect(awayScoreIdx).toBeGreaterThan(awayTeamIdx);
  });

  it('Admin + !beendet → "Ergebnis"-Button', () => {
    const html = renderMatchCard(makeMatch({ isFinished: false }), true);
    expect(html).toContain('data-action="enter-result"');
    expect(html).toContain('data-match-id="m-1"');
    expect(html).toContain('>Ergebnis</button>');
  });

  it('Admin + beendet → "Erneut"-Button', () => {
    const html = renderMatchCard(makeMatch({ isFinished: true, scoreHome: 3, scoreAway: 1 }), true);
    expect(html).toContain('data-action="enter-result"');
    expect(html).toContain('>Erneut</button>');
  });

  it('Member + beendet → Text "Beendet" (kein Button)', () => {
    const html = renderMatchCard(makeMatch({ isFinished: true, scoreHome: 3, scoreAway: 1 }), false);
    expect(html).toContain('>Beendet</span>');
    expect(html).not.toContain('data-action="enter-result"');
  });

  it('Member + !beendet + m.sub → zeigt sub-Text', () => {
    const html = renderMatchCard(makeMatch({ isFinished: false, sub: 'Gruppenspiel A · 1. Spieltag' }), false);
    expect(html).toContain('Gruppenspiel A · 1. Spieltag');
    expect(html).not.toContain('data-action="enter-result"');
  });

  it('Member + !beendet + kein sub → gar keine Aktionszeile', () => {
    // Bis zur Markenuebernahme stand hier ein Gedankenstrich. Das war
    // richtig, solange die Aktion eine SPALTE rechts neben den Teams war:
    // eine leere Grid-Spalte sieht nach Fehler aus, ein "–" nach Absicht.
    //
    // Seit die Aktion eine eigene ZEILE unter der Meta ist, kostet der
    // Strich eine ganze Zeile Hoehe fuer die Aussage "hier steht nichts".
    // Bei sechs offenen Spielen untereinander sind das sechs leere
    // Zeilen. Jetzt faellt die Zeile weg — die Karte endet nach der
    // Meta-Zeile.
    const html = renderMatchCard(makeMatch({ isFinished: false, sub: null }), false);
    expect(html).not.toContain('t-match-action-text');
    expect(html).not.toContain('t-match-action');
  });

  it('Team-Farbe wird inline als background-style gerendert', () => {
    const html = renderMatchCard(makeMatch({ home: { name: 'H', color: '#ff0000' } }), false);
    expect(html).toMatch(/<i class="t-dot" style="background:#ff0000"/);
  });

  it('Team ohne Farbe bekommt var(--line)', () => {
    const html = renderMatchCard(makeMatch({ home: { name: 'H', color: null } }), false);
    expect(html).toMatch(/<i class="t-dot" style="background:var\(--line\)"/);
  });

  it('Escaping: XSS-Versuche in Teamnamen werden escaped', () => {
    const m = makeMatch({ home: { name: '<script>alert(1)</script>', color: null } });
    const html = renderMatchCard(m, false);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderMatchCardCompact', () => {
  it('rendert Teams + zwei Score-Felder (Anzeigetafel-Layout)', () => {
    const m = makeMatch({ scoreHome: 2, scoreAway: 1, isFinished: true });
    const html = renderMatchCardCompact(m);
    expect(html).toContain('t-match--compact');
    expect(html).toContain('t-match--done');
    expect(html).not.toContain('2 : 1');
    expect(html).toContain('data-area="home-score">2<');
    expect(html).toContain('data-area="away-score">1<');
    expect(html).toContain('Heim');
    expect(html).toContain('Gast');
  });

  it('leeres Score → "–" in beiden Feldern + .empty', () => {
    const html = renderMatchCardCompact(makeMatch({ scoreHome: null, scoreAway: null }));
    expect(html).not.toContain('– : –');
    expect(html).toContain('empty');
    expect(html.match(/t-match-score empty/g)?.length).toBe(2);
  });

  it('kein Meta, keine Action-Spalte (Aside-Variante)', () => {
    const html = renderMatchCardCompact(makeMatch());
    expect(html).not.toContain('t-match-meta');
    expect(html).not.toContain('t-match-action');
    expect(html).not.toContain('data-action="enter-result"');
  });

  it('A2.2: t-match-rows umschließt die 4 Team+Score-Elemente (Compact)', () => {
    const html = renderMatchCardCompact(makeMatch());
    expect(html.match(/class="t-match-rows"/g)?.length).toBe(1);
  });
});

describe('renderMatchList', () => {
  it('leere Liste → ehrlicher "Keine Spiele"-Platzhalter', () => {
    expect(renderMatchList([], true)).toContain('Keine Spiele in dieser Auswahl');
  });

  it('null/undefined → Platzhalter (kein Crash)', () => {
    expect(renderMatchList(null, false)).toContain('Keine Spiele in dieser Auswahl');
    expect(renderMatchList(undefined, true)).toContain('Keine Spiele in dieser Auswahl');
  });

  it('n Matches → n Match-Karten (Admin: Button enthält auch data-match-id)', () => {
    const matches = [
      makeMatch({ id: 'm1' }),
      makeMatch({ id: 'm2' }),
      makeMatch({ id: 'm3' }),
    ];
    const html = renderMatchList(matches, true);
    // Pro Karte: 1x am .t-match + 1x am Enter-Result-Button = 2
    expect((html.match(/data-match-id=/g) || []).length).toBe(6);
    // Eindeutige Karten: 3
    const unique = new Set();
    for (const m of html.matchAll(/data-match-id="([^"]+)"/g)) unique.add(m[1]);
    expect(unique.size).toBe(3);
  });
});

describe('renderAsideNext', () => {
  it('nächste 3 offene Spiele (Default-Limit)', () => {
    const offene = [
      makeMatch({ id: 'o1', isFinished: false }),
      makeMatch({ id: 'o2', isFinished: false }),
      makeMatch({ id: 'o3', isFinished: false }),
      makeMatch({ id: 'o4', isFinished: false }), // 4. wird NICHT angezeigt
    ];
    const html = renderAsideNext(offene);
    expect((html.match(/data-match-id=/g) || []).length).toBe(0); // compact hat data-match-id NICHT
    // Aber die Heim-Namen sind sichtbar
    expect((html.match(/>Heim</g) || []).length).toBe(3);
  });

  it('keine offenen Spiele → "Alle Spiele beendet"', () => {
    const html = renderAsideNext([makeMatch({ isFinished: true, scoreHome: 3, scoreAway: 1 })]);
    expect(html).toContain('Alle Spiele beendet');
  });

  it('beendete Spiele werden übersprungen', () => {
    const matches = [
      makeMatch({ id: 'a', isFinished: true, scoreHome: 3, scoreAway: 0 }),
      makeMatch({ id: 'b', isFinished: false }),
      makeMatch({ id: 'c', isFinished: false }),
    ];
    const html = renderAsideNext(matches);
    // nur b + c → 2 kompakte Karten
    expect((html.match(/>Heim</g) || []).length).toBe(2);
  });

  it('null Matches → "Alle Spiele beendet" (defensiv)', () => {
    expect(renderAsideNext(null)).toContain('Alle Spiele beendet');
  });
});

describe('renderAsideTables', () => {
  it('Plattenbelegung: nächste 6 offenen Spiele mit field', () => {
    const matches = Array.from({ length: 8 }, (_, i) =>
      makeMatch({ id: `m${i}`, isFinished: false, field: (i % 3) + 1, scheduledTime: `${10 + i}:00` })
    );
    const html = renderAsideTables(matches);
    expect(html).toContain('<ul class="t-aside-list">');
    // 8 Spiele, Limit 6
    expect((html.match(/<li>/g) || []).length).toBe(6);
  });

  it('überspringt Spiele ohne field (kein Tisch)', () => {
    const matches = [
      makeMatch({ id: 'a', isFinished: false, field: null }),
      makeMatch({ id: 'b', isFinished: false, field: 1 }),
    ];
    const html = renderAsideTables(matches);
    expect(html).toContain('<strong>Platte' + String.fromCharCode(160) + '1</strong>');
    // 'a' darf NICHT auftauchen
    expect(html).not.toContain('data-match-id');
    expect((html.match(/<li>/g) || []).length).toBe(1);
  });

  it('überspringt beendete Spiele', () => {
    const matches = [
      makeMatch({ id: 'a', isFinished: true, scoreHome: 3, scoreAway: 1, field: 1 }),
      makeMatch({ id: 'b', isFinished: false, field: 2 }),
    ];
    const html = renderAsideTables(matches);
    expect(html).toContain('Platte 2');
    expect(html).not.toContain('Platte 1');
  });

  it('leere Liste → "Keine Platten verplant"', () => {
    expect(renderAsideTables([])).toContain('Keine Platten verplant');
  });

  it('null → "Keine Platten verplant" (defensiv)', () => {
    expect(renderAsideTables(null)).toContain('Keine Platten verplant');
  });
});

// ── P1 + P2 (2026-08-24) — Browser-Feedback-Runde ────────────────────
//
// User-Forderungen:
//   P1: Spec-Verweis aus User-Output, Hint nur bei mixedGroupSizes.
//   P2: Spalten-Overlap GRUPPE/SP. und BECHER/DIFF bei 360–430 px.
//       data-col-Attribute auf TH/TD, damit Container-Query
//       schmale Spalten ausblenden kann.

describe('renderBestThirdsTable — Hint-Text (P6)', () => {
  // P6 (2026-08-24, User-Liste): Hinweis ist unconditional.
  // "Gewertet wird nach Punkten pro Spiel." — gilt IMMER, unabhängig
  // davon, ob die zugrunde liegenden Gruppen unterschiedlich groß sind.
  // Ein konstanter Einzehler erklärt die Normierung generell und ist
  // weniger verwirrend als ein bedingter Text.

  const mixedRows = [
    { name: 'A1', groupKey: 'A', played: 3, won: 2, drawn: 0, lost: 1, goalsFor: 6, goalsAgainst: 4, points: 6, qualifies: true },
    { name: 'B1', groupKey: 'B', played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 4, goalsAgainst: 2, points: 4, qualifies: true },
  ];
  const equalRows = [
    { name: 'A1', groupKey: 'A', played: 3, won: 2, drawn: 0, lost: 1, goalsFor: 6, goalsAgainst: 4, points: 6, qualifies: true },
    { name: 'B1', groupKey: 'B', played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 5, goalsAgainst: 4, points: 4, qualifies: false },
    { name: 'C1', groupKey: 'C', played: 3, won: 0, drawn: 2, lost: 1, goalsFor: 3, goalsAgainst: 5, points: 2, qualifies: false },
  ];

  it('mixedGroupSizes zeigt IMMER den kompakten Hinweis "Gewertet wird nach Punkten pro Spiel."', () => {
    const html = renderBestThirdsTable({ qualifyCount: 1, rows: mixedRows });
    expect(html).toContain('Gewertet wird nach Punkten pro Spiel.');
    expect(html).toContain('t-hint--compact');
    // KEIN Spec-Verweis mehr
    expect(html).not.toContain('Spec §10.4');
    expect(html).not.toContain('Rangfolge nach Punkten');
    // Alter "unterschiedlich groß"-Text ist weg
    expect(html).not.toContain('unterschiedlich groß');
  });

  it('gleich große Gruppen zeigt GENAUSO den Hinweis (kein bedingter Lärm mehr)', () => {
    const html = renderBestThirdsTable({ qualifyCount: 1, rows: equalRows });
    expect(html).toContain('Gewertet wird nach Punkten pro Spiel.');
  });
});

describe('renderBestThirdsTable — Spalten-Markup (P2)', () => {
  // P2 (Browser-Feedback 2026-08-24): GRUPPE/SP. und BECHER/DIFF
  // überlappen bei 360–430 px Modulbreite. Fix: data-col-Attribute
  // + CSS-Container-Query, die unkritische Spalten ausblendet.

  const rows = [
    { name: 'A1', groupKey: 'A', played: 3, won: 2, drawn: 0, lost: 1, goalsFor: 6, goalsAgainst: 4, points: 6, qualifies: true },
  ];

  it('jedes TH (außer Team) hat data-col-Attribut', () => {
    const html = renderBestThirdsTable({ qualifyCount: 1, rows });
    // 9 data-col-THs (Pl., Gruppe, Sp., S, U, N, Becher, Diff, Pkt.)
    const dataColThs = html.match(/<th[^>]*data-col="[^"]+"/g) || [];
    expect(dataColThs.length).toBe(9);
    // Team-TH hat KEIN data-col
    const teamTh = html.match(/<th[^>]*class="is-team"[^>]*>([^<]*)<\/th>/);
    expect(teamTh).not.toBeNull();
    expect(teamTh[0]).not.toContain('data-col=');
  });

  it('jedes TD (außer Team) hat data-col-Attribut', () => {
    const html = renderBestThirdsTable({ qualifyCount: 1, rows });
    const dataColTds = html.match(/<td[^>]*data-col="[^"]+"/g) || [];
    // Bei 1 Reihe: 9 data-col-TDs (alle außer Team-TD)
    expect(dataColTds.length).toBe(9);
    // Team-TD hat KEIN data-col
    const teamTd = html.match(/<td[^>]*class="t-thirds-team"[^>]*>([^<]*)<\/td>/);
    expect(teamTd).not.toBeNull();
    expect(teamTd[0]).not.toContain('data-col=');
  });

  it('THIRDS_COL_WIDTHS-Layout hat 10 Spalten (5 ausgeblendet bei @container ≤430px)', () => {
    const html = renderBestThirdsTable({ qualifyCount: 1, rows });
    const cols = html.match(/<col\s+style="width:[^"]+">/g) || [];
    expect(cols.length).toBe(10);
    // Ausblendbare Spalten (CSS-seitig): played, won, drawn, lost, score
    // Sichtbare: pl, group, points (+ Team als auto)
    const thCols = (html.match(/<th[^>]*data-col="([^"]+)"/g) || []).map((s) => s.match(/data-col="([^"]+)"/)[1]);
    expect(thCols).toEqual(['pl', 'group', 'played', 'won', 'drawn', 'lost', 'score', 'diff', 'points']);
  });
});

// ─────────────────────────────────────────────────────────────────
// P5-Truncation 2026-08-25: Compact-Mode-Switch für Beste-Dritte.
// Mobile (7 Colgroup-Spalten): Pl · Team · Gruppe · Sp · Becher · Diff · Pkt.
// Gruppe bleibt sichtbar (sonst weiß man nicht, aus welcher Gruppe der
// Dritte kommt), S/U/N ausgeblendet wie in Standings.
//
// KORREKTUR 2026-08-25: die beiden Spaltenzahl-Tests hier standen auf 7
// und haben den Defekt damit ZEMENTIERT statt ihn zu fangen. Die 7 kam
// aus dem Kommentar am Konstanten-Set, der "Sp" als sichtbar zählte —
// main.css blendet data-col="played" auf Mobile aber aus. Sichtbar sind
// SECHS Spalten: Pl · Team · Gruppe · Becher · Diff · Pkt.
// Ein Test, der eine Zahl aus dem Kommentar neben der Konstante abschreibt
// statt aus dem gerenderten Markup, prüft nichts — der markup-gebundene
// Gegentest steht in best-thirds-render.test.js ("Mobile-Spaltenzahl passt
// zur Zahl der nicht versteckten data-col-Spalten").
// ─────────────────────────────────────────────────────────────────

describe('renderBestThirdsTable — Compact-Mode-Switch (P5-Truncation)', () => {
  beforeEach(() => setCompactMode(false));

  const sample = {
    qualifyCount: 1,
    rows: [{
      teamId: 't1', name: 'Team X', groupKey: 'A',
      played: 3, won: 2, drawn: 0, lost: 1,
      goalsFor: 12, goalsAgainst: 10, goalDiff: 2, points: 6,
      qualifies: true,
    }],
  };

  it('Desktop: 10 Colgroup-Spalten', () => {
    setCompactMode(false);
    const html = renderBestThirdsTable(sample);
    const cols = html.match(/<col\s+style="width:[^"]+">/g) || [];
    expect(cols).toHaveLength(10);
  });

  it('Mobile: 5 Colgroup-Spalten (Pl · Team · Gruppe · Diff · Pkt)', () => {
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    const cols = html.match(/<col\s+style="width:[^"]+">/g) || [];
    expect(cols).toHaveLength(5);
    // Flucht-Angleichung: Pl./Diff/Pkt. tragen dieselben Prozente wie die
    // Standings-Tabelle, und Team+Gr. hier ist so breit wie Team+Sp. dort
    // (44+12 = 42+14 = 56). Damit stehen die rechten Kanten beider
    // Tabellen uebereinander. Becher ist mobil seit 26.08. weg.
    expect(html).toContain('width:14%');  // Pl.
    expect(html).toContain('width:44%');  // Team
    expect(html).toContain('width:12%');  // Gr. (ein Buchstabe)
    expect(html).toContain('width:15%');  // Diff + Pkt.
    // Die alten Werte gehoerten zum verschobenen 7er-Set. Zweimal ist
    // hier inzwischen ein Wert von der Liste geflogen, weil er legitim
    // wurde: 8% am 25.08., 12% am 26.08. (beides die Gruppen-Spalte).
    // Beide Male aus demselben Grund — ein Test, der einen gueltigen
    // Zustand verbietet, wird beim naechsten Rot abgeschaltet statt
    // gelesen. Was hier bleibt, sind Werte, die es im Mobile-Set nicht
    // geben KANN: 20% war die Becher-Breite, 18% ein verschobener Nachbar.
    expect(html).not.toContain('width:20%');
    expect(html).not.toContain('width:18%');
  });

  it('Mobile: keine 7%-Geister-Spalten (S/U/N weg) + Spalten-Anzahl = 5', () => {
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    // width:7% war die Breite der S/U/N-Spalten im 10er-Desktop-Colgroup.
    // Im Mobile-Set kommt sie nicht mehr vor.
    expect(html).not.toContain('width:7%');
    const cols = html.match(/<col\s+style="width:[^"]+">/g) || [];
    expect(cols).toHaveLength(5);
    // Summe muss genau 100% sein — kein 'auto', keine Restlücke.
    const sum = cols
      .map((c) => parseFloat(c.match(/width:([\d.]+)%/)[1]))
      .reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('Mobile: Gruppe-Spalte bleibt sichtbar (data-col=group vorhanden)', () => {
    setCompactMode(true);
    const html = renderBestThirdsTable(sample);
    // Pl, Gruppe, Sp, Becher, Diff, Pkt (Team hat kein data-col → auto)
    expect(html).toContain('data-col="group"');
    expect(html).toContain('data-col="played"');
  });
});
