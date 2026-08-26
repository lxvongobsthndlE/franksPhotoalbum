/**
 * Die Turnier-Uebersicht ist eine Ansicht mit einer Aufgabe — sie darf sich
 * nicht selbst ueberspringen.
 *
 * Drei Ansagen von Jonas am 2026-08-26, alle dieselbe Sache aus wachsender
 * Naehe:
 *
 *  1. „ich kann kein neues turnier erstellen weil ich nicht in das
 *     turniermenue komme wenn ich nur ein turnier habe"
 *  2. „die turnierauswahl laedt automatisch und es oeffnet sich nach ca
 *     1 sek das turnier, ich kann also nicht neue turniere erstellen"
 *  3. „er springt automatisch in das bestehende turnier und ich werde aus
 *     dem eigentlichen turnierauswahlsmenue direkt in das turnier geworfen"
 *
 * Ursache war der Auto-Sprung (P4, 24.08., verschaerft am 25.08.): bei genau
 * einem sichtbaren Turnier lud `loadTournamentInstances` sofort das Detail.
 * Zusammen mit zwei weiteren Entscheiden desselben Tages — „Neu" nur noch in
 * der Uebersicht, und die Aktionszeile unter dem Modulkopf ersatzlos
 * gestrichen — war die Uebersicht damit unerreichbar und mit ihr das Anlegen
 * eines zweiten Turniers.
 *
 * Zwei Anlaeufe haben um den Sprung herumgebaut (Ausnahme-Flag, dann den
 * Erstellen-Weg ins Modul verlegt). Erst der dritte hat ihn entfernt. Was
 * bleibt, sind zwei Zusicherungen:
 *
 *   - Die Uebersicht wird gezeigt, wenn sie geladen wird. Immer.
 *   - Der Erstellen-Weg haengt nicht an ihr, sondern am Modul. Das bleibt
 *     auch ohne Sprung richtig: wer in einem Turnier steckt und ein zweites
 *     anlegen will, soll nicht erst hinausnavigieren muessen.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderDetailSidebar, findDataActions } from '../tournament-render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(resolve(__dirname, '..', 'main.js'), 'utf-8');

/** Quelltext einer Funktion ab ihrer Signatur bis zur ersten Zeile, die nur
 *  eine schliessende Klammer traegt — reicht fuer diese flachen Funktionen. */
function funktionsRumpf(signatur) {
  const ab = mainSrc.slice(mainSrc.indexOf(signatur));
  const zeilen = ab.split(/\r?\n/);
  const ende = zeilen.findIndex((l, i) => i > 0 && /^\}\s*$/.test(l));
  return zeilen.slice(0, ende < 0 ? zeilen.length : ende).join('\n');
}

/** Kommentarzeilen raus: eine Erlaeuterung, die den alten Sprung beschreibt,
 *  ist kein Sprung. Ohne diesen Filter waeren die Tests unten rot, sobald
 *  jemand die Herleitung im Code aufschreibt — genau das ist am 25.08. an
 *  einer anderen Stelle dieses Repos passiert. */
function nurCode(quelle) {
  return quelle
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
}

describe('Kein Auto-Sprung: die Uebersicht ueberspringt sich nicht selbst', () => {
  // Dieser Test ist die Sperre dagegen, dass der Sprung als „ist doch
  // bequem" zurueckkommt. Er kam schon einmal zurueck (25.08., als
  // Verschaerfung), und danach hat es drei Anlaeufe gekostet, die Folgen
  // einzufangen.

  it('POSITIVPROBE: der gescannte Rumpf ist wirklich die Ladefunktion', () => {
    // Ohne diese Probe waeren die beiden Negativ-Tests darunter leer-gruen,
    // sobald `funktionsRumpf` ins Leere greift — ein umbenanntes
    // `loadTournamentInstances` wuerde dann als „kein Auto-Sprung" gelesen.
    // Ein Waechter, der nichts findet, bewacht nichts.
    const rumpf = funktionsRumpf('async function loadTournamentInstances');
    expect(rumpf.length).toBeGreaterThan(500);
    expect(rumpf).toContain('renderTournamentInstancesPage()');
    expect(rumpf).toContain('/tournaments/group/');
  });

  it('loadTournamentInstances oeffnet kein Turnier von sich aus', () => {
    const ruft = nurCode(funktionsRumpf('async function loadTournamentInstances'))
      .filter((l) => /openTournamentInstance\s*\(/.test(l));
    expect(
      ruft,
      'Die Listen-Ladefunktion oeffnet wieder selbst ein Turnier:\n' + ruft.join('\n'),
    ).toEqual([]);
  });

  it('die Anzahl der Turniere entscheidet nicht ueber die Ansicht', () => {
    // Die Uebersicht ist der Ort, an dem ein Turnier ANGELEGT wird — sie hat
    // eine Aufgabe, die von ihrer Fuellung unabhaengig ist. Eine Ansicht
    // danach zu bemessen, wie voll sie ist, uebersieht, was sie sonst traegt.
    const verzweigt = nurCode(funktionsRumpf('async function loadTournamentInstances'))
      .filter((l) => /\.length\s*===\s*1/.test(l));
    expect(
      verzweigt,
      'Es wird wieder auf „genau ein Turnier" verzweigt:\n' + verzweigt.join('\n'),
    ).toEqual([]);
  });

  it('switchToTournamentInstances braucht keine Optionen mehr', () => {
    // Solange es den Sprung gab, brauchte der Aufrufer ein `forceList`, um
    // ihn zu unterdruecken. Ohne Sprung gibt es nichts zu unterdruecken —
    // bliebe das Flag stehen, waere es toter Zustand, und toter Zustand ist
    // der naechste Bug.
    const code = nurCode(funktionsRumpf('async function switchToTournamentInstances')).join('\n');
    expect(code).toContain('activeTournamentInstance = null');
    expect(code).not.toContain('forceList');
    expect(code).not.toContain('tournamentListForced');
  });
});

describe('Ausgang aus dem Turnier: Desktop-Seitenleiste', () => {
  it('traegt einen Zurueck-Eintrag — sonst gibt es ueber 600px keinen Ausgang', () => {
    // `.t-mod-tabs` (und mit ihr das Mehr-Blatt) ist ueber 600px
    // display:none. Ohne diesen Eintrag gaebe es auf Desktop keinen Weg aus
    // einem geoeffneten Turnier heraus.
    for (const isAdmin of [true, false]) {
      const html = renderDetailSidebar({ isAdmin });
      expect(
        findDataActions(html).has('back'),
        `Seitenleiste ohne Ausgang (isAdmin=${isAdmin}).`,
      ).toBe(true);
    }
  });

  it('der Zurueck-Eintrag ist KEIN Ansichts-Reiter', () => {
    // Der Nav-Binder greift `.t-mod-nav button[data-view]` und schaltet
    // damit `section.t-view[data-view=…]` um. Traegt der Ausgang ein
    // data-view, wechselt der Klick auf eine Ansicht, die es nicht gibt —
    // sichtbares Ergebnis: eine leere Hauptspalte.
    const html = renderDetailSidebar({ isAdmin: true });
    const zurueck = html.slice(html.indexOf('data-action="back"'));
    expect(zurueck.slice(0, zurueck.indexOf('</button>'))).not.toContain('data-view');
  });

  it('nennt die Uebersicht beim Namen — deutsch, du-Form', () => {
    expect(renderDetailSidebar({ isAdmin: true })).toContain('Zurück zur Übersicht');
  });
});

describe('Der Erstellen-Weg haengt am Modul, nicht an einer Ansicht', () => {
  it('die Turnier-Seitenleiste bietet Admins „Neues Turnier"', () => {
    const html = renderDetailSidebar({ isAdmin: true });
    expect(findDataActions(html).has('new-tournament')).toBe(true);
    expect(html).toContain('Neues Turnier');
  });

  it('Mitglieder bekommen ihn nicht — POST /api/tournaments antwortet ihnen 403', () => {
    expect(findDataActions(renderDetailSidebar({ isAdmin: false })).has('new-tournament')).toBe(false);
  });

  it('das mobile Mehr-Blatt traegt beide Wege — dort ist die Seitenleiste aus', () => {
    // Unter 600px ist `.t-mod-nav` display:none. Stuende der Erstellen-Weg
    // nur in der Spalte, waere er auf dem Handy weg — und Mobile ist laut
    // Jonas der Hauptfall.
    const ab = mainSrc.indexOf('t-mod-more-list');
    const sheet = mainSrc.slice(ab, mainSrc.indexOf('</nav>', ab));
    expect(sheet).toContain('data-action="back"');
    expect(sheet).toContain('data-action="new-tournament"');
    expect(sheet, 'Der Erstellen-Weg im Sheet ist nicht isAdmin-gegated').toMatch(
      /isAdmin\s*\?[\s\S]*new-tournament/,
    );
  });

  it('der Handler wechselt erst in die Uebersicht, dann oeffnet er den Wizard', () => {
    // Der Wizard mountet in `grid`, und `grid` traegt im Detail die
    // Host-Klasse der Detailansicht. Direkt oeffnen setzt ihn in die falsche
    // Schale.
    const ab = mainSrc.indexOf('data-action="new-tournament"]\').forEach');
    const block = mainSrc.slice(ab, mainSrc.indexOf('openTournamentWizard()', ab) + 30);
    expect(block).toContain('switchToTournamentInstances()');
    expect(block.indexOf('switchToTournamentInstances')).toBeLessThan(
      block.indexOf('openTournamentWizard'),
    );
  });
});

describe('„Neu" im Modulkopf steht in der Uebersicht — und nur dort', () => {
  it('haengt an isInstancesView und der Admin-Rolle', () => {
    const body = funktionsRumpf('function renderTournamentHeaderActions');
    expect(body).toContain('tournament-new-instance-btn');
    expect(body).toContain('darfErstellen');
    // Das Gate, das den grossen Knopf aus dem geoeffneten Turnier
    // fernhaelt (Entscheid 26.08.: „das brauch ich da gar nicht waehrend
    // ich in einem turnier drin bin"). Der leise Eintrag am Fuss der
    // Navigationsspalte ist die Gegenprobe dazu, keine Ruecknahme.
    expect(body).toMatch(/const detailOffen\s*=/);
    expect(body).toContain('!detailOffen');
  });
});
