/**
 * Betriebsfestigkeit A3 (2026-08-25): Sitzungsende wirft Eingaben weg.
 *
 * Der belegte Ablauf (Uebergabe 4.2, „Anmeldung laeuft ab, Speichern
 * scheitert still")
 * --------------------------------------------------------------------
 *   Handy liegt zwanzig Minuten in der Tasche. Ergebnis-Dialog auf,
 *   3:2 getippt, „Speichern". Der Server antwortet 401, `apiCall`
 *   versucht den Refresh, der Refresh-Cookie ist abgelaufen — und im
 *   catch stand `await logout()`. logout() setzt `window.location.href`.
 *   Die Seite war weg, samt Dialog und samt 3:2. Ohne Meldung, ohne
 *   Rueckfrage. Dazu hatte der Auto-Refresh-Timer kein `.catch()`:
 *   dieselbe Zwangs-Abmeldung konnte mitten in der Arbeit von einem
 *   Timer ausgeloest werden, plus eine unbehandelte Rejection.
 *
 * Der Kern des Fixes ist nicht die Meldung, sondern dass die Werte
 * bleiben. Sie ueberleben auf zwei Wegen, und beide werden geprueft:
 *
 *   1. Es wird NICHT MEHR UMGELEITET. auth-oidc.js meldet nur noch
 *      „Sitzung zu Ende"; der Redirect passiert erst in `forceReauth()`,
 *      also nach Zustimmung. Der Dialog bleibt stehen, das 3:2 steht
 *      weiter in den Feldern.
 *   2. Wer zustimmt, verlaesst die Seite — dafuer legt main.js die
 *      Eingaben vorher in den sessionStorage, der den Authentik-Umweg
 *      ueberdauert, und holt sie beim naechsten Oeffnen zurueck.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as acorn from 'acorn';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_DIR = path.resolve(__dirname, '..');
const AUTH = path.join(SCRIPT_DIR, 'auth-oidc.js');
const MAIN = path.join(SCRIPT_DIR, 'main.js');
const authSrc = fs.readFileSync(AUTH, 'utf-8');
const mainSrc = fs.readFileSync(MAIN, 'utf-8');

// ── Teil 1: auth-oidc.js, echtes Modul ───────────────────────────────
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

describe('auth-oidc: ein abgelaufener Refresh meldet, statt zu verschwinden', () => {
  let gerufeneUrls;
  let alteGlobals;

  beforeEach(() => {
    vi.resetModules();
    gerufeneUrls = [];
    alteGlobals = {
      fetch: globalThis.fetch,
      sessionStorage: globalThis.sessionStorage,
      window: globalThis.window,
    };
    globalThis.sessionStorage = fakeStorage();
    globalThis.sessionStorage.setItem('accessToken', 'alt');
    globalThis.window = {
      location: { href: 'https://app.example/start' },
      dispatchEvent: () => true,
    };
    globalThis.fetch = async (u) => {
      gerufeneUrls.push(String(u));
      if (String(u).includes('/auth/refresh')) {
        return { ok: false, status: 401, text: async () => '', json: async () => ({}) };
      }
      if (String(u).includes('/auth/logout')) {
        const koerper = JSON.stringify({ endSessionUrl: 'https://authentik/end' });
        return { ok: true, status: 200, text: async () => koerper, json: async () => JSON.parse(koerper) };
      }
      // Der eigentliche Aufruf: abgelaufener Token.
      return { ok: false, status: 401, text: async () => '', json: async () => ({}) };
    };
  });

  afterEach(() => {
    globalThis.fetch = alteGlobals.fetch;
    globalThis.sessionStorage = alteGlobals.sessionStorage;
    globalThis.window = alteGlobals.window;
  });

  it('leitet NICHT mehr von selbst um — der Dialog bleibt stehen', async () => {
    const auth = await import('../auth-oidc.js');
    await expect(auth.apiCall('/tournaments/x', 'GET')).rejects.toBeTruthy();
    expect(globalThis.window.location.href, 'die Seite wurde umgeleitet — die Eingabe ist weg')
      .toBe('https://app.example/start');
    expect(gerufeneUrls.some((u) => u.includes('/auth/logout')), 'logout() lief ungefragt')
      .toBe(false);
  });

  it('meldet das Sitzungsende an angemeldete Horcher', async () => {
    const auth = await import('../auth-oidc.js');
    const gemeldet = [];
    auth.onSessionExpired((info) => gemeldet.push(info));
    expect(auth.isSessionExpired()).toBe(false);
    await auth.apiCall('/tournaments/x', 'GET').catch(() => {});
    expect(gemeldet).toHaveLength(1);
    expect(gemeldet[0].reason).toBe('refresh_failed');
    expect(auth.isSessionExpired()).toBe(true);
  });

  it('meldet nur EINMAL, auch wenn mehrere Aufrufe gleichzeitig scheitern', async () => {
    const auth = await import('../auth-oidc.js');
    let n = 0;
    auth.onSessionExpired(() => { n += 1; });
    await Promise.all([
      auth.apiCall('/a', 'GET').catch(() => {}),
      auth.apiCall('/b', 'GET').catch(() => {}),
      auth.apiCall('/c', 'GET').catch(() => {}),
    ]);
    expect(n, 'drei Absagen duerfen nicht drei Dialoge ergeben').toBe(1);
  });

  it('der Fehler ist als Sitzungsende erkennbar und traegt einen deutschen Satz', async () => {
    const auth = await import('../auth-oidc.js');
    const err = await auth.apiCall('/tournaments/x', 'GET').catch((e) => e);
    expect(err.code).toBe('session_expired');
    expect(err.serverMessage).toMatch(/Anmeldung ist abgelaufen/);
  });

  it('abgemeldete Horcher werden nicht mehr gerufen', async () => {
    const auth = await import('../auth-oidc.js');
    let n = 0;
    const ab = auth.onSessionExpired(() => { n += 1; });
    ab();
    await auth.apiCall('/tournaments/x', 'GET').catch(() => {});
    expect(n).toBe(0);
  });

  it('forceReauth ist der EINZIGE Weg, der wirklich umleitet', async () => {
    const auth = await import('../auth-oidc.js');
    await auth.forceReauth();
    expect(globalThis.window.location.href).toBe('https://authentik/end');
    expect(gerufeneUrls.some((u) => u.includes('/auth/logout'))).toBe(true);
  });
});

// ── Teil 2: Quelltext-Ratschen ───────────────────────────────────────
describe('auth-oidc: die zwei Stellen aus Punkt 4.2 bleiben repariert', () => {
  const ast = acorn.parse(authSrc, { ecmaVersion: 2022, sourceType: 'module' });
  const fn = (name) => {
    let t = null;
    const gehe = (n) => {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'FunctionDeclaration' && n.id?.name === name) { t = n; return; }
      for (const k of Object.keys(n)) {
        if (k === 'start' || k === 'end' || k === 'loc') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(gehe); else gehe(v);
      }
    };
    gehe(ast);
    if (!t) throw new Error(`${name} nicht gefunden`);
    return authSrc.slice(t.start, t.end);
  };

  it('refreshAccessToken loggt im Fehlerfall nicht mehr selbst aus', () => {
    const koerper = fn('refreshAccessToken');
    expect(koerper, 'der Zwangs-Logout ist zurueck — damit ist die Eingabe wieder weg')
      .not.toContain('await logout()');
    expect(koerper).toContain('notifySessionExpired');
  });

  it('der Auto-Refresh-Timer hat ein .catch()', () => {
    const koerper = fn('startTokenRefreshTimer');
    expect(koerper, 'ohne catch: unbehandelte Rejection plus Zwangs-Abmeldung per Timer')
      .toMatch(/\.catch\(/);
  });

  it('der Timer setzt nach einem endgueltigen Fehlschlag keinen neuen Timer', () => {
    const koerper = fn('startTokenRefreshTimer');
    const abCatch = koerper.slice(koerper.indexOf('.catch('));
    expect(abCatch).not.toContain('startTokenRefreshTimer()');
  });

  it('ein erfolgreicher Refresh hebt den Ablauf-Zustand wieder auf', () => {
    expect(fn('refreshAccessToken')).toContain('sessionExpired = false;');
    expect(fn('checkSession')).toContain('sessionExpired = false;');
  });
});

// ── Teil 3: main.js, der Entwurf ueberlebt die Weiterleitung ─────────
const mainAst = acorn.parse(mainSrc, { ecmaVersion: 2022, sourceType: 'module' });
function schneideMain(name) {
  const t = mainAst.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === name);
  if (!t) throw new Error(`${name} existiert nicht auf Modulebene in main.js`);
  return mainSrc.slice(t.start, t.end);
}

function schneideKonstante(name) {
  for (const n of mainAst.body) {
    if (n.type !== 'VariableDeclaration') continue;
    if (n.declarations.some((d) => d.id?.type === 'Identifier' && d.id.name === name)) {
      return mainSrc.slice(n.start, n.end);
    }
  }
  throw new Error(`Konstante ${name} nicht auf Modulebene gefunden`);
}

function ladeEntwurfsHelfer({ store, dialog, jetzt = Date.now() }) {
  const quelle = [
    // Die Konstanten gehoeren zum Verhalten (Schluessel + Verfallsdauer)
    // und werden deshalb aus main.js mitgeschnitten, nicht abgeschrieben.
    schneideKonstante('PENDING_RESULT_KEY'),
    schneideKonstante('PENDING_RESULT_MAX_ALTER_MS'),
    schneideMain('safeSessionStorage'),
    schneideMain('stashPendingResultInput'),
    schneideMain('readPendingResultInput'),
    schneideMain('clearPendingResultInput'),
    schneideMain('restorePendingResultInput'),
  ].join('\n');
  const toasts = [];
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'sessionStorage',
    'document',
    'toast',
    'Date',
    'console',
    'Event',
    `${quelle}\nreturn { stashPendingResultInput, readPendingResultInput, clearPendingResultInput, restorePendingResultInput };`,
  );
  const fakeDate = { now: () => jetzt };
  const api = factory(
    store,
    { getElementById: (id) => (id === 'result-entry-modal' ? dialog : null) },
    (m, k) => toasts.push([m, k]),
    fakeDate,
    { warn() {} },
    class { constructor(t) { this.type = t; } },
  );
  return { ...api, toasts };
}

/** Fake-Dialog: hidden input ODER select fuer das Spiel, zwei Score-Felder. */
function fakeDialog({ tournamentId = 'T1', matchId = 'M1', select = null, home = '', away = '' } = {}) {
  const felder = {
    '#re-home': { value: home },
    '#re-away': { value: away },
  };
  felder['#re-match-id'] = select
    ? { tagName: 'SELECT', value: select.value ?? '', options: select.options.map((v) => ({ value: v })), dispatchEvent() {} }
    : { tagName: 'INPUT', value: matchId };
  return {
    dataset: { tournamentId },
    querySelector: (sel) => felder[sel] ?? null,
    felder,
  };
}

describe('Entwurf des Ergebnis-Dialogs ueberlebt die Neu-Anmeldung', () => {
  it('sichert nichts, solange nichts getippt wurde', () => {
    const store = fakeStorage();
    const h = ladeEntwurfsHelfer({ store, dialog: fakeDialog() });
    expect(h.stashPendingResultInput()).toBe(false);
    expect(store._map.size).toBe(0);
  });

  it('sichert die getippten Werte samt Turnier und Spiel', () => {
    const store = fakeStorage();
    const h = ladeEntwurfsHelfer({ store, dialog: fakeDialog({ home: '3', away: '2' }) });
    expect(h.stashPendingResultInput()).toBe(true);
    const e = h.readPendingResultInput();
    expect(e.scoreHome).toBe('3');
    expect(e.scoreAway).toBe('2');
    expect(e.tournamentId).toBe('T1');
    expect(e.matchId).toBe('M1');
  });

  it('sichert auch, wenn nur eine Zahl dasteht', () => {
    const store = fakeStorage();
    const h = ladeEntwurfsHelfer({ store, dialog: fakeDialog({ home: '3' }) });
    expect(h.stashPendingResultInput()).toBe(true);
  });

  it('holt die Werte in einen frisch geoeffneten Dialog zurueck', () => {
    const store = fakeStorage();
    const vorher = ladeEntwurfsHelfer({ store, dialog: fakeDialog({ home: '3', away: '2' }) });
    vorher.stashPendingResultInput();

    const neuerDialog = fakeDialog();
    const nachher = ladeEntwurfsHelfer({ store, dialog: neuerDialog });
    expect(nachher.restorePendingResultInput(neuerDialog, 'T1')).toBe(true);
    expect(neuerDialog.felder['#re-home'].value).toBe('3');
    expect(neuerDialog.felder['#re-away'].value).toBe('2');
    // Und ist danach verbraucht — sonst schlaegt er beim naechsten Spiel
    // wieder denselben Score vor.
    expect(nachher.readPendingResultInput()).toBeNull();
    expect(nachher.toasts[0][0]).toMatch(/wieder da/);
  });

  it('holt NICHTS in ein anderes Turnier', () => {
    const store = fakeStorage();
    const a = ladeEntwurfsHelfer({ store, dialog: fakeDialog({ tournamentId: 'T1', home: '3', away: '2' }) });
    a.stashPendingResultInput();
    const fremd = fakeDialog({ tournamentId: 'T2' });
    const b = ladeEntwurfsHelfer({ store, dialog: fremd });
    expect(b.restorePendingResultInput(fremd, 'T2')).toBe(false);
    expect(fremd.felder['#re-home'].value).toBe('');
  });

  it('holt NICHTS in ein anderes vorgegebenes Spiel', () => {
    const store = fakeStorage();
    const a = ladeEntwurfsHelfer({ store, dialog: fakeDialog({ matchId: 'M1', home: '3', away: '2' }) });
    a.stashPendingResultInput();
    const anderes = fakeDialog({ matchId: 'M9' });
    const b = ladeEntwurfsHelfer({ store, dialog: anderes });
    expect(b.restorePendingResultInput(anderes, 'T1')).toBe(false);
  });

  it('holt NICHTS, wenn das Spiel inzwischen nicht mehr offen ist', () => {
    const store = fakeStorage();
    const a = ladeEntwurfsHelfer({ store, dialog: fakeDialog({ matchId: 'M1', home: '3', away: '2' }) });
    a.stashPendingResultInput();
    const mitAuswahl = fakeDialog({ select: { value: '', options: ['M7', 'M8'] } });
    const b = ladeEntwurfsHelfer({ store, dialog: mitAuswahl });
    expect(b.restorePendingResultInput(mitAuswahl, 'T1')).toBe(false);
  });

  it('waehlt das Spiel im Auswahlfeld, wenn es noch offen ist', () => {
    const store = fakeStorage();
    const a = ladeEntwurfsHelfer({ store, dialog: fakeDialog({ matchId: 'M1', home: '3', away: '2' }) });
    a.stashPendingResultInput();
    const mitAuswahl = fakeDialog({ select: { value: '', options: ['M1', 'M8'] } });
    const b = ladeEntwurfsHelfer({ store, dialog: mitAuswahl });
    expect(b.restorePendingResultInput(mitAuswahl, 'T1')).toBe(true);
    expect(mitAuswahl.felder['#re-match-id'].value).toBe('M1');
  });

  it('ein alter Entwurf verfaellt statt in ein spaeteres Spiel zu rutschen', () => {
    const store = fakeStorage();
    const a = ladeEntwurfsHelfer({ store, dialog: fakeDialog({ home: '3', away: '2' }), jetzt: 0 });
    a.stashPendingResultInput();
    const spaet = fakeDialog();
    const b = ladeEntwurfsHelfer({ store, dialog: spaet, jetzt: 3 * 60 * 60 * 1000 });
    expect(b.restorePendingResultInput(spaet, 'T1')).toBe(false);
    expect(spaet.felder['#re-home'].value).toBe('');
  });

  it('kommt ohne sessionStorage klar (privater Modus)', () => {
    const h = ladeEntwurfsHelfer({ store: undefined, dialog: fakeDialog({ home: '3' }) });
    expect(() => h.stashPendingResultInput()).not.toThrow();
    expect(h.readPendingResultInput()).toBeNull();
  });
});

describe('Verdrahtung: der Fix haengt wirklich am Sitzungsende', () => {
  it('main.js meldet einen Horcher an', () => {
    expect(mainSrc).toContain('onSessionExpired(');
    expect(mainSrc).toContain('handleSessionExpired()');
  });

  it('die Meldung sichert die Eingaben, BEVOR sie den Neu-Anmeldeweg anbietet', () => {
    const fn = schneideMain('handleSessionExpired');
    const stashAb = fn.indexOf('stashPendingResultInput()');
    const dialogAb = fn.indexOf('showConfirmDlg');
    expect(stashAb).toBeGreaterThan(-1);
    expect(dialogAb).toBeGreaterThan(-1);
    expect(stashAb, 'erst sichern, dann fragen').toBeLessThan(dialogAb);
  });

  it('umgeleitet wird nur nach Zustimmung', () => {
    const fn = schneideMain('handleSessionExpired');
    expect(fn).toMatch(/if \(ok\) await forceReauth\(\);/);
  });

  it('der Ergebnis-Dialog holt gesicherte Werte beim Oeffnen zurueck', () => {
    expect(mainSrc).toContain('restorePendingResultInput(dlg, tournamentId);');
  });

  it('erfolgreiches Speichern raeumt den Entwurf weg', () => {
    expect(mainSrc).toContain('clearPendingResultInput();');
  });
});
