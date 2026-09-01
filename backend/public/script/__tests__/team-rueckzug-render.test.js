/**
 * Tests für den Rückzugs-Knopf in der Teams-Liste (2026-09-01).
 *
 * Fachlicher Hintergrund: Ein Team sagt vor dem Turnier ab und soll
 * vollständig verschwinden. Der Knopf dafür darf nur erscheinen, wenn der
 * Aufrufer ihn ausdrücklich erlaubt — die Sperre kommt aus `locks.js`, der
 * Renderer entscheidet sie nicht selbst.
 *
 * Was hier geprüft wird:
 *   - `canWithdraw: false` → gar kein Knopf im Markup
 *   - `canWithdraw: true`  → genau ein Knopf je Team, mit der richtigen teamId
 *   - Nicht-Admin        → weder Knopf noch Sperrgrund (Members geht der
 *                          Rückzug nichts an)
 *   - Admin + gesperrt   → der Grund steht im Markup, sichtbar BEVOR jemand
 *                          klickt (Hausregel: Begründung neben das gesperrte
 *                          Bedienelement, nicht in den Fehler-Toast danach)
 */

import { describe, it, expect } from 'vitest';
import { renderTeamsList } from '../spielplan-helpers.js';

const teams = [
  { id: 't-a', name: 'Team Alpha', color: '#112233', seed: 0 },
  { id: 't-b', name: 'Team Beta', color: null, seed: 1 },
  { id: 't-c', name: 'Team Gamma', color: null, seed: 2 },
];

/** Zählt Vorkommen eines Teilstrings — `includes` reicht hier nicht,
 *  weil „genau einer je Team" eine Zahl ist, keine Ja/Nein-Frage. */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const SPERRGRUND = 'Turnier läuft bereits.';

describe('renderTeamsList — Rückzugs-Knopf', () => {
  it('canWithdraw: false → kein data-action="withdraw-team" im Markup', () => {
    const html = renderTeamsList(teams, {
      isAdmin: true,
      reorderable: true,
      canWithdraw: false,
    });
    expect(html).not.toContain('data-action="withdraw-team"');
    // Die Liste selbst muss trotzdem stehen — sonst prüft der Test nur,
    // dass der Renderer nichts gerendert hat.
    expect(html).toContain('data-role="teams-list"');
    expect(html).toContain('Team Alpha');
  });

  it('canWithdraw: true → genau ein Knopf je Team mit korrekter teamId', () => {
    const html = renderTeamsList(teams, {
      isAdmin: true,
      reorderable: true,
      canWithdraw: true,
    });
    expect(count(html, 'data-action="withdraw-team"')).toBe(teams.length);
    for (const t of teams) {
      expect(html).toContain(`data-action="withdraw-team" data-team-id="${t.id}"`);
    }
  });

  it('Nicht-Admin sieht weder Knopf noch Sperrgrund', () => {
    const html = renderTeamsList(teams, {
      isAdmin: false,
      reorderable: false,
      canWithdraw: false,
      withdrawLockReason: SPERRGRUND,
    });
    expect(html).not.toContain('data-action="withdraw-team"');
    expect(html).not.toContain(SPERRGRUND);
    expect(html).not.toContain('withdraw-lock-reason');
  });

  it('Admin + gesperrt → der Sperrgrund steht im Markup, ohne Knopf', () => {
    const html = renderTeamsList(teams, {
      isAdmin: true,
      reorderable: false,
      canWithdraw: false,
      withdrawLockReason: SPERRGRUND,
    });
    expect(html).toContain('data-role="withdraw-lock-reason"');
    expect(html).toContain(SPERRGRUND);
    expect(html).not.toContain('data-action="withdraw-team"');
  });

  it('Erlaubter Rückzug zeigt keinen Sperrgrund (kein Hinweis auf Vorrat)', () => {
    const html = renderTeamsList(teams, {
      isAdmin: true,
      reorderable: true,
      canWithdraw: true,
      withdrawLockReason: SPERRGRUND,
    });
    expect(html).not.toContain('withdraw-lock-reason');
    expect(html).not.toContain(SPERRGRUND);
  });

  it('XSS: Teamname im aria-label des Knopfes wird escaped', () => {
    const html = renderTeamsList([{ id: 'x', name: '<img src=x onerror=1>', seed: 0 }], {
      isAdmin: true,
      reorderable: true,
      canWithdraw: true,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  // Die Klasse ist keine Kosmetik: `.t-team-row` deklariert vier
  // Grid-Spalten, der Knopf waere das fuenfte Kind. `has-withdraw`
  // schaltet die fuenfte Spalte frei — fehlt sie, landet der Knopf in
  // einer impliziten Spalte, die nie durchgerechnet wurde. Und Listen
  // OHNE Knopf duerfen sie nicht tragen, sonst schleppen sie eine leere
  // Spalte samt `gap` mit.
  it('Die Liste traegt has-withdraw genau dann, wenn es Knoepfe gibt', () => {
    const mit = renderTeamsList(teams, { isAdmin: true, reorderable: true, canWithdraw: true });
    expect(mit).toContain('has-withdraw');

    const ohne = renderTeamsList(teams, { isAdmin: true, reorderable: true, canWithdraw: false });
    expect(ohne).not.toContain('has-withdraw');
    expect(ohne).toContain('t-teams-list');
  });
});
