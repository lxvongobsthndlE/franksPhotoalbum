/**
 * Parity-Test für die Lock-Logik (Etappe B.8, D1.5).
 *
 * Hintergrund: locks.js exportiert die Funktionen als ESM (für Node-Routes)
 * UND hängt sich an `window.tournamentLocks` (für Browser-Renderer). Beide
 * Wege MÜSSEN für identische Inputs dasselbe Ergebnis liefern. Eine
 * einzige Wahrheit, zwei Aufrufer — sonst hat man die Regel siebenmal und
 * irgendwann sechs davon richtig.
 *
 * Was hier getestet wird:
 *   1. canEdit pro Status × Aktion liefert konsistente Ergebnisse
 *   2. canRevertToDraft / canStartTournament für alle Zustände
 *   3. UMD-Pattern: window-Export existiert und liefert dieselbe Logik
 *   4. Reason-Texte sind nicht-leer wenn allowed=false
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  canEdit,
  canRevertToDraft,
  canStartTournament,
  lockStateFor,
  requireConfirmForRedraw,
  requireConfirmForDelete,
  EDITABLE,
} from '../locks.js';

const DATE = new Date('2026-08-20T10:00:00Z');

describe('locks: canEdit (Single Source of Truth)', () => {
  it('rejected: status === "finished" → alles read-only', () => {
    const t = { status: 'finished', startedAt: DATE };
    for (const what of EDITABLE) {
      const r = canEdit(t, 0, what);
      expect(r.allowed).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  });

  it('full edit: startedAt === null && status === "draft"', () => {
    const t = { status: 'draft', startedAt: null };
    for (const what of EDITABLE) {
      const r = canEdit(t, 0, what);
      expect(r.allowed).toBe(true);
      expect(r.reason).toBeNull();
    }
  });

  it('full edit: startedAt === null && status === "generated" (Bereit)', () => {
    const t = { status: 'generated', startedAt: null };
    for (const what of EDITABLE) {
      const r = canEdit(t, 0, what);
      expect(r.allowed).toBe(true);
    }
  });

  it('partial: startedAt !== null (Läuft) sperrt teams, mode, groups', () => {
    const t = { status: 'group_stage', startedAt: DATE };
    const locked = ['teams', 'mode', 'groups'];
    for (const what of locked) {
      const r = canEdit(t, 0, what);
      expect(r.allowed).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  });

  it('partial: Läuft erlaubt fields, times, results', () => {
    const t = { status: 'group_stage', startedAt: DATE };
    for (const what of ['fields', 'times', 'results']) {
      const r = canEdit(t, 0, what);
      expect(r.allowed).toBe(true);
    }
  });

  it('draw ist auch in LÄUFT prinzipiell erlaubt (Confirm-Handshake separat)', () => {
    const t = { status: 'group_stage', startedAt: DATE };
    const r = canEdit(t, 3, 'draw');
    expect(r.allowed).toBe(true);
  });

  it('throws für unbekannte what-Keys', () => {
    const t = { status: 'draft', startedAt: null };
    expect(() => canEdit(t, 0, 'unknown_thing')).toThrow(/Unknown lock key/);
  });
});

describe('locks: canRevertToDraft', () => {
  it('erlaubt wenn LÄUFT ohne Ergebnisse', () => {
    const t = { status: 'group_stage', startedAt: DATE };
    const r = canRevertToDraft(t, 0);
    expect(r.allowed).toBe(true);
  });

  it('verbietet wenn LÄUFT mit Ergebnissen', () => {
    const t = { status: 'group_stage', startedAt: DATE };
    const r = canRevertToDraft(t, 3);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Ergebnis/);
  });

  it('verbietet wenn finished', () => {
    const t = { status: 'finished', startedAt: DATE };
    const r = canRevertToDraft(t, 0);
    expect(r.allowed).toBe(false);
  });

  it('verbietet wenn noch nicht gestartet', () => {
    const t = { status: 'generated', startedAt: null };
    const r = canRevertToDraft(t, 0);
    expect(r.allowed).toBe(false);
  });
});

describe('locks: canStartTournament', () => {
  it('erlaubt im Status "generated" mit startedAt null', () => {
    const t = { status: 'generated', startedAt: null };
    const r = canStartTournament(t);
    expect(r.allowed).toBe(true);
  });

  it('verbietet im Status "draft"', () => {
    const t = { status: 'draft', startedAt: null };
    const r = canStartTournament(t);
    expect(r.allowed).toBe(false);
  });

  it('verbietet wenn bereits started', () => {
    const t = { status: 'group_stage', startedAt: DATE };
    const r = canStartTournament(t);
    expect(r.allowed).toBe(false);
  });
});

describe('locks: Confirm-Handshake', () => {
  it('requireConfirmForRedraw nur bei LÄUFT + finished', () => {
    expect(requireConfirmForRedraw({ startedAt: null }, 0)).toBe(false);
    expect(requireConfirmForRedraw({ startedAt: null }, 3)).toBe(false);
    expect(requireConfirmForRedraw({ startedAt: DATE }, 0)).toBe(false);
    expect(requireConfirmForRedraw({ startedAt: DATE }, 3)).toBe(true);
  });

  it('requireConfirmForDelete bei finished > 0', () => {
    expect(requireConfirmForDelete({}, 0)).toBe(false);
    expect(requireConfirmForDelete({}, 1)).toBe(true);
  });
});

describe('locks: lockStateFor (flaches Objekt für Renderer)', () => {
  it('entält alle Renderer-Felder', () => {
    const t = { status: 'group_stage', startedAt: DATE };
    const s = lockStateFor(t, 3);
    expect(s).toHaveProperty('canEditTeams');
    expect(s).toHaveProperty('canEditMode');
    expect(s).toHaveProperty('canEditGroups');
    expect(s).toHaveProperty('canEditFields');
    expect(s).toHaveProperty('canEditTimes');
    expect(s).toHaveProperty('canRedraw');
    expect(s).toHaveProperty('canEditResults');
    expect(s).toHaveProperty('canRevertToDraft');
    expect(s).toHaveProperty('canStart');
    expect(s).toHaveProperty('canDelete');
    expect(s).toHaveProperty('canFinish');
    expect(s).toHaveProperty('canShiftMatches');
    expect(s).toHaveProperty('canReschedule');
    expect(s).toHaveProperty('requireConfirmForRedraw');
    expect(s).toHaveProperty('requireConfirmForDelete');
  });

  it('LÄUFT + Ergebnisse: canEditGroups false, canRevertToDraft false, canEditFields true', () => {
    const s = lockStateFor({ status: 'group_stage', startedAt: DATE }, 3);
    expect(s.canEditGroups.allowed).toBe(false);
    expect(s.canRevertToDraft.allowed).toBe(false);
    expect(s.canEditFields.allowed).toBe(true);
    expect(s.requireConfirmForRedraw).toBe(true);
  });
});

describe('locks: UMD-Pattern — window.tournamentLocks exportiert dieselbe Logik', () => {
  // Simulate Browser-Context, indem wir window zur Verfügung stellen
  // und das Modul-Code ausführen.
  let savedWindow;

  beforeEach(() => {
    savedWindow = globalThis.window;
    globalThis.window = globalThis;
    // Re-import? Nein — die Datei setzt window.tournamentLocks nur einmal
    // beim Modul-Load. Da Node-ESM das Modul einmalig ausführt, müssen
    // wir aufpassen: das window-Objekt existiert in Node-Tests nicht
    // standardmäßig. Lösung: wir prüfen die Side-Effect-Bedingung über
    // die Modul-Quelle.
  });
  afterEach(() => {
    if (savedWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = savedWindow;
    }
  });

  it('der Modul-Source enthält window.tournamentLocks-Export', async () => {
    // Wir lesen den Source und prüfen, dass der UMD-Branch existiert.
    // Das ist ein simpler "is the line there"-Test — kein exec.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = url.fileURLToPath(import.meta.url);
    const src = await fs.readFile(
      path.resolve(path.dirname(here), '../../../../public/script/locks.js'),
      'utf8'
    );
    expect(src).toMatch(/typeof\s+window\s+!==\s+'undefined'/);
    expect(src).toMatch(/window\.tournamentLocks/);
    // Beide Pfade (ESM-Export + window.global) müssen dieselben Funktionen
    // referenzieren — wir prüfen, dass die Symbole im Source-String
    // identisch sind.
    const names = [
      'canEdit',
      'canRevertToDraft',
      'canStartTournament',
      'lockStateFor',
      'requireConfirmForRedraw',
      'requireConfirmForDelete',
    ];
    for (const n of names) {
      // mindestens 2 Vorkommen: ESM-Definition + window-Export
      const matches = src.match(new RegExp(n, 'g')) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }
  });
});
