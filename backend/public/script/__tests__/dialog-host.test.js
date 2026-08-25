/**
 * A5 (2026-08-25) — Dialog-Host: Tokens, Tastatur, Fokus.
 *
 * Hintergrund (der Bug, den diese Datei absichert):
 *   Drei Dialoge dieser App hängen an `document.body`, also ausserhalb
 *   von `.t-mod`. Sämtliche Design-Tokens des Turniermoduls stehen
 *   aber auf `.t-mod` (tournament.css:42), nicht auf `:root`. Ein
 *   `var(--line)` ohne Wert liefert kein Grau, sondern macht die ganze
 *   Deklaration ungültig — `border: 1px solid var(--line)` wird zu
 *   `border: none`, `border-radius: var(--r-btn)` zu 0, `gap: var(--s3)`
 *   zu 0. Sichtbar war das als: eckige Ecken in der Lösch-Bestätigung,
 *   ein Bestätigungs-Eingabefeld ohne Rahmen, aneinanderklebender Text
 *   und Knöpfe mit Hover-Aussetzer im Team-Verschieben-Modal.
 *
 * Zwei Test-Ebenen, weil hier kein jsdom liegt (vitest läuft mit
 * `environment: 'node'`, siehe backend/vitest.config.js):
 *   1. Echte Unit-Tests der reinen Funktionen aus dialog-host.js.
 *   2. Quell-Scan über main.js / tournament.js / tournament.css für
 *      die strukturellen Zusagen, die kein Unit-Test sehen kann.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  DIALOG_HOST_CLASS,
  DIALOG_TOKEN_CLASSES,
  isDialogCloseKey,
  isDialogSubmitKey,
  captureDialogTrigger,
  restoreDialogTrigger,
} from '../dialog-host.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');
const mainJs = read('main.js');
const tournamentJs = read('tournament.js');
const tournamentCss = read('..', 'style', 'tournament.css');

// ─────────────────────────────────────────────────────────────────
// 1. Die reinen Funktionen
// ─────────────────────────────────────────────────────────────────

describe('Host-Klassen', () => {
  it('DIALOG_HOST_CLASS bringt Backdrop, Tokens und Layout-Reset mit', () => {
    const parts = DIALOG_HOST_CLASS.split(' ');
    expect(parts).toContain('dlg-bg');
    expect(parts).toContain('t-mod'); // die eine Wahrheit für die Tokens
    expect(parts).toContain('t-dialog-host'); // nimmt .t-mod-Layout zurück
  });

  it('DIALOG_TOKEN_CLASSES lässt den Backdrop weg (eigener Backdrop vorhanden)', () => {
    const parts = DIALOG_TOKEN_CLASSES.split(' ');
    expect(parts).toEqual(['t-mod', 't-dialog-host']);
    expect(parts).not.toContain('dlg-bg');
  });
});

describe('Escape schliesst', () => {
  it('Escape wird erkannt', () => {
    expect(isDialogCloseKey({ key: 'Escape' })).toBe(true);
  });

  it('andere Tasten nicht', () => {
    expect(isDialogCloseKey({ key: 'Enter' })).toBe(false);
    expect(isDialogCloseKey({ key: 'Esc' })).toBe(false); // Alt-IE-Schreibweise
    expect(isDialogCloseKey({ key: 'a' })).toBe(false);
  });

  it('kein Event → false statt Absturz', () => {
    expect(isDialogCloseKey(null)).toBe(false);
    expect(isDialogCloseKey(undefined)).toBe(false);
  });
});

describe('Enter speichert', () => {
  it('Enter in einem Zahlenfeld speichert', () => {
    expect(isDialogSubmitKey({ key: 'Enter', target: { tagName: 'INPUT' } })).toBe(true);
  });

  it('Enter in einem Auswahlfeld speichert', () => {
    expect(isDialogSubmitKey({ key: 'Enter', target: { tagName: 'SELECT' } })).toBe(true);
  });

  it('Enter auf einem Knopf NICHT — das ist der Knopf-Klick selbst', () => {
    expect(isDialogSubmitKey({ key: 'Enter', target: { tagName: 'BUTTON' } })).toBe(false);
  });

  it('Enter in einem Textbereich NICHT — dort ist es ein Zeilenumbruch', () => {
    expect(isDialogSubmitKey({ key: 'Enter', target: { tagName: 'TEXTAREA' } })).toBe(false);
  });

  it('Shift+Enter bleibt frei', () => {
    expect(
      isDialogSubmitKey({ key: 'Enter', shiftKey: true, target: { tagName: 'INPUT' } }),
    ).toBe(false);
  });

  it('Strg/Alt/Meta+Enter speichern nicht', () => {
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
      expect(
        isDialogSubmitKey({ key: 'Enter', [mod]: true, target: { tagName: 'INPUT' } }),
      ).toBe(false);
    }
  });

  it('andere Tasten und fehlendes Event → false', () => {
    expect(isDialogSubmitKey({ key: 'a', target: { tagName: 'INPUT' } })).toBe(false);
    expect(isDialogSubmitKey(null)).toBe(false);
  });

  it('Event ohne target → true (kein Absturz, sinnvoller Default)', () => {
    expect(isDialogSubmitKey({ key: 'Enter' })).toBe(true);
  });
});

describe('Fokus-Rückkehr zum Auslöser', () => {
  it('merkt sich das fokussierte Element', () => {
    const btn = { tagName: 'BUTTON', focus: () => {} };
    const doc = { activeElement: btn, body: {} };
    expect(captureDialogTrigger(doc)).toBe(btn);
  });

  it('document.body zählt nicht als Auslöser', () => {
    const body = { tagName: 'BODY', focus: () => {} };
    expect(captureDialogTrigger({ activeElement: body, body })).toBeNull();
  });

  it('kein activeElement → null', () => {
    expect(captureDialogTrigger({ activeElement: null, body: {} })).toBeNull();
    expect(captureDialogTrigger(undefined)).toBeNull();
  });

  it('Element ohne focus() → null (kein Absturz)', () => {
    expect(captureDialogTrigger({ activeElement: { tagName: 'DIV' }, body: {} })).toBeNull();
  });

  it('beim Schliessen kehrt der Fokus zurück', () => {
    const focus = vi.fn();
    expect(restoreDialogTrigger({ focus, isConnected: true })).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('ein Auslöser, der nicht mehr im Dokument steht, wird NICHT fokussiert', () => {
    // Genau der Fall nach erfolgreichem Speichern: die Detail-Ansicht
    // lädt neu, der auslösende Knopf ist ersetzt.
    const focus = vi.fn();
    expect(restoreDialogTrigger({ focus, isConnected: false })).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });

  it('kein Auslöser gemerkt → still nichts tun', () => {
    expect(restoreDialogTrigger(null)).toBe(false);
    expect(restoreDialogTrigger({})).toBe(false);
  });

  it('ein werfendes focus() reisst nichts mit', () => {
    const trigger = {
      isConnected: true,
      focus() {
        throw new Error('detached');
      },
    };
    expect(restoreDialogTrigger(trigger)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. Quell-Scan: die drei Dialoge tragen die Host-Klasse
// ─────────────────────────────────────────────────────────────────

describe('Alle drei body-Dialoge erben die Turnier-Tokens', () => {
  it('Ergebnis-Dialog (main.js) nutzt DIALOG_HOST_CLASS', () => {
    expect(mainJs).toMatch(
      /dlg\.id = 'result-entry-modal';[\s\S]{0,200}dlg\.className = `\$\{DIALOG_HOST_CLASS\}/,
    );
    // Kein handgeschriebenes 'dlg-bg' mehr an dieser Stelle.
    expect(mainJs).not.toMatch(
      /dlg\.id = 'result-entry-modal';[\s\S]{0,200}dlg\.className = 'dlg-bg';/,
    );
  });

  it('Lösch-Bestätigung (tournament.js) nutzt DIALOG_TOKEN_CLASSES', () => {
    expect(tournamentJs).toMatch(
      /backdrop\.className = `t-confirm-backdrop \$\{DIALOG_TOKEN_CLASSES\}`/,
    );
  });

  it('Team-Verschieben-Modal (main.js) nutzt DIALOG_TOKEN_CLASSES', () => {
    expect(mainJs).toMatch(
      /overlay\.className = `t-pick-team-modal \$\{DIALOG_TOKEN_CLASSES\}`/,
    );
  });

  it('beide Dateien importieren aus dialog-host.js', () => {
    expect(mainJs).toMatch(/from '\.\/dialog-host\.js'/);
    expect(tournamentJs).toMatch(/from '\.\/dialog-host\.js'/);
  });
});

describe('tournament.css: der Host nimmt die .t-mod-Layout-Eigenschaften zurück', () => {
  const host = tournamentCss.slice(tournamentCss.indexOf('.t-dialog-host {'));
  const block = host.slice(0, host.indexOf('}') + 1);

  it('.t-dialog-host existiert wirklich (die Klasse war bis A5 nur ein Kommentar)', () => {
    expect(tournamentCss).toMatch(/^\.t-dialog-host \{/m);
  });

  it('hebt den Container-Vertrag auf — sonst messen die Container-Queries den Dialog', () => {
    expect(block).toMatch(/container-type:\s*normal/);
  });

  it('setzt die Flex-Richtung auf row zurück — .t-mod ist column', () => {
    // In einer Spalte tauschen align-items und justify-content die
    // Achsen: der Bottom-Sheet fiele sonst nach rechts statt nach unten.
    expect(block).toMatch(/flex-direction:\s*row/);
  });

  it('gibt Breite, Höhe, Overflow und Padding zurück', () => {
    expect(block).toMatch(/width:\s*auto/);
    expect(block).toMatch(/height:\s*auto/);
    expect(block).toMatch(/overflow:\s*visible/);
    expect(block).toMatch(/padding:\s*var\(--s4\)/);
  });

  it('die Lösch-Bestätigung bekommt einen Radius, obwohl --r3 im Modul fehlt', () => {
    expect(tournamentCss).toMatch(
      /\.t-dialog-host \.t-confirm-dialog \{ border-radius: var\(--r-card\); \}/,
    );
  });

  it('Knopf-Optik im Dialog kommt gegen den .t-mod-button-Reset an', () => {
    // `.t-mod button { border: none; background: none }` (Klasse+Typ)
    // schlägt `.t-btn` (nur Klasse). Im Dialog wäre das ein Rückschritt.
    expect(tournamentCss).toMatch(/^\.t-dialog-host \.t-btn \{/m);
    expect(tournamentCss).toMatch(/^\.t-dialog-host \.t-btn--primary \{/m);
    expect(tournamentCss).toMatch(/^\.t-dialog-host \.t-btn--danger \{/m);
  });

  it('der Bottom-Sheet gilt nur für den Ergebnis-Dialog, nicht für jede Bestätigung', () => {
    expect(tournamentCss).toMatch(/\.t-dialog-host--sheet \{\s*align-items: flex-end/);
    // Keine unbedingte flex-end-Regel auf allen Hosts.
    expect(tournamentCss).not.toMatch(/^\s*\.t-dialog-host \{ align-items: flex-end/m);
  });
});
