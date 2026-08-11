/**
 * Regressionstests für zwei 2026-08-11 entdeckte Bugs:
 *
 *   1. AUTH-HEADER FEHLTE
 *      Vorher rief tournament.js 6-mal raw fetch() auf mit nur
 *      credentials:'include', aber OHNE Authorization-Header. Sobald
 *      der Server den Token nur per Bearer (nicht per Cookie) akzeptiert,
 *      lehnt er alles mit "No Authorization was found in request.headers"
 *      ab. Fix: Alle Aufrufe gehen jetzt durch fetchWithAuth() aus
 *      auth-oidc.js, das den Header zentral setzt + 401-Refresh macht.
 *
 *   2. STEP 1 BLOCKIERTE BEI FEHLSCHLAG
 *      Vorher hat der "Weiter"-Handler in Step 1 auf einen
 *      fehlgeschlagenen Draft-POST gewartet und bei Fehler den Wizard
 *      in Step 1 festgehalten. User konnte nicht weiterklicken. Fix:
 *      ensureDraftPromise() schluckt Fehler intern, schreibt sie nach
 *      state.__draftError und liefert { tournamentId: null, error }.
 *      Der Step-1-Handler zeigt einen Hinweis, lässt den User aber
 *      weiterklicken. main.js onGenerate versucht es am Ende nochmal.
 *
 * Spec §13.5: Ursache beheben statt Meldung verschönern.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ensureDraftPromise } from '../tournament.js';

let originalFetch;
let fetchCalls;

beforeEach(() => {
  fetchCalls = [];
  originalFetch = globalThis.fetch;
  // Wichtig: status > 400 muss vermieden werden, sonst ruft
  // fetchWithAuth refreshAccessToken → logout() auf, was im
  // Node-Test-Environment wegen window undefined hängt. Wir
  // testen den Fehlerpfad deshalb über ok:false + status:200,
  // den tournament.js selbst parst.
  globalThis.fetch = vi.fn(async (url, init) => {
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 201,
      json: async () => ({ tournament: { id: 't-new-1' } }),
    };
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ensureDraftPromise — nicht-throwend (Bug B, 2026-08-11)', () => {
  it('WIRFT NICHT, wenn der Server einen Fehlerbody schickt', async () => {
    // Der Trick: wir nutzen status:200 mit { error: "..." } im Body,
    // damit fetchWithAuth keinen 401-Refresh-Pfad auslöst.
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 200, // status:200 aber ok:false — fetchWithAuth lässt durch
      json: async () => ({ error: 'simulated_500' }),
    }));
    const state = { name: 'X', mode: 'groups_ko' };
    // Vor dem Fix hätte das hier geworfen → Step 1 blockiert.
    // Jetzt: Promise löst sich auf, tournamentId bleibt null.
    const result = await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(result.tournamentId).toBeNull();
    expect(result.created).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('WIRFT NICHT bei Netzwerkfehler (TypeError: Failed to fetch)', async () => {
    globalThis.fetch = vi.fn(async () => {
      // Reale Netzwerkfehler werfen eine TypeError.
      throw new TypeError('Failed to fetch');
    });
    const state = { name: 'X', mode: 'groups_ko' };
    const result = await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(result.tournamentId).toBeNull();
    expect(result.error).toMatch(/Internetverbindung/i);
  });

  it('schreibt den Fehler nach state.__draftError für UI + Konsole', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 200,
      json: async () => ({ message: 'Berechtigung fehlt' }),
    }));
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(state.__draftError).toBeTruthy();
  });

  it('löscht state.__draftError nach erfolgreichem Retry', async () => {
    // 1. Versuch: Fehler
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 200,
      json: async () => ({ message: 'Berechtigung fehlt' }),
    }));
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(state.__draftError).toBeTruthy();
    // 2. Versuch (Retry): Erfolg
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ tournament: { id: 't-new-2' } }),
    }));
    const r = await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(r.tournamentId).toBe('t-new-2');
    expect(state.__draftError).toBeNull();
  });
});

describe('ensureDraftPromise — Pfad durch fetchWithAuth (Bug A)', () => {
  it('setzt credentials: include am globalen fetch (über fetchWithAuth)', async () => {
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(fetchCalls[0].init.credentials).toBe('include');
  });

  it('setzt Content-Type: application/json am POST-Body', async () => {
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(fetchCalls[0].init.headers['Content-Type']).toBe('application/json');
  });

  it('POST gegen /api/tournaments, method: POST', async () => {
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('/api/tournaments');
    expect(fetchCalls[0].init.method).toBe('POST');
  });
});