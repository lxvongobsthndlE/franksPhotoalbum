/**
 * Spielkachel-Trennlinie + Reload-Knopf (2026-08-28).
 *
 * ZWEI BESCHWERDEN, EINE URSACHENFAMILIE: eine Komponente wird an zwei
 * Stellen beschrieben, und die spaetere Beschreibung nimmt der frueheren
 * still eine Eigenschaft weg.
 *
 *   1. Die Trennlinie zwischen den beiden Teams einer Spielkachel besteht
 *      aus ZWEI Stuecken - dem oberen Rahmen der Team-Zelle (linke Spalte)
 *      und dem der Score-Zelle (rechte Spalte). Im offenen Zustand fiel das
 *      rechte Stueck ersatzlos aus, weil `.t-match-score.empty` ein
 *      `border: 0` mitbrachte (gleiche Spezifitaet wie die Linien-Regel,
 *      aber spaetere Zeile). Zusaetzlich raeumte dasselbe `.empty` das
 *      Zell-Polster ab, und `align-items: center` liess die dadurch
 *      flachere Zelle in der Mitte haengen - das rechte Stueck sass also
 *      auch noch tiefer als das linke.
 *      Gemessen (msedge ueber Playwright, public/pruefstand-marke.html,
 *      375px): offen EIN Stueck ueber 89.3% der Kachelbreite, fertig ZWEI
 *      Stuecke ueber 100% mit 0.5px Versatz. Nachher: in jedem Zustand
 *      zwei Stuecke, 0px Versatz, 100%.
 *
 *   2. Der Reload-Knopf in der Turnieruebersicht war gemessen 20x38px -
 *      ein hochkant stehender Kasten um ein 18px-Zeichen. `width: 38px`
 *      in tournament.css (0,1,0) verlor gegen
 *      `button.tournament-header-btn { width: auto }` in main.css (0,1,1).
 *
 * WARUM QUELL-SCAN STATT DOM: vitest laeuft hier mit
 * `environment: 'node'` (backend/vitest.config.js) - es gibt kein jsdom
 * und erst recht keine Layout-Engine. Die Geometrie wurde im Browser
 * gemessen; was dieser Test festhaelt, sind die KASKADEN-Zusagen, aus
 * denen die gemessene Geometrie folgt. Faellt eine davon, ist die Messung
 * ungueltig.
 *
 * ROBUST GEGEN REFORMATIERUNG: geprueft wird nicht auf Zeilen oder
 * Umbrueche, sondern auf geparste Regeln mit vereinheitlichtem Weissraum.
 * (Am 2026-08-27 sind fuenf Textscan-Tests bei einem Prettier-Lauf
 * gebrochen, weil sie auf Umbrueche gebaut waren.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const lies = (...p) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');

const tournamentCss = lies('..', 'style', 'tournament.css');
const mainCss = lies('..', 'style', 'main.css');
const mainJs = lies('main.js');
const indexHtml = lies('..', 'index.html');

// ─────────────────────────────────────────────────────────────────
// Ein kleiner, toleranter CSS-Leser
// ─────────────────────────────────────────────────────────────────
// Liefert je Regel: Selektorliste, Deklarationen und die umgebenden
// At-Regeln. Kein vollstaendiger Parser - er muss nur Regeln finden und
// Weissraum vereinheitlichen. Genau das macht ihn unempfindlich gegen
// Prettier: ob eine Deklaration auf einer oder auf drei Zeilen steht,
// aendert am Ergebnis nichts.

/**
 * Entfernt Kommentarbloecke.
 *
 * @param {string} css Quelltext
 * @returns {string} Quelltext ohne Kommentare
 */
function ohneKommentare(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Zerlegt ein Stylesheet in Regeln.
 *
 * @param {string} css Quelltext
 * @returns {Array<object>} Regeln in Quell-Reihenfolge
 */
function leseRegeln(css) {
  const text = ohneKommentare(css);
  const regeln = [];
  const stapel = [];
  let anfang = 0;
  let nr = 0;
  for (let i = 0; i < text.length; i++) {
    const z = text[i];
    if (z === '{') {
      const prelude = text.slice(anfang, i).trim().replace(/\s+/g, ' ');
      if (prelude.startsWith('@')) {
        stapel.push(prelude);
        anfang = i + 1;
        continue;
      }
      let tiefe = 1;
      let j = i + 1;
      for (; j < text.length && tiefe > 0; j++) {
        if (text[j] === '{') tiefe++;
        else if (text[j] === '}') tiefe--;
      }
      const koerper = text.slice(i + 1, j - 1);
      const deklarationen = {};
      for (const stueck of koerper.split(';')) {
        const k = stueck.indexOf(':');
        if (k < 0) continue;
        const name = stueck.slice(0, k).trim().replace(/\s+/g, ' ').toLowerCase();
        const wert = stueck
          .slice(k + 1)
          .trim()
          .replace(/\s+/g, ' ');
        if (!name || name.startsWith('@') || name.includes('{') || name.includes('}')) continue;
        deklarationen[name] = wert;
      }
      regeln.push({
        selektoren: prelude
          .split(',')
          .map((s) => s.trim().replace(/\s+/g, ' '))
          .filter(Boolean),
        deklarationen,
        kontext: [...stapel],
        nr: nr++,
      });
      i = j - 1;
      anfang = j;
    } else if (z === '}') {
      stapel.pop();
      anfang = i + 1;
    }
  }
  return regeln;
}

/**
 * Spezifitaet eines Selektors als vergleichbare Zahl.
 *
 * @param {string} sel Ein einzelner Selektor
 * @returns {number} ids * 10000 + klassen * 100 + elemente
 */
function gewicht(sel) {
  const s = sel.replace(/::[a-zA-Z-]+/g, ' ');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const klassen =
    (s.match(/\.[\w-]+/g) || []).length +
    (s.match(/\[[^\]]*\]/g) || []).length +
    (s.match(/:(?!not\b)[a-zA-Z-]+/g) || []).length;
  const elemente = (
    s
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[.#:][\w-]+(\([^)]*\))?/g, ' ')
      .match(/\b[a-zA-Z][\w-]*\b/g) || []
  ).length;
  return ids * 10000 + klassen * 100 + elemente;
}

const cssRegeln = leseRegeln(tournamentCss);
const mainRegeln = leseRegeln(mainCss);

/** @param {object} r Regel @returns {boolean} true im Druck-Kontext */
const istDruck = (r) => r.kontext.some((k) => k.includes('print'));

// ─────────────────────────────────────────────────────────────────
// 0. Der Leser selbst - sonst prueft alles Weitere nichts
// ─────────────────────────────────────────────────────────────────

describe('CSS-Leser (Positivprobe)', () => {
  it('findet Regeln, Deklarationen und den At-Kontext', () => {
    const probe = leseRegeln('a{color:red}@media print{.b , .c{margin : 0 ; padding:1px}}');
    expect(probe).toHaveLength(2);
    expect(probe[0].selektoren).toEqual(['a']);
    expect(probe[0].deklarationen.color).toBe('red');
    expect(probe[1].selektoren).toEqual(['.b', '.c']);
    expect(probe[1].deklarationen.margin).toBe('0');
    expect(probe[1].kontext[0]).toContain('print');
  });

  it('ignoriert Kommentare und Umbrueche (Prettier-Festigkeit)', () => {
    const eng = leseRegeln('.x{padding:9px 12px 9px 0}');
    const weit = leseRegeln('/* Hinweis */\n.x {\n  padding:\n    9px 12px 9px 0;\n}\n');
    expect(weit[0].deklarationen).toEqual(eng[0].deklarationen);
    expect(weit[0].selektoren).toEqual(eng[0].selektoren);
  });

  it('wiegt Spezifitaeten in der Reihenfolge, die der Browser benutzt', () => {
    expect(gewicht('button.tournament-header-btn')).toBeGreaterThan(
      gewicht('.tournament-icon-btn')
    );
    expect(gewicht('button.tournament-icon-btn')).toBe(gewicht('button.tournament-header-btn'));
    expect(gewicht(".t-match-rows > .t-match-score[data-area='away-score']")).toBeGreaterThan(
      gewicht('.t-match-score.empty')
    );
    expect(gewicht('.t-match-rows > :nth-child(4)')).toBe(gewicht('.t-match-score.empty'));
  });
});

// ─────────────────────────────────────────────────────────────────
// 1. Die Trennlinie in der Spielkachel
// ─────────────────────────────────────────────────────────────────

describe('Trennlinie der Spielkachel', () => {
  const linienRegeln = cssRegeln.filter(
    (r) =>
      !istDruck(r) &&
      r.selektoren.some((s) => s.includes('.t-match-rows')) &&
      Object.keys(r.deklarationen).some((d) => d === 'border-top' || d === 'border-top-width')
  );

  it('wird von genau einer Regel gezeichnet', () => {
    expect(linienRegeln).toHaveLength(1);
    expect(linienRegeln[0].deklarationen['border-top']).toMatch(/^1px solid /);
  });

  it('nennt die Score-Zelle ausdruecklich - nicht nur ueber :nth-child', () => {
    // Die :nth-child-Zeilen wiegen (0,2,0) und verlieren damit gegen jede
    // spaetere Zustandsregel derselben Komponente. Genau so ist das rechte
    // Stueck der Linie im offenen Zustand verschwunden.
    const sel = linienRegeln[0].selektoren;
    expect(sel.some((s) => /\.t-match-score\[data-area=.away-score.\]/.test(s))).toBe(true);
  });

  it('haelt keine spaetere Regel dagegen, die den Rahmen der Score-Zelle abraeumt', () => {
    const linie = linienRegeln[0];
    const linienGewicht = Math.max(
      ...linie.selektoren.filter((s) => /t-match-score/.test(s)).map((s) => gewicht(s))
    );
    const abraeumer = cssRegeln.filter(
      (r) =>
        !istDruck(r) &&
        r.nr > linie.nr &&
        r.selektoren.some((s) => /\.t-match-score/.test(s) && !/t-match--bracket/.test(s)) &&
        Object.entries(r.deklarationen).some(
          ([d, w]) => /^border(-top)?(-width|-style)?$/.test(d) && /^(0|0px|none)$/.test(w)
        )
    );
    for (const r of abraeumer) {
      const stark = Math.max(...r.selektoren.map((s) => gewicht(s)));
      expect(
        stark,
        `Regel "${r.selektoren.join(', ')}" wiegt ${stark} und steht hinter der Linien-Regel (${linienGewicht}) - sie loescht das rechte Stueck der Trennlinie.`
      ).toBeLessThan(linienGewicht);
    }
  });

  it('laesst die Zellen die Zeilenhoehe fuellen, damit beide Stuecke gleich hoch liegen', () => {
    const wrapper = cssRegeln.find(
      (r) => !istDruck(r) && r.selektoren.length === 1 && r.selektoren[0] === '.t-match-rows'
    );
    expect(wrapper).toBeTruthy();
    // `center` liess die flachere Zelle in der Zeilenmitte haengen -
    // gemessen 10px tiefer als das linke Stueck der Linie.
    expect(wrapper.deklarationen['align-items']).toBe('stretch');
  });

  it('gibt der Score-Zelle dasselbe senkrechte Polster wie der Team-Zelle', () => {
    const zelle = cssRegeln.find(
      (r) => !istDruck(r) && r.selektoren.includes('.t-match-rows > .t-match-score')
    );
    expect(zelle).toBeTruthy();
    // Kurzschreiber statt `padding-right`: so kann keine spaetere Regel
    // derselben Spezifitaet nur die Haelfte davon treffen.
    const padding = zelle.deklarationen.padding;
    expect(padding, 'padding muss als Kurzschreiber stehen').toBeTruthy();
    const oben = padding.split(' ')[0];
    expect(parseFloat(oben), `senkrechtes Polster ist "${oben}"`).toBeGreaterThan(0);
    expect(zelle.deklarationen['justify-self']).toBe('stretch');
    expect(zelle.deklarationen['align-self']).toBe('stretch');
  });

  it('laesst den offenen Zustand nur Farbe und Strichstaerke setzen, keine Geometrie', () => {
    // `.t-match-score.empty` ist eine ZUSTANDS-Regel. Sie darf sagen, wie
    // der Platzhalter aussieht - nicht, wie gross die Zelle ist. Beides
    // stand hier ("padding: 0" und "border: 0") und war die Wurzel des
    // Fehlers: der offene Zustand bekam eine andere Kachel-Geometrie als
    // der eingetragene.
    const zustand = cssRegeln.filter(
      (r) => !istDruck(r) && r.selektoren.some((s) => /^\.t-match-score\.empty$/.test(s))
    );
    expect(zustand.length).toBeGreaterThan(0);
    for (const r of zustand) {
      const verboten = Object.keys(r.deklarationen).filter((d) =>
        /^(padding|margin|border|width|height)/.test(d)
      );
      expect(verboten, `unerlaubte Geometrie im offenen Zustand: ${verboten.join(', ')}`).toEqual(
        []
      );
    }
  });

  it('haelt beide Renderer bei data-area, worauf die Linien-Regel zeigt', () => {
    const helfer = lies('spielplan-helpers.js');
    const treffer = helfer.match(/data-area="away-score"/g) || [];
    expect(treffer.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. Der Reload-Knopf in der Turnieruebersicht
// ─────────────────────────────────────────────────────────────────

describe('Reload-Knopf der Turnieruebersicht', () => {
  const geometrie = cssRegeln.find(
    (r) =>
      !istDruck(r) &&
      r.selektoren.some((s) => /tournament-icon-btn$/.test(s)) &&
      r.deklarationen.width
  );

  it('gewinnt gegen die Breiten-Regel aus main.css', () => {
    const gegner = mainRegeln.filter(
      (r) => r.selektoren.some((s) => /tournament-header-btn/.test(s)) && r.deklarationen.width
    );
    expect(gegner.length).toBeGreaterThan(0);
    expect(geometrie, 'keine Breiten-Regel fuer den Icon-Knopf gefunden').toBeTruthy();
    const meins = Math.max(
      ...geometrie.selektoren.filter((s) => /tournament-icon-btn/.test(s)).map((s) => gewicht(s))
    );
    for (const g of gegner) {
      const fremd = Math.max(...g.selektoren.map((s) => gewicht(s)));
      expect(
        meins,
        `"${g.selektoren.join(', ')}" (main.css) wiegt ${fremd}; der Icon-Knopf wiegt nur ${meins} und verliert wie vor dem Fix.`
      ).toBeGreaterThanOrEqual(fremd);
    }
  });

  it('steht in der spaeter geladenen Datei - sonst reicht Gleichstand nicht', () => {
    const reihenfolge = [...indexHtml.matchAll(/href="\.?\/?style\/([\w.-]+\.css)"/g)].map(
      (m) => m[1]
    );
    expect(reihenfolge).toContain('main.css');
    expect(reihenfolge).toContain('tournament.css');
    expect(reihenfolge.indexOf('tournament.css')).toBeGreaterThan(reihenfolge.indexOf('main.css'));
  });

  it('hat mindestens 44x44 Trefferflaeche', () => {
    for (const seite of ['width', 'height']) {
      expect(parseFloat(geometrie.deklarationen[seite])).toBeGreaterThanOrEqual(44);
    }
  });

  it('traegt in Ruhe keine Pille - kein Rahmen, keine Hintergrund-Kapsel', () => {
    expect(geometrie.deklarationen.border).toMatch(/^(0|0px|none)$/);
    expect(geometrie.deklarationen.background).toMatch(/^(none|transparent)$/);
  });

  it('hebt sich beim Zeigen dezent hervor', () => {
    const hover = cssRegeln.find(
      (r) => !istDruck(r) && r.selektoren.some((s) => /tournament-icon-btn:hover$/.test(s))
    );
    expect(hover, 'kein :hover fuer den Icon-Knopf').toBeTruthy();
    expect(hover.deklarationen.background).toBeTruthy();
  });

  it('zeigt der Tastatur, wo sie steht', () => {
    // Ohne Rahmen in Ruhe ist der Fokusring das EINZIGE Merkmal. Faellt er
    // weg, ist der Knopf per Tastatur nicht mehr auffindbar.
    const fokus = cssRegeln.find(
      (r) => !istDruck(r) && r.selektoren.some((s) => /tournament-icon-btn:focus-visible$/.test(s))
    );
    expect(fokus, 'kein :focus-visible fuer den Icon-Knopf').toBeTruthy();
    expect(fokus.deklarationen.outline).toBeTruthy();
    expect(fokus.deklarationen.outline).not.toMatch(/^none$/);
  });

  it('behaelt seine Beschriftung fuer Screenreader und Tooltip', () => {
    // Der Knopf zeigt nur ein Zeichen - die Bedeutung haengt an aria-label
    // und title. main.js setzt beide aus `item.label`.
    // Die ID taucht in main.js mehrfach auf (u.a. beim Aufraeumen der
    // Kopfleiste). Gesucht ist die STELLE, an der der Knopf beschrieben
    // wird - also id und label im selben Objektliteral, in beliebiger
    // Reihenfolge und ueber beliebig viele Zeilen.
    const beschreibung = /id:\s*'tournament-refresh-btn',[\s\S]{0,400}?label:\s*'Aktualisieren'/;
    expect(mainJs).toMatch(beschreibung);
    expect(mainJs).toMatch(/setAttribute\(\s*'aria-label',\s*item\.label\s*\)/);
    expect(mainJs).toMatch(/\.title\s*=\s*item\.label/);
  });
});
