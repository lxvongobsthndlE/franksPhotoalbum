/**
 * Der Modulkopf — Artefakt „Turniermodul ohne Kaestchen", Abschnitt 01.
 *
 * Zwei Aussagen werden hier festgehalten, weil beide schon einmal
 * verlorengegangen sind:
 *
 *  1. OHNE LOGO KEIN PLATZHALTER. Kein grauer Ersatzkasten, kein
 *     Anfangsbuchstabe im Kreis, keine reservierte Spalte. Die Mehrheit
 *     der Turniere hat kein Logo, und eine leere Stelle faellt staerker
 *     auf als gar nichts. Das Raster entsteht deshalb ueber eine Klasse
 *     AM KOPF, nicht ueber ein leeres Bild.
 *
 *  2. Der Kopf steht an EINER Stelle. main.js hatte ihn bis zum
 *     2026-08-26 als Template-Literal, der Pruefstand eine zweite Kopie
 *     davon. Zwei Kopien desselben Markups laufen auseinander — und ein
 *     Pruefstand mit nachgetipptem Markup hat in diesem Repo schon
 *     fuenfmal einen intakten Zustand fuer kaputt erklaert.
 *
 * Das Logo selbst war vorher hochladbar, aber in keiner Ansicht zu
 * sehen; die Bilanz des Artefakts fuehrt es als „0 → 3".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderModulKopf } from '../tournament-render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(resolve(__dirname, '..', ...p), 'utf-8');

describe('renderModulKopf — mit Logo', () => {
  const html = renderModulKopf({ t: { logoUrl: '/api/tournaments/t1/logo' }, titel: 'Spielplan' });

  it('rendert das Bild und schaltet das Raster ein', () => {
    expect(html).toContain('class="t-mod-logo"');
    expect(html).toContain('src="/api/tournaments/t1/logo"');
    expect(html).toContain('t-mod-header-inner--logo');
  });

  it('das Logo ist dekorativ: leeres alt und aria-hidden', () => {
    // Der Turniername steht eine Zeile weiter im Kicker. Ein zweites Mal
    // vorgelesen zu werden ist fuer eine Bildschirmleserin kein Gewinn.
    expect(html).toMatch(/<img class="t-mod-logo"[^>]*alt=""/);
    expect(html).toMatch(/<img class="t-mod-logo"[^>]*aria-hidden="true"/);
  });

  it('der Cache-Buster haengt nur dran, wenn er verlangt wird', () => {
    // Der Dateiname am Server ist fuer alle Turniere gleich („logo") —
    // nach einem Austausch zeigt der Browser sonst das alte Bild. Der
    // Pruefstand braucht ihn nicht und bekommt ihn auch nicht.
    const mit = renderModulKopf({ t: { logoUrl: '/l' }, cacheBust: 1234 });
    expect(mit).toContain('src="/l?v=1234"');
    const mitFrage = renderModulKopf({ t: { logoUrl: '/l?x=1' }, cacheBust: 1234 });
    expect(mitFrage).toContain('src="/l?x=1&v=1234"');
    expect(html).toContain('src="/api/tournaments/t1/logo"');
    expect(html).not.toContain('?v=');
  });
});

describe('renderModulKopf — ohne Logo', () => {
  for (const [fall, t] of Object.entries({
    'logoUrl null': { logoUrl: null },
    'logoUrl leer': { logoUrl: '' },
    'Feld fehlt': {},
    'kein Turnier': undefined,
  })) {
    it(`${fall}: kein Bild, kein Platzhalter, kein Raster`, () => {
      const ohne = renderModulKopf({ t, titel: 'Gruppen' });
      expect(ohne).not.toContain('<img');
      expect(ohne).not.toContain('t-mod-header-inner--logo');
      // Weder ein Ersatzkasten noch ein Anfangsbuchstabe.
      expect(ohne).not.toContain('t-logo');
      expect(ohne).toContain('class="t-mod-header-inner"');
    });
  }
});

describe('renderModulKopf — der Vertrag mit applyViewChrome', () => {
  const html = renderModulKopf({ t: {}, titel: 'Spielplan' });

  it('liefert die drei Anker, die die Ansicht spaeter beschriftet', () => {
    // applyViewChrome() setzt Kicker-Text, Titel und Aktion je Ansicht.
    // Fehlt einer davon, bleibt die Kopfzeile stumm — und zwar still.
    expect(html).toContain('class="t-mod-kicker-text"');
    expect(html).toContain('data-view-title');
    expect(html).toContain('data-view-action');
  });

  it('die Aktion startet versteckt', () => {
    // Nicht jede Ansicht hat eine. Ein leerer Knopf waere eine Zusage.
    expect(html).toMatch(/class="t-mod-action" data-view-action hidden/);
  });

  it('escaped den Titel', () => {
    expect(renderModulKopf({ t: {}, titel: '<script>' })).toContain('&lt;script&gt;');
  });
});

describe('Der Kopf steht an einer Stelle', () => {
  const mainJs = read('main.js');
  const pruefstand = read('pruefstand-marke.js');

  it('main.js baut den Kopf ueber den Renderer, nicht als eigenes Literal', () => {
    expect(mainJs).toContain('renderModulKopf({');
    expect(mainJs).toMatch(/import \{[\s\S]*?renderModulKopf/);
  });

  it('der Pruefstand benutzt denselben Renderer', () => {
    // Sonst zeigt er einen Kopf, den es in der App nicht gibt.
    expect(pruefstand).toContain('renderModulKopf(');
  });

  it('niemand tippt die Kopfzeile noch von Hand nach', () => {
    for (const [name, quelle] of Object.entries({ 'main.js': mainJs, 'pruefstand-marke.js': pruefstand })) {
      const treffer = (quelle.match(/class="t-mod-kicker-text"/g) || []).length;
      expect(treffer, `${name} enthaelt eine zweite Kopie des Kopf-Markups`).toBe(0);
    }
  });
});
