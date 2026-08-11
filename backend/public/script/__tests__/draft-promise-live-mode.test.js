/**
 * Tests für ensureDraftPromise — der Schritt, in dem der Wizard
 * den Turnier-Entwurf in der DB anlegt (POST /api/tournaments).
 *
 * Hintergrund: Dieser Lebenszyklus ist der Risikopunkt. Wenn der
 * Aufrufer opts.groupId nicht durchreicht, geht die Funktion
 * stillschweigend in den Mock-Modus — kein POST, keine tournamentId,
 * und der User merkt es erst in Schritt 5 ("Turnier generieren").
 *
 * Genau das ist 2026-08-11 in main.js passiert. Diese Tests halten
 * fest, dass ensureDraftPromise sich in beiden Modi korrekt verhält:
 *
 *   - opts.groupId fehlt     → Mock, kein fetch, tournamentId null
 *   - opts.groupId gesetzt   → Live, fetch wird abgesetzt,
 *                              tournamentId wird gesetzt
 *   - tournamentId bereits   → idempotent, kein zweiter POST
 *   - __draftInFlight läuft  → hängt am laufenden Promise
 *
 * Spec §1.2: "Genau ein POST pro Wizard-leben".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ensureDraftPromise } from '../tournament.js';

let originalFetch;
let fetchCalls;

beforeEach(() => {
  fetchCalls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, init) => {
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 201,
      json: async () => ({ tournament: { id: 't-new-1' } }),
    };
  });
});

// Am Ende: fetch wiederherstellen, damit andere Tests nicht leaken.
import { afterEach } from 'vitest';
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ensureDraftPromise — Mock-Modus (opts.groupId fehlt)', () => {
  it('macht KEINEN fetch, wenn opts.groupId undefined ist', async () => {
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, {});
    expect(fetchCalls).toHaveLength(0);
  });

  it('setzt KEINE tournamentId, wenn opts.groupId fehlt', async () => {
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, {});
    expect(state.tournamentId).toBeUndefined();
  });

  it('macht KEINEN fetch, wenn opts.groupId leerer String ist', async () => {
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: '' });
    expect(fetchCalls).toHaveLength(0);
  });

  it(
    'REGRESSIONSSCHUTZ: opts.groupId fehlt, aber initialState.groupId ist ' +
    'gesetzt — genau das war der main.js-Bug vom 2026-08-11',
    async () => {
      const state = { name: 'X', mode: 'groups_ko', groupId: 'g-1' };
      // opts.groupId fehlt → Mock-Modus → kein fetch.
      // Ohne den Fix in main.js (groupId als Top-Level-Option) wäre
      // der User hier gelandet.
      await ensureDraftPromise(state, {});
      expect(fetchCalls).toHaveLength(0);
      expect(state.tournamentId).toBeUndefined();
    }
  );
});

describe('ensureDraftPromise — Live-Modus (opts.groupId gesetzt)', () => {
  it('setzt EINEN POST /api/tournaments ab', async () => {
    const state = { name: 'Cup 2026', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: 'g-42' });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('/api/tournaments');
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(JSON.parse(fetchCalls[0].init.body)).toEqual({
      groupId: 'g-42',
      name: 'Cup 2026',
      mode: 'groups_ko',
    });
  });

  it('setzt state.tournamentId aus der Server-Antwort', async () => {
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(state.tournamentId).toBe('t-new-1');
  });

  it('sendet name.trim() — Whitespace wird abgeschnitten', async () => {
    const state = { name: '  Whitespace-Cup  ', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(JSON.parse(fetchCalls[0].init.body).name).toBe('Whitespace-Cup');
  });
});

describe('ensureDraftPromise — Idempotenz', () => {
  it('macht KEINEN zweiten POST, wenn tournamentId schon gesetzt ist', async () => {
    const state = {
      name: 'X',
      mode: 'groups_ko',
      tournamentId: 't-existing',
    };
    await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(fetchCalls).toHaveLength(0);
  });

  it('zweiter Aufruf mit gesetzter tournamentId gibt vorhandene ID zurück', async () => {
    const state = {
      name: 'X',
      mode: 'groups_ko',
      tournamentId: 't-existing',
    };
    const result = await ensureDraftPromise(state, { groupId: 'g-1' });
    expect(result).toEqual({
      tournamentId: 't-existing',
      created: false,
    });
  });
});

describe('ensureDraftPromise — Single-Flight (parallel calls)', () => {
  it('zwei parallele Aufrufe ergeben nur einen POST', async () => {
    const state = { name: 'X', mode: 'groups_ko' };
    const [a, b] = await Promise.all([
      ensureDraftPromise(state, { groupId: 'g-1' }),
      ensureDraftPromise(state, { groupId: 'g-1' }),
    ]);
    expect(fetchCalls).toHaveLength(1);
    expect(a.tournamentId).toBe('t-new-1');
    expect(b.tournamentId).toBe('t-new-1');
  });

  it('löscht __draftInFlight nach Abschluss, damit Retry wieder versuchen kann', async () => {
    const state = { name: 'X', mode: 'groups_ko' };
    await ensureDraftPromise(state, { groupId: 'g-1' });
    // Nach erfolgreichem Lauf ist der Cache leer — aber tournamentId
    // ist gesetzt, also würde ein weiterer Aufruf ohnehin idempotent
    // abbrechen. Das ist OK.
    expect(state.__draftInFlight).toBeNull();
  });
});