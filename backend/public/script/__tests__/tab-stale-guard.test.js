/**
 * Betriebsfestigkeit A4 (2026-08-25): Stale-Guard in den Tab-Ladern.
 *
 * Fehlerklasse
 * ------------
 *   `loadStandingsTab` und `loadBracketTab` schrieben nach ihrem
 *   `await apiCall(...)` bedingungslos in den Mount. Zwischen Absenden
 *   und Antwort kann der Nutzer laengst woanders stehen:
 *
 *       Turnier A oeffnen → Gruppen-Tab → schnell zurueck → Turnier B
 *       → die Antwort von A trifft ein → Tabelle von A steht in B.
 *
 *   Am Turniertag ist das nicht kosmetisch: die Tabelle sieht echt aus,
 *   traegt aber fremde Zahlen. Der Guard
 *   `activeTournamentInstance?.id === instanceId` stand an sechs
 *   anderen Stellen im File und fehlte genau hier.
 *
 * Was der Test prueft
 * -------------------
 *   1. VERHALTEN: der Guard-Ausdruck wird aus dem Quelltext gelesen und
 *      gegen beide Faelle ausgefuehrt (gleiches Turnier / gewechselt).
 *   2. STRUKTUR: acorn — jede Stelle, die nach einem `await` in einen
 *      Tab-Mount schreibt, liegt hinter dem Guard.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as acorn from 'acorn';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAIN = path.resolve(__dirname, '..', 'main.js');
const src = fs.readFileSync(MAIN, 'utf-8');
const zeilen = src.split(/\r?\n/);
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module', locations: true });

const GUARD = 'if (activeTournamentInstance?.id !== tournamentId) return;';

describe('Der Guard selbst tut, was er soll', () => {
  // Der Ausdruck wird nicht abgeschrieben, sondern aus main.js gelesen —
  // sonst prueft der Test seine eigene Kopie.
  const steht = zeilen.some((l) => l.trim() === GUARD);

  it('steht woertlich in main.js', () => {
    expect(steht, `erwartete Zeile fehlt: ${GUARD}`).toBe(true);
  });

  const baue = () => {
    // eslint-disable-next-line no-new-func
    return new Function('activeTournamentInstance', 'tournamentId', `${GUARD}\nreturn 'gemalt';`);
  };

  it('laesst durch, solange dasselbe Turnier offen ist', () => {
    expect(baue()({ id: 'A' }, 'A')).toBe('gemalt');
  });

  it('bricht ab, wenn der Nutzer inzwischen in einem anderen Turnier steht', () => {
    expect(baue()({ id: 'B' }, 'A')).toBeUndefined();
  });

  it('bricht ab, wenn gar kein Turnier mehr offen ist (Liste, Logout)', () => {
    expect(baue()(null, 'A')).toBeUndefined();
    expect(baue()(undefined, 'A')).toBeUndefined();
  });
});

// ── Struktur ─────────────────────────────────────────────────────────
function funktion(name) {
  let treffer = null;
  const suche = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) {
      treffer = node;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (const c of v) suche(c);
      } else suche(v);
    }
  };
  suche(ast);
  if (!treffer) throw new Error(`${name} nicht gefunden`);
  return treffer;
}

/**
 * Die drei Stellen, die nach einer Wartezeit in einen Tab-Mount malen.
 * `loadTeamsTab` steht bewusst NICHT dabei: sie rendert aus `t.teams`
 * ohne eigenen Fetch, hat also kein `await` zwischen Entscheid und
 * Schreiben — dort gaebe es nichts zu bewachen (gemessen 2026-08-25).
 */
const BEWACHTE_LADER = ['loadStandingsTab', 'loadBracketTab', 'refreshStandingsTab'];

describe('Struktur: jeder Tab-Lader bewacht seinen Mount', () => {
  for (const name of BEWACHTE_LADER) {
    it(`${name} prueft vor dem Schreiben, ob das Turnier noch offen ist`, () => {
      const fn = funktion(name);
      const koerper = src.slice(fn.start, fn.end);
      expect(koerper, `${name} schreibt ohne Stale-Guard in den Mount`).toContain(GUARD);
    });
  }

  it('loadStandingsTab bewacht auch den Fehlerzweig', () => {
    // Sonst legt eine spaet eintreffende Absage von Turnier A ein
    // „Tabellen konnten nicht geladen werden" ueber Turnier B.
    const koerper = src.slice(funktion('loadStandingsTab').start, funktion('loadStandingsTab').end);
    const nachCatch = koerper.slice(koerper.lastIndexOf('} catch'));
    expect(nachCatch).toContain(GUARD);
  });

  it('loadBracketTab bewacht auch den Fehlerzweig', () => {
    const koerper = src.slice(funktion('loadBracketTab').start, funktion('loadBracketTab').end);
    const nachCatch = koerper.slice(koerper.lastIndexOf('} catch'));
    expect(nachCatch).toContain(GUARD);
  });

  it('der Guard steht VOR dem ersten Schreiben in den Mount', () => {
    for (const name of ['loadStandingsTab', 'loadBracketTab']) {
      const fn = funktion(name);
      const koerper = src.slice(fn.start, fn.end);
      // Erstes `mount.innerHTML` nach dem ersten `await apiCall`.
      const nachFetch = koerper.indexOf('await apiCall');
      expect(nachFetch, `${name}: kein apiCall gefunden`).toBeGreaterThan(-1);
      const guardAb = koerper.indexOf(GUARD, nachFetch);
      const schreibenAb = koerper.indexOf('mount.innerHTML', nachFetch);
      expect(guardAb, `${name}: Guard fehlt nach dem Fetch`).toBeGreaterThan(-1);
      expect(schreibenAb, `${name}: kein Schreiben nach dem Fetch`).toBeGreaterThan(-1);
      expect(guardAb, `${name}: Guard steht hinter dem ersten Schreiben — nutzlos`).toBeLessThan(
        schreibenAb
      );
    }
  });
});
