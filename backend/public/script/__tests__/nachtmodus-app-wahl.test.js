/**
 * Der Nachtmodus der APP folgt der App — nie dem Betriebssystem.
 *
 * Gemeldet am 2026-08-28, woertlich: „es soll sich NUR an der app
 * orientieren und ob ich in der app nachtmodus anhabe, nicht ob ichs
 * aufm handy anhabe." Im Screenshot lag die Kopfleiste hell da und der
 * Turnierbereich darunter schwarz — zwei Modi auf einem Schirm.
 *
 * Ursache (main.js, Block „DARK MODE")
 * ------------------------------------
 *   `toggleDarkMode` setzte beim AUSSCHALTEN `data-theme` auf den
 *   LEEREN STRING, und der Restore beim Laden setzte im Hellfall gar
 *   nichts. Der Nachtmodus-Block in tokens.css haengt aber an
 *   `:root:not([data-theme='light'])` innerhalb von
 *   `@media (prefers-color-scheme: dark)`. Ein leerer String ist nicht
 *   'light' — also gewann die Systemabfrage. Die App-Schale blieb hell,
 *   weil main.css nur `[data-theme='dark']` kennt und kein
 *   prefers-color-scheme. Daher der Riss mitten im Bild.
 *
 * Gemessen im Browser (Edge, 375px, getComputedStyle), Pruefstand
 * `public/pruefstand-nachtmodus.html`:
 *   VORHER  App hell / System dunkel -> #content #0b0b0c (schwarz),
 *           Ueberschrift #1a1410 auf #0b0b0c = 1,08 : 1
 *   NACHHER App hell / System dunkel -> #content #d7d6d0 (hell),
 *           Ueberschrift #0b0b0c auf #d7d6d0 = 13,51 : 1
 *
 * Was dieser Test festhaelt
 * -------------------------
 *   1. VERHALTEN: die Theme-Initialisierung hinterlaesst IMMER ein
 *      ausdrueckliches Attribut — 'light' oder 'dark', nie leer, nie
 *      fehlend, fuer JEDEN localStorage-Zustand.
 *   2. PARITAET: das Inline-Schnipsel im <head> von index.html und
 *      `bootAppTheme()` in main.js geben dieselbe Antwort. Zwei
 *      Startwege, eine Regel.
 *   3. QUELLTEXT: niemand schreibt wieder ein leeres data-theme.
 *   4. NEGATIVRAUM: live.html und aushang.html behalten ihren
 *      System-Fallback — dort laeuft kein main.js, dort ist er richtig.
 *
 * Kein jsdom im Projekt (vitest environment: 'node'), deshalb dieselbe
 * Machart wie in double-click-guard.test.js: die echten Funktionen per
 * acorn aus dem Quelltext schneiden und an einem Fake-DOM ausfuehren.
 * Alle Quelltext-Pruefungen laufen ueber AST oder tolerante Regexe und
 * NICHT ueber Zeilenumbrueche — ein Prettier-Lauf hat in diesem Repo
 * schon einmal fuenf Tests gekippt, ohne dass sich Verhalten aenderte.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as acorn from 'acorn';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', '..');
const mainSrc = fs.readFileSync(path.join(PUBLIC, 'script', 'main.js'), 'utf-8');
const indexSrc = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf-8');
const tokensSrc = fs.readFileSync(path.join(PUBLIC, 'style', 'tokens.css'), 'utf-8');

/** index.html ohne HTML-Kommentare. Noetig, weil der Erklaerblock ueber dem
 *  Schnipsel selbst ein Stylesheet-Link-Beispiel und das Wort data-theme
 *  nennt — eine Suche im Rohtext haelt die Erklaerung sonst fuer die Sache.
 *  Genau diese Falle hat den ersten Lauf dieses Tests rot gemacht. */
const indexCode = indexSrc.replace(/<!--[\s\S]*?-->/g, '');

const ast = acorn.parse(mainSrc, { ecmaVersion: 2022, sourceType: 'module', locations: true });

/** Eine Funktionsdeklaration von Modulebene woertlich ausschneiden. */
function schneide(name) {
  const treffer = ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name);
  if (!treffer) throw new Error(`${name} existiert nicht auf Modulebene in main.js`);
  return mainSrc.slice(treffer.start, treffer.end);
}

/** Generischer AST-Durchlauf — acorn-walk liegt in diesem Projekt nicht. */
function jederKnoten(knoten, tu) {
  if (!knoten || typeof knoten !== 'object') return;
  if (Array.isArray(knoten)) {
    for (const k of knoten) jederKnoten(k, tu);
    return;
  }
  if (typeof knoten.type === 'string') tu(knoten);
  for (const schluessel of Object.keys(knoten)) {
    if (schluessel === 'type' || schluessel === 'loc') continue;
    jederKnoten(knoten[schluessel], tu);
  }
}

/** Minimales <html> mit genau den Beruehrungspunkten, die der Code hat. */
function fakeDom() {
  const attrs = {};
  const html = {
    attrs,
    setAttribute(k, v) {
      attrs[k] = v;
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
    },
  };
  return {
    documentElement: html,
    getElementById: () => null,
    querySelector: () => null,
  };
}

/** Minimaler localStorage. `null` als Startwert heisst: nichts gespeichert. */
function fakeSpeicher(start) {
  const daten = start === null || start === undefined ? {} : { theme: start };
  return {
    daten,
    getItem: (k) => (k in daten ? daten[k] : null),
    setItem: (k, v) => {
      daten[k] = String(v);
    },
    removeItem: (k) => {
      delete daten[k];
    },
  };
}

/** Die drei echten Funktionen aus main.js, an einem Fake-DOM aufgehaengt.
 *  updateThemeIcon/syncThemeColor kommen als Stubs herein — sie sind nicht
 *  Gegenstand dieses Tests, aber applyAppTheme ruft sie. */
function ladeMainStarter(dom, speicher) {
  const quelle = [
    schneide('resolveAppTheme'),
    schneide('applyAppTheme'),
    schneide('bootAppTheme'),
  ].join('\n');
  const rufe = [];
  // eslint-disable-next-line no-new-func
  const bauen = new Function(
    'document',
    'localStorage',
    'updateThemeIcon',
    'syncThemeColor',
    quelle + '\nreturn { resolveAppTheme, applyAppTheme, bootAppTheme };'
  );
  const api = bauen(
    dom,
    speicher,
    () => rufe.push('icon'),
    () => rufe.push('themeColor')
  );
  return { ...api, rufe };
}

/** Das Inline-Schnipsel aus dem <head> von index.html — das, welches
 *  data-theme setzt. Ueber den Inhalt gefunden, nicht ueber die Position,
 *  damit ein Umsortieren im Kopf den Test nicht kippt. */
function inlineSchnipsel() {
  const alle = [...indexCode.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  const treffer = alle.filter((m) => /data-theme/.test(m[1]));
  return { treffer, quelle: treffer[0]?.[1] ?? null, index: treffer[0]?.index ?? -1 };
}

const ZUSTAENDE = [
  ['dark', 'dark'],
  ['light', 'light'],
  [null, 'light'],
  ['', 'light'],
  ['Dark', 'light'],
  ['system', 'light'],
];

describe('Theme-Start: das Attribut ist IMMER ausdruecklich', () => {
  for (const [gespeichert, erwartet] of ZUSTAENDE) {
    it(`localStorage.theme = ${JSON.stringify(gespeichert)} -> data-theme="${erwartet}"`, () => {
      const dom = fakeDom();
      const speicher = fakeSpeicher(gespeichert);
      const { bootAppTheme } = ladeMainStarter(dom, speicher);
      bootAppTheme();
      const attr = dom.documentElement.getAttribute('data-theme');
      expect(attr).toBe(erwartet);
      // Die eigentliche Zusicherung, unabhaengig vom erwarteten Wert:
      // niemals leer, niemals fehlend.
      expect(attr).not.toBeNull();
      expect(attr).not.toBe('');
      expect(['light', 'dark']).toContain(attr);
    });
  }

  it('schreibt den ausdruecklichen Wert auch in den Speicher zurueck', () => {
    const dom = fakeDom();
    const speicher = fakeSpeicher(null);
    ladeMainStarter(dom, speicher).bootAppTheme();
    expect(speicher.getItem('theme')).toBe('light');
  });

  it('ueberlebt einen localStorage, der wirft (Privatmodus, blockierte Cookies)', () => {
    const dom = fakeDom();
    const boese = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('SecurityError');
      },
    };
    const { bootAppTheme } = ladeMainStarter(dom, boese);
    expect(() => bootAppTheme()).not.toThrow();
    expect(dom.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('zieht Icon und theme-color-Meta beim Start mit — nicht erst beim Umschalten', () => {
    const dom = fakeDom();
    const starter = ladeMainStarter(dom, fakeSpeicher('dark'));
    starter.bootAppTheme();
    expect(starter.rufe).toContain('icon');
    expect(starter.rufe).toContain('themeColor');
  });

  it('schaltet hin und her, ohne je einen leeren Zwischenzustand zu hinterlassen', () => {
    const dom = fakeDom();
    const speicher = fakeSpeicher('dark');
    const { applyAppTheme } = ladeMainStarter(dom, speicher);
    for (const wunsch of ['light', 'dark', 'light', 'dark']) {
      applyAppTheme(wunsch);
      expect(dom.documentElement.getAttribute('data-theme')).toBe(wunsch);
      expect(speicher.getItem('theme')).toBe(wunsch);
    }
  });
});

describe('Paritaet: Inline-Schnipsel und main.js sagen dasselbe', () => {
  it('index.html traegt genau EIN Inline-Schnipsel fuer data-theme', () => {
    const { treffer } = inlineSchnipsel();
    expect(treffer.length).toBe(1);
  });

  it('das Schnipsel steht VOR dem ersten Stylesheet — sonst blitzt der falsche Modus auf', () => {
    const { index } = inlineSchnipsel();
    expect(index).toBeGreaterThan(-1);
    const erstesStylesheet = indexCode.search(/<link[^>]+rel=["']stylesheet["']/i);
    expect(erstesStylesheet).toBeGreaterThan(-1);
    expect(index).toBeLessThan(erstesStylesheet);
  });

  it('gibt fuer jeden Speicherzustand dieselbe Antwort wie bootAppTheme()', () => {
    const { quelle } = inlineSchnipsel();
    expect(quelle).toBeTruthy();
    for (const [gespeichert] of ZUSTAENDE) {
      const domA = fakeDom();
      // eslint-disable-next-line no-new-func
      new Function('document', 'localStorage', quelle)(domA, fakeSpeicher(gespeichert));

      const domB = fakeDom();
      ladeMainStarter(domB, fakeSpeicher(gespeichert)).bootAppTheme();

      const a = domA.documentElement.getAttribute('data-theme');
      const b = domB.documentElement.getAttribute('data-theme');
      expect(['light', 'dark']).toContain(a);
      expect(a).toBe(b);
    }
  });
});

describe('Quelltext-Sperre: kein leeres data-theme mehr', () => {
  it('kein setAttribute("data-theme", …) reicht je einen leeren oder unbekannten Wert durch', () => {
    const gefunden = [];
    jederKnoten(ast, (n) => {
      if (n.type !== 'CallExpression') return;
      const c = n.callee;
      if (c?.type !== 'MemberExpression') return;
      const name = c.property?.name ?? c.property?.value;
      if (name !== 'setAttribute') return;
      const erstes = n.arguments[0];
      if (erstes?.type !== 'Literal' || erstes.value !== 'data-theme') return;
      const wert = n.arguments[1];
      const literale = [];
      jederKnoten(wert, (k) => {
        if (k.type === 'Literal' && typeof k.value === 'string') literale.push(k.value);
      });
      gefunden.push({ zeile: n.loc.start.line, literale });
    });

    // Es MUSS mindestens einen solchen Aufruf geben — sonst prueft dieser
    // Test nichts und waere still gruen (der teuerste Testfehler dieses
    // Repos, siehe Memory „nullzaehler-beweist-keine-trennung").
    expect(gefunden.length).toBeGreaterThan(0);

    // Ein BEZEICHNER als Wert ist in Ordnung — applyAppTheme normalisiert ihn
    // auf 'light'/'dark', und das prueft der Verhaltensteil oben. Verboten ist
    // jedes LITERAL, das nicht 'light' oder 'dark' ist: genau so ist der leere
    // String hereingekommen (`isDark ? '' : 'dark'`).
    for (const t of gefunden) {
      for (const l of t.literale) {
        expect(
          ['light', 'dark'],
          `main.js:${t.zeile} setzt data-theme auf ${JSON.stringify(l)}`
        ).toContain(l);
      }
    }
    expect(gefunden.flatMap((t) => t.literale)).not.toContain('');
  });

  it('niemand setzt data-theme am Vorbeiweg ueber dataset auf einen fremden Wert', () => {
    // `document.documentElement.dataset.theme = ...` waere derselbe Fehler in
    // anderer Schreibweise; der setAttribute-Scan oben sieht ihn nicht.
    const treffer = [];
    jederKnoten(ast, (n) => {
      if (n.type !== 'AssignmentExpression') return;
      const l = n.left;
      if (l?.type !== 'MemberExpression') return;
      if ((l.property?.name ?? l.property?.value) !== 'theme') return;
      if (l.object?.type !== 'MemberExpression') return;
      if ((l.object.property?.name ?? l.object.property?.value) !== 'dataset') return;
      const literale = [];
      jederKnoten(n.right, (k) => {
        if (k.type === 'Literal' && typeof k.value === 'string') literale.push(k.value);
      });
      treffer.push({ zeile: n.loc.start.line, literale });
    });
    for (const t of treffer) {
      for (const l of t.literale) {
        expect(['light', 'dark'], `main.js:${t.zeile}`).toContain(l);
      }
    }
  });

  it('main.js startet den Modus wirklich — ein Aufruf von bootAppTheme() auf Modulebene', () => {
    const aufrufe = ast.body.filter(
      (n) =>
        n.type === 'ExpressionStatement' &&
        n.expression?.type === 'CallExpression' &&
        n.expression.callee?.name === 'bootAppTheme'
    );
    expect(aufrufe.length).toBe(1);
  });

  it('das Inline-Schnipsel setzt ebenfalls nur light oder dark', () => {
    const { quelle } = inlineSchnipsel();
    const teil = acorn.parse(quelle, { ecmaVersion: 2022 });
    let gesehen = 0;
    jederKnoten(teil, (n) => {
      if (n.type !== 'CallExpression') return;
      if ((n.callee?.property?.name ?? n.callee?.property?.value) !== 'setAttribute') return;
      if (n.arguments[0]?.value !== 'data-theme') return;
      gesehen++;
      const literale = [];
      jederKnoten(n.arguments[1], (k) => {
        if (k.type === 'Literal' && typeof k.value === 'string') literale.push(k.value);
      });
      expect(literale.length).toBeGreaterThan(0);
      for (const l of literale) expect(['light', 'dark']).toContain(l);
    });
    expect(gesehen).toBe(1);
  });
});

describe('Negativraum: der System-Fallback bleibt, wo er hingehoert', () => {
  it('tokens.css fuehrt weiterhin einen prefers-color-scheme-Block', () => {
    // Fuer live.html und aushang.html gibt es KEINE App-Wahl; dort waere
    // ein grellweisses Blatt am Abend die Folge. Der Block darf beim
    // Reparieren der App nicht mit weggeraeumt werden.
    expect(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/.test(tokensSrc)).toBe(true);
  });

  for (const datei of ['live.html', 'aushang.html']) {
    it(`${datei} bekommt KEIN data-theme aufgezwungen`, () => {
      const src = fs.readFileSync(path.join(PUBLIC, datei), 'utf-8');
      const setzt = [...src.matchAll(/setAttribute\(\s*['"]data-theme['"]/g)];
      expect(setzt.length).toBe(0);
      expect(/\bdataset\s*\.\s*theme\s*=/.test(src)).toBe(false);
    });
  }
});

describe('Ueberschrift „Turniere": eine Tinte, nicht zwei', () => {
  it('tokens.css bruecken --text/--text2 auf die Modul-Tinte', () => {
    // .gal-title (main.css) faerbt sich ueber var(--text). Ohne diese
    // Bruecke traegt die Ueberschrift im Modulbereich die App-Tinte —
    // gemessen #1a1410 auf #0b0b0c = 1,08 : 1.
    // Tolerant gegen Umbrueche und Leerraum: Prettier hat in diesem Repo
    // schon Tests gekippt, die auf Zeilen gebaut waren.
    const ohneKommentare = tokensSrc.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/--text\s*:\s*var\(\s*--ink\s*\)\s*;/.test(ohneKommentare)).toBe(true);
    expect(/--text2\s*:\s*var\(\s*--ink-2\s*\)\s*;/.test(ohneKommentare)).toBe(true);
  });

  it('die Bruecke steht im Traeger-Block, nicht auf :root', () => {
    // Auf :root wuerde sie die GANZE App umfaerben — genau das, was der
    // Kopfkommentar dieser Datei ausdruecklich zurueckstellt.
    const ohneKommentare = tokensSrc.replace(/\/\*[\s\S]*?\*\//g, '');
    const bisText = ohneKommentare.slice(0, ohneKommentare.indexOf('--text:'));
    const letzterBlockstart = bisText.lastIndexOf('{');
    const kopf = bisText.slice(0, letzterBlockstart);
    expect(kopf.trim()).toMatch(/#content:has\(\.t-list-host\)$/);
  });
});
