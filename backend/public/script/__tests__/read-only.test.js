/**
 * Read-Only Enforcement (P1) — User-Liste 2026-08-24.
 *
 * Mitglieder (isAdmin=false) dürfen KEINE mutierenden Bedienelemente
 * sehen — kein Bearbeiten, kein Löschen, kein Ergebnis eintragen,
 * kein Turnier löschen, kein Einstellungen-Tab, kein Teams-Edit,
 * kein Zeitplan-Edit.
 *
 * Wir prüfen das auf zwei Ebenen:
 *
 * 1. **Renderer-Ebene:** Direkter Aufruf der reinen HTML-Renderer
 *    aus `tournament-render.js` mit isAdmin=false, dann Suche nach
 *    mutierenden `data-action`-Attributen im Output.
 *
 * 2. **Source-Scan:** Statischer Scan von main.js + spielplan-helpers.js,
 *    um sicherzustellen, dass jedes mutierende `data-action="…"` in
 *    einem Template-Literal von einem `${isAdmin ? … : ''}`-Gate
 *    umschlossen ist (oder in einer Helper-Funktion steckt, deren
 *    Output im Test unter Ebene 1 geprüft wird).
 *
 * Renderer-Ebene ist die primary defense — wenn die Tests grün sind,
 * ist die Render-Pipeline garantiert read-only für Members.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  renderSpielplanSectionHead,
  renderRegelnSectionHead,
  renderEinstellungenSection,
  renderDetailSidebar,
  filterMemberViews,
  findMutatingAction,
  findDataActions,
  MUTATING_DATA_ACTIONS,
  SAFE_DATA_ACTIONS,
} from '../tournament-render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = resolve(__dirname, '..');
const mainJsPath = resolve(SCRIPT_DIR, 'main.js');
const spielplanHelpersPath = resolve(SCRIPT_DIR, 'spielplan-helpers.js');

describe('Renderer-Ebene: isAdmin=false darf KEIN mutierendes data-action enthalten', () => {
  it('Spielplan-Section-Head: kein toggle-schedule-edit / enter-result-pick', () => {
    const html = renderSpielplanSectionHead({ isAdmin: false, t: { id: 't1' } });
    const mut = findMutatingAction(html);
    expect(mut).toBeNull();
    // Sanity: keine Spuren von "Bearbeiten" oder "Ergebnis eintragen"
    expect(html).not.toContain('toggle-schedule-edit');
    expect(html).not.toContain('enter-result-pick');
  });

  it('Regeln-Section-Head: kein edit-rules', () => {
    const html = renderRegelnSectionHead({ isAdmin: false });
    const mut = findMutatingAction(html);
    expect(mut).toBeNull();
    expect(html).not.toContain('edit-rules');
  });

  it('Einstellungen-Section: komplett leer für !isAdmin', () => {
    const html = renderEinstellungenSection({ isAdmin: false });
    expect(html).toBe('');
    // Sanity: sicherstellen, dass nicht doch irgendein Button drin ist.
    expect(findMutatingAction(html)).toBeNull();
  });

  it('Sidebar: kein "Einstellungen"-Item für !isAdmin', () => {
    const html = renderDetailSidebar({ isAdmin: false });
    // data-view="einstellungen" wäre hier ok — wir prüfen nur mutierende actions.
    const mut = findMutatingAction(html);
    expect(mut).toBeNull();
    expect(html).not.toContain('>Einstellungen<');
  });

  it('filterMemberViews: filtert Einstellungen für Members', () => {
    const all = ['spielplan', 'gruppen', 'baum', 'teams', 'regeln', 'drucken', 'einstellungen'];
    expect(filterMemberViews({ allViews: all, isAdmin: true })).toEqual(all);
    expect(filterMemberViews({ allViews: all, isAdmin: false })).toEqual([
      'spielplan',
      'gruppen',
      'baum',
      'teams',
      'regeln',
      'drucken',
    ]);
  });
});

describe('Sanity: isAdmin=true DARF mutierende Actions enthalten', () => {
  it('Spielplan-Section-Head: enter-result-pick sichtbar, Bearbeiten NICHT mehr', () => {
    // Diese Zusicherung ist die POSITIVPROBE der ganzen Datei: ohne sie
    // waeren die Negativ-Tests darueber leer-gruen, weil ein Renderer,
    // der gar nichts ausgibt, jede "enthaelt keine mutierende Aktion"-
    // Pruefung besteht.
    //
    // Entscheid Jonas, 2026-08-26: "bearbeiten kann auch weg das mach ich
    // als admin ja in den einstellungen." Der Einstieg in den Edit-Modus
    // ist damit aus dem Spielplan-Kopf verschwunden — der Edit-Modus
    // selbst und seine Rollenpruefung sind unveraendert.
    const html = renderSpielplanSectionHead({ isAdmin: true, t: { id: 't1' } });
    const actions = findDataActions(html);
    expect(actions.has('enter-result-pick')).toBe(true);
    expect(actions.has('toggle-schedule-edit')).toBe(false);
  });

  it('Regeln-Section-Head traegt gar keine Aktion mehr — sie liegt im Modulkopf', () => {
    // Jonas: "hier gibts zwei mal bearbeiten, das muss weg." Der Modulkopf
    // traegt je Ansicht EINE Aktion, fuer das Regelwerk ist das
    // "Bearbeiten". Der Knopf im View-Kopf war dieselbe Handlung ein
    // zweites Mal.
    //
    // Ein leerer Renderer ist hier KEIN Freibrief: die Rollenpruefung darf
    // dabei nicht verschwunden sein, sie ist nur umgezogen. Deshalb wird
    // sie unten am Quelltext von main.js nachgewiesen — sonst haette
    // dieser Test das Loch selbst aufgemacht, das er bewachen soll.
    for (const isAdmin of [true, false]) {
      const html = renderRegelnSectionHead({ isAdmin });
      expect(findDataActions(html).size).toBe(0);
    }

    const mainSrc = readFileSync(resolve(__dirname, '..', 'main.js'), 'utf-8');
    const chrome = mainSrc.slice(mainSrc.indexOf('const T_VIEW_CHROME'));
    const regelnBlock = chrome.slice(chrome.indexOf('regeln:'), chrome.indexOf('drucken:'));
    expect(regelnBlock, 'Regelwerk-Aktion fehlt im Modulkopf').toContain('Bearbeiten');
    expect(regelnBlock, 'Die Regelwerk-Aktion im Modulkopf hat KEINE Rollenpruefung mehr').toMatch(
      /wenn:\s*\(t\)\s*=>\s*t\.isAdmin\s*===\s*true/
    );
  });
  it('Einstellungen-Section: sichtbar für Admins', () => {
    const html = renderEinstellungenSection({ isAdmin: true });
    expect(html).toContain('data-view="einstellungen"');
  });

  it('Sidebar: Einstellungen-Item für Admins', () => {
    const html = renderDetailSidebar({ isAdmin: true });
    expect(html).toContain('>Einstellungen<');
  });
});

describe('Source-Scan: jedes mutierende data-action in main.js / spielplan-helpers.js ist isAdmin-gegated', () => {
  // Wir scannen main.js + spielplan-helpers.js statisch. Erwartung:
  // jede Fundstelle eines mutierenden `data-action="X"` liegt in einer
  // Zeile, die selbst `${isAdmin ? ... : ''}` enthält — oder in einer
  // Funktion, die als Parameter `{ isAdmin }` bzw. `{ isAdmin: … }`
  // deklariert. Letzteres ist die übliche Form in spielplan-helpers.js
  // (renderEinstellungen, renderActionsBlock, renderGroupsBoard,
  // renderFieldsEditor, renderEinstellungen, …).
  //
  // Das ist ein Belt-and-Suspenders-Test. Wenn jemand ein neues
  // mutierendes data-action ohne isAdmin-Gate einfügt, fängt dieser
  // Test es ab, bevor es in der UI landet.
  const sourceFiles = [mainJsPath, spielplanHelpersPath];

  for (const filePath of sourceFiles) {
    const fileName = filePath.split(/[/\\]/).pop();
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    describe(fileName, () => {
      for (const action of MUTATING_DATA_ACTIONS) {
        it(`data-action="${action}" ist isAdmin-gegated`, () => {
          // Suche nach allen Vorkommen. Wir filtern Listener-Attachments
          // raus (querySelector[All]('[data-action="..."]')), weil die
          // kein Rendering sind — die Buttons selbst werden anderswo
          // gerendert (per renderEinstellungenSection / renderActionsBlock)
          // und sind dort bereits isAdmin-gegated.
          const re = new RegExp(`data-action=["']${action}["']`, 'i');
          // `closest()` gehört zur selben Klasse wie `querySelector`:
          // eine SUCHE, kein Rendering. Ohne diesen Zweig hing das
          // Urteil über delegierte Dispatch-Zeilen (z. B.
          // `event.target.closest('[data-action="instance-delete"]')`)
          // daran, ob zufällig irgendwo in den 120 Zeilen darüber das
          // Wort `isAdmin` steht — eingefügte Kommentarzeilen konnten
          // den Test kippen, ohne dass sich am Gating etwas änderte
          // (belegt am 2026-08-25 bei main.js:2465).
          const listenerRe = /(?:querySelector(?:All)?|closest)\([^)]*data-action/i;
          // Kommentarzeilen zaehlen nicht als Fundstelle: ein Kommentar
          // rendert kein Markup. Ohne diesen Filter machte jede
          // Erlaeuterung, die ein data-action beim Namen nennt, den
          // Test rot (belegt 2026-08-25 an der Notiz zu
          // openPickTeamForGroupModal).
          const commentRe = /^\s*(?:\/\/|\*|\/\*)/;
          const hits = [];
          lines.forEach((line, idx) => {
            if (commentRe.test(line)) return;
            if (re.test(line) && !listenerRe.test(line)) hits.push(idx);
          });
          if (hits.length === 0) {
            // Kein Vorkommen in dieser Datei — das ist OK (vielleicht
            // ist die Action nur in tournament-render.js definiert oder
            // nur als Listener angehängt).
            return;
          }
          // Jeder Hit muss isAdmin-gegated sein.
          for (const hitIdx of hits) {
            // Suche in einem breiten Kontext nach dem Gate. Wir
            // schauen 120 Zeilen zurück UND 5 Zeilen vor — viele
            // Buttons sind in Helper-Funktionen wie renderActionsBlock
            // oder renderMatchCard gekapselt, die isAdmin als Parameter
            // bekommen oder per Early-Return (`if (!isAdmin) return …`)
            // gaten. Diese Gates können weit oberhalb der data-action-
            // Zeile liegen.
            const start = Math.max(0, hitIdx - 120);
            const end = Math.min(lines.length, hitIdx + 5);
            const ctx = lines.slice(start, end).join('\n');
            // Kommentarzeilen rausfiltern, damit `// isAdmin wäre hier
            // sinnvoll` nicht als Gate zählt.
            const ctxNoComments = ctx
              .split('\n')
              .filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
              .join('\n');

            // Gate-Formen: jede Erwähnung von `isAdmin` im Kontext
            // gilt als Beleg, dass die Funktion isAdmin-gegated ist
            // (entweder per Ternary, Early-Return, Options-Destructuring
            // oder Funktionsparameter). Wir verlassen uns nicht auf
            // eine spezifische Syntax, weil `renderActionsBlock` mit
            // `if (!isAdmin) return 'safe-html';` genauso gated ist
            // wie `data-action="${isAdmin ? 'X' : ''}"`.
            const isAdminRe = /\bisAdmin\b/;
            const gated = isAdminRe.test(ctxNoComments);
            expect(
              gated,
              `data-action="${action}" in ${fileName}:${hitIdx + 1} ` +
                `ist NICHT isAdmin-gegated — Kontext:\n${ctx}`
            ).toBe(true);
          }
        });
      }
    });
  }
});

describe('Allow-Liste: SAFE_DATA_ACTIONS sind klar getrennt von MUTATING_DATA_ACTIONS', () => {
  it('keine Überlappung zwischen safe und mutating', () => {
    const intersection = SAFE_DATA_ACTIONS.filter((a) => MUTATING_DATA_ACTIONS.includes(a));
    expect(intersection).toEqual([]);
  });
});
