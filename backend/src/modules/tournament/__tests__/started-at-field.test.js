/**
 * Tests für startedAt im DTO (Etappe B.8).
 *
 * Das DTO muss `startedAt` durchreichen, damit Frontend-Renderer und
 * Backend-Routes die Lock-Logik auf einheitliche Felder anwenden können.
 *
 * `startedAtShort` ist die formatierte Variante für die Anzeige.
 */

import { describe, expect, it } from 'vitest';
import { prepareTournamentView } from '../access/tournament.js';

describe('DTO: startedAt (Etappe B.8)', () => {
  it('startedAt ist null für draft', () => {
    const v = prepareTournamentView({
      id: 't-1',
      groupId: 'g-1',
      name: 'T',
      mode: 'groups_ko',
      status: 'draft',
      createdById: 'u-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(v.startedAt).toBeNull();
  });

  it('startedAt ist null für "generated" ohne Start', () => {
    const v = prepareTournamentView({
      id: 't-1',
      groupId: 'g-1',
      name: 'T',
      mode: 'groups_ko',
      status: 'generated',
      startedAt: null,
      createdById: 'u-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(v.startedAt).toBeNull();
  });

  it('startedAt ist Date-Objekt für gestartete Turniere', () => {
    const at = new Date('2026-08-20T10:00:00Z');
    const v = prepareTournamentView({
      id: 't-1',
      groupId: 'g-1',
      name: 'T',
      mode: 'groups_ko',
      status: 'group_stage',
      startedAt: at,
      createdById: 'u-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(v.startedAt).toEqual(at);
    expect(v.startedAtShort).toBeTruthy();
  });

  it('startedAt null wenn startedAt-Feld fehlt (alt)', () => {
    const v = prepareTournamentView({
      id: 't-1',
      groupId: 'g-1',
      name: 'T',
      mode: 'groups_ko',
      status: 'draft',
      createdById: 'u-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // startedAt-Feld komplett fehlend → null
    expect(v.startedAt).toBeNull();
  });
});
