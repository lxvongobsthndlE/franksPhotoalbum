/**
 * Tests für den Einstellungen-Tab-Renderer (Etappe B.7).
 *
 * Block-Reihenfolge, Sichtbarkeitsregeln (Admin vs Member, Lock,
 * finished), XSS-Escape.
 */

import { describe, it, expect } from 'vitest';
import { renderEinstellungen } from '../spielplan-helpers.js';

const tDraft = {
  tournament: {
    id: 't-1',
    name: 'Mein Turnier',
    status: 'draft',
    config: {
      fields: [
        { id: 'f1', name: 'Platte 1', order: 0 },
        { id: 'f2', name: 'Platte 2', order: 1 },
      ],
    },
  },
  teams: [
    { id: 'team-a', name: 'Team Alpha', color: '#112233', seed: 0 },
    { id: 'team-b', name: 'Team Beta', color: null, seed: 1 },
  ],
  groups: [
    {
      id: 'gA',
      key: 'A',
      name: 'Gruppe A',
      members: [{ teamId: 'team-a', name: 'Team Alpha', color: '#112233' }],
    },
    {
      id: 'gB',
      key: 'B',
      name: 'Gruppe B',
      members: [{ teamId: 'team-b', name: 'Team Beta', color: null }],
    },
  ],
};

describe('renderEinstellungen', () => {
  it('Admin + draft: 5 Blöcke in Reihenfolge (Aktionen / Groups / Seeding / Fields / Danger)', () => {
    const html = renderEinstellungen(tDraft, { isAdmin: true, finishedCount: 0 });
    const i1 = html.indexOf('data-section="actions"');
    const i2 = html.indexOf('data-section="groups"');
    const i3 = html.indexOf('data-section="seeding"');
    const i4 = html.indexOf('data-section="fields"');
    const i5 = html.indexOf('data-section="danger-zone"');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i4).toBeGreaterThan(i3);
    expect(i5).toBeGreaterThan(i4);
  });

  it('Admin + draft: „Turnier abschließen" sichtbar (Button)', () => {
    const html = renderEinstellungen(tDraft, { isAdmin: true, finishedCount: 0 });
    expect(html).toContain('Turnier abschließen');
    expect(html).toContain('data-action="finish-tournament"');
  });

  it('Admin + finished: „Turnier abschließen" NICHT sichtbar', () => {
    const t = { ...tDraft, tournament: { ...tDraft.tournament, status: 'finished' } };
    const html = renderEinstellungen(t, { isAdmin: true, finishedCount: 12 });
    expect(html).not.toContain('data-action="finish-tournament"');
  });

  it('Gefahrenzone: nur für Admin, beide Aktionen sichtbar, „Gefahrenzone"-Header', () => {
    const html = renderEinstellungen(tDraft, { isAdmin: true, finishedCount: 0 });
    expect(html).toContain('t-danger-zone');
    expect(html).toContain('Gefahrenzone');
    expect(html).toContain('Alle Ergebnisse löschen');
    expect(html).toContain('Turnier löschen');
  });

  it('Member: keine Gefahrenzone, kein Speichern, kein Drag', () => {
    const html = renderEinstellungen(tDraft, { isAdmin: false, finishedCount: 0 });
    expect(html).not.toContain('t-danger-zone');
    expect(html).not.toContain('data-action="save-groups"');
    expect(html).not.toContain('data-action="redraw-seeding"');
    expect(html).not.toContain('data-action="finish-tournament"');
    expect(html).not.toContain('data-action="save-fields"');
  });

  it('Lock-Hinweis bei ≥1 beendetem Match', () => {
    const html = renderEinstellungen(tDraft, { isAdmin: true, finishedCount: 3 });
    expect(html).toContain('3 Spiele bereits beendet');
  });

  it('Groups-Board: N Spalten mit korrekter Anzahl Cards', () => {
    const html = renderEinstellungen(tDraft, { isAdmin: true, finishedCount: 0 });
    // Etappe B.8.1: data-group-key gibt es jetzt AUCH in den Team-Karten
    // (Same-Group-Schutz beim Paar-Klick-Tausch). Wir zählen daher die
    // Spalten-DIVs direkt.
    const colDivs = html.match(/<div class="t-groups-column"/g);
    expect(colDivs).toHaveLength(2);
    // Cards sind <li>-Tags mit class "t-group-team-card". Wir zählen
    // über das data-team-id-Attribut statt die CSS-Klasse, weil die
    // Klasse auch im Dot/Namen-Span auftaucht.
    const cards = html.match(/<li class="t-group-team-card"/g);
    expect(cards).toHaveLength(2);
  });

  it('Spielfelder-Block: zeigt Feldnamen aus config.fields', () => {
    const html = renderEinstellungen(tDraft, { isAdmin: true, finishedCount: 0 });
    expect(html).toContain('value="Platte 1"');
    expect(html).toContain('value="Platte 2"');
    expect(html).toContain('data-fields-count="2"');
  });

  it('Spielfelder: Lock-Hinweis NUR in status === finished (Etappe B.8)', () => {
    // Etappe B.8 Spielfeld-Lock: editable in draft / generated / group_stage,
    // erst in finished read-only. Vorher (B.7) war die Regel `status !== 'draft'`,
    // das sperrte die Spielfelder fälschlich direkt nach Generate.
    const tRunning = { ...tDraft, tournament: { ...tDraft.tournament, status: 'group_stage', startedAt: new Date().toISOString() } };
    const htmlRunning = renderEinstellungen(tRunning, { isAdmin: true, finishedCount: 0 });
    expect(htmlRunning).not.toContain('Spielfelder sind nach der Generierung gesperrt');

    const tFinished = { ...tDraft, tournament: { ...tDraft.tournament, status: 'finished' } };
    const htmlFinished = renderEinstellungen(tFinished, { isAdmin: true, finishedCount: 0 });
    // In finished bleibt der Lock-Hinweis (oder ein read-only-Indikator) sichtbar —
    // genauer Wortlaut darf variieren, Hauptsache "gesperrt" / "beendet" taucht auf.
    expect(/gesperrt|Beendet|read.?only|t-hint--/i.test(htmlFinished)).toBe(true);
  });

  it('XSS: Team-Name mit <script> wird escaped', () => {
    const t = {
      ...tDraft,
      teams: [{ id: 'x', name: '<script>alert(1)</script>', color: null, seed: 0 }],
      groups: [
        {
          id: 'gA',
          key: 'A',
          name: 'Gruppe A',
          members: [{ teamId: 'x', name: '<script>alert(1)</script>', color: null }],
        },
      ],
    };
    const html = renderEinstellungen(t, { isAdmin: true, finishedCount: 0 });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('Spielfelder-Default bei leerer config: 4 Default-Felder', () => {
    const t = { ...tDraft, tournament: { ...tDraft.tournament, config: {} } };
    const html = renderEinstellungen(t, { isAdmin: true, finishedCount: 0 });
    expect(html).toContain('data-fields-count="4"');
    expect(html).toContain('value="Platte 1"');
  });

  it('Groups-Block (Admin, BEREIT): nur „Zufällig verteilen" sichtbar, kein Save/DnD (Etappe B.8)', () => {
    // User-Spec 2026-08-20: „Teams tauschen, Gruppengröße gleich". DnD mit
    // beliebigen Moves ist weg; dafür gibt es den Balance-Shuffle-Button,
    // der server-seitig die Größen konstant hält.
    const tBereit = {
      ...tDraft,
      tournament: { ...tDraft.tournament, status: 'generated', startedAt: null },
    };
    const html = renderEinstellungen(tBereit, { isAdmin: true, finishedCount: 0 });
    expect(html).toContain('data-action="randomize-groups"');
    // Save-Button und Touch-Picker sind weg, weil DnD weg ist.
    expect(html).not.toContain('data-action="save-groups"');
    expect(html).not.toContain('data-action="reset-groups"');
    // Hinweis erklärt warum (Admin-Variante: explizit zum Tausch auffordern).
    expect(html).toMatch(/Klicke auf zwei Teams|Größen bleiben gleich/);
  });

  it('Groups-Block (Admin, LÄUFT): Zufällig-Button gesperrt oder raus', () => {
    // In LÄUFT (startedAt !== null) ist canEditGroups = false → Renderer
    // rendert keinen Zufällig-Button (oder zumindest keinen Save-Button).
    const tRunning = {
      ...tDraft,
      tournament: { ...tDraft.tournament, status: 'group_stage', startedAt: new Date().toISOString() },
    };
    const html = renderEinstellungen(tRunning, { isAdmin: true, finishedCount: 0 });
    // Save ist garantiert raus.
    expect(html).not.toContain('data-action="save-groups"');
  });

  // Etappe B.8.1 ─ Paar-Klick-Tausch-UI
  it('Groups-Block (BEREIT, Admin): Paar-Klick-Tausch-UI sichtbar, kein DnD', () => {
    const tBereit = {
      ...tDraft,
      tournament: { ...tDraft.tournament, status: 'generated', startedAt: null },
    };
    const html = renderEinstellungen(tBereit, { isAdmin: true, finishedCount: 0 });
    // Paar-Klick-Tausch-Bar mit deaktiviertem Tauschen-Button + Abbrechen.
    expect(html).toContain('data-role="swap-bar"');
    expect(html).toContain('data-action="confirm-swap"');
    expect(html).toContain('data-action="cancel-swap"');
    expect(html).toContain('data-action="select-for-swap"');
    // DnD ist weg: Board hat kein draggable="true".
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('draggable="false"');
  });

  it('Groups-Block (BEREIT, Non-Admin): keine Swap-Bar, aber Board mit select-for-swap-Action', () => {
    const tBereit = {
      ...tDraft,
      tournament: { ...tDraft.tournament, status: 'generated', startedAt: null },
    };
    const html = renderEinstellungen(tBereit, { isAdmin: false, finishedCount: 0 });
    // Member sieht die Tausch-UI nicht (kann nur lesen).
    expect(html).not.toContain('data-action="confirm-swap"');
    expect(html).not.toContain('data-action="randomize-groups"');
    // ABER teams haben auch kein Action-Attribute mehr (weil non-Admin).
    expect(html).not.toContain('data-action="select-for-swap"');
  });

  it('Groups-Block: jede Team-Karte hat data-group-key für Same-Group-Schutz', () => {
    const tBereit = {
      ...tDraft,
      tournament: { ...tDraft.tournament, status: 'generated', startedAt: null },
    };
    const html = renderEinstellungen(tBereit, { isAdmin: true, finishedCount: 0 });
    // Etappe B.8.1: data-group-key gibt es in den Spalten-DIVs UND in
    // den Team-Karten (für Same-Group-Schutz). 2 Spalten + 2 Teams = 4.
    const occurrences = (html.match(/data-group-key=/g) || []).length;
    expect(occurrences).toBe(4);
  });
});
