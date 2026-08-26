/**
 * Tests für den Takt der Zuschauer-Ansicht und ihre Stand-Pille.
 *
 * Zwei Dinge werden hier geprüft, und sie brauchen zwei verschiedene
 * Werkzeuge:
 *
 *   1. Der Takt ist reine Fachlogik (live-takt.js) — direkt aufrufbar.
 *   2. Die Verdrahtung liegt in live.js und live.html, und die laufen nur
 *      im Browser. Vitest fährt hier ohne DOM (environment: 'node'),
 *      deshalb prüft der zweite Block den Quelltext: Sind die drei IDs auf
 *      beiden Seiten dieselben? Genau dort ging es in diesem Haus schon
 *      mehrfach auseinander — ein Renderer schrieb in ein Element, das die
 *      Seite nicht mehr hatte, und niemand sah es außer im Browser.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  naechsterAbstand,
  abstandNachFehler,
  TAKT_LIVE,
  TAKT_TAG,
  TAKT_RUHE,
} from '../live-takt.js';

const hier = dirname(fileURLToPath(import.meta.url));
const liveJs = readFileSync(join(hier, '..', 'live.js'), 'utf8');
const liveHtml = readFileSync(join(hier, '..', '..', 'live.html'), 'utf8');

describe('Takt: Wie oft holt die Zuschauerseite nach?', () => {
  it('Ein laufendes Spiel zieht den Takt an', () => {
    expect(naechsterAbstand({ matches: [{ isLive: false }, { isLive: true }] })).toBe(TAKT_LIVE);
  });

  it('Turniertag ohne Anpfiff: der normale Takt', () => {
    expect(
      naechsterAbstand({
        tournament: { status: 'group_stage' },
        matches: [{ isLive: false }],
      })
    ).toBe(TAKT_TAG);
  });

  it('Abgeschlossen: die Seite zieht sich zurück', () => {
    expect(naechsterAbstand({ tournament: { status: 'finished' }, matches: [] })).toBe(TAKT_RUHE);
  });

  it('Ein laufendes Spiel schlägt „abgeschlossen" — der Status kann nachhinken', () => {
    expect(
      naechsterAbstand({
        tournament: { status: 'finished' },
        matches: [{ isLive: true }],
      })
    ).toBe(TAKT_LIVE);
  });

  it('Noch nie geladen heißt Turniertag, nicht Ruhe', () => {
    expect(naechsterAbstand(null)).toBe(TAKT_TAG);
    expect(naechsterAbstand(undefined)).toBe(TAKT_TAG);
    expect(naechsterAbstand({})).toBe(TAKT_TAG);
  });
});

describe('Nach einem Fehlversuch: erst schnell, dann nachgebend', () => {
  it('Der erste Nachfassversuch kommt binnen fünf Sekunden', () => {
    expect(abstandNachFehler(1)).toBe(5_000);
  });

  it('Die Abstände wachsen und bleiben bei einer Minute stehen', () => {
    const folge = [1, 2, 3, 4, 5, 12].map(abstandNachFehler);
    expect(folge).toEqual([5_000, 10_000, 20_000, 60_000, 60_000, 60_000]);
  });

  it('Unsinnige Zähler kippen nicht auf undefined', () => {
    expect(abstandNachFehler(0)).toBe(5_000);
    expect(abstandNachFehler(-3)).toBe(5_000);
    expect(abstandNachFehler(NaN)).toBe(5_000);
  });
});

describe('Verdrahtung: Pille in live.html, Zugriff in live.js', () => {
  for (const id of ['lr', 'lr-label', 'lr-zeit']) {
    it(`live.html hat #${id}, live.js greift darauf zu`, () => {
      expect(liveHtml).toContain(`id="${id}"`);
      expect(liveJs).toContain(`getElementById('${id}')`);
    });
  }

  it('Die Pille steht außerhalb von #app — sonst löscht zeichne() sie weg', () => {
    const app = liveHtml.indexOf('id="app"');
    const appEnde = liveHtml.indexOf('</div>', app);
    const pille = liveHtml.indexOf('id="lr"');
    expect(app).toBeGreaterThan(-1);
    expect(pille).toBeGreaterThan(appEnde);
  });

  it('Der Knopf ist ein <button type="button"> — kein div, das man nicht antippen kann', () => {
    expect(liveHtml).toMatch(/<button[^>]*class="lr"[^>]*type="button"/);
  });

  it('Tippen löst einen Abruf aus', () => {
    expect(liveJs).toContain("knopf.addEventListener('click'");
    expect(liveJs).toContain('laden({ manuell: true })');
  });

  it('Es gibt nur EINEN Zeitgeber, und er wird vor jedem Neuplanen gelöscht', () => {
    expect(liveJs).not.toContain('setInterval');
    expect(liveJs).toContain('clearTimeout(zeitgeber)');
  });

  it('Im Hintergrund ruht die Seite', () => {
    expect(liveJs).toContain("document.visibilityState === 'hidden'");
  });

  it('Der Takt kommt aus live-takt.js, nicht aus einer zweiten Konstante', () => {
    expect(liveJs).toContain("from './live-takt.js'");
    expect(liveJs).not.toContain('REFRESH_MS');
  });
});
