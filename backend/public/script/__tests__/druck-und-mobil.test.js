/**
 * Drucklayout und Mobil-Vorschau (2026-08-29).
 *
 * DIE MELDUNG WAR: "Druckansicht des Spielplans, vom Handy ausgeloest,
 * falsch formatiert." Dahinter lagen vier Fehler, die alle dieselbe Form
 * haben — eine Beschreibung wurde geaendert, die zweite Stelle, die von
 * ihr abhaengt, nicht.
 *
 *   1. ZWEI DRUCKBLOECKE, KEINE RANGFOLGE. Der aeltere (Etappe 8) druckt
 *      die drei Bildschirm-Ansichten und schaltet dafuer
 *      `.t-view { display: none !important }` — der Drucken-Tab ist dort
 *      nicht wieder eingeblendet. Der neuere (26.08.) legt die Druckboegen
 *      genau dorthin. Gemessen mit `page.emulateMedia({ media: 'print' })`:
 *      `.t-bogen` war NULLMAL sichtbar, gedruckt wurde der entfaerbte
 *      Bildschirm, und der Modulkopf fiel zusaetzlich weg.
 *
 *   2. DER KNOPF DRUCKTE INS LEERE. Die Boegen entstehen lazy beim Oeffnen
 *      des Drucken-Tabs. Am Telefon fuehrt der einzige Weg zum Drucken
 *      ueber das Kontextmenue — also nie ueber den Tab. Der drucken-mount
 *      war dann leer, und was nicht im DOM steht, kann kein Stylesheet
 *      aufs Papier holen.
 *
 *   3. DER TOKEN-RESET WAR IM NACHTMODUS WIRKUNGSLOS. Er stand auf
 *      `[data-theme='dark'] .t-mod` = (0,2,0). Der Dunkel-Block heisst
 *      inzwischen `[data-theme='dark'] :is(.t-mod, ...,
 *      #content:has(> .t-detail-host), ...)`; `:is()` uebernimmt die
 *      Spezifitaet seines staerksten Arms, und einer traegt eine ID —
 *      (1,2,0). Gemessen unter media:print mit data-theme=dark: `--ink`
 *      kam als #f1f0ed heraus, die Aufstiegsbaender druckten in #f0794d.
 *
 *   4. DIE ENTFAERBUNG ZIELTE AUF ALTE KLASSEN. Der Renderer gibt seit dem
 *      26.08. `is-lead`/`is-qualified` aus, der Druckblock raeumte
 *      `is-qualified`/`is-pending` ab. Der orange Fuehrungsstreifen ging
 *      ungebremst aufs Papier.
 *
 * WARUM QUELL-SCAN: vitest laeuft hier mit `environment: 'node'`
 * (backend/vitest.config.js) — kein jsdom, keine Layout-Engine. Geometrie
 * und Farben wurden im Browser gemessen (msedge ueber Playwright,
 * public/pruefstand-marke.html, 375px und 1280px, je hell und dunkel).
 * Was dieser Test festhaelt, sind die Zusagen, aus denen die Messung
 * folgt. Faellt eine davon, ist die Messung ungueltig.
 *
 * Geprueft wird auf GEPARSTE Regeln mit vereinheitlichtem Weissraum, nicht
 * auf Zeilen: am 27.08. sind fuenf Textscan-Tests bei einem Prettier-Lauf
 * gebrochen, weil sie auf Umbrueche gebaut waren.
 */

import { describe, it, expect } from 'vitest';
import { renderStandingsGroups, setCompactMode } from '../spielplan-helpers.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const lies = (...p) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');

const tournamentCss = lies('..', 'style', 'tournament.css');
const tokensCss = lies('..', 'style', 'tokens.css');
const mainJs = lies('main.js');
const helpersJs = lies('spielplan-helpers.js');

const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Zerlegt ein Stylesheet in Regeln samt umgebender At-Regeln.
 *
 * @param {string} css Quelltext
 * @returns {Array<object>} Regeln in Quell-Reihenfolge
 */
function leseRegeln(css) {
  const text = ohneKommentare(css);
  const regeln = [];
  const stapel = [];
  let anfang = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
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
      const deklarationen = {};
      for (const stueck of text.slice(i + 1, j - 1).split(';')) {
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
      });
      i = j - 1;
      anfang = j;
    } else if (text[i] === '}') {
      stapel.pop();
      anfang = i + 1;
    }
  }
  return regeln;
}

const regeln = leseRegeln(tournamentCss);
const druckRegeln = regeln.filter((r) => r.kontext.some((k) => /^@media[^{]*\bprint\b/.test(k)));

/** Die eine Regel, die den Token-Satz des Moduls auf Papier zuruecksetzt. */
const tokenReset = druckRegeln.find(
  (r) =>
    r.selektoren.includes('.t-mod') && Object.keys(r.deklarationen).some((d) => d.startsWith('--'))
);

/** Farbtoken = in tokens.css mit einem Farbwert deklariert. */
const farbToken = new Set(
  [...tokensCss.matchAll(/^\s*--([a-z0-9-]+)\s*:\s*(?:#|rgb|hsl|color-mix)/gm)].map((m) => m[1])
);

/** Token, die tournament.css tatsaechlich ausliest. */
const benutzteToken = new Set(
  [...ohneKommentare(tournamentCss).matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1])
);

describe('Drucklayout: der Token-Satz', () => {
  it('setzt das Modul auf Papierfarben zurueck', () => {
    expect(tokenReset, 'Regel mit Druck-Tokens auf .t-mod nicht gefunden').toBeTruthy();
    expect(tokenReset.deklarationen['--ink']).toMatch(/#000000/);
    expect(tokenReset.deklarationen['--paper']).toMatch(/#ffffff/);
  });

  it('deckt JEDEN Farbtoken ab, den das Modul benutzt', () => {
    const gesetzt = new Set(
      Object.keys(tokenReset.deklarationen)
        .filter((d) => d.startsWith('--'))
        .map((d) => d.slice(2))
    );
    const luecke = [...farbToken].filter((t) => benutzteToken.has(t) && !gesetzt.has(t)).sort();
    expect(
      luecke,
      `Diese Farbtoken benutzt das Modul, der Druck setzt sie nicht zurueck: ${luecke.join(', ')}. ` +
        'Im Nachtmodus drucken sie in Dunkelmodus-Werten.'
    ).toEqual([]);
  });

  it('fuehrt keine Karteileichen mit', () => {
    // Ein Reset-Eintrag fuer einen Token, den niemand mehr ausliest, ist
    // kein Schaden, aber eine Luege ueber den Stand des Moduls — und er
    // macht die Pruefung darueber stumpf. --board, --board-ink,
    // --board-dim und --danger-ink standen hier noch, nachdem die
    // Anzeigetafel am 26.08. aus dem Modul geflogen war.
    const tot = Object.keys(tokenReset.deklarationen)
      .filter((d) => d.startsWith('--'))
      .map((d) => d.slice(2))
      .filter((t) => !benutzteToken.has(t));
    expect(tot, `Im Druck zurueckgesetzt, aber nirgends benutzt: ${tot.join(', ')}`).toEqual([]);
  });

  it('setzt jeden Wert mit !important', () => {
    // Der Dunkel-Block in tokens.css steht bei (1,2,0), weil sein
    // :is()-Arm eine ID traegt. Ein Spezifitaets-Wettrennen verliert die
    // naechste Erweiterung jener Liste wieder — und zwar unbemerkt, denn
    // ein zu schwacher Reset meldet sich nicht.
    const ohne = Object.entries(tokenReset.deklarationen)
      .filter(([name, wert]) => name.startsWith('--') && !wert.includes('!important'))
      .map(([name]) => name);
    expect(ohne, `Ohne !important und damit im Nachtmodus wirkungslos: ${ohne.join(', ')}`).toEqual(
      []
    );
  });
});

describe('Drucklayout: die Entfaerbung trifft die Klassen des Renderers', () => {
  const ZUSTAENDE = ['is-lead', 'is-qualified', 'is-pending', 'is-cutoff'];

  /** Zustandsklassen, die der Tabellen-Renderer heute setzt. */
  const rendererKlassen = new Set(
    [...helpersJs.matchAll(/'(is-[a-z]+)'/g)].map((m) => m[1]).filter((k) => ZUSTAENDE.includes(k))
  );

  const entfaerbung = druckRegeln.filter(
    (r) =>
      r.selektoren.some((s) => /\.t-standings-row\./.test(s)) &&
      /none/.test(r.deklarationen.background ?? '')
  );

  const genannteKlassen = new Set(
    entfaerbung
      .flatMap((r) => r.selektoren)
      .flatMap((s) => [...s.matchAll(/\.(is-[a-z]+)/g)].map((m) => m[1]))
  );

  it('findet ueberhaupt eine Entfaerbungsregel', () => {
    expect(entfaerbung.length).toBeGreaterThan(0);
    expect(rendererKlassen.size).toBeGreaterThan(0);
  });

  it('kennt jede Zustandsklasse, die der Renderer ausgibt', () => {
    const fehlend = [...rendererKlassen].filter((k) => !genannteKlassen.has(k));
    expect(
      fehlend,
      `Der Renderer gibt ${[...rendererKlassen].join('/')} aus; im Druck nicht entfaerbt: ` +
        fehlend.join(', ')
    ).toEqual([]);
  });

  it('entfaerbt keine Klasse, die es nicht mehr gibt', () => {
    // Die Gegenrichtung. `is-pending` und `is-cutoff` standen hier noch,
    // nachdem der Renderer sie am 26.08. aufgegeben hatte — eine Regel,
    // die nichts mehr trifft, sieht aus wie Schutz und ist keiner.
    const verwaist = [...genannteKlassen].filter((k) => !rendererKlassen.has(k));
    expect(
      verwaist,
      `Im Druck entfaerbt, vom Renderer nie gesetzt: ${verwaist.join(', ')}`
    ).toEqual([]);
  });
});

describe('Drucklayout: die Boegen sind der Ausdruck', () => {
  const mitBoegen = (s) => /:has\(\.t-druck \.t-bogen\)/.test(s);

  it('blendet den Drucken-Tab ein, wenn Boegen im DOM stehen', () => {
    const treffer = druckRegeln.filter(
      (r) =>
        r.selektoren.some((s) => mitBoegen(s) && /\[data-view='drucken'\]/.test(s)) &&
        /block/.test(r.deklarationen.display ?? '')
    );
    expect(treffer.length, 'Keine Regel holt den Drucken-Tab in den Druck').toBeGreaterThan(0);
  });

  it('haelt die Bildschirm-Ansichten zurueck, solange Boegen da sind', () => {
    const treffer = druckRegeln.filter(
      (r) =>
        r.selektoren.some((s) => mitBoegen(s) && /\[data-view='spielplan'\]/.test(s)) &&
        /none/.test(r.deklarationen.display ?? '')
    );
    expect(
      treffer.length,
      'Ohne diese Regel druckt der entfaerbte Bildschirm zusaetzlich mit'
    ).toBeGreaterThan(0);
  });

  it('behaelt den Rueckfall ohne Boegen', () => {
    // Wer aus einer Ansicht druckt, in der keine Boegen erzeugt wurden,
    // soll den entfaerbten Spielplan bekommen — nicht leeres Papier.
    const rueckfall = druckRegeln.filter(
      (r) =>
        r.selektoren.some((s) => /\[data-view='spielplan'\]/.test(s) && !mitBoegen(s)) &&
        /block/.test(r.deklarationen.display ?? '')
    );
    expect(rueckfall.length, 'Der Rueckfall auf die Bildschirm-Ansicht fehlt').toBeGreaterThan(0);
  });

  it('laesst die Erklaerkarte des Drucken-Tabs nicht mitdrucken', () => {
    const treffer = druckRegeln.filter(
      (r) =>
        r.selektoren.some((s) => s.includes('.t-druck-hinweis')) &&
        /none/.test(r.deklarationen.display ?? '')
    );
    expect(treffer.length).toBeGreaterThan(0);
  });

  it('blendet den Modulkopf nur zusammen mit den Boegen aus', () => {
    // Ohne Boegen traegt der Modulkopf den Turniernamen; faellt er
    // bedingungslos weg, hat das Blatt keine Ueberschrift. Genau das war
    // der Zustand: Block 2 nahm ihn weg, Block 1 baute auf ihn.
    const kopfRegeln = druckRegeln.filter(
      (r) =>
        r.selektoren.some((s) => /\.t-mod-header/.test(s)) &&
        /none/.test(r.deklarationen.display ?? '')
    );
    expect(kopfRegeln.length).toBeGreaterThan(0);
    for (const r of kopfRegeln) {
      const kopfSelektoren = r.selektoren.filter((s) => /\.t-mod-header/.test(s));
      expect(
        kopfSelektoren.every((s) => mitBoegen(s)),
        `Der Modulkopf faellt auch ohne Boegen weg: ${kopfSelektoren.join(', ')}`
      ).toBe(true);
    }
  });
});

describe('Mobil: die Bogen-Vorschau', () => {
  const vorschau = regeln.filter(
    (r) =>
      r.selektoren.includes('.t-bogen') &&
      r.deklarationen['min-width'] &&
      r.kontext.some((k) => /max-width/.test(k))
  );

  it('gibt dem Bogen am Handy eine Mindestbreite statt ihn abzuschneiden', () => {
    // Gemessen bei 375px: Bogen 307px breit, Inhalt 563px, und
    // `.t-mod-main` traegt `overflow-x: clip` — abgeschnitten, nicht
    // scrollbar. Die rechten Tabellenspalten waren unerreichbar.
    expect(vorschau.length, 'Keine Mobil-Regel fuer .t-bogen').toBeGreaterThan(0);
    expect(parseInt(vorschau[0].deklarationen['min-width'], 10)).toBeGreaterThanOrEqual(520);
  });

  it('macht den Rahmen darum scrollbar', () => {
    const scroller = regeln.filter(
      (r) =>
        r.selektoren.includes('.t-druck') && /auto|scroll/.test(r.deklarationen['overflow-x'] ?? '')
    );
    expect(
      scroller.length,
      '.t-druck scrollt nicht — die Mindestbreite wuerde nur anders clippen'
    ).toBeGreaterThan(0);
  });

  it('gilt NUR am Bildschirm, nie im Druck', () => {
    // Ohne `screen and` greift die Regel auch auf Papier: gemessen mit
    // emulateMedia bei 375px stand der Bogen mit min-width 560px in einem
    // 335px breiten Rahmen mit overflow-x. Auf Papier wird daraus ein
    // abgeschnittener rechter Rand, denn Papier scrollt nicht.
    for (const r of vorschau) {
      const query = r.kontext.find((k) => /max-width/.test(k));
      expect(query, `Vorschau-Regel ohne screen-Bindung: ${query}`).toMatch(/\bscreen\b/);
    }
  });
});

describe('Der Drucken-Knopf laedt die Boegen, bevor er druckt', () => {
  const anker = mainJs.indexOf('detail.querySelectorAll(\'[data-action="print"]\')');
  const handler = mainJs.slice(anker, anker + 700);

  it('findet den Handler', () => {
    expect(anker).toBeGreaterThan(0);
  });

  it('wartet auf ladeDruckboegen, wenn der Mount leer ist', () => {
    // Am Telefon fuehrt der einzige Weg ueber das Kontextmenue, also nie
    // ueber den Drucken-Tab, der die Boegen sonst erzeugt.
    expect(handler).toMatch(/drucken-mount/);
    expect(handler).toMatch(/await\s+ladeDruckboegen/);
    // Gedruckt wird trotzdem, auch wenn das Laden fehlschlaegt.
    expect(handler).toMatch(/window\.print\(\)/);
  });

  it('wechselt dafuer NICHT den Tab', () => {
    // Nach dem Schliessen des Druckdialogs soll der Druckende dort
    // stehen, wo er war — ein Sprung waere eine Navigation, die niemand
    // angefordert hat.
    expect(handler).not.toMatch(/switchToView\(/);
  });
});

describe('Wizard: der Body scrollt auf Desktop', () => {
  it('gibt dem gedeckelten Modul ein Kind, das scrollt', () => {
    // Gemessen: Schritt 2 mit 18 Teams braucht 1529px, verfuegbar sind
    // 840px bei 900px Fensterhoehe; der Weiter-Knopf lag bei y=1545 und
    // war auf JEDEM Desktop-Fenster unerreichbar, auch auf 1440x1080.
    const treffer = regeln.filter(
      (r) =>
        r.selektoren.includes('.t-wizard-host > .t-mod > .t-wizard-body') &&
        /auto|scroll/.test(r.deklarationen['overflow-y'] ?? '')
    );
    expect(treffer.length, 'Der Wizard-Body scrollt nicht — der Weiter-Knopf bleibt geklippt').toBe(
      1
    );
    // Nur dort, wo die Hoehenklammer ueberhaupt greift.
    expect(treffer[0].kontext.some((k) => /min-width:\s*768px/.test(k))).toBe(true);
  });

  it('laesst die Hoehenklammer selbst stehen', () => {
    // Die Klammer ist nicht der Fehler — ohne sie waechst das Modul ueber
    // das Fenster hinaus und die Fortschrittsanzeige wandert mit weg.
    const klammer = regeln.filter(
      (r) =>
        r.selektoren.includes('.t-wizard-host > .t-mod') &&
        /hidden/.test(r.deklarationen.overflow ?? '')
    );
    expect(klammer.length).toBe(1);
  });
});

describe('Zwischenbreiten: die Rangspalte im Neuner-Satz', () => {
  // GEMESSEN im Browser (msedge, public/pruefstand-marke.html): der
  // Compact-Umschalter greift bei .t-mod <= 600px. Direkt darueber gilt
  // wieder der Neuner-Satz — und dort waren 6% zu wenig: bei .t-mod =
  // 612px ergaben sie 37px, die Ueberschrift Pl. braucht 40px. Die
  // Zelle traegt overflow:visible und text-overflow:clip, es gibt also
  // nicht einmal ein Auslassungszeichen; der Text lief in die
  // Team-Spalte. Reproduzierbar bei 640px und 660px Ansichtsbreite,
  // 660px ist ein Bruchpunkt des Bestands.
  //
  // Geprueft wird das gerenderte <colgroup>, nicht die Konstante: was
  // zaehlt, ist die Breite, die im DOM ankommt.
  const fixture = [
    {
      groupKey: 'A',
      groupName: 'Gruppe A',
      standings: [{ teamId: 't1', name: 'Blaue Hummeln', points: 6 }],
    },
  ];

  /**
   * Liest die Spaltenbreiten aus dem gerenderten colgroup.
   *
   * @param {string} html Markup des Renderers
   * @returns {number[]} Breiten in Prozent, 'auto' als 0
   */
  const spaltenBreiten = (html) =>
    [...html.matchAll(/<col style="width:([^"]+)">/g)].map((m) =>
      m[1] === 'auto' ? 0 : parseFloat(m[1])
    );

  it('gibt der Rangspalte im Desktop-Satz mindestens 8%', () => {
    setCompactMode(false);
    const breiten = spaltenBreiten(renderStandingsGroups(fixture, 'Becher', 2));
    expect(breiten.length, 'Neuner-Satz erwartet').toBe(9);
    // 8% von 601px (der schmalsten Breite, bei der dieser Satz gilt)
    // sind 48px und liegen ueber dem gemessenen Bedarf von 40px.
    expect(breiten[0]).toBeGreaterThanOrEqual(8);
  });

  it('laesst der Team-Spalte weiter den Rest', () => {
    // Die Zugabe kommt aus der auto-Spalte, nicht aus einem Festwert —
    // sonst verschiebt sich die Zuordnung Spalte->Breite, an der diese
    // Liste schon einmal zerbrochen ist.
    setCompactMode(false);
    const breiten = spaltenBreiten(renderStandingsGroups(fixture, 'Becher', 2));
    expect(breiten[1], 'Team-Spalte muss auto bleiben').toBe(0);
    const feste = breiten.reduce((a, b) => a + b, 0);
    expect(feste, 'Festwerte duerfen der auto-Spalte nicht alles nehmen').toBeLessThanOrEqual(75);
  });

  it('ruehrt den Mobil-Satz nicht an', () => {
    // Der Fuenfer-Satz ist eigens gemessen (P5, 2026-08-25) und gilt
    // unterhalb von 600px — dort war nie etwas geklippt.
    setCompactMode(true);
    const breiten = spaltenBreiten(renderStandingsGroups(fixture, 'Becher', 2));
    expect(breiten).toEqual([14, 42, 14, 15, 15]);
    setCompactMode(false);
  });
});
