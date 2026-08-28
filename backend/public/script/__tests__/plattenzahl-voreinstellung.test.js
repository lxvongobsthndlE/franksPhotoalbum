/**
 * Die Plattenzahl hat EINE Voreinstellung — und sie faehrt beim Generate mit.
 *
 * Warum es diese Tests gibt (Befund 2026-08-28):
 * ---------------------------------------------
 * Der Betreiber meldete einen Spielplan mit genau EINEM Spiel je
 * Anstosszeit, alles auf „Platte 1", obwohl mehrere Platten eingestellt
 * waren. Dahinter lagen drei getrennte Ursachen, und keine davon war die
 * Engine:
 *
 *   1. ZWEI Voreinstellungen fuer denselben Wert. `DEFAULT_WIZARD_STATE`
 *      in tournament.js sagte 2, main.js baute sein eigenes initialState
 *      mit `numTables: 1` — und weil der Aufrufer-Wert das Default
 *      ueberschreibt, gewann die 1. Wer den Stepper nie anfasste,
 *      erzeugte ein Ein-Platten-Turnier.
 *   2. Der Zeitplan hatte keine Verteidigungslinie. `mode` und
 *      `numGroups` schickt der Wizard beim Generate ausdruecklich mit,
 *      falls der Step-PATCH nicht durchkam (Bug A, 17.08.). Der
 *      Zeitplan — und damit die Plattenzahl — fuhr nicht mit.
 *   3. Der Einstellungen-Tab zeigte einen Rueckfallwert von 4 Platten an,
 *      waehrend die Engine ohne gesetzten Wert mit 1 rechnet. Anzeige und
 *      Plan sagten also Verschiedenes.
 *
 * Die Tests hier pruefen die REGEL, nicht die Zahl: Sie fallen, sobald
 * jemand die Plattenzahl wieder irgendwo festnagelt oder eine zweite
 * Voreinstellung einfuehrt. Ein fester Wert kann nicht mehrere
 * verschiedene Eingaben gleichzeitig erfuellen.
 *
 * Bewusst KEIN Zeilen-Scan: Im Repo sind schon einmal fuenf Tests bei
 * einem Prettier-Lauf gebrochen, weil sie auf Umbrueche gebaut waren.
 * Wo hier trotzdem Quelltext gelesen wird, geschieht das ueber tolerante
 * Muster ohne Annahme ueber Zeilen oder Weissraum.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildGeneratePayload, WIZARD_DEFAULT_NUM_TABLES } from '../tournament.js';

const hier = dirname(fileURLToPath(import.meta.url));
const skriptDir = join(hier, '..');

function quelle(datei) {
  return readFileSync(join(skriptDir, datei), 'utf8');
}

/** Entfernt Kommentare, damit ein erklaerender Text nicht als Code zaehlt. */
function ohneKommentare(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function basisState(ueberschreibungen = {}) {
  return {
    date: '2026-09-05',
    numGroups: 2,
    teams: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
    mode: 'groups_ko',
    numTables: 3,
    matchDuration: 20,
    pauseMinutes: 5,
    startTime: '10:00',
    ...ueberschreibungen,
  };
}

describe('Eine Voreinstellung fuer die Plattenzahl, nicht zwei', () => {
  it('die Voreinstellung ist exportiert und plant mehr als eine Platte', () => {
    expect(Number.isInteger(WIZARD_DEFAULT_NUM_TABLES)).toBe(true);
    // Der konkrete Wert darf sich aendern; dass ein frisches Turnier
    // nicht im Ein-Platten-Nacheinander landet, darf sich nicht aendern.
    expect(WIZARD_DEFAULT_NUM_TABLES).toBeGreaterThanOrEqual(2);
  });

  it('main.js erfindet keine eigene Plattenzahl mehr', () => {
    const src = ohneKommentare(quelle('main.js'));
    // Eine Zuweisung `numTables: <Zahl>` in main.js waere wieder eine
    // zweite Wahrheit — der Wert gehoert aus tournament.js geholt.
    const eigeneZahl = src.match(/numTables\s*:\s*\d+/g) ?? [];
    expect(eigeneZahl).toEqual([]);
    expect(src).toMatch(/numTables\s*:\s*WIZARD_DEFAULT_NUM_TABLES/);
  });

  it('der Einstellungen-Tab zeigt keinen erfundenen Rueckfallwert an', () => {
    const src = ohneKommentare(quelle('spielplan-helpers.js'));
    const rueckfall = src.match(/parallelFields\s*\?\?\s*(\d+)/g) ?? [];
    expect(rueckfall.length).toBeGreaterThan(0);
    // Ohne gesetzten Wert rechnet die Engine mit 1 (engine/schedule.js).
    // Jede andere Zahl in der Anzeige waere eine Behauptung ueber einen
    // Plan, den es so nicht gibt.
    for (const treffer of rueckfall) {
      expect(treffer.replace(/\s+/g, '')).toBe('parallelFields??1');
    }
  });
});

describe('Der Zeitplan faehrt im Generate-Body mit', () => {
  for (const platten of [1, 2, 3, 4, 6]) {
    it(`${platten} Platten aus dem Wizard-State landen im Body`, () => {
      const body = buildGeneratePayload(basisState({ numTables: platten }));
      expect(body.schedule).toBeDefined();
      expect(body.schedule.parallelFields).toBe(platten);
    });
  }

  it('Spieldauer, Pause und Startzeit fahren ebenfalls mit', () => {
    const body = buildGeneratePayload(
      basisState({ matchDuration: 25, pauseMinutes: 10, startTime: '09:30' })
    );
    expect(body.schedule.matchDurationMinutes).toBe(25);
    expect(body.schedule.pauseAfterMatches).toBe(10);
    expect(body.schedule.startTime).toBe('09:30');
  });

  it('eine Pause von 0 Minuten ist ein Wert, kein fehlender Wert', () => {
    // `if (state.pauseMinutes)` haette die 0 verschluckt und den Server
    // auf den alten config-Wert zurueckfallen lassen — genau die Art
    // stiller Ruecknahme, gegen die diese Verteidigungslinie gebaut ist.
    const body = buildGeneratePayload(basisState({ pauseMinutes: 0 }));
    expect(body.schedule.pauseAfterMatches).toBe(0);
  });

  it('was der State nicht kennt, wird auch nicht behauptet', () => {
    const body = buildGeneratePayload({
      date: '2026-09-05',
      numGroups: 2,
      teams: [],
      mode: 'groups_ko',
    });
    expect(body.schedule).toBeUndefined();
  });

  it('die bestehende Verteidigungslinie fuer Modus und Gruppen bleibt', () => {
    const body = buildGeneratePayload(basisState());
    expect(body.mode).toBe('groups_ko');
    expect(body.numGroups).toBe(2);
    expect(body.baseDate).toBe('2026-09-05');
  });
});
