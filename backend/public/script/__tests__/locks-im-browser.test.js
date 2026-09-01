/**
 * Die Lock-Tabelle erreicht den Browser (2026-09-01).
 *
 * Befund: `locks.js` lag unter backend/src und wurde nie ausgeliefert
 * (Static-Root ist backend/public). `window.tournamentLocks` blieb im
 * Browser undefined — und jedes Renderer-Gate, das darauf liest, fiel
 * still auf seinen Fallback: kein Rueckzugs-Knopf im Teams-Tab, keine
 * Zeile „Zurueck zu Entwurf" im Einstellungen-Tab. 2143 Tests waren
 * gruen, weil jeder die Lock-Tabelle direkt importierte oder dem
 * Renderer `canWithdraw: true` von Hand reichte. Geprueft wurde „malt
 * er den Knopf richtig", nie „bekommt er das Ja jemals".
 *
 * Dieser Test prueft die Kette, nicht das Glied:
 *   1. main.js importiert './locks.js' als Seiteneffekt — ohne den Import
 *      ist die Datei zwar ausgeliefert, aber nie geladen.
 *   2. Die ausgelieferte Datei haengt sich in einem Browser-Kontext an
 *      window.tournamentLocks und liefert fuer den Rueckzugs-Fall
 *      (generiert, nicht gestartet, keine Ergebnisse) das Ja, auf das
 *      teamsWithdrawOptions() in main.js wartet.
 *   3. Der Server-Pfad ist dieselbe Datei (Re-Export), keine Kopie.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..');
const srcLocks = path.resolve(here, '../../../src/modules/tournament/locks.js');

describe('locks.js erreicht den Browser', () => {
  let savedWindow;
  beforeAll(() => {
    savedWindow = globalThis.window;
    // Browser-Kontext simulieren, BEVOR das Modul geladen wird — der
    // UMD-Zweig laeuft nur einmal beim Modul-Load.
    globalThis.window = globalThis;
  });
  afterAll(() => {
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  });

  it('main.js importiert ./locks.js als Seiteneffekt', async () => {
    const src = await fs.readFile(path.join(publicDir, 'main.js'), 'utf8');
    expect(src).toMatch(/^import '\.\/locks\.js';/m);
  });

  it('die ausgelieferte Datei setzt window.tournamentLocks — und das Rueckzugs-Gate sagt Ja', async () => {
    await import('../locks.js');
    const locks = globalThis.window.tournamentLocks;
    expect(locks).toBeDefined();
    expect(typeof locks.lockStateFor).toBe('function');
    // Genau der Aufruf aus teamsWithdrawOptions() (main.js): generiert,
    // nicht gestartet, keine Ergebnisse → Teams duerfen bearbeitet werden.
    const state = locks.lockStateFor({ status: 'generated', startedAt: null }, 0);
    expect(state.canEditTeams).toEqual({ allowed: true, reason: null });
    // Und die Gegenprobe: laeuft → gesperrt, mit Grund.
    const running = locks.lockStateFor({ status: 'generated', startedAt: '2026-09-01' }, 0);
    expect(running.canEditTeams.allowed).toBe(false);
    expect(running.canEditTeams.reason).toMatch(/läuft/);
  });

  it('der Server-Pfad ist ein Re-Export derselben Datei, keine Kopie', async () => {
    const shim = await fs.readFile(srcLocks, 'utf8');
    expect(shim).toMatch(/export \* from '\.\.\/\.\.\/\.\.\/public\/script\/locks\.js'/);
    const viaServer = await import(pathToFileURL(srcLocks).href);
    const viaBrowser = await import('../locks.js');
    expect(viaServer.canEdit).toBe(viaBrowser.canEdit);
    expect(viaServer.lockStateFor).toBe(viaBrowser.lockStateFor);
  });
});
