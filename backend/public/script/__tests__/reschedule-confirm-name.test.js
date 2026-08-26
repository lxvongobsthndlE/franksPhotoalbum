/**
 * Betriebsfestigkeit A6 (2026-08-25): falsches Bestaetigungswort.
 *
 * Fehlerklasse
 * ------------
 *   `rescheduleTournament(tournamentId, tournamentName)` gibt den
 *   zweiten Parameter als `expectedName` an den Bestaetigungsdialog
 *   weiter. Sind bereits Spiele beendet, antwortet der Server 409 mit
 *   `needsConfirmation` — der Dialog verlangt dann, dass der Nutzer den
 *   Turniernamen abtippt.
 *
 *   `rescheduleAuto` uebergab dort den Literal-String 'AUTO'. Der
 *   Dialog sagte also „Erwartet: AUTO" und akzeptierte NUR das Wort
 *   AUTO — mitten in einem laufenden Turnier, in dem der Nutzer den
 *   Turniernamen vor Augen hat. Die drei anderen Aufrufer geben `t.name`.
 *
 * Die Regel als Ratsche
 * ---------------------
 *   Ein Bestaetigungsname ist nie ein Literal. Ein String-Literal an
 *   dieser Stelle ist immer ein Platzhalter, den jemand stehen gelassen
 *   hat — deshalb prueft der Test die Aufrufform, nicht den einen Wert
 *   'AUTO'.
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

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit);
    } else if (v && typeof v.type === 'string') {
      walk(v, visit);
    }
  }
}

function aufrufe(name) {
  const treffer = [];
  walk(ast, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === name) {
      treffer.push(n);
    }
  });
  return treffer;
}

describe('rescheduleTournament: der Bestaetigungsname ist nie ein Literal', () => {
  const stellen = aufrufe('rescheduleTournament');

  it('es gibt ueberhaupt Aufrufer (sonst prueft der Test nichts)', () => {
    // Gemessen 2026-08-25: zwei lebende Aufrufer — saveScheduleEdits
    // (Spieldauer im Spielplan-Edit geaendert) und rescheduleAuto. Die
    // beiden anderen hingen an [data-action="reschedule"], einem
    // Selektor, den kein Renderer ausgibt; sie sind in derselben Runde
    // geloescht worden.
    //
    // Nachmessung 2026-08-26: einer. Der Spielplan-Edit-Modus ist
    // entfallen (er gab seit dem Zeitachsen-Umbau keine Eingabefelder
    // mehr aus), damit auch saveScheduleEdits. Uebrig bleibt
    // rescheduleAuto aus dem Einstellungen-Tab.
    expect(stellen.length).toBeGreaterThanOrEqual(1);
  });

  it('kein Aufruf uebergibt einen festen String als Turniernamen', () => {
    const literale = stellen
      .filter(
        (n) =>
          n.arguments[1] &&
          n.arguments[1].type === 'Literal' &&
          typeof n.arguments[1].value === 'string'
      )
      .map(
        (n) =>
          `main.js:${n.loc.start.line}  rescheduleTournament(…, ${JSON.stringify(n.arguments[1].value)})`
      );
    if (literale.length) {
      throw new Error(
        'FALSCHES BESTAETIGUNGSWORT: ' +
          literale.length +
          ' Aufruf(e) geben einen ' +
          'festen String als Turniernamen:\n' +
          literale.map((l) => '  - ' + l).join('\n') +
          '\n\nDer Wert landet als `expectedName` im Bestaetigungsdialog. Sind Spiele ' +
          'beendet, muss der Nutzer genau diesen String tippen — statt des ' +
          'Turniernamens, den der Dialog ihm ansagt.'
      );
    }
    expect(literale).toEqual([]);
  });

  it('jeder Aufruf uebergibt ueberhaupt einen zweiten Parameter', () => {
    const ohne = stellen
      .filter((n) => n.arguments.length < 2)
      .map((n) => `main.js:${n.loc.start.line}`);
    expect(ohne).toEqual([]);
  });
});

describe('rescheduleAuto reicht den echten Turniernamen durch', () => {
  it('nimmt den Namen als dritten Parameter entgegen', () => {
    let fn = null;
    walk(ast, (n) => {
      if (n.type === 'FunctionDeclaration' && n.id?.name === 'rescheduleAuto') fn = n;
    });
    expect(fn, 'rescheduleAuto nicht gefunden').not.toBeNull();
    expect(fn.params.map((p) => p.name)).toEqual(['tournamentId', 'mount', 'tournamentName']);
  });

  it('die Verdrahtung im Einstellungen-Tab gibt t.name mit', () => {
    expect(src).toContain('await rescheduleAuto(t.id, mount, t.name);');
  });

  it('faellt auf das aktive Turnier zurueck, falls der Name fehlt', () => {
    // Ohne Rueckfall stuende bei einem fehlenden Namen `undefined` im
    // Dialog — dann waere gar keine Eingabe mehr moeglich.
    expect(src).toContain("const name = tournamentName || activeTournamentInstance?.name || '';");
  });
});

/**
 * Die Pause fliesst mit in den Config-Patch — und mit ihr `slotMinutes`.
 *
 * Fehlerklasse, die der zweite Test abfaengt (2026-08-26):
 *   Die Engine nimmt den GROESSTEN der drei Werte —
 *   `matchDurationMinutes + pauseAfterMatches` gegen den gespeicherten
 *   `slotMinutes` (engine/schedule.js:122). Der Wizard legt slotMinutes
 *   als Dauer + Pause an. Schriebe der Einstellungen-Tab nur Dauer und
 *   Pause, waere jede VERKUERZUNG hier wirkungslos: wer die Pause von 5
 *   auf 0 stellt, bekaeme weiter den alten 35-Minuten-Takt — und zwar
 *   ohne Fehlermeldung, der Zeitplan saehe nur unveraendert aus.
 */
describe('rescheduleAuto schreibt die Pause mit', () => {
  it('liest den Pause-Stepper aus dem Einstellungen-Tab', () => {
    expect(src).toContain("mount?.querySelector?.('[data-reschedule-pause]')");
  });

  it('sendet pauseAfterMatches UND das daraus berechnete slotMinutes', () => {
    expect(src).toContain('pauseAfterMatches: pause,');
    expect(src).toContain('slotMinutes: duration + pause,');
  });

  it('prueft den Wertebereich der Pause vor dem Senden', () => {
    expect(src).toContain('pause < 0 || pause > 60');
  });
});
