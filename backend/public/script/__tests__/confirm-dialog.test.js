/**
 * Regressionstest für `openConfirmDialog` (Etappe B.7, Anmerkung 1).
 *
 * Hintergrund: Die Funktion wird an 5 Stellen aufgerufen:
 *   - tournament.js:2767, 2788, 3071 (Wizard, kein expectedName → simple Confirm)
 *   - tournament.js:3956 (Wizard-Regenerate, expectedName = Turniername)
 *   - main.js:3637 (Reschedule, expectedName = Turniername)
 *
 * Mit Etappe B.7 erweitern wir `openConfirmDialog` um ein optionales
 * `confirmText`-Feld, das den Hint-Text unter dem Input überschreibt.
 * Das Feld MUSS optional sein — sonst brechen die drei Wizard-Aufrufer.
 *
 * Statt DOM-Mocking testen wir die reine Descriptor-Logik
 * `resolveConfirmDescriptor` (in spielplan-helpers.js). Sie liefert
 * `{ needsInput, expected, hint, okInitiallyDisabled }` und kapselt
 * genau die Backward-Compat-Logik, die im Plan gefordert ist.
 *
 * Was hier geprüft wird:
 *   1. Aufruf OHNE confirmText & OHNE expectedName → OK aktiv, kein Input.
 *   2. Aufruf MIT expectedName (klassisch) → Input rendert mit
 *      "Erwartet: <name>"-Hint, OK disabled.
 *   3. Aufruf MIT confirmText (NEU) → Input rendert mit confirmText als
 *      Hint (überschreibt expectedName-Hint).
 *   4. confirmText OHNE expectedName → wie Fall 1 (kein Use-Case, ignoriert).
 *   5. confirmText mit leerem String fällt auf Default-Hint zurück.
 *   6. expectedName mit leerem String fällt auf "kein Input" zurück.
 */

import { describe, it, expect } from 'vitest';
import { resolveConfirmDescriptor } from '../spielplan-helpers.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('resolveConfirmDescriptor — Backward-Compat für 5 bestehende Aufrufer', () => {
  it('Fall 1a: kein expectedName, kein confirmText → kein Input, OK aktiv', () => {
    const d = resolveConfirmDescriptor({});
    expect(d.needsInput).toBe(false);
    expect(d.expected).toBeNull();
    expect(d.hint).toBeNull();
    expect(d.okInitiallyDisabled).toBe(false);
  });

  it('Fall 1b: undefined-Args (Wizard bulk-remove) → kein Input, OK aktiv', () => {
    // tournament.js:2767 ruft openConfirmDialog({ title, message, confirmLabel, danger }).
    // expectedName ist undefined. Reproduziert hier.
    const d = resolveConfirmDescriptor({ title: 'x', message: 'y' });
    expect(d.needsInput).toBe(false);
    expect(d.okInitiallyDisabled).toBe(false);
  });

  it('Fall 2: nur expectedName (Wizard-Regenerate, Reschedule) → Input mit "Erwartet: …"', () => {
    const d = resolveConfirmDescriptor({ expectedName: 'Mein Turnier' });
    expect(d.needsInput).toBe(true);
    expect(d.expected).toBe('Mein Turnier');
    expect(d.hint).toBe('Erwartet: „Mein Turnier"');
    expect(d.okInitiallyDisabled).toBe(true);
  });

  it('Fall 3: expectedName + confirmText (NEU) → confirmText überschreibt Hint', () => {
    const d = resolveConfirmDescriptor({
      expectedName: 'Mein Turnier',
      confirmText: 'Tippe „reset" zum Zurücksetzen',
    });
    expect(d.needsInput).toBe(true);
    expect(d.expected).toBe('Mein Turnier');
    expect(d.hint).toBe('Tippe „reset" zum Zurücksetzen');
    expect(d.okInitiallyDisabled).toBe(true);
  });

  it('Fall 4: confirmText OHNE expectedName → wie Fall 1 (kein Use-Case)', () => {
    const d = resolveConfirmDescriptor({ confirmText: 'irrelevant' });
    expect(d.needsInput).toBe(false);
    expect(d.hint).toBeNull();
    expect(d.okInitiallyDisabled).toBe(false);
  });

  it('Fall 5: expectedName + leerer confirmText → fällt auf Default-Hint zurück', () => {
    const d = resolveConfirmDescriptor({ expectedName: 'X', confirmText: '' });
    expect(d.needsInput).toBe(true);
    expect(d.hint).toBe('Erwartet: „X"');
  });

  it('Fall 6: leerer expectedName (z.B. Tournament-Name noch nicht gesetzt) → kein Input', () => {
    const d = resolveConfirmDescriptor({ expectedName: '' });
    expect(d.needsInput).toBe(false);
    expect(d.okInitiallyDisabled).toBe(false);
  });

  it('Aufruf ohne Args (defensiv) → kein Input', () => {
    const d = resolveConfirmDescriptor();
    expect(d.needsInput).toBe(false);
  });

  it('non-string expectedName (z.B. number) → kein Input', () => {
    const d = resolveConfirmDescriptor({ expectedName: 42 });
    expect(d.needsInput).toBe(false);
  });

  it('special-chars im expectedName werden verbatim im Hint übernommen', () => {
    const d = resolveConfirmDescriptor({ expectedName: 'Tischtennis-Turnier 2026 & mehr' });
    expect(d.hint).toBe('Erwartet: „Tischtennis-Turnier 2026 & mehr"');
  });
});

/**
 * A5 (2026-08-25) — der Dialog selbst, nicht nur sein Descriptor.
 *
 * Dies ist der zerstörerischste Dialog der App: hier tippt man den
 * Turniernamen ein, um ein Turnier samt aller Ergebnisse zu löschen.
 * Er hing an `document.body` und damit ausserhalb von `.t-mod`, wo
 * alle Tokens definiert sind. Sichtbare Folgen (alle drei am
 * 25.08. gemeldet und im Screenshot generate-flow/gen-2-dialog.png
 * belegt):
 *
 *   border-radius: var(--r3)   → --r3 gibt es im Modul nicht → eckig
 *   gap: var(--s3)             → ungültig → gap:0, alles klebt
 *   border: 1px solid var(--line) am Eingabefeld → ungültig → randlos
 *
 * Ohne Rahmen war ausgerechnet das Feld unsichtbar, in das man tippen
 * MUSS, um zu bestätigen. Deshalb steht der Test hier und nicht in
 * einer Sammeldatei.
 *
 * Geprüft wird per Quell-Scan (kein jsdom im Projekt, siehe
 * backend/vitest.config.js). Die Tastatur- und Fokus-Funktionen selbst
 * sind in dialog-host.test.js echt unit-getestet.
 */
describe('openConfirmDialog — Token-Vererbung, Escape, Fokus-Rückkehr (A5)', () => {
  const tournamentJs = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tournament.js'),
    'utf8',
  );
  const tournamentCss = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'style', 'tournament.css'),
    'utf8',
  );

  it('Der Backdrop trägt die Host-Klassen — sonst erbt er keinen Token', () => {
    expect(tournamentJs).toMatch(
      /backdrop\.className = `t-confirm-backdrop \$\{DIALOG_TOKEN_CLASSES\}`/,
    );
    expect(tournamentJs).not.toMatch(/backdrop\.className = 't-confirm-backdrop';/);
  });

  it('Der Auslöser wird gemerkt, bevor der Dialog den Fokus nimmt', () => {
    const capture = tournamentJs.indexOf('const trigger = captureDialogTrigger(document)');
    const create = tournamentJs.indexOf("const backdrop = document.createElement('div')");
    expect(capture).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(capture);
  });

  it('close() gibt den Fokus zurück und räumt den keydown-Horcher ab', () => {
    expect(tournamentJs).toMatch(/restoreDialogTrigger\(trigger\)/);
    expect(tournamentJs).toMatch(/document\.removeEventListener\('keydown', onKey\)/);
  });

  it('close() ist gegen doppelten Aufruf gesichert (Escape + Klick)', () => {
    expect(tournamentJs).toMatch(/if \(confirmClosed\) return;/);
  });

  it('Escape wird über dieselbe Funktion geprüft wie in den anderen Dialogen', () => {
    expect(tournamentJs).toMatch(/isDialogCloseKey\(e\)\) cancelBtn\.click\(\)/);
    // Keine handgeschriebene Zweitprüfung mehr.
    expect(tournamentJs).not.toMatch(/e\.key === 'Escape'/);
  });

  it('Der Radius kommt aus dem Modul, obwohl --r3 dort nicht existiert', () => {
    expect(tournamentCss).toMatch(
      /\.t-dialog-host \.t-confirm-dialog \{ border-radius: var\(--r-card\); \}/,
    );
  });

  it('Der Löschen-Knopf behält sein Rot gegen den .t-mod-button-Reset', () => {
    expect(tournamentCss).toMatch(/^\.t-dialog-host \.t-btn--danger \{/m);
  });
});
