/**
 * Tests für die defensive Schritt-Coercion im Wizard.
 *
 * Hintergrund: ensureDraftPromise() in Step 1 prüft `state.step === 1`.
 * Wenn der Aufrufer (main.js-Wrapper oder ein zukünftiger Test)
 * einen ungültigen step setzt (0, 7, undefined, NaN, "1" als String),
 * würde kein Entwurf angelegt → "no_tournament_id" in Schritt 5.
 *
 * renderWizardView (und damit der ganze Wizard) muss daher jeden
 * ungültigen Wert auf 1 zurückfallen lassen, ohne den Aufrufer zu
 * korrigieren. coerceWizardStep() ist die pure-Function-Variante,
 * damit sie ohne DOM in Vitest getestet werden kann.
 *
 * Spec §13.5: "Keine stillen Annahmen" — auch über die UI-Eingabe
 * hinaus. Wir vertrauen nicht darauf, dass main.js den step korrekt
 * setzt.
 */

import { describe, it, expect } from 'vitest';
import { coerceWizardStep } from '../tournament.js';

describe('coerceWizardStep — ungültige Eingaben → Default 1', () => {
  it('step=0 → 1', () => {
    expect(coerceWizardStep(0)).toBe(1);
  });
  it('step=7 → 1 (über dem Maximum)', () => {
    expect(coerceWizardStep(7)).toBe(1);
  });
  it('step=-1 → 1', () => {
    expect(coerceWizardStep(-1)).toBe(1);
  });
  it('step=3.5 (kein Integer) → 1', () => {
    expect(coerceWizardStep(3.5)).toBe(1);
  });
  it('step=undefined → 1', () => {
    expect(coerceWizardStep(undefined)).toBe(1);
  });
  it('step=null → 1', () => {
    expect(coerceWizardStep(null)).toBe(1);
  });
  it('step=NaN → 1', () => {
    expect(coerceWizardStep(NaN)).toBe(1);
  });
  it('step="1" (String) wird zu Number(1) und akzeptiert', () => {
    // Number("1") === 1, also gültig. Das ist Absicht: JSON / Form
    // kommen oft als String, und 1 ist offensichtlich die richtige Wahl.
    expect(coerceWizardStep('1')).toBe(1);
  });
  it('step="foo" → 1', () => {
    expect(coerceWizardStep('foo')).toBe(1);
  });
  it('step=true → 1 (Number(true)=1)', () => {
    // Edge-Case: würde Number(true)=1 liefern, also wird akzeptiert.
    expect(coerceWizardStep(true)).toBe(1);
  });
});

describe('coerceWizardStep — gültige Eingaben bleiben', () => {
  it.each([1, 2, 3, 4, 5])('step=%i wird durchgereicht', (s) => {
    expect(coerceWizardStep(s)).toBe(s);
  });
});

describe('coerceWizardStep — Verhalten in renderWizardView', () => {
  it('gibt DEFAULT zurück für alles unter 1', () => {
    // Konkreter Regressionsschutz: der Wert 0 war der Bug, der
    // "no_tournament_id" erzeugt hat. Wenn der Default sich jemals
    // ändert, soll der Test brechen, damit wir den Fall bewusst
    // anpassen.
    expect(coerceWizardStep(0)).toBe(1);
  });
});
