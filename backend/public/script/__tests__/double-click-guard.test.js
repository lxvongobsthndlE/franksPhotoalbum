/**
 * Betriebsfestigkeit A2 (2026-08-25): Doppelklick feuert zweimal.
 *
 * Fehlerklasse
 * ------------
 *   Elf mutierende Aktionen im Turniermodul hatten keine Sperre. Der
 *   teuerste Fall ist `randomize-groups` →
 *   `POST /:id/balance-shuffle-groups`: die Route wuerfelt bei JEDEM
 *   Aufruf neu und kennt keinen Vorzustand. Zwei Klicks — am Handy, an
 *   der Platte, mit einer Hand — heissen zwei Auslosungen. Der Nutzer
 *   sieht die erste aufblitzen und behaelt die zweite. Es gibt kein
 *   Zurueck: die alte Zuordnung ist weg.
 *
 *   Drei Stellen im selben File machten es schon richtig
 *   (Ergebnis-Speichern, Paar-Tausch, Fill-KO): Knopf vor dem `await`
 *   sperren, im Fehlerfall wieder freigeben. `runGuardedAction` /
 *   `wireGuardedClick` schreiben genau diese Machart einmal auf.
 *
 * Zwei Ebenen
 * -----------
 *   1. VERHALTEN: beide Helfer werden aus dem echten Quelltext
 *      geschnitten und an einem Fake-Knopf ausgefuehrt. Kein jsdom im
 *      Projekt — der Fake deckt genau die vier Beruehrungspunkte ab
 *      (`dataset`, `disabled`, `setAttribute`, `addEventListener`).
 *   2. ABDECKUNG: alle elf Aktionen benutzen den Helfer wirklich.
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

// Beide Helfer zusammen laden — wireGuardedClick ruft runGuardedAction.
const helferQuelle = `${schneide('runGuardedAction')}\n${schneide('wireGuardedClick')}`;
// eslint-disable-next-line no-new-func
const ladeHelfer = new Function(
  'console',
  `${helferQuelle}\nreturn { runGuardedAction, wireGuardedClick };`
);
const { runGuardedAction, wireGuardedClick } = ladeHelfer({ error() {} });

/** Minimaler Knopf-Ersatz: genau die Eigenschaften, die der Helfer anfasst. */
function fakeKnopf({ disabled = false } = {}) {
  const listener = [];
  return {
    dataset: {},
    disabled,
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    addEventListener(typ, fn) {
      if (typ === 'click') listener.push(fn);
    },
    klick() {
      for (const fn of listener) fn({ type: 'click' });
    },
  };
}

const spaeter = () => new Promise((r) => setTimeout(r, 0));

describe('runGuardedAction: der zweite Klick faellt auf den Boden', () => {
  it('laesst genau EINEN Durchlauf zu, solange der erste laeuft', async () => {
    const btn = fakeKnopf();
    let laeuft = 0;
    let fertig = 0;
    let loesen;
    const handler = async () => {
      laeuft += 1;
      await new Promise((r) => {
        loesen = r;
      });
      fertig += 1;
    };
    const a = runGuardedAction(btn, handler);
    const b = runGuardedAction(btn, handler); // Doppelklick
    await spaeter();
    expect(laeuft).toBe(1);
    await expect(b).resolves.toBeUndefined();
    loesen();
    await a;
    expect(fertig).toBe(1);
  });

  it('sperrt den Knopf waehrend des Laufs und markiert ihn als beschaeftigt', async () => {
    const btn = fakeKnopf();
    let loesen;
    const lauf = runGuardedAction(
      btn,
      () =>
        new Promise((r) => {
          loesen = r;
        })
    );
    await spaeter();
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.busy).toBe('1');
    expect(btn.attrs['aria-busy']).toBe('true');
    loesen();
    await lauf;
    expect(btn.dataset.busy).toBeUndefined();
    expect(btn.attrs['aria-busy']).toBeUndefined();
  });

  it('gibt den Knopf auch frei, wenn der Handler wirft', async () => {
    const btn = fakeKnopf();
    await expect(
      runGuardedAction(btn, async () => {
        throw new Error('409');
      })
    ).rejects.toThrow('409');
    expect(btn.disabled).toBe(false);
    expect(btn.dataset.busy).toBeUndefined();
  });

  it('schaltet einen vom Renderer gesperrten Knopf NICHT frei', async () => {
    // Lock-Faelle: „Turnier starten" ist bei laufendem Turnier disabled.
    // Die Doppelklick-Sperre darf diesen Zustand nicht aufheben.
    const btn = fakeKnopf({ disabled: true });
    await runGuardedAction(btn, async () => {});
    expect(btn.disabled).toBe(true);
  });

  it('ohne Knopf (delegierter Fall ohne Treffer) laeuft der Handler trotzdem', async () => {
    let n = 0;
    await runGuardedAction(null, async () => {
      n += 1;
    });
    expect(n).toBe(1);
  });

  it('nach dem Lauf ist der Knopf wieder klickbar — die Sperre ist keine Einbahnstrasse', async () => {
    const btn = fakeKnopf();
    let n = 0;
    await runGuardedAction(btn, async () => {
      n += 1;
    });
    await runGuardedAction(btn, async () => {
      n += 1;
    });
    expect(n).toBe(2);
  });
});

describe('wireGuardedClick: derselbe Schutz am Listener', () => {
  it('zwei schnelle Klicks loesen den Handler genau einmal aus', async () => {
    const btn = fakeKnopf();
    let n = 0;
    let loesen;
    wireGuardedClick(btn, async () => {
      n += 1;
      await new Promise((r) => {
        loesen = r;
      });
    });
    btn.klick();
    btn.klick();
    await spaeter();
    expect(n).toBe(1);
    loesen();
    await spaeter();
  });

  it('ein werfender Handler erzeugt keine unbehandelte Rejection', async () => {
    const btn = fakeKnopf();
    const fehler = [];
    const { wireGuardedClick: wgc } = ladeHelfer({ error: (...a) => fehler.push(a) });
    wgc(btn, async () => {
      throw new Error('kaputt');
    });
    btn.klick();
    await spaeter();
    expect(fehler).toHaveLength(1);
    expect(btn.disabled).toBe(false);
  });

  it('ohne Knopf passiert nichts (kein Absturz beim Verdrahten)', () => {
    expect(() => wireGuardedClick(null, async () => {})).not.toThrow();
  });
});

// ── Abdeckung ────────────────────────────────────────────────────────
/**
 * Die elf Aktionen, die vorher ungeschuetzt waren. Jede Zeile ist ein
 * Knopf, der eine Mutation ausloest — Reihenfolge wie im
 * Einstellungen-Tab, dazu der delegierte Spielplan-Speichern-Knopf.
 */
const GESCHUETZTE_AKTIONEN = [
  ['start-tournament', 'startBtn'],
  ['revert-to-draft', 'revertBtn'],
  ['shift-open', 'shiftBtn'],
  ['reschedule-auto', 'rescheduleAutoBtn'],
  ['finish-tournament', 'finishBtn'],
  ['redraw-seeding', 'redrawSeedingBtn'],
  ['randomize-groups', 'randomBtn'],
  ['save-fields', 'saveFieldsBtn'],
  ['reset-results', 'resetBtn'],
  ['delete-tournament', 'deleteBtn'],
];

describe('Abdeckung: jede mutierende Aktion haengt am Helfer', () => {
  const zeilen = src.split(/\r?\n/);

  for (const [action, variable] of GESCHUETZTE_AKTIONEN) {
    it(`data-action="${action}" wird ueber wireGuardedClick verdrahtet`, () => {
      const i = zeilen.findIndex((l) => l.includes(`querySelector('[data-action="${action}"]')`));
      expect(i, `Verdrahtung fuer ${action} nicht gefunden`).toBeGreaterThan(-1);
      const fenster = zeilen.slice(i, i + 6).join('\n');
      expect(
        fenster,
        `${action} (main.js:${i + 1}) haengt noch an addEventListener statt an wireGuardedClick`
      ).toContain(`wireGuardedClick(${variable},`);
      expect(fenster).not.toContain(`${variable}.addEventListener('click'`);
    });
  }

  // Der Test „der delegierte 'Speichern & neu terminieren' laeuft ueber
  // runGuardedAction" ist am 2026-08-26 mit seinem Gegenstand entfallen:
  // der Spielplan-Edit-Modus samt save-/cancel-schedule-edits ist
  // geloescht, weil er seit dem Zeitachsen-Umbau keine Eingabefelder
  // mehr ausgab. `runGuardedAction` bleibt geprueft — ueber die Liste
  // GESCHUETZTE_AKTIONEN oben und den Gegenprobe-Test unten.

  /**
   * Handler mit EIGENER Sperre. `swapConfirmBtn` ist eines der drei
   * Vorbilder, an denen die Machart abgelesen wurde: er setzt
   * `disabled = true` selbst und gibt sich im catch wieder frei. Der
   * Test erkennt das am Quelltext des Handlers, nicht an einer Liste.
   */
  const hatEigeneSperre = (variable, ab) => {
    const koerper = zeilen.slice(ab, ab + 40).join('\n');
    return koerper.includes(`${variable}.disabled = true;`);
  };

  it('kein mutierender Knopf im Einstellungen-Tab haengt ungeschuetzt an addEventListener', () => {
    // Gegenprobe zur Liste oben: wir suchen das ALTE Muster im Bereich
    // von wireEinstellungen. Findet sich dort ein
    // `<x>Btn.addEventListener('click', async` ohne eigene Sperre, ist
    // ein Knopf durchgerutscht.
    const start = zeilen.findIndex((l) => l.includes('function wireEinstellungen('));
    expect(start).toBeGreaterThan(-1);
    let ende = zeilen.length;
    for (let k = start + 1; k < zeilen.length; k++) {
      if (/^function |^async function /.test(zeilen[k])) {
        ende = k;
        break;
      }
    }
    const durchgerutscht = [];
    for (let k = start; k < ende; k++) {
      const m = zeilen[k].match(/(\w+Btn)\.addEventListener\('click', async/);
      if (!m) continue;
      if (hatEigeneSperre(m[1], k)) continue;
      durchgerutscht.push(`main.js:${k + 1}  ${zeilen[k].trim()}`);
    }
    expect(durchgerutscht, 'ungeschuetzte Klick-Handler:\n' + durchgerutscht.join('\n')).toEqual(
      []
    );
  });
});
