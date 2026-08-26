/**
 * Tests für Teams-Tab Pure-Functions (Etappe B.5).
 *
 * Renderer + Serializer leben in spielplan-helpers.js, damit sie ohne
 * DOM-Mock getestet werden können. main.js ruft sie via
 * `window.spielplanHelpers.renderTeamsList(...)` auf.
 *
 * Was wir hier prüfen:
 *   - serializeTeamsList: Sanitizing + Sortierung
 *   - renderTeamsList: Admin vs Member, Reorderable vs locked, leerer Zustand
 */

import { describe, it, expect } from 'vitest';
import { serializeTeamsList, renderTeamsList } from '../spielplan-helpers.js';

const fixtureRaw = [
  { id: 't-a', name: 'Team Alpha', color: '#112233', seed: 2 },
  { id: 't-b', name: '  Team Beta  ', color: '  #445566  ', seed: 0 },
  { id: 't-c', name: 'Team Gamma', color: null, seed: 1 },
  { id: 't-d', name: '', color: '#aa00aa', seed: 3 }, // leerer Name → Fallback
];

describe('serializeTeamsList', () => {
  it('gibt leeres Array für non-Array-Input zurück', () => {
    expect(serializeTeamsList(null)).toEqual([]);
    expect(serializeTeamsList(undefined)).toEqual([]);
    expect(serializeTeamsList('foo')).toEqual([]);
  });

  it('trimmt Namen und entfernt Whitespace-Farben', () => {
    const out = serializeTeamsList(fixtureRaw);
    const b = out.find((t) => t.id === 't-b');
    expect(b.name).toBe('Team Beta');
    expect(b.color).toBe('#445566');
  });

  it('leerer Name wird zu "Team" (Render-Fallback)', () => {
    const out = serializeTeamsList(fixtureRaw);
    const d = out.find((t) => t.id === 't-d');
    expect(d.name).toBe('Team');
  });

  it('null-Farbe bleibt null', () => {
    const out = serializeTeamsList(fixtureRaw);
    const c = out.find((t) => t.id === 't-c');
    expect(c.color).toBeNull();
  });

  it('filtert null/undefined Items raus', () => {
    const out = serializeTeamsList([{ id: 'x', name: 'X', seed: 0 }, null, undefined]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('x');
  });

  it('sortiert nach seed asc', () => {
    const out = serializeTeamsList(fixtureRaw);
    expect(out.map((t) => t.id)).toEqual(['t-b', 't-c', 't-a', 't-d']);
  });

  it('vergibt Default-Seed = Index wenn seed fehlt', () => {
    const out = serializeTeamsList([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    expect(out[0].seed).toBe(0);
    expect(out[1].seed).toBe(1);
  });
});

describe('renderTeamsList', () => {
  it('zeigt Empty-Hint bei leerer Liste', () => {
    const html = renderTeamsList([], { isAdmin: true, reorderable: true });
    expect(html).toContain('Noch keine Teams');
  });

  it('zeigt Empty-Hint auch bei null', () => {
    const html = renderTeamsList(null, { isAdmin: true });
    expect(html).toContain('Noch keine Teams');
  });

  it('rendert eine ul.t-teams-list mit korrekter Anzahl <li>', () => {
    const html = renderTeamsList(fixtureRaw, { isAdmin: true, reorderable: true });
    const lis = html.match(/<li class="t-team-row/g);
    expect(lis).toHaveLength(4);
  });

  it('Admin + reorderable: ul hat is-draggable, Rows auch', () => {
    const html = renderTeamsList(fixtureRaw, { isAdmin: true, reorderable: true });
    expect(html).toContain('class="t-teams-list is-draggable"');
    expect(html).toContain('class="t-team-row is-draggable"');
  });

  it('Admin + locked (Status !== draft): kein is-draggable, Hinweis sichtbar', () => {
    const html = renderTeamsList(fixtureRaw, { isAdmin: true, reorderable: false });
    expect(html).not.toContain('is-draggable');
    expect(html).toContain('gesperrt');
    expect(html).toContain('Spielplan');
  });

  it('Member (kein Admin): kein is-draggable, Member-Hinweis sichtbar', () => {
    const html = renderTeamsList(fixtureRaw, { isAdmin: false, reorderable: false });
    expect(html).not.toContain('is-draggable');
    expect(html).toContain('Nur Admins');
  });

  it('jede Row hat data-team-id, data-team-name, data-seed', () => {
    const html = renderTeamsList(fixtureRaw, { isAdmin: true, reorderable: true });
    expect(html).toContain('data-team-id="t-a"');
    expect(html).toContain('data-team-name="Team Alpha"');
    expect(html).toContain('data-seed="2"');
  });

  it('DnD-Handle nur sichtbar/gerendert wenn Admin+reorderable', () => {
    const adminHtml = renderTeamsList(fixtureRaw, { isAdmin: true, reorderable: true });
    const memberHtml = renderTeamsList(fixtureRaw, { isAdmin: false, reorderable: false });
    // Admin bekommt das Handle-Span (mit ☰-Glyph), Member bekommt einen
    // leeren is-readonly-Platzhalter (für Layout-Stabilität).
    expect(adminHtml).toContain('t-team-drag-handle');
    expect(adminHtml).toContain('☰');
    expect(memberHtml).toContain('t-team-drag-handle is-readonly');
    expect(memberHtml).not.toContain('☰');
  });

  it('Edit-Hint nur sichtbar wenn Admin+reorderable', () => {
    const adminHtml = renderTeamsList(fixtureRaw, { isAdmin: true, reorderable: true });
    const memberHtml = renderTeamsList(fixtureRaw, { isAdmin: false, reorderable: false });
    expect(adminHtml).toContain('Klicken zum Umbenennen');
    expect(memberHtml).not.toContain('Klicken zum Umbenennen');
  });

  it('Farbiger Marker mit Initial für jedes Team', () => {
    const html = renderTeamsList(fixtureRaw, { isAdmin: true, reorderable: true });
    expect(html).toContain('style="background:#112233;color:#fff;"');
    expect(html).toContain('>T<'); // Initial "T" für "Team Alpha" (erstes nicht-leeres Zeichen)
  });

  it('XSS: <script> im Namen wird escaped', () => {
    const html = renderTeamsList([{ id: 'x', name: '<script>alert(1)</script>', seed: 0 }], {
      isAdmin: true,
      reorderable: true,
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('Seed-Label #1, #2, #3, … erscheint in der Reihenfolge', () => {
    const html = renderTeamsList(fixtureRaw, { isAdmin: true, reorderable: true });
    // Sortiert: t-b(0), t-c(1), t-a(2), t-d(3)
    expect(html).toContain('<span class="t-team-seed">#1</span>');
    expect(html).toContain('<span class="t-team-seed">#4</span>');
  });
});
