/**
 * Zeitachse im Spielplan — Markenuebernahme Etappe 5 (2026-08-26).
 *
 * renderMatchList buendelt die Spiele nach Anstosszeit und setzt vor
 * jeden Block eine Marke. Drei Dinge koennen dabei schiefgehen, und
 * genau die pruefen diese Tests:
 *
 *   1. Ein Spiel faellt aus der Liste. Buendeln heisst umsortieren, und
 *      umsortieren heisst: man kann etwas verlieren.
 *   2. Mehr als ein Block ist "als Naechstes". Dann ist es keine
 *      Reihenfolge mehr, sondern zwei Behauptungen.
 *   3. Das laufende Spiel landet in der Achse statt darueber. Es hat
 *      keine Uhrzeit — es ist jetzt.
 */

import { describe, it, expect } from 'vitest';
import { renderMatchList } from '../spielplan-helpers.js';

const m = (o) => ({
  id: o.id,
  isFinished: !!o.fin,
  isLive: !!o.live,
  scheduledTime: o.zeit,
  field: o.platte ?? 1,
  label: o.gruppe ?? 'Gruppe A',
  home: { kind: 'team', teamId: 'h' + o.id, name: o.h ?? ('Heim ' + o.id) },
  away: { kind: 'team', teamId: 'a' + o.id, name: o.a ?? ('Gast ' + o.id) },
  scoreHome: o.hs,
  scoreAway: o.as,
});

const marken = (html) =>
  [...html.matchAll(/<div class="t-zeitmarke([^"]*)">\s*<span class="t-zeitmarke-zeit">([^<]*)<\/span>[\s\S]*?<span class="t-zeitmarke-zustand">(?:<span[^>]*><\/span>)?([^<]*)<\/span>/g)]
    .map((x) => ({ next: x[1].includes('is-next'), zeit: x[2], zustand: x[3].trim() }));

const karten = (html) => (html.match(/class="t-match[ "]/g) || []).length;

describe('renderMatchList — Zeitachse', () => {
  it('buendelt nach Uhrzeit und setzt je Block eine Marke', () => {
    const html = renderMatchList([
      m({ id: '1', zeit: '14:00', fin: true, hs: 3, as: 1 }),
      m({ id: '2', zeit: '14:00', fin: true, hs: 2, as: 0 }),
      m({ id: '3', zeit: '14:30' }),
      m({ id: '4', zeit: '15:00' }),
    ], false);
    expect(marken(html).map((x) => x.zeit)).toEqual(['14:00', '14:30', '15:00']);
  });

  it('verliert kein Spiel beim Buendeln', () => {
    const spiele = Array.from({ length: 18 }, (_, i) =>
      m({ id: String(i), zeit: ['14:00', '14:30', '15:00'][i % 3], fin: i < 10, hs: 3, as: 1 }));
    expect(karten(renderMatchList(spiele, false))).toBe(18);
  });

  it('genau EIN Block ist "Als Nächstes"', () => {
    const html = renderMatchList([
      m({ id: '1', zeit: '14:00', fin: true, hs: 3, as: 1 }),
      m({ id: '2', zeit: '14:30' }),
      m({ id: '3', zeit: '15:00' }),
      m({ id: '4', zeit: '15:30' }),
    ], false);
    const naechste = marken(html).filter((x) => x.next);
    expect(naechste).toHaveLength(1);
    expect(naechste[0].zeit).toBe('14:30');
  });

  it('abgeschlossene Bloecke heissen "Gespielt", spaetere "Geplant"', () => {
    const html = renderMatchList([
      m({ id: '1', zeit: '14:00', fin: true, hs: 3, as: 1 }),
      m({ id: '2', zeit: '14:30' }),
      m({ id: '3', zeit: '15:00' }),
    ], false);
    expect(marken(html).map((x) => x.zustand)).toEqual(['Gespielt', 'Als Nächstes', 'Geplant']);
  });

  it('alles gespielt: keine Marke traegt "Als Nächstes"', () => {
    const html = renderMatchList([
      m({ id: '1', zeit: '14:00', fin: true, hs: 3, as: 1 }),
      m({ id: '2', zeit: '14:30', fin: true, hs: 1, as: 3 }),
    ], false);
    expect(marken(html).filter((x) => x.next)).toHaveLength(0);
    expect(marken(html).map((x) => x.zustand)).toEqual(['Gespielt', 'Gespielt']);
  });

  it('das laufende Spiel steht vor der ersten Marke, nicht darin', () => {
    const html = renderMatchList([
      m({ id: '1', zeit: '14:00', fin: true, hs: 3, as: 1 }),
      m({ id: '2', zeit: '14:30', live: true, hs: 2, as: 1 }),
      m({ id: '3', zeit: '15:00' }),
    ], false);
    const ersteMarke = html.indexOf('t-zeitmarke');
    const ersteKarte = html.indexOf('t-match');
    expect(ersteKarte).toBeLessThan(ersteMarke);
    // und es taucht genau einmal auf, nicht zusaetzlich im 14:30-Block
    expect(karten(html)).toBe(3);
  });

  it('Spiele ohne Uhrzeit bekommen einen Gedankenstrich, keine Luecke', () => {
    const html = renderMatchList([m({ id: '1' })], false);
    expect(marken(html)[0].zeit).toBe('–');
  });

  it('leere Auswahl bleibt ein ehrlicher Hinweis, keine leere Achse', () => {
    expect(renderMatchList([], false)).toContain('Keine Spiele');
    expect(renderMatchList([], false)).not.toContain('t-zeitmarke');
  });

  it('die Reihenfolge der Bloecke folgt der Eingabe, nicht der Uhrzeit-Sortierung', () => {
    // sortMatchesBySchedule sortiert VOR dem Aufruf. Wer hier ein zweites
    // Mal sortiert, dreht bei gleicher Zeit die Plattenreihenfolge um.
    const html = renderMatchList([
      m({ id: '1', zeit: '15:00' }),
      m({ id: '2', zeit: '14:00', fin: true, hs: 3, as: 1 }),
    ], false);
    expect(marken(html).map((x) => x.zeit)).toEqual(['15:00', '14:00']);
  });
});
