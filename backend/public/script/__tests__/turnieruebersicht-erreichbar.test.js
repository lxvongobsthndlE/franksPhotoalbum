/**
 * Die Turnier-Uebersicht muss erreichbar bleiben — auch mit genau EINEM
 * Turnier.
 *
 * Beschwerde Jonas, 2026-08-26: „ich kann kein neues turnier erstellen
 * weil ich nicht in das turniermenue komme wenn ich nur ein turnier habe."
 *
 * Zwei Aenderungen desselben Tages hatten sich gegenseitig eingemauert:
 *
 *  1. Der Auto-Sprung (P4, 2026-08-24/25): bei genau einem sichtbaren
 *     Turnier laedt `loadTournamentInstances` sofort das Detail. Er war
 *     bedingungslos — auch dann, wenn der Nutzer gerade „Zurueck zur
 *     Uebersicht" gedrueckt hatte. Die Uebersicht kam also nie zum
 *     Vorschein: sie wurde geladen und im selben Zug uebersprungen.
 *  2. Der Knopf „Neu" steht seit dem 26.08. NUR in der Uebersicht
 *     (`detailOffen`-Gate in `renderTournamentHeaderActions`, Entscheid:
 *     „das brauch ich da gar nicht waehrend ich in einem turnier drin
 *     bin"). Wer die Uebersicht nicht erreicht, erreicht ihn nicht.
 *
 * Dazu kam ein dritter Punkt, der die Sackgasse auf Desktop komplett
 * machte: die Aktionszeile unter dem Modulkopf ist am 26.08. ersatzlos
 * entfallen, und der Ersatz-Ausgang landete nur im mobilen Mehr-Blatt
 * (`.t-mod-tabs` ist ueber 600px `display: none`). Auf Desktop gab es
 * danach ueberhaupt keinen Weg aus einem geoeffneten Turnier heraus.
 *
 * Jede der drei Aenderungen war fuer sich richtig. Deshalb bewacht dieser
 * Test nicht eine davon, sondern ihr Zusammenspiel: den Weg
 * Detail -> Uebersicht -> „Neu".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderDetailSidebar, findDataActions } from '../tournament-render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(resolve(__dirname, '..', 'main.js'), 'utf-8');

describe('Ausgang aus dem Turnier: Desktop-Seitenleiste', () => {
  it('traegt einen Zurueck-Eintrag — sonst gibt es ueber 600px keinen Ausgang', () => {
    for (const isAdmin of [true, false]) {
      const html = renderDetailSidebar({ isAdmin });
      expect(
        findDataActions(html).has('back'),
        `Seitenleiste ohne Ausgang (isAdmin=${isAdmin}): .t-mod-tabs ist auf Desktop `
        + 'display:none, das Mehr-Blatt also unerreichbar.',
      ).toBe(true);
    }
  });

  it('der Zurueck-Eintrag ist KEIN Ansichts-Reiter', () => {
    // Der Nav-Binder in main.js greift `.t-mod-nav button[data-view]` und
    // schaltet damit `section.t-view[data-view=…]` um. Traegt der Ausgang
    // ein data-view, wechselt der Klick auf eine Ansicht, die es nicht
    // gibt — sichtbares Ergebnis: eine leere Hauptspalte.
    const html = renderDetailSidebar({ isAdmin: true });
    const zurueck = html.slice(html.indexOf('data-action="back"'));
    const knopfEnde = zurueck.indexOf('</button>');
    expect(zurueck.slice(0, knopfEnde)).not.toContain('data-view');
  });

  it('nennt die Uebersicht beim Namen — deutsch, du-Form, kein Fachwort', () => {
    expect(renderDetailSidebar({ isAdmin: true })).toContain('Zurück zur Übersicht');
  });
});

describe('Auto-Sprung bei genau einem Turnier', () => {
  it('ist an !tournamentListForced gekoppelt', () => {
    // Ohne diese Bedingung ist die Uebersicht bei genau einem Turnier
    // eine Sackgasse: sie laedt und springt sofort wieder weg.
    const block = mainSrc.slice(
      mainSrc.indexOf('const visibleInstances'),
      mainSrc.indexOf('renderTournamentInstancesPage();', mainSrc.indexOf('const visibleInstances')),
    );
    expect(block).toContain('visibleInstances.length === 1');
    expect(
      block,
      'Der Auto-Sprung ignoriert wieder den ausdruecklichen Wunsch nach der Uebersicht.',
    ).toContain('!tournamentListForced');
  });

  it('switchToTournamentInstances nimmt forceList entgegen und setzt das Flag', () => {
    const fn = mainSrc.slice(mainSrc.indexOf('async function switchToTournamentInstances'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('forceList');
    expect(body).toMatch(/tournamentListForced\s*=\s*forceList\s*===\s*true/);
  });

  it('der Zurueck-Handler uebergibt forceList: true', () => {
    // Der Klick IST der Wunsch. Ohne das Argument wirft der Auto-Sprung
    // sofort wieder ins selbe Detail — die Beschwerde von oben.
    const handler = mainSrc.slice(mainSrc.indexOf("data-action=\"back\"]').forEach"));
    // Bis zum Fallback-Zweig schneiden, nicht bis zum ersten `});` — das
    // steht seit dem Fix im Aufruf selbst (`{ forceList: true })`) und
    // haette den Handler mitten im Beleg abgeschnitten.
    const block = handler.slice(0, handler.indexOf('history.back'));
    expect(block).toMatch(/switchToTournamentInstances\(\{\s*forceList:\s*true\s*\}\)/);
  });

  it('das Oeffnen eines Turniers verbraucht den Uebersichts-Wunsch', () => {
    // Positivprobe zur Regel oben: bliebe das Flag stehen, waere der
    // Auto-Sprung fuer den Rest der Sitzung tot — und der Klick auf
    // „Turniere" in der Seitenleiste landete dauerhaft in einer Liste
    // mit einem einzigen Eintrag. Das war die Beschwerde vom 25.08.,
    // also die Gegenrichtung derselben Achse.
    const fn = mainSrc.slice(mainSrc.indexOf('async function openTournamentInstance'));
    expect(fn.slice(0, fn.indexOf('try {'))).toContain('tournamentListForced = false');
  });
});

describe('„Neu" steht in der Uebersicht — und nur dort', () => {
  it('haengt an isInstancesView und der Admin-Rolle', () => {
    const fn = mainSrc.slice(mainSrc.indexOf('function renderTournamentHeaderActions'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('tournament-new-instance-btn');
    expect(body).toContain('darfErstellen');
    // Das Gate, das den Knopf aus dem geoeffneten Turnier fernhaelt.
    // Es ist der Grund, warum die Uebersicht erreichbar bleiben MUSS.
    expect(body).toMatch(/const detailOffen\s*=/);
    expect(body).toContain('!detailOffen');
  });
});
