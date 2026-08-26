/**
 * Ergebnis-Dialog — die strukturellen Entscheidungen.
 *
 * Bug 2026-08-17 (Vereinfachung): keine Vorschau-Box, Teamnamen direkt
 * neben den Score-Feldern, keine Emoji im Titel oder Speichern-Knopf.
 *
 * A5 2026-08-25 (Redesign, redesign-umsetzung-teil2.md): Der Dialog hing
 * an `document.body` und damit ausserhalb von `.t-mod` — dort erben die
 * Turnier-Tokens nicht, und ein `var(--r-card)` ohne Wert macht die
 * Deklaration ungültig statt sie auf einen Default zu setzen. Ergebnis:
 * fremde Farben, eckige Ecken, fremde Knöpfe. Seither trägt der Dialog
 * `DIALOG_HOST_CLASS` und die Klassen aus tournament.css. Dazu vier
 * Verhaltensänderungen: leere Felder, Fokus im ersten Feld, Enter
 * speichert, Knöpfe im Fussbereich ausserhalb des <form>.
 *
 * Strategie: Wir schneiden den `openResultEntryModal`-Rumpf aus main.js
 * und prüfen Präsenz/Abwesenheit bestimmter Tokens. Die Tastatur- und
 * Fokus-Logik selbst liegt als reine Funktion in dialog-host.js und ist
 * dort echt unit-getestet (dialog-host.test.js) — hier wird nur belegt,
 * dass der Dialog sie auch benutzt.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// main.js liegt unter public/script/, die Stylesheets unter public/style/.
const mainJsPath = resolve(__dirname, '..', 'main.js');
const mainCssPath = resolve(__dirname, '..', '..', 'style', 'main.css');
const tournamentCssPath = resolve(__dirname, '..', '..', 'style', 'tournament.css');
const mainJs = readFileSync(mainJsPath, 'utf8');
const mainCss = readFileSync(mainCssPath, 'utf8');
const tournamentCss = readFileSync(tournamentCssPath, 'utf8');

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
    // NACHHER: <h3 class="t-dialog-title" id="re-title">Ergebnis eintragen</h3>
    expect(modal).toMatch(/<h3[^>]*>Ergebnis eintragen<\/h3>/);
    expect(modal).not.toContain('⚽');
  });

  it('Speichern-Button OHNE Emoji (kein 💾)', () => {
    expect(modal).toMatch(/<button[^>]*type="submit"[^>]*>Speichern<\/button>/);
    expect(modal).not.toContain('💾');
    expect(modal).not.toMatch(/Ergebnis speichern/);
  });

  it('Selection-Dropdown nur wenn kein presetMatchId', () => {
    // Template-Bedingung: bei initialMatch → hidden input, sonst → select.
    expect(modal).toMatch(/initialMatch[\s\S]{0,200}input type="hidden"[\s\S]{0,200}re-match-id/);
    expect(modal).toMatch(/openSorted[\s\S]{0,400}<select id="re-match-id"/);
  });

  it('Keine alte re-info-Vorschau-Box mehr', () => {
    expect(modal).not.toMatch(/id="re-info"/);
    expect(modal).not.toMatch(/class="re-info"/);
    expect(modal).toMatch(/id="re-subline"/);
  });
});

describe('Ergebnis-Modal A5: Token-Vererbung statt Token-Kopie', () => {
  it('Der Dialog trägt die Host-Klassen, nicht mehr nur dlg-bg', () => {
    // Ohne `t-mod` am Wurzelelement erbt der Dialog keinen einzigen
    // Turnier-Token — genau das war der Befund.
    expect(modal).toMatch(/dlg\.className = `\$\{DIALOG_HOST_CLASS\} t-dialog-host--sheet`/);
    expect(modal).not.toMatch(/dlg\.className = 'dlg-bg';/);
  });

  it('Struktur nach Bauvorlage: Kopf, Rumpf, Fussbereich', () => {
    expect(modal).toMatch(/class="t-dialog"/);
    expect(modal).toMatch(/class="t-dialog-head"/);
    expect(modal).toMatch(/class="t-dialog-body"/);
    expect(modal).toMatch(/class="t-dialog-foot"/);
    expect(modal).toMatch(/class="t-dialog-subline"/);
  });

  it('Teamname und Eingabefeld in einer Zeile (.t-score-entry-row)', () => {
    expect(modal).toMatch(/class="t-score-entry"/);
    expect(modal).toMatch(/class="t-score-entry-row"/);
    expect(modal).toMatch(/class="t-score-entry-team"/);
    expect(modal).toMatch(/class="t-score-entry-input"/);
  });

  it('Die alten .re-*-Klassen sind aus dem Template raus', () => {
    for (const cls of ['re-score-row', 're-team', 're-score-input', 're-dot']) {
      expect(modal).not.toMatch(new RegExp(`class="[^"]*\\b${cls}\\b`));
    }
  });

  it('Der Dialog ist ordentlich ausgezeichnet (role, aria-modal, aria-labelledby)', () => {
    expect(modal).toMatch(/role="dialog"/);
    expect(modal).toMatch(/aria-modal="true"/);
    expect(modal).toMatch(/aria-labelledby="re-title"/);
  });

  it('CSS: die .re-*-Regeln sind aus main.css raus, .t-score-entry* stehen in tournament.css', () => {
    expect(mainCss).not.toMatch(/^\.re-info\s*\{/m);
    expect(mainCss).not.toMatch(/^\.re-subline\s*\{/m);
    expect(mainCss).not.toMatch(/^\.re-score-row\s*\{/m);
    expect(mainCss).not.toMatch(/^\.re-team\s*\{/m);
    expect(mainCss).not.toMatch(/^\.re-score-input\s*\{/m);

    expect(tournamentCss).toMatch(/^\.t-dialog\s*\{/m);
    expect(tournamentCss).toMatch(/^\.t-dialog-subline\s*\{/m);
    expect(tournamentCss).toMatch(/^\.t-score-entry\s*\{/m);
    expect(tournamentCss).toMatch(/^\.t-score-entry-row\s*\{/m);
    expect(tournamentCss).toMatch(/^\.t-score-entry-input\s*\{/m);
  });
});

describe('Ergebnis-Modal A5: die vier Verhaltensänderungen', () => {
  it('1. Die Punktefelder starten LEER, nicht mit 0', () => {
    // Eine vorbelegte Null muss man erst wegtippen — und ein
    // versehentlich gespeichertes 0:0 ist teurer als der Tastendruck.
    expect(modal).toMatch(/id="re-home"[\s\S]{0,160}class="t-score-entry-input"/);
    expect(modal).not.toMatch(/id="re-home"[^>]*value="0"/);
    expect(modal).not.toMatch(/id="re-away"[^>]*value="0"/);
    // Auch keine spätere Zuweisung, die die Null durch die Hintertür holt.
    expect(modal).not.toMatch(/#re-home'\)\.value\s*=\s*['"]?0/);
  });

  it('2. Beim Öffnen liegt der Fokus im ersten Feld', () => {
    expect(modal).toMatch(/const firstField =/);
    expect(modal).toMatch(/if \(firstField\) firstField\.focus\(\);/);
    // Ist kein Spiel vorgegeben, gehört der Fokus ins Auswahlfeld.
    expect(modal).toMatch(
      /mIdInput\.tagName === 'SELECT' \? mIdInput : dlg\.querySelector\('#re-home'\)/
    );
  });

  it('3. Enter speichert', () => {
    expect(modal).toMatch(/isDialogSubmitKey\(e\)/);
    expect(modal).toMatch(/formEl\.requestSubmit\(\)/);
    // preventDefault verhindert ein zweites, natives Absenden.
    expect(modal).toMatch(/isDialogSubmitKey\(e\)\) return;[\s\S]{0,80}e\.preventDefault\(\)/);
  });

  it('4. Die Knöpfe stehen im Fussbereich, AUSSERHALB des <form>', () => {
    const foot = modal.slice(modal.indexOf('t-dialog-foot'));
    expect(foot).toMatch(
      /<button type="button" class="t-btn" data-action="close">Abbrechen<\/button>/
    );
    expect(foot).toMatch(/<button type="submit" form="result-entry-form"/);
    // Das </form> muss VOR dem Fussbereich stehen.
    expect(modal.indexOf('</form>')).toBeGreaterThan(0);
    expect(modal.indexOf('</form>')).toBeLessThan(modal.indexOf('t-dialog-foot'));
  });
});

describe('Ergebnis-Modal A5: Escape und Fokus-Rückkehr', () => {
  it('Escape schliesst', () => {
    expect(modal).toMatch(/isDialogCloseKey\(e\)/);
    expect(modal).toMatch(/document\.addEventListener\('keydown', onDialogKeyDown\)/);
  });

  it('Der Auslöser wird VOR dem Öffnen gemerkt', () => {
    const capture = modal.indexOf('captureDialogTrigger(document)');
    const append = modal.indexOf('document.body.appendChild(dlg)');
    expect(capture).toBeGreaterThan(0);
    expect(append).toBeGreaterThan(capture);
  });

  it('Jeder Schliess-Weg läuft durch closeDialog — inkl. Fokus-Rückgabe', () => {
    expect(modal).toMatch(/function closeDialog\(\) \{/);
    expect(modal).toMatch(/restoreDialogTrigger\(trigger\)/);
    // Backdrop-Klick, ✕ und Abbrechen
    expect(modal).toMatch(/e\.target\.dataset\.action === 'close'\) closeDialog\(\)/);
    // …und der Erfolgsfall nach dem Speichern: kein rohes dlg.remove() mehr.
    //
    // Gemessen statt gezaehlt (2026-08-25): vorher stand hier ein
    // Zeichenfenster von 40. Das machte den Test von der Kommentar-
    // laenge zwischen den beiden Zeilen abhaengig — eine eingefuegte
    // Zeile (clearPendingResultInput) kippte ihn, obwohl die geprüfte
    // Reihenfolge unveraendert war. Massgeblich ist der Abschnitt
    // zwischen „Toast gezeigt" und „Modal entfernt".
    const abToast = modal.indexOf("tlog('toast:shown');");
    const abEntfernt = modal.indexOf("tlog('modal:removed');");
    expect(abToast).toBeGreaterThan(-1);
    expect(abEntfernt).toBeGreaterThan(abToast);
    const abschnitt = modal.slice(abToast, abEntfernt);
    expect(abschnitt).toContain('closeDialog();');
    expect(abschnitt).not.toContain('dlg.remove();');
  });

  it('Der keydown-Horcher wird wieder abgeräumt', () => {
    expect(modal).toMatch(/document\.removeEventListener\('keydown', onDialogKeyDown\)/);
    // Selbstheilung, falls der Dialog an closeDialog vorbei entfernt wurde.
    expect(modal).toMatch(/if \(!dlg\.isConnected\)/);
  });
});
