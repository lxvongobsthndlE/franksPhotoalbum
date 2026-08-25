/**
 * Betriebsfestigkeit A5 (2026-08-25): der Tab blieb dauerhaft kaputt.
 *
 * Fehlerklasse
 * ------------
 *   Die drei Lazy-Tabs setzten `mount.dataset.loaded = '1'` VOR dem
 *   `await`. Schlug das Laden fehl — Funkloch an der Platte, 500 vom
 *   Server —, blieb die Markierung stehen. Wegklicken und
 *   Zurueckklicken luden nicht mehr nach: der Tab war fuer den Rest der
 *   Sitzung leer. Einen Weg zurueck gab es nicht; nur die Listenseite
 *   bot in derselben Lage einen „Erneut versuchen"-Knopf.
 *
 *   Dazu kam: `loadStandingsTab` und `loadBracketTab` fingen ihren
 *   Fehler selbst ab und liefen erfolgreich zurueck. Selbst ein
 *   korrekter Lade-Zustandsautomat haette den Fehlschlag nie gesehen —
 *   deshalb werfen beide jetzt weiter, NACHDEM sie ihren Kartentext
 *   gesetzt haben.
 *
 * Was hier geprueft wird
 * ----------------------
 *   1. VERHALTEN von `startTabLoad` und `renderTabLoadError`, aus dem
 *      echten Quelltext geschnitten und an Fake-Knoten ausgefuehrt
 *      (kein jsdom im Projekt).
 *   2. STRUKTUR: kein Tab markiert sich mehr VOR dem Laden als geladen,
 *      und die beiden fetchenden Lader werfen weiter.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as acorn from 'acorn';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAIN = path.resolve(__dirname, '..', 'main.js');
const src = fs.readFileSync(MAIN, 'utf-8');
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module', locations: true });

function schneide(name) {
  const treffer = ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name);
  if (!treffer) throw new Error(`${name} existiert nicht auf Modulebene in main.js`);
  return src.slice(treffer.start, treffer.end);
}

const quelle = [schneide('startTabLoad'), schneide('renderTabLoadError')].join('\n');

/** Minimaler Mount-Ersatz: nur die Beruehrungspunkte der beiden Helfer. */
function fakeMount() {
  const knoepfe = [];
  return {
    dataset: {},
    innerHTML: '',
    knoepfe,
    querySelector(sel) {
      if (sel !== '[data-action="retry-tab-load"]') return null;
      if (!this.innerHTML.includes('data-action="retry-tab-load"')) return null;
      const btn = { addEventListener(typ, fn) { if (typ === 'click') this._fn = fn; }, klick() { this._fn?.({}); } };
      knoepfe.push(btn);
      return btn;
    },
  };
}

function lade() {
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'console',
    'esc',
    `${quelle}\nreturn { startTabLoad, renderTabLoadError };`,
  );
  return factory({ warn() {} }, (s) => String(s ?? ''));
}

const ruhe = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('startTabLoad: der Fehlschlag ist kein Endzustand', () => {
  const { startTabLoad } = lade();

  it('markiert erst NACH erfolgreichem Laden als geladen', async () => {
    const mount = fakeMount();
    let aufgeloest;
    const loader = () => new Promise((r) => { aufgeloest = r; });
    startTabLoad(mount, 'Die Teamliste', loader);
    await ruhe();
    expect(mount.dataset.loaded, 'waehrend des Ladens muss der Zustand pending sein').toBe('pending');
    aufgeloest();
    await ruhe();
    expect(mount.dataset.loaded).toBe('1');
  });

  it('nimmt die Markierung bei Fehlschlag WIEDER WEG', async () => {
    const mount = fakeMount();
    startTabLoad(mount, 'Die Teamliste', async () => { throw new Error('HTTP 500'); });
    await ruhe();
    expect(mount.dataset.loaded, 'ein fehlgeschlagener Tab darf nicht als geladen gelten').toBeUndefined();
  });

  it('der naechste Tab-Klick laedt nach einem Fehlschlag von selbst neu', async () => {
    const mount = fakeMount();
    let versuche = 0;
    const loader = async () => { versuche += 1; throw new Error('HTTP 500'); };
    startTabLoad(mount, 'Die Teamliste', loader);
    await ruhe();
    startTabLoad(mount, 'Die Teamliste', loader); // erneuter Tab-Wechsel
    await ruhe();
    expect(versuche).toBe(2);
  });

  it('blockt eine zweite Ladung, solange die erste laeuft', async () => {
    const mount = fakeMount();
    let versuche = 0;
    const loader = () => { versuche += 1; return new Promise(() => {}); };
    startTabLoad(mount, 'Die Teamliste', loader);
    startTabLoad(mount, 'Die Teamliste', loader);
    await ruhe();
    expect(versuche).toBe(1);
  });

  it('laedt einen bereits geladenen Tab nicht erneut', async () => {
    const mount = fakeMount();
    let versuche = 0;
    const loader = async () => { versuche += 1; };
    startTabLoad(mount, 'Die Teamliste', loader);
    await ruhe();
    startTabLoad(mount, 'Die Teamliste', loader);
    await ruhe();
    expect(versuche).toBe(1);
  });

  it('zeigt bei Fehlschlag ein Fehlerbild mit Erneut-Knopf', async () => {
    const mount = fakeMount();
    startTabLoad(mount, 'Der Turnierbaum', async () => { throw new Error('HTTP 500'); });
    await ruhe();
    expect(mount.innerHTML).toContain('Der Turnierbaum konnte nicht geladen werden.');
    expect(mount.innerHTML).toContain('data-action="retry-tab-load"');
    expect(mount.innerHTML).toContain('Erneut versuchen');
  });

  it('der Knopf startet wirklich einen neuen Versuch', async () => {
    const mount = fakeMount();
    let versuche = 0;
    startTabLoad(mount, 'Der Turnierbaum', async () => { versuche += 1; throw new Error('HTTP 500'); });
    await ruhe();
    expect(versuche).toBe(1);
    mount.knoepfe.at(-1).klick();
    await ruhe();
    expect(versuche).toBe(2);
  });

  it('ohne Mount passiert nichts', () => {
    const { startTabLoad: s } = lade();
    expect(() => s(null, 'X', async () => {})).not.toThrow();
  });
});

describe('renderTabLoadError: die Detailzeile ist optional', () => {
  const { renderTabLoadError } = lade();

  it('ohne Detail nur der Klartext', () => {
    const mount = fakeMount();
    renderTabLoadError(mount, 'Die Einstellungen', () => {});
    expect(mount.innerHTML).toContain('Die Einstellungen konnte nicht geladen werden.');
    expect(mount.innerHTML).not.toContain('t-hint--error');
  });

  it('mit Detail steht die Serverantwort dabei', () => {
    const mount = fakeMount();
    renderTabLoadError(mount, 'Die Einstellungen', () => {}, 'groups is not iterable');
    expect(mount.innerHTML).toContain('groups is not iterable');
    expect(mount.innerHTML).toContain('t-hint--error');
  });
});

// ── Struktur ─────────────────────────────────────────────────────────
describe('Struktur: kein Tab markiert sich mehr vor dem Laden', () => {
  it("handleTournamentTabSideEffects setzt dataset.loaded = '1' nicht mehr selbst", () => {
    const fn = schneide('handleTournamentTabSideEffects');
    expect(fn).not.toContain("dataset.loaded = '1'");
    expect(fn).not.toContain('!mount.dataset.loaded');
  });

  for (const [view, lader] of [['teams', 'loadTeamsTab'], ['gruppen', 'loadStandingsTab'], ['baum', 'loadBracketTab']]) {
    it(`${view}-Tab laeuft ueber startTabLoad (${lader})`, () => {
      const fn = schneide('handleTournamentTabSideEffects');
      const ab = fn.indexOf(`view === '${view}'`);
      expect(ab, `Zweig fuer ${view} nicht gefunden`).toBeGreaterThan(-1);
      const zweig = fn.slice(ab, ab + 400);
      expect(zweig).toContain('startTabLoad(');
      expect(zweig).toContain(lader);
    });
  }

  for (const lader of ['loadStandingsTab', 'loadBracketTab']) {
    it(`${lader} wirft weiter — sonst sieht startTabLoad den Fehlschlag nie`, () => {
      const fn = schneide(lader);
      const nachCatch = fn.slice(fn.lastIndexOf('} catch'));
      expect(nachCatch, `${lader} verschluckt seinen Fehler`).toContain('throw e;');
    });
  }

  it('der Erneut-Knopf ist auch im Einstellungen-Tab verdrahtet', () => {
    const fn = schneide('loadEinstellungenTab');
    expect(fn).toContain('renderTabLoadError(mount,');
  });
});

// ── Auftrag C: Drucken-Tab ───────────────────────────────────────────
describe('Drucken-Tab hat echten Inhalt statt eines Platzhalters', () => {
  const html = (() => {
    // eslint-disable-next-line no-new-func
    return new Function(`${schneide('renderDruckenView')}\nreturn renderDruckenView();`)();
  })();

  it('der Platzhalter ist raus', () => {
    expect(src).not.toContain("placeholder('Die Druckansicht'");
    expect(src).not.toContain('Kommt in Etappe B.6.');
  });

  it('erklaert, was auf das Papier geht', () => {
    expect(html).toMatch(/Spielplan/);
    expect(html).toMatch(/Gruppentabellen/);
    expect(html).toMatch(/K\.-o\.-Baum/);
  });

  it('hat einen Knopf, der den bestehenden print-Handler trifft', () => {
    expect(html).toContain('data-action="print"');
    expect(html).toContain('Jetzt drucken');
    // Der Handler haengt am Detail-Container und faengt jeden Treffer.
    expect(src).toContain(`detail.querySelectorAll('[data-action="print"]')`);
    expect(src).toContain('window.print()');
  });

  it('wird im drucken-View gerendert', () => {
    expect(src).toContain('${renderDruckenView()}');
  });

  it('bringt kein eigenes CSS mit — das Drucklayout kommt aus dem Stylesheet', () => {
    expect(html).not.toMatch(/<style|style="/);
  });
});
