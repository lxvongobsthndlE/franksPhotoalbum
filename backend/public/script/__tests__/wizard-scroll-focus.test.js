/**
 * Regressionsschutz: der Wizard darf beim Ändern einer Einstellung
 * nicht nach oben springen.
 *
 * Nutzermeldung (29.08.2026): „Bei Wizard: wenn ich was anpasse also
 * eine Einstellung mache, springt er nach oben statt dort zu bleiben."
 *
 * Ursache war refreshShell(): die Funktion stand viermal wortgleich in
 * tournament.js und rief blank `root.parentNode.replaceChild(fresh,
 * root)`. Der frische Baum ist ein anderes DOM-Objekt — der Fokus des
 * gerade gedrückten Knopfes fiel auf <body> (in Edge headless gemessen:
 * activeElement === 'BODY' nach jedem Stepper-Klick), und jeder
 * Scroll-Container über dem Wizard klemmte seinen scrollTop auf den
 * neuen Maximalwert, sobald der frische Baum auch nur kurz kürzer war
 * als der alte.
 *
 * Getestet wird das Paar captureWizardViewport/restoreWizardViewport
 * gegen eine Mini-DOM-Attrappe (das Projekt hat kein jsdom, siehe
 * nachtmodus-app-wahl.test.js für dasselbe Muster) plus ein Quelltext-
 * Scan, der verhindert, dass jemand die vier Kopien wieder auf ein
 * blankes replaceChild zurückdreht.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureWizardViewport, restoreWizardViewport } from '../tournament.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const QUELLE = fs.readFileSync(path.join(HIER, '..', 'tournament.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────
// Mini-DOM: nur so viel, wie die beiden Funktionen anfassen.
// ─────────────────────────────────────────────────────────────────

class FakeDoc {
  constructor() {
    this.activeElement = null;
    // defaultView bewusst ohne requestAnimationFrame: der zweite
    // Anlauf im nächsten Frame ist eine Zugabe, kein Fundament — der
    // synchrone Durchlauf muss allein reichen.
    this.defaultView = {};
  }
}

class FakeEl {
  constructor(tagName, opts = {}) {
    this.tagName = tagName;
    this.nodeType = 1;
    this.parentNode = null;
    this.children = [];
    this.ownerDocument = opts.doc || null;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.disabled = opts.disabled || false;
    if (opts.type) this.type = opts.type;
    this._text = opts.text || '';
    this.focusCalls = [];
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }

  append(...kids) {
    for (const k of kids) {
      k.parentNode = this;
      k.ownerDocument = this.ownerDocument;
      this.children.push(k);
    }
    return this;
  }

  replaceChild(fresh, alt) {
    const i = this.children.indexOf(alt);
    if (i < 0) throw new Error('replaceChild: Kind nicht gefunden');
    this.children[i] = fresh;
    fresh.parentNode = this;
    fresh.ownerDocument = this.ownerDocument;
    alt.parentNode = null;
    return alt;
  }

  focus(opts) {
    this.focusCalls.push(opts);
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
}

/**
 * Baut eine Wizard-ähnliche Schale nach:
 *   scroller (#content)
 *     └ root (.t-mod.t-wizard)
 *         ├ [banner]        (optional — taucht bei mancher Konstellation auf)
 *         ├ feld
 *         │   ├ label
 *         │   └ stepper ( – | zahl | + )
 *         └ eingabe (input)
 */
function baueSchale(doc, { mitBanner = false, plusDisabled = false } = {}) {
  const root = new FakeEl('DIV', { doc });
  if (mitBanner) root.append(new FakeEl('DIV', { doc, text: 'Konstellation problematisch' }));

  const feld = new FakeEl('DIV', { doc });
  const stepper = new FakeEl('DIV', { doc });
  const minus = new FakeEl('BUTTON', { doc, text: '–' });
  const zahl = new FakeEl('SPAN', { doc, text: '3' });
  const plus = new FakeEl('BUTTON', { doc, text: '+', disabled: plusDisabled });
  stepper.append(minus, zahl, plus);
  feld.append(new FakeEl('SPAN', { doc, text: 'Beste Drittplatzierte' }), stepper);

  const eingabe = new FakeEl('INPUT', { doc, type: 'text' });
  eingabe.selectionStart = 0;
  eingabe.selectionEnd = 0;
  eingabe.setSelectionRange = (a, b) => {
    eingabe.selectionStart = a;
    eingabe.selectionEnd = b;
  };

  root.append(feld, eingabe);
  return { root, minus, zahl, plus, eingabe };
}

/**
 * Baut eine Team-Liste nach, wie sie Schritt 2 rendert:
 *   ol
 *    └ li.t-wizard-team-row  (pro Team)
 *        ├ input (Teamname — die EINZIGE Unterscheidung der Zeilen)
 *        └ span
 *            ├ button ↑
 *            ├ button ↓
 *            └ button Löschen
 * Der sichtbare Text ist bei allen Zeilen gleich — genau deshalb muss
 * das Erkennungsmerkmal die Feldinhalte enthalten.
 */
function baueListe(doc, namen) {
  const root = new FakeEl('DIV', { doc });
  const ol = new FakeEl('OL', { doc });
  const zeilen = [];
  for (const name of namen) {
    const li = new FakeEl('LI', { doc });
    const input = new FakeEl('INPUT', { doc, type: 'text' });
    input.value = name;
    const aktionen = new FakeEl('SPAN', { doc });
    const auf = new FakeEl('BUTTON', { doc, text: '\u2191' });
    const ab = new FakeEl('BUTTON', { doc, text: '\u2193' });
    const weg = new FakeEl('BUTTON', { doc, text: 'Löschen' });
    aktionen.append(auf, ab, weg);
    li.append(input, aktionen);
    ol.append(li);
    zeilen.push({ li, input, auf, ab, weg, name });
  }
  root.append(ol);
  const seite = new FakeEl('DIV', { doc });
  seite.append(root);
  return { seite, root, zeilen };
}

function baueSeite(doc, opts) {
  const seite = new FakeEl('DIV', { doc }); // entspricht #content
  const schale = baueSchale(doc, opts);
  seite.append(schale.root);
  return { seite, ...schale };
}

// ─────────────────────────────────────────────────────────────────
// Scrollstand
// ─────────────────────────────────────────────────────────────────

describe('Wizard-Rerender — Scrollstand bleibt stehen', () => {
  it('der Scroller über der Schale behält seinen scrollTop', () => {
    const doc = new FakeDoc();
    const alt = baueSeite(doc);
    alt.seite.scrollTop = 137;

    const schnappschuss = captureWizardViewport(alt.root);

    // Austausch wie in replaceWizardShell(): frischer Baum rein, und
    // der Scroller wird dabei (wie im Browser) auf 0 geklemmt.
    const neu = baueSchale(doc);
    alt.seite.replaceChild(neu.root, alt.root);
    alt.seite.scrollTop = 0;

    restoreWizardViewport(neu.root, schnappschuss);
    expect(alt.seite.scrollTop).toBe(137);
  });

  it('sichert die ganze Vorfahren-Kette, nicht nur den direkten Elternteil', () => {
    // Warum: je nach Fensterbreite scrollt in dieser App mal #content,
    // mal die Seite selbst. Wer den Scroller rät, rät irgendwann falsch.
    const doc = new FakeDoc();
    const aussen = new FakeEl('DIV', { doc });
    const alt = baueSeite(doc);
    aussen.append(alt.seite);
    aussen.scrollTop = 42;
    alt.seite.scrollTop = 8;

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueSchale(doc);
    alt.seite.replaceChild(neu.root, alt.root);
    aussen.scrollTop = 0;
    alt.seite.scrollTop = 0;

    restoreWizardViewport(neu.root, schnappschuss);
    expect(aussen.scrollTop).toBe(42);
    expect(alt.seite.scrollTop).toBe(8);
  });

  it('ohne Schnappschuss passiert nichts (fail-open)', () => {
    expect(restoreWizardViewport(null, null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// Fokus
// ─────────────────────────────────────────────────────────────────

describe('Wizard-Rerender — Fokus bleibt auf dem bedienten Element', () => {
  it('der gedrückte „+"-Knopf ist danach wieder fokussiert (im FRISCHEN Baum)', () => {
    const doc = new FakeDoc();
    const alt = baueSeite(doc);
    doc.activeElement = alt.plus;

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueSchale(doc);
    alt.seite.replaceChild(neu.root, alt.root);
    doc.activeElement = null; // wie im Browser: Fokus fällt auf <body>

    const ziel = restoreWizardViewport(neu.root, schnappschuss);
    expect(ziel).toBe(neu.plus);
    expect(doc.activeElement).toBe(neu.plus);
    expect(ziel).not.toBe(alt.plus);
  });

  it('fokussiert mit preventScroll — das Zurückholen darf nicht selbst scrollen', () => {
    const doc = new FakeDoc();
    const alt = baueSeite(doc);
    doc.activeElement = alt.minus;

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueSchale(doc);
    alt.seite.replaceChild(neu.root, alt.root);

    restoreWizardViewport(neu.root, schnappschuss);
    expect(neu.minus.focusCalls[0]).toEqual({ preventScroll: true });
  });

  it('Textcursor im Eingabefeld überlebt (selectionStart/-End)', () => {
    const doc = new FakeDoc();
    const alt = baueSeite(doc);
    alt.eingabe.selectionStart = 3;
    alt.eingabe.selectionEnd = 5;
    doc.activeElement = alt.eingabe;

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueSchale(doc);
    alt.seite.replaceChild(neu.root, alt.root);

    const ziel = restoreWizardViewport(neu.root, schnappschuss);
    expect(ziel).toBe(neu.eingabe);
    expect([neu.eingabe.selectionStart, neu.eingabe.selectionEnd]).toEqual([3, 5]);
  });

  it('Strukturwechsel: lieber KEIN Fokus als der falsche', () => {
    // Der Konstellations-Banner in Schritt 4 erscheint und verschwindet
    // mit der Einstellung. Derselbe Index-Pfad zeigt danach auf ein
    // anderes Element — der Steckbrief (Tag/Typ/Beschriftung) fängt das ab.
    const doc = new FakeDoc();
    const alt = baueSeite(doc);
    doc.activeElement = alt.plus;

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueSchale(doc, { mitBanner: true });
    alt.seite.replaceChild(neu.root, alt.root);
    doc.activeElement = null;

    const ziel = restoreWizardViewport(neu.root, schnappschuss);
    expect(ziel).toBeNull();
    expect(doc.activeElement).toBeNull();
    // Der Scrollstand wird trotzdem gerettet — die beiden Rettungen
    // hängen nicht voneinander ab.
    expect(alt.seite.scrollTop).toBe(0);
  });

  it('ein an seine Grenze gelaufener (disabled) Knopf wird nicht fokussiert', () => {
    const doc = new FakeDoc();
    const alt = baueSeite(doc);
    doc.activeElement = alt.plus;

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueSchale(doc, { plusDisabled: true });
    alt.seite.replaceChild(neu.root, alt.root);
    doc.activeElement = null;

    expect(restoreWizardViewport(neu.root, schnappschuss)).toBeNull();
  });

  it('Fokus ausserhalb der Schale wird nicht angefasst', () => {
    const doc = new FakeDoc();
    const alt = baueSeite(doc);
    const fremd = new FakeEl('BUTTON', { doc, text: 'Woanders' });
    alt.seite.append(fremd);
    doc.activeElement = fremd;

    const schnappschuss = captureWizardViewport(alt.root);
    expect(schnappschuss.focus).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// Listenzeilen: der Fokus folgt dem EINTRAG, nicht der Position
//
// Team verschieben und Team entfernen (refreshAfterMutation) rendern
// dieselbe Schale neu wie eine Einstellung — nur dass die Zeile dabei
// ihren Platz wechselt oder ganz verschwindet. Ein positionsbasiertes
// Zurückholen sässe danach auf dem Pfeil eines fremden Teams, und der
// nächste Klick verschöbe das falsche.
// ─────────────────────────────────────────────────────────────────

describe('Wizard-Rerender — Listenzeilen', () => {
  it('Team verschoben: der Fokus wandert mit dem Team, nicht mit der Position', () => {
    const doc = new FakeDoc();
    const alt = baueListe(doc, ['Adler', 'Baeren', 'Chamaeleons', 'Dachse']);
    doc.activeElement = alt.zeilen[2].auf; // „Chamaeleons" nach oben

    const schnappschuss = captureWizardViewport(alt.root);

    // Nach dem Tausch steht „Chamaeleons" auf Position 1 (Index 1).
    const neu = baueListe(doc, ['Adler', 'Chamaeleons', 'Baeren', 'Dachse']);
    alt.seite.replaceChild(neu.root, alt.root);
    doc.activeElement = null;

    const ziel = restoreWizardViewport(neu.root, schnappschuss);
    expect(ziel).toBe(neu.zeilen[1].auf);
    expect(ziel).not.toBe(neu.zeilen[2].auf); // das waere „Baeren"
  });

  it('Team entfernt: kein Fokus statt des Knopfes der Nachbarzeile', () => {
    const doc = new FakeDoc();
    const alt = baueListe(doc, ['Adler', 'Baeren', 'Chamaeleons']);
    doc.activeElement = alt.zeilen[1].weg; // „Baeren" loeschen

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueListe(doc, ['Adler', 'Chamaeleons']);
    alt.seite.replaceChild(neu.root, alt.root);
    doc.activeElement = null;

    // An Position 1 sitzt jetzt „Chamaeleons" mit einem gleich
    // aussehenden „Loeschen" — genau der Knopf, den man NICHT haben will.
    expect(restoreWizardViewport(neu.root, schnappschuss)).toBeNull();
    expect(doc.activeElement).toBeNull();
  });

  it('doppelte Teamnamen: mehrdeutig heisst kein Fokus', () => {
    // Die App erlaubt Dubletten (mit Warnung). Zwei nicht
    // unterscheidbare Zeilen sind kein Grund zu raten.
    const doc = new FakeDoc();
    const alt = baueListe(doc, ['Adler', 'Baeren']);
    doc.activeElement = alt.zeilen[0].auf;

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueListe(doc, ['Adler', 'Adler']);
    alt.seite.replaceChild(neu.root, alt.root);
    doc.activeElement = null;

    expect(restoreWizardViewport(neu.root, schnappschuss)).toBeNull();
  });

  it('Umbenennen ändert das Erkennungsmerkmal — dann lieber kein Fokus', () => {
    const doc = new FakeDoc();
    const alt = baueListe(doc, ['Adler', 'Baeren']);
    doc.activeElement = alt.zeilen[0].ab;

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueListe(doc, ['Adlerin', 'Baeren']);
    alt.seite.replaceChild(neu.root, alt.root);
    doc.activeElement = null;

    expect(restoreWizardViewport(neu.root, schnappschuss)).toBeNull();
  });

  it('unveränderte Liste: der Fokus kommt normal zurück', () => {
    // Gegenprobe zu den drei Negativfällen — sonst wäre „nie
    // fokussieren" eine bestandene Umsetzung.
    const doc = new FakeDoc();
    const alt = baueListe(doc, ['Adler', 'Baeren', 'Chamaeleons']);
    doc.activeElement = alt.zeilen[2].ab;

    const schnappschuss = captureWizardViewport(alt.root);
    const neu = baueListe(doc, ['Adler', 'Baeren', 'Chamaeleons']);
    alt.seite.replaceChild(neu.root, alt.root);
    doc.activeElement = null;

    expect(restoreWizardViewport(neu.root, schnappschuss)).toBe(neu.zeilen[2].ab);
  });
});

// ─────────────────────────────────────────────────────────────────
// Quelltext-Scan: der blanke Austausch darf nicht zurückkommen
// ─────────────────────────────────────────────────────────────────

describe('refreshShell benutzt ausschliesslich replaceWizardShell', () => {
  const koerper = [...QUELLE.matchAll(/function refreshShell\(\)\s*\{([\s\S]*?)\n {2}\}/g)].map(
    (m) => m[1]
  );

  it('es gibt weiterhin genau vier refreshShell-Kopien', () => {
    // Ändert sich diese Zahl, hat jemand einen Schritt-Renderer
    // hinzugefügt oder entfernt — dann gehört der neue Pfad hier her.
    expect(koerper.length).toBe(4);
  });

  it('keine Kopie tauscht die Schale an der Rettung vorbei aus', () => {
    for (const k of koerper) {
      expect(k).toContain('replaceWizardShell(root, state)');
      expect(k).not.toContain('replaceChild');
    }
  });

  it('refreshAfterMutation (Team verschieben/entfernen) nimmt denselben Weg', () => {
    // Dieser Pfad hing lange daneben: eine zweite, blanke Kopie des
    // Austauschs. Team verschieben ist kein Schritt-Wechsel.
    const fn = QUELLE.match(/function refreshAfterMutation\(\) \{([\s\S]*?)\n\}/);
    expect(fn).not.toBeNull();
    expect(fn[1]).toContain('replaceWizardShell(root, state)');
    expect(fn[1]).not.toContain('replaceChild');
  });

  it('jedes replaceChild im File ist entweder die Rettung oder ein erklärter Schritt-Wechsel', () => {
    // Der Scan ist die eigentliche Wache: er faellt auf, wenn jemand
    // irgendwo im File einen NEUEN Rerender-Pfad aufmacht.
    //
    // Erlaubt sind genau zwei Sorten:
    //   a) der Austausch INNERHALB von replaceWizardShell() — das ist
    //      die Rettung selbst;
    //   b) Stellen, die vorher den Marker „SCHRITT-WECHSEL:" tragen.
    //      Dort ist der Sprung nach oben gewollt, weil ein neuer
    //      Schritt von oben gelesen werden will — und der Marker sagt
    //      dem naechsten Leser auch, warum.
    const zeilen = QUELLE.split('\n');
    const treffer = [];
    zeilen.forEach((z, i) => {
      if (!/\.replaceChild\(/.test(z)) return;
      if (z.trim().startsWith('//')) return; // Kommentar, kein Aufruf
      treffer.push({ nr: i + 1, zeile: z.trim() });
    });

    expect(treffer.length).toBeGreaterThan(0); // Anti-Trivial-Check

    const rettung = QUELLE.slice(
      QUELLE.indexOf('function replaceWizardShell(root, state) {'),
      QUELLE.indexOf('function replaceWizardShell(root, state) {') + 400
    );

    const ungedeckt = treffer.filter((t) => {
      if (rettung.includes(t.zeile)) return false;
      const davor = zeilen.slice(Math.max(0, t.nr - 8), t.nr - 1).join('\n');
      return !davor.includes('SCHRITT-WECHSEL:');
    });

    expect(
      ungedeckt.map((t) => `Zeile ${t.nr}: ${t.zeile}`),
      'Neuer Rerender-Pfad ohne Scroll-/Fokus-Rettung und ohne SCHRITT-WECHSEL-Marker'
    ).toEqual([]);
  });

  it('die vier erlaubten Schritt-Wechsel sind auch wirklich noch da', () => {
    // Gegenprobe: verschwaende jemand die Marker, wuerde der Scan oben
    // rot — verschwaenden die STELLEN, waere er still gruen.
    expect(QUELLE.match(/SCHRITT-WECHSEL:/g)?.length).toBe(4);
  });

  it('appendRow bekommt state/opts gereicht, statt sie aus dem DOM zu suchen', () => {
    // Ohne das ist die Teamliste nach jedem vollen Render leer, die
    // Seite bricht auf einen Bruchteil ihrer Hoehe zusammen — und gegen
    // eine wirklich kuerzere Seite kommt kein Scroll-Retten an.
    expect(QUELLE).toContain('appendRow(list, i, state, opts)');
    expect(QUELLE).toMatch(/function appendRow\(list, index, stateArg, optsArg\)/);
  });

  it('replaceWizardShell rettet Scrollstand und Fokus um den Austausch herum', () => {
    const fn = QUELLE.match(/function replaceWizardShell\(root, state\) \{([\s\S]*?)\n\}/);
    expect(fn).not.toBeNull();
    const body = fn[1];
    expect(body.indexOf('captureWizardViewport')).toBeGreaterThan(-1);
    expect(body.indexOf('captureWizardViewport')).toBeLessThan(body.indexOf('replaceChild'));
    expect(body.indexOf('replaceChild')).toBeLessThan(body.indexOf('restoreWizardViewport'));
  });
});
