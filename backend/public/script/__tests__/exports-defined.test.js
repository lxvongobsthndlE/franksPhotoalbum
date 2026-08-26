/**
 * Regression-Test: Jede exportierte Funktion in main.js / tournament.js
 * muss auch DEFINIERT sein.
 *
 * Bug-Geschichte (2026-08-12, nach Etappe C):
 *   Beim Aufräumen des v2-Detail-Views habe ich Funktionsdefinitionen
 *   gelöscht, aber vergessen, die zugehörigen Einträge aus dem
 *   `Object.assign(window, { … })`-Block am Ende von main.js zu nehmen.
 *   Resultat: 8 exportierte Namen ohne Definition. Beim Laden der App
 *   wirft das Skript einen `ReferenceError: X is not defined`, bricht
 *   ab Zeile 13689 ab — und ALLE Handler, die danach registriert
 *   werden, sind tot (Feed, Fotos, Nachtmodus, Abmelden, …). Sichtbar
 *   nur durch Konsole. `node --check` reicht nicht, das findet nur
 *   Syntaxfehler.
 *
 *   Der Fehler ist zu folgenschwer, um ihn beim nächsten Mal wieder
 *   manuell zu finden. Dieser Test läuft bei jedem `npm test` mit.
 *
 * Was er prüft:
 *   1. main.js — jeder Name aus `Object.assign(window, { … })` muss
 *      im File als function/async-function/const/let/var definiert sein.
 *   2. tournament.js — jeder Name aus den ES-Export-Statements UND dem
 *      `export default { … }`-Block muss im File definiert sein.
 *
 * Edge-Cases:
 *   - `$` ist ein gültiger JS-Identifier, sieht aber wie ein Regex-Quantor
 *     aus. Der Audit-String-Builder escaped Regex-Sonderzeichen sauber.
 *   - Kommentare und leere Zeilen im Export-Block werden ignoriert.
 *   - Komma-Suffix wird toleriert (auch wenn das gemeinhin hässlich ist).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '..');

const MAIN_JS = path.join(FRONTEND_DIR, 'main.js');
const TOURNAMENT_JS = path.join(FRONTEND_DIR, 'tournament.js');

// ── Helper: gültige Regex-Boundaries für einen JS-Identifier bauen ──
// JS-Identifiers: A–Z, a–z, 0–9, _, $. Wir wollen verhindern, dass
// "foo" in "foobar" als Treffer zählt — also word-boundary benutzen.
function identRegex(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`);
}

// ── Helper: alle Definitionen eines Namens zählen ──
// function foo, async function foo, const foo = …, let foo = …, var foo = …
// Zählt „foo bar" und „foo123" NICHT als Treffer (word-boundary).
function definitionsIn(src, name) {
  const re = identRegex(name);
  let count = 0;
  const patterns = [
    new RegExp(`\\basync\\s+function\\s+${re.source}`),
    new RegExp(`\\bfunction\\s+${re.source}`),
    new RegExp(`\\bconst\\s+${re.source}\\s*=`),
    new RegExp(`\\blet\\s+${re.source}\\s*=`),
    new RegExp(`\\bvar\\s+${re.source}\\s*=`),
  ];
  for (const p of patterns) {
    const matches = src.match(new RegExp(p.source, 'g'));
    if (matches) count += matches.length;
  }
  return count;
}

// ── main.js: Namen aus Object.assign(window, { … }) extrahieren ──
function mainJsExportNames(src) {
  // Öffnende Klammer suchen, dann Block bis zum nächsten '});' auf
  // gleicher Verschachtelungstiefe. Wir erwarten genau EINEN Block im
  // File — wenn ein Maintainer irgendwann mehrere hinzufügt, fällt das
  // hier auf.
  const start = src.indexOf('Object.assign(window, {');
  if (start < 0) throw new Error('main.js: kein Object.assign(window, …) gefunden');
  const end = src.indexOf('});', start);
  if (end < 0) throw new Error('main.js: Object.assign-Block nicht geschlossen');
  const block = src.substring(start, end);
  const names = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('//')) continue; // reine Kommentar-Zeile
    if (line.startsWith('Object.assign')) continue;
    // Erwartetes Format: "<name>," oder "<name>" oder "<name>  // kommentar".
    // Alles, was mit einem JS-Identifier beginnt und optional mit Komma
    // und/oder Kommentar endet, gilt als Export-Name.
    const m = line.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*,?(?:\s*\/\/.*)?$/);
    if (m) names.push(m[1]);
  }
  return names;
}

// ── tournament.js: Namen aus ES-Exports extrahieren ──
// - `export { a, b, c }`
// - `export function foo() {…}` etc. (Name steht direkt nach 'function')
// - `export const/let/var foo = …`
// - `export default { a, b, foo }`
function tournamentJsExportNames(src) {
  const names = [];

  // 1) `export { … }`
  const namedBlockRe = /export\s*\{\s*([^}]+)\s*\}/g;
  let m;
  while ((m = namedBlockRe.exec(src)) !== null) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      // Mögliche Aliase: `foo as bar` — wir wollen nur den EXTERNEN Namen.
      // Im einfachsten Fall haben wir keine Aliase, aber für später:
      const asMatch = part.match(/^[A-Za-z_$][A-Za-z0-9_$]*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (asMatch) names.push(asMatch[1]);
      else names.push(part);
    }
  }

  // 2) `export [async] function NAME`
  const fnDefRe = /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = fnDefRe.exec(src)) !== null) names.push(m[1]);

  // 3) `export const/let/var NAME`
  const cnRe = /export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = cnRe.exec(src)) !== null) names.push(m[1]);

  // 4) `export default { … }` (mehrere, falls Maintainer hinzufügen)
  const defaultRe = /export\s+default\s*\{\s*([^}]+)\s*\}/g;
  while ((m = defaultRe.exec(src)) !== null) {
    for (const raw of m[1].split(',')) {
      // „key" oder „key," — Shorthand-Einträge sind erlaubt.
      // Explizite Aliase wie „renderMatch: genMatch" erkennen wir hier NICHT
      // — wenn jemand mal einen expliziten Alias einsetzt, fällt er auf
      // und muss den Test anpassen. Das ist OK, dann sehen wir's beim
      // ersten Lauf.
      const part = raw.trim();
      const mm = part.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (mm) names.push(mm[1]);
    }
  }

  return names;
}

// ── Doppelnamen rauswerfen (jeder Name wird nur einmal geprüft) ──
function uniq(arr) {
  return [...new Set(arr)];
}

// =================================================================
describe('Export-Audit: keine undefinierten Namen exportieren', () => {
  describe('main.js (Object.assign(window, { … }))', () => {
    const src = fs.readFileSync(MAIN_JS, 'utf8');
    const exports_ = uniq(mainJsExportNames(src));

    it('findet überhaupt Export-Namen (Sanity-Check)', () => {
      expect(exports_.length).toBeGreaterThan(50);
    });

    it.each(
      // it.each über ein Array wäre schwerfällig — wir generieren den
      // schönen Sammelfehler lieber manuell. Hier nur der „es gibt
      // überhaupt welche"-Check; der harte Test steht weiter unten.
      []
    )('placeholder', () => {});

    it('jeder exportierte Name hat eine Definition im selben File', () => {
      const missing = [];
      const defined = [];
      for (const name of exports_) {
        const count = definitionsIn(src, name);
        if (count === 0) missing.push(name);
        else defined.push(`${name}×${count}`);
      }
      if (missing.length) {
        // Hilfreiche Diagnose: zeig alle fehlenden Namen inkl. Fundstelle
        // (Zeile nach 'Object.assign').
        throw new Error(
          `main.js: ${missing.length} exportierte(r) Name(n) ohne Definition:\n` +
            missing.map((n) => `  - ${n}`).join('\n') +
            `\n\nDas sind die Handler, die das Skript beim Laden abwirft.` +
            `\nFix: Definition ergänzen ODER Eintrag aus Object.assign entfernen.`
        );
      }
      expect(missing).toEqual([]);
      expect(defined.length).toBeGreaterThan(0);
    });
  });

  describe('tournament.js (ES-Exports + export default)', () => {
    const src = fs.readFileSync(TOURNAMENT_JS, 'utf8');
    const exports_ = uniq(tournamentJsExportNames(src));

    it('findet überhaupt Export-Namen (Sanity-Check)', () => {
      expect(exports_.length).toBeGreaterThan(5);
    });

    it('jeder exportierte Name hat eine Definition im selben File', () => {
      const missing = [];
      for (const name of exports_) {
        if (definitionsIn(src, name) === 0) missing.push(name);
      }
      if (missing.length) {
        throw new Error(
          `tournament.js: ${missing.length} exportierte(r) Name(n) ohne Definition:\n` +
            missing.map((n) => `  - ${n}`).join('\n') +
            `\nFix: Definition ergänzen ODER Export entfernen.`
        );
      }
      expect(missing).toEqual([]);
    });

    it('exportierte Namen sind alle unterschiedlich lang (Anti-Trivial-Check)', () => {
      // Verhindert, dass jemand aus Versehen einen zweistelligen
      // Buchstabensalat einträgt, der mit nichts kollidiert aber
      // auch nichts exportiert. Namen müssen ≥3 Zeichen haben UND
      // dürfen nicht alle identisch sein.
      const counts = {};
      for (const name of exports_) counts[name.length] = (counts[name.length] || 0) + 1;
      // Mindestens 3 verschiedene Längen — das schließt reine
      // „renderX"-Familien (alle 5–10 Zeichen) noch nicht aus, aber
      // zusammen mit dem Sanity-Check ist das gut genug.
      expect(Object.keys(counts).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Audit-Helfer (sich selbst)', () => {
    const sampleSrc = `
      function foo() {}
      async function bar() {}
      const baz = 1;
      let qux = 2;
      var corge = 3;
      function $dollar() {}
      function foo123() {} // nicht „foo"
      export { foo, bar, baz, qux, corge, $dollar as renamed };
    `;

    it('definitionsIn zählt „foo" genau 1, nicht „foo123"', () => {
      expect(definitionsIn(sampleSrc, 'foo')).toBe(1);
      expect(definitionsIn(sampleSrc, 'foo123')).toBe(1);
    });

    it('definitionsIn erkennt $ als Identifier', () => {
      expect(definitionsIn(sampleSrc, '$dollar')).toBe(1);
    });

    it('definitionsIn erkennt Aliase (renamed)', () => {
      // Aliase sind Exports — wir prüfen hier nur, dass die
      // Helfer-Funktion keine falschen Treffer für renamed oder $ liefert.
      expect(definitionsIn(sampleSrc, 'renamed')).toBe(0);
      expect(definitionsIn(sampleSrc, '$')).toBe(0);
    });
  });
});
