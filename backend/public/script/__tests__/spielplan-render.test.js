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

import { describe, it, expect } from 'vitest';
import {
  sortMatchesBySchedule,
  applySpielplanFilter,
  renderFilterChips,
  renderMatchCard,
  renderMatchCardCompact,
  renderMatchList,
  renderAsideNext,
  renderAsideTables,
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
  const offenesGruppenspiel = makeMatch({
    id: 'g-offen',
    isGroupMatch: true,
    isFinished: false,
  });
  const beendetesGruppenspiel = makeMatch({
    id: 'g-done',
    isGroupMatch: true,
    isFinished: true,
    scoreHome: 3,
    scoreAway: 1,
  });
  const offenesKo = makeMatch({
    id: 'ko-offen',
    isKoMatch: true,
    isFinished: false,
  });
  const beendetesKo = makeMatch({
    id: 'ko-done',
    isKoMatch: true,
    isFinished: true,
    scoreHome: 2,
    scoreAway: 0,
  });
  const alle = [offenesGruppenspiel, beendetesGruppenspiel, offenesKo, beendetesKo];

  it('"alle" liefert alle Matches unverändert', () => {
    expect(applySpielplanFilter(alle, 'alle')).toEqual(alle);
  });

  it('"offen" liefert nur !isFinished', () => {
    const r = applySpielplanFilter(alle, 'offen');
    expect(r.map((m) => m.id)).toEqual(['g-offen', 'ko-offen']);
  });

  it('"beendet" liefert nur isFinished', () => {
    const r = applySpielplanFilter(alle, 'beendet');
    expect(r.map((m) => m.id)).toEqual(['g-done', 'ko-done']);
  });

  it('"gruppe" liefert nur isGroupMatch (egal ob beendet)', () => {
    const r = applySpielplanFilter(alle, 'gruppe');
    expect(r.map((m) => m.id)).toEqual(['g-offen', 'g-done']);
  });

  it('"ko" liefert nur isKoMatch', () => {
    const r = applySpielplanFilter(alle, 'ko');
    expect(r.map((m) => m.id)).toEqual(['ko-offen', 'ko-done']);
  });

  it('"g:<groupId>" filtert auf groupId', () => {
    const m1 = makeMatch({ id: 'ga', groupId: 'A' });
    const m2 = makeMatch({ id: 'gb', groupId: 'B' });
    const r = applySpielplanFilter([m1, m2], 'g:A');
    expect(r.map((m) => m.id)).toEqual(['ga']);
  });

  it('unbekannter Filter liefert ALLE Matches (kein silent empty)', () => {
    // Spec §13.10: keine stillen Annahmen. Wenn der Filter kaputt ist,
    // zeigen wir lieber alles als eine leere Liste, die der User nicht
    // versteht.
    const r = applySpielplanFilter(alle, 'kaputt');
    expect(r).toEqual(alle);
  });

  it('null/undefined Matches → leere Liste', () => {
    expect(applySpielplanFilter(null, 'alle')).toEqual([]);
    expect(applySpielplanFilter(undefined, 'offen')).toEqual([]);
  });
});

describe('renderFilterChips', () => {
  const offenesGruppenspiel = makeMatch({ isGroupMatch: true, isFinished: false });
  const beendetesGruppenspiel = makeMatch({ isGroupMatch: true, isFinished: true });
  const offenesKO = makeMatch({ isKoMatch: true, isFinished: false });
  const matches = [offenesGruppenspiel, beendetesGruppenspiel, offenesKO];

  it('rendert immer die drei Basis-Chips', () => {
    const html = renderFilterChips(matches, [], 'alle');
    expect(html).toContain('data-filter="alle"');
    expect(html).toContain('data-filter="offen"');
    expect(html).toContain('data-filter="beendet"');
  });

  it('zeigt Counts aus UNGefilterter Liste (auch wenn "offen" aktiv)', () => {
    const html = renderFilterChips(matches, [], 'offen');
    // "Alle" zeigt 3, auch wenn der aktive Filter "offen" ist
    expect(html).toContain('Alle <span class="count">3</span>');
    // "Offen" zeigt 2, "Beendet" zeigt 1
    expect(html).toContain('Nur offene <span class="count">2</span>');
    expect(html).toContain('Beendet <span class="count">1</span>');
  });

  it('Phasen-Filter nur, wenn in dieser Kategorie Spiele existieren', () => {
    const nurKO = [makeMatch({ isKoMatch: true })];
    const html = renderFilterChips(nurKO, [], 'alle');
    expect(html).toContain('data-filter="ko"');
    expect(html).not.toContain('data-filter="gruppe"');
  });

  it('Gruppen-Filter pro Gruppe, sortiert nach key', () => {
    const groups = [
      { id: 'g1', key: 'B' },
      { id: 'g2', key: 'A' },
    ];
    const matchesMitGruppen = [
      makeMatch({ id: 'm1', groupId: 'g1' }),
      makeMatch({ id: 'm2', groupId: 'g2' }),
    ];
    const html = renderFilterChips(matchesMitGruppen, groups, 'alle');
    // "Gruppe A" muss VOR "Gruppe B" stehen, weil nach key sortiert
    const aIdx = html.indexOf('Gruppe A');
    const bIdx = html.indexOf('Gruppe B');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(bIdx);
  });

  it('aktiver Filter bekommt is-active Klasse + aria-pressed=true', () => {
    const html = renderFilterChips(matches, [], 'offen');
    expect(html).toMatch(/<button[^>]*class="t-chip is-active"[^>]*data-filter="offen"/);
    expect(html).toContain('data-filter="offen" aria-pressed="true"');
  });

  it('inaktiver Filter bekommt KEIN is-active', () => {
    const html = renderFilterChips(matches, [], 'offen');
    expect(html).toContain('data-filter="alle" aria-pressed="false"');
    expect(html).not.toContain('data-filter="alle" class="t-chip is-active"');
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
    expect(html).toContain('14:30 · Platte 2');
    expect(html).toContain('VF 1');
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

  it('Member + !beendet + kein sub → Platzhalter "–"', () => {
    const html = renderMatchCard(makeMatch({ isFinished: false, sub: null }), false);
    expect(html).toContain('<span class="t-match-action-text">–</span>');
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
    expect(html).toContain('<strong>Platte 1</strong>');
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
    expect(html).toContain('Platte 2');
    expect(html).not.toContain('Platte 1');
  });

  it('leere Liste → "Keine Platten verplant"', () => {
    expect(renderAsideTables([])).toContain('Keine Platten verplant');
  });

  it('null → "Keine Platten verplant" (defensiv)', () => {
    expect(renderAsideTables(null)).toContain('Keine Platten verplant');
  });
});
