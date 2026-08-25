/**
 * Dialog-Host — eine Wahrheit für die drei Dialoge, die an
 * `document.body` hängen statt im Turniermodul (`.t-mod`).
 *
 * ── Warum es dieses Modul gibt ────────────────────────────────────
 *
 * `tournament.css` definiert ALLE Design-Tokens des Turniermoduls auf
 * `.t-mod` (`--ink`, `--line`, `--s3`, `--r-card`, `--r-btn` …), nicht
 * auf `:root`. Ein Dialog, der an `document.body` hängt, steht
 * ausserhalb dieses Teilbaums — dort erbt er nichts.
 *
 * Custom Properties fallen dann nicht "auf einen Standardwert" zurück,
 * sondern machen die ganze Deklaration ungültig (invalid at computed
 * value time). Das erklärt exakt die drei gemeldeten Ausfälle:
 *
 *   border-radius: var(--r-btn)        → initial (0)     → eckig
 *   border: 1px solid var(--line)      → initial (none)  → randlos
 *   background: var(--surface-alt)     → initial (transp) → Hover-Aussetzer
 *   gap: var(--s3)                     → normal (0)      → alles klebt
 *
 * Der Fix ist NICHT, die Tokens im Dialog zu wiederholen — das gäbe
 * zwei Wahrheiten, die auseinanderlaufen. Der Dialog bekommt die
 * Klasse `t-mod` zusätzlich (Tokens erben) plus `t-dialog-host`, das
 * die Layout-Eigenschaften von `.t-mod` wieder zurücknimmt.
 * Dasselbe Muster nutzt die Turnierliste seit A4 (`.t-list-host`,
 * tournament.css ab ~205).
 *
 * ── Warum die Tastatur-Logik hier liegt ───────────────────────────
 *
 * Escape schliesst, Enter speichert, der Fokus kehrt zum auslösenden
 * Element zurück. Das sind drei Regeln, die in drei Dateien dreimal
 * leicht anders geraten würden. Als reine Funktionen sind sie ausserdem
 * ohne DOM testbar — hier gibt es kein jsdom (vitest läuft mit
 * `environment: 'node'`).
 */

/**
 * Klassen-Kette für jedes Dialog-Wurzelelement, das an `document.body`
 * hängt und Turnier-Tokens braucht.
 *
 *   dlg-bg         Backdrop aus main.css (fixed, inset:0, Abdunklung)
 *   t-mod          bringt die Tokens mit — die EINE Wahrheit
 *   t-dialog-host  nimmt die Layout-Eigenschaften von .t-mod zurück
 *
 * Dialoge mit eigenem Backdrop (`.t-confirm-backdrop`,
 * `.t-pick-team-modal`) nehmen nur die hinteren beiden, siehe
 * `DIALOG_TOKEN_CLASSES`.
 */
export const DIALOG_HOST_CLASS = 'dlg-bg t-mod t-dialog-host';

/** Nur Tokens + Layout-Reset, ohne den `dlg-bg`-Backdrop. */
export const DIALOG_TOKEN_CLASSES = 't-mod t-dialog-host';

/**
 * Escape schliesst — in jedem der drei Dialoge.
 */
export function isDialogCloseKey(event) {
  return !!event && event.key === 'Escape';
}

/**
 * Enter speichert.
 *
 * Nicht immer: In einem `<textarea>` ist Enter ein Zeilenumbruch, und
 * auf einem Knopf ist Enter der Knopf-Klick — beides würde sonst
 * doppelt feuern. Modifier-Tasten (Shift/Alt/Strg/Meta) zählen nicht,
 * damit Shift+Enter frei bleibt.
 */
export function isDialogSubmitKey(event) {
  if (!event || event.key !== 'Enter') return false;
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
  const tag = String(event.target?.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'BUTTON') return false;
  return true;
}

/**
 * Das Element merken, das den Dialog geöffnet hat — vor dem Anhängen
 * aufrufen, sonst ist der Fokus schon weg.
 *
 * `document.body` zählt nicht als Auslöser: Wenn niemand fokussiert
 * war, gibt es nichts, wohin der Fokus zurückkehren könnte.
 */
export function captureDialogTrigger(doc) {
  const el = doc?.activeElement;
  if (!el || typeof el.focus !== 'function') return null;
  if (doc.body && el === doc.body) return null;
  return el;
}

/**
 * Fokus zurück auf den Auslöser — beim Schliessen.
 *
 * Liefert `true`, wenn wirklich fokussiert wurde. `false` ist der
 * Normalfall nach einem erfolgreichen Speichern: Danach lädt die
 * Detail-Ansicht neu, der auslösende Knopf ist dann aus dem Dokument
 * entfernt (`isConnected === false`) und ein `focus()` darauf wäre
 * wirkungslos bis irreführend.
 */
export function restoreDialogTrigger(trigger) {
  if (!trigger || typeof trigger.focus !== 'function') return false;
  if (trigger.isConnected === false) return false;
  try {
    trigger.focus();
  } catch {
    return false;
  }
  return true;
}
