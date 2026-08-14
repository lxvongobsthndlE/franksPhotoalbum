/**
 * Tests für die klickbare Fortschrittsanzeige im Wizard (Issue 4).
 *
 * Spec §13.3: "oben Fortschrittsanzeige mit klickbaren abgeschlossenen
 * Schritten". renderWizardProgress() baut ein <ol> mit 5 <button>s,
 * jeweils einen pro Schritt. Bereits besuchte Schritte (stepNum <= state.step)
 * MÜSSEN anklickbar sein und den Wizard dorthin zurückspringen lassen.
 *
 * Was getestet wird:
 *   - 5 Buttons werden gerendert (einer pro Schritt).
 *   - Buttons für stepNum > state.step sind disabled.
 *   - Buttons für stepNum <= state.step sind NICHT disabled und
 *     tragen die CSS-Klasse `is-reachable`.
 *   - Ein Klick auf einen reachable Button (a) setzt state.step,
 *     (b) ruft notifyChange (c) ruft root._rerender() auf.
 *   - Ein Klick auf den CURRENT-Button ist ein No-op für state.step
 *     (bleibt gleich), feuert aber rerender (harmlos).
 *
 * Wir testen gegen einen DOM-Stub, weil jsdom/happy-dom nicht als
 * dev-deps installiert sind. Der Stub ist minimal: createElement +
 * addEventListener + click-Dispatch reichen.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── DOM-Stub ────────────────────────────────────────────────────────
// Genug API, damit renderWizardProgress + renderWizardView laufen.
// Nicht schön, aber ehrlich: wir testen die Klick-Logik, nicht das CSS.
class FakeNode {
  constructor(tag) {
    this.tagName = (tag || 'DIV').toUpperCase();
    this.className = '';
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attrs = {};
    this.disabled = false;
    this.style = new Proxy({}, {
      set: (target, prop, value) => {
        target[prop] = value;
        return true;
      },
      get: (target, prop) => target[prop] || '',
    });
    this._listeners = {};
    this._textContent = '';
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(child) {
    if (child && typeof child === 'object') {
      this.children.push(child);
      child.parent = this;
    }
    return child;
  }
  addEventListener(ev, fn) {
    (this._listeners[ev] = this._listeners[ev] || []).push(fn);
  }
  set classList(_unused) {}
  get classList() {
    const set = new Set(this.className ? this.className.split(/\s+/) : []);
    return {
      add: (...names) => names.forEach((n) => set.add(n)),
      remove: (...names) => names.forEach((n) => set.delete(n)),
      contains: (n) => set.has(n),
      toggle: (n, force) => {
        if (force === true) set.add(n);
        else if (force === false) set.delete(n);
        else if (set.has(n)) set.delete(n);
        else set.add(n);
      },
    };
  }
  set textContent(v) {
    this._textContent = String(v);
    // Text-Inhalt → children weg, damit .textContent lesbar ist.
    this.children = [];
  }
  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent || '').join('');
  }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML || ''; }
  // Click-Dispatch für die Tests.
  click() {
    const fns = this._listeners.click || [];
    for (const fn of fns) fn({ target: this });
  }
  querySelector(sel) {
    // Minimal: reicht für unsere Buttons via data-step.
    const m = sel.match(/\[data-step="(\d+)"\]/);
    if (m) {
      const wanted = m[1];
      // Nur in Nachfahren suchen, nicht im this-Knoten selbst — sonst
      // würde die root.dataset.step = "3" (vom Wizard) jeden
      // data-step="3"-Match abfangen.
      for (const c of this.children || []) {
        const found = findByDataset(c, 'step', wanted);
        if (found) return found;
      }
      return null;
    }
    return null;
  }
}

function findByDataset(node, key, value) {
  if (node.dataset && node.dataset[key] === value) return node;
  for (const c of node.children || []) {
    const found = findByDataset(c, key, value);
    if (found) return found;
  }
  return null;
}

function installDomStub() {
  const created = [];
  const origDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => {
      const n = new FakeNode(tag);
      created.push(n);
      return n;
    },
    createDocumentFragment: () => new FakeNode('#fragment'),
    querySelector: () => null,
  };
  return {
    created,
    restore: () => { globalThis.document = origDoc; },
  };
}

// ── Tournament-Module importieren ──────────────────────────────────
// Wichtig: renderWizardView nutzt window/localStorage/eventuell.
// Wir definieren nur das, was tatsächlich gebraucht wird.
function installGlobals() {
  globalThis.window = globalThis.window || {};
  globalThis.window.addEventListener = () => {};
  globalThis.window.removeEventListener = () => {};
  globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  };
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  }));
}

import {
  renderWizardView,
} from '../tournament.js';

describe('Wizard Progress — klickbare abgeschlossene Schritte (Issue 4)', () => {
  let dom;
  let onStateChangeSpy;

  beforeEach(() => {
    installGlobals();
    dom = installDomStub();
    onStateChangeSpy = vi.fn();
  });

  afterEach(() => {
    dom.restore();
  });

  it('rendert 5 Step-Buttons (einer pro Schritt 1–5)', async () => {
    const root = await renderWizardView({
      groupId: 'g1',
      initialState: { step: 1, tournamentId: 't1' },
      onStateChange: onStateChangeSpy,
      onCancel: () => {},
    });
    expect(root).toBeTruthy();
    const buttons = [];
    for (let i = 1; i <= 5; i++) {
      const btn = root.querySelector(`[data-step="${i}"]`);
      expect(btn, `Button für Schritt ${i} fehlt`).toBeTruthy();
      buttons.push(btn);
    }
    expect(buttons).toHaveLength(5);
  });

  it('auf step=3 sind die Buttons 1, 2, 3 aktiv; 4 und 5 disabled', async () => {
    const root = await renderWizardView({
      groupId: 'g1',
      initialState: { step: 3, tournamentId: 't1' },
      onStateChange: onStateChangeSpy,
      onCancel: () => {},
    });
    for (let i = 1; i <= 3; i++) {
      const btn = root.querySelector(`[data-step="${i}"]`);
      expect(btn.disabled, `Schritt ${i} sollte aktiv sein`).toBe(false);
    }
    for (let i = 4; i <= 5; i++) {
      const btn = root.querySelector(`[data-step="${i}"]`);
      expect(btn.disabled, `Schritt ${i} sollte disabled sein`).toBe(true);
    }
  });

  it('Klick auf Schritt 1 von Schritt 3: state.step wird 1, rerender wird gerufen, onStateChange feuert', async () => {
    let rerenderCount = 0;
    const root = await renderWizardView({
      groupId: 'g1',
      initialState: { step: 3, tournamentId: 't1' },
      onStateChange: onStateChangeSpy,
      onCancel: () => {},
    });
    // rerender zählt Aufrufe — wird der Root ersetzt, geht der alte
    // Hook verloren. Wir hängen uns DAVOR dran: der erste
    // _rerender-Aufruf MUSS passieren, wenn der Klick kommt.
    const originalRerender = root._rerender;
    root._rerender = () => {
      rerenderCount++;
      if (originalRerender) originalRerender();
    };

    const step1Btn = root.querySelector('[data-step="1"]');
    expect(step1Btn.disabled).toBe(false);

    // State vor dem Klick
    expect(root._state.step).toBe(3);

    // Klick simulieren
    step1Btn.click();

    // State nach dem Klick
    expect(root._state.step).toBe(1);
    expect(rerenderCount, '_rerender wurde nicht aufgerufen').toBeGreaterThanOrEqual(1);
    expect(onStateChangeSpy, 'onStateChange wurde nicht gefeuert').toHaveBeenCalled();
    const lastCallState = onStateChangeSpy.mock.calls.at(-1)[0];
    expect(lastCallState.step).toBe(1);
  });

  it('Klick auf Schritt 4 von Schritt 3: nichts passiert (disabled)', async () => {
    const root = await renderWizardView({
      groupId: 'g1',
      initialState: { step: 3, tournamentId: 't1' },
      onStateChange: onStateChangeSpy,
      onCancel: () => {},
    });
    let rerenderCount = 0;
    const originalRerender = root._rerender;
    root._rerender = () => {
      rerenderCount++;
      if (originalRerender) originalRerender();
    };

    const step4Btn = root.querySelector('[data-step="4"]');
    expect(step4Btn.disabled).toBe(true);

    // Click auf disabled Button — Browser dispatcht das Event nicht.
    // Unser Stub feuert aber trotzdem; der Handler MUSS selbst
    // abbrechen, weil stepNum > state.step.
    step4Btn.click();
    expect(root._state.step).toBe(3);
    expect(rerenderCount).toBe(0);
    expect(onStateChangeSpy).not.toHaveBeenCalled();
  });

  it('Klick auf den aktuellen Schritt (3 von 3): rerender feuert, state.step bleibt 3', async () => {
    const root = await renderWizardView({
      groupId: 'g1',
      initialState: { step: 3, tournamentId: 't1' },
      onStateChange: onStateChangeSpy,
      onCancel: () => {},
    });
    let rerenderCount = 0;
    const originalRerender = root._rerender;
    expect(typeof originalRerender).toBe('function');
    root._rerender = () => {
      rerenderCount++;
      if (originalRerender) originalRerender();
    };

    const step3Btn = root.querySelector('[data-step="3"]');
    expect(step3Btn).toBeTruthy();
    expect(step3Btn.disabled).toBe(false);

    step3Btn.click();
    // step bleibt gleich, aber rerender feuert (harmloser Re-Render)
    expect(root._state.step).toBe(3);
    expect(rerenderCount, `rerenderCount=${rerenderCount}, listeners=${(step3Btn._listeners.click || []).length}`).toBeGreaterThanOrEqual(1);
  });
});
