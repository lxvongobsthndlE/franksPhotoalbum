/**
 * Regression-Test (Issue 5, 2026-08-14):
 *   Das Wort "Wizard" darf in keinem USER-VISIBLEN String mehr auftauchen.
 *
 * Hintergrund: Spec §8.0 verbietet Tech-Sprech im UI. "Wizard" ist ein
 * Entwickler-Begriff aus der Spec-Sprache, der durch "Turnier erstellen"
 * (für die Aktion) bzw. "Turnier-Erstellung" (für den Vorgang) ersetzt
 * wird. Die ersten Stellen, an denen das durchschlug:
 *   - "Der Turnier-Wizard kommt im nächsten Schritt."  → "Du kannst gleich ein Turnier erstellen."
 *   - aria-label "Wizard-Schritte" → "Turnier erstellen — Schritte"
 *   - Progress-Titel "Neues Turnier" → "Turnier erstellen"
 *   - Toast "Wizard ist bereits offen" → "Turnier-Erstellung ist bereits offen"
 *   - Galerie-Titel "Neues Turnier" → "Turnier erstellen"
 *
 * Wir scannen beide Dateien nach Treffern in:
 *   - String-Literalen (einfach + doppelt quotiert)
 *   - Template-Literalen (nur die statischen Teile)
 *   - textContent-/innerHTML-/title.textContent-Zuweisungen
 *
 * NICHT gescannt werden:
 *   - CSS-Klassen-Namen (`.t-wizard-*`) — interne Hooks für Selektoren.
 *   - console.warn('[wizard] …') — interne Log-Tags, hilfreich zum Greppen.
 *   - data-screen/data-t-wizard-*-Attribute — interne Hooks.
 *   - Kommentare und Code-Identifer (z. B. `renderWizardView`).
 *
 * Bei einem Treffer bricht der Test mit Datei + Zeile + Snippet ab,
 * damit das Problem sofort sichtbar ist.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, '..');

const FILES = [
  path.join(FRONTEND_DIR, 'tournament.js'),
  path.join(FRONTEND_DIR, 'main.js'),
];

// Wir suchen ZEICHEN-SEQUENZEN die darauf hindeuten, dass "Wizard"
// als USER-SICHTBARER Text (String-Literal oder Template-Literal) oder
// als ARIA-LABEL / TITLE gesetzt wurde.
//
// Beispiele, die wir FANGEN wollen:
//   '... Wizard ...'     "Wizard ..."   `... Wizard ...`
//   textContent = '... Wizard ...'
//   setAttribute('aria-label', 'Wizard ...')
//   title.textContent = '... Wizard ...'
//
// Beispiele, die wir IGNORIEREN wollen:
//   't-wizard-foo'           (CSS-Klasse)
//   '[wizard] Entwurf …'     (Log-Tag)
//   data-t-wizard-…          (Hook)
//   console.warn('[wizard]…' (Log)
//   renderWizardView(…)      (Funktion)
//   // … Wizard-Kommentar    (Kommentar)
//   .t-mod.t-wizard          (Selector)
//   WIZARD_HOST_CLASS        (Konstante)

const REGEX = /(\bWizard\b|\bWIZARD\b|\bwizard\b)/g;

function isClassOrHook(line, match) {
  // Klassenname in einem String-Literal oder DOM-API-Aufruf
  if (/class(Name)?\s*=\s*['"`]/.test(line)) return true;
  if (/['"`][^'"`]*\bt-wizard\b[^'"`]*['"`]/.test(line)) return true;
  if (/\.t-wizard\b/.test(line)) return true;
  // data-t-wizard-… Attribute
  if (/data-t-wizard/.test(line)) return true;
  // CSS-Selectoren mit `.t-mod.t-wizard` oder `.t-wizard-…`
  if (/querySelector\(.*\.t-wizard/.test(line)) return true;
  if (/getRoot\(\)|\.t-mod\.t-wizard/.test(line)) return true;
  // Log-Tags
  if (/console\.(warn|log|error|info)\(['"`]\[wizard\]/.test(line)) return true;
  // Code-Identifer (renderWizardView, ensureDraftPromise, etc.)
  if (/renderWizardView|renderWizardProgress|renderWizardStep|renderWizardFooter|renderWizardPreview|renderWizardForm|renderWizardStep1Grunddaten|renderWizardStep2Teams|renderWizardStep3Modus|renderWizardStep4Qualifikation|renderWizardStep5Zusammenfassung|teardownWizard|wizardMounted|WIZARD_HOST_CLASS|tournament-wizard-modal/.test(line)) {
    // Aber: dieser Match darf NICHT in einem String-Literal stehen,
    // das User sichtbar wäre. Wir verfeinern unten.
    return false;
  }
  // Kommentare
  if (/^\s*\*/.test(line) || /^\s*\/\//.test(line)) return true;
  // String mit "Wizard" als Datenbank-/API-Feld → gibt's aktuell nicht
  // (Spec nutzt "wizard" nirgends als DB-Token), also gehen wir davon
  // aus: jeder Treffer in einem String-Literal ist user-visible.
  return false;
}

function isInUserVisibleString(line) {
  // Wir suchen Wizard in einem String-Literal oder Template-Literal.
  // Akzeptiert: 'Wizard', "Wizard", `Wizard`, sowie Varianten mit "Turnier-Wizard".
  // Heuristik: erstes Vorkommen in einer Zeile liegt in einem String,
  // wenn die Zeile Anführungszeichen enthält VOR dem ersten Wizard-Match.
  const wizIdx = line.search(/\bWizard\b/);
  if (wizIdx < 0) return false;
  const before = line.slice(0, wizIdx);
  // Zähle öffnende und schließende Quotes (einfach + doppelt + backtick)
  // vor dem Wizard. Wenn die Anzahl ungerade ist, sind wir IN einem String.
  let inSingle = false, inDouble = false, inBacktick = false;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (c === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (c === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (c === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;
  }
  return inSingle || inDouble || inBacktick;
}

describe('Issue 5 — "Wizard" darf nicht in user-sichtbarem Text auftauchen', () => {
  for (const filePath of FILES) {
    const fileName = path.basename(filePath);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const violations = [];

    lines.forEach((line, i) => {
      // Reset des RegEx pro Zeile (lastIndex würde sonst hängenbleiben)
      REGEX.lastIndex = 0;
      if (!REGEX.test(line)) return;
      // Erst prüfen, ob der Treffer überhaupt in einem String ist.
      if (!isInUserVisibleString(line)) return;
      // Jetzt prüfen, ob es sich um eine harmlose Klasse / Hook / Log
      // handelt. Wenn ja, ist es KEIN user-sichtbarer Treffer.
      if (isClassOrHook(line, 'Wizard')) return;

      violations.push({ line: i + 1, text: line.trim() });
    });

    it(`${fileName}: keine user-sichtbaren "Wizard"-Strings`, () => {
      if (violations.length > 0) {
        const sample = violations
          .slice(0, 10)
          .map((v) => `  Zeile ${v.line}: ${v.text}`)
          .join('\n');
        throw new Error(
          `${fileName}: ${violations.length} Stelle(n), an denen "Wizard" ` +
          `als user-sichtbarer Text vorkommt:\n${sample}\n\n` +
          `Fix: "Wizard" → "Turnier-Erstellung" (Vorgang) oder ` +
          `"Turnier erstellen" (Aktion) ersetzen.`,
        );
      }
      expect(violations).toEqual([]);
    });
  }
});
