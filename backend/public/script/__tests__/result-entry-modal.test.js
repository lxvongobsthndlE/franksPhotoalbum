/**
 * Bug 2026-08-17 — Vereinfachtes Ergebnis-Modal: keine Vorschau-Box,
 * Teamnamen direkt neben Score-Inputs, keine Emoji im Titel oder
 * Speichern-Button. Diese Datei sichert die strukturellen
 * Entscheidungen ab, falls jemand wieder die alte Drei-Mal-Anzeige
 * einbaut oder die Emoji zurückbringt.
 *
 * Strategie: Wir laden die modal-relevanten Strings (HTML-Template +
 * CSS-Klassen) aus main.js + main.css und prüfen Präsenz/Abwesenheit
 * bestimmter Tokens. Wenn der Test fehlschlägt, ist die Vereinfachung
 * rückgängig gemacht.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// main.js liegt unter public/script/, main.css unter public/style/.
const mainJsPath = resolve(__dirname, '..', 'main.js');
const mainCssPath = resolve(__dirname, '..', '..', 'style', 'main.css');
const mainJs = readFileSync(mainJsPath, 'utf8');
const mainCss = readFileSync(mainCssPath, 'utf8');

// Wir schneiden den openResultEntryModal-Body heraus, damit wir nur
// das Modal-Template prüfen, nicht den ganzen main.js. Das verhindert
// false positives aus anderen Dialogen.
function sliceModal() {
  const start = mainJs.indexOf('async function openResultEntryModal(');
  if (start < 0) throw new Error('openResultEntryModal nicht gefunden');
  // Bis zum nächsten "async function" oder Dateiende.
  const nextFn = mainJs.indexOf('\nasync function ', start + 1);
  return nextFn > 0 ? mainJs.slice(start, nextFn) : mainJs.slice(start);
}
const modal = sliceModal();

describe('Ergebnis-Modal: Bug 2026-08-17 (Vereinfachung)', () => {
  it('Titel OHNE Emoji (kein ⚽)', () => {
    // VORHER: <h3>⚽ Ergebnis eintragen</h3>
    // NACHHER: <h3>Ergebnis eintragen</h3>
    expect(modal).toMatch(/<h3>Ergebnis eintragen<\/h3>/);
    expect(modal).not.toContain('⚽');
  });

  it('Speichern-Button OHNE Emoji (kein 💾)', () => {
    // VORHER: 💾 Ergebnis speichern
    // NACHHER: Speichern
    expect(modal).toMatch(/<button[^>]*type="submit"[^>]*>Speichern<\/button>/);
    expect(modal).not.toContain('💾');
    expect(modal).not.toMatch(/Ergebnis speichern/);
  });

  it('Selection-Dropdown nur wenn kein presetMatchId', () => {
    // Wir prüfen die Template-Bedingung: bei initialMatch → hidden input,
    // sonst → select. Die Bedingung steht als Ternary im Code.
    expect(modal).toMatch(/initialMatch[\s\S]{0,200}input type="hidden"[\s\S]{0,200}re-match-id/);
    expect(modal).toMatch(/openSorted[\s\S]{0,400}<select id="re-match-id"/);
  });

  it('Keine alte re-info-Vorschau-Box mehr', () => {
    // VORHER: <div id="re-info" class="re-info" ...>
    // NACHHER: <div id="re-subline" ...>
    expect(modal).not.toMatch(/id="re-info"/);
    expect(modal).not.toMatch(/class="re-info"/);
    expect(modal).toMatch(/id="re-subline"/);
  });

  it('Teamnamen direkt neben Score-Inputs (.re-team + .re-score-row)', () => {
    expect(modal).toMatch(/class="re-team"/);
    expect(modal).toMatch(/class="re-score-input"/);
    expect(modal).toMatch(/class="re-score-row"/);
  });

  it('CSS-Datei: alte .re-info-Regeln entfernt, neue .re-subline/.re-score-row da', () => {
    expect(mainCss).not.toMatch(/^\.re-info\s*\{/m);
    expect(mainCss).not.toMatch(/^\.re-info-row\s*\{/m);
    expect(mainCss).not.toMatch(/^\.re-info-meta\s*\{/m);
    expect(mainCss).not.toMatch(/^\.re-info-team\s*\{/m);
    expect(mainCss).toMatch(/^\.re-subline\s*\{/m);
    expect(mainCss).toMatch(/^\.re-score-row\s*\{/m);
    expect(mainCss).toMatch(/^\.re-team\s*\{/m);
    expect(mainCss).toMatch(/^\.re-score-input\s*\{/m);
  });
});
