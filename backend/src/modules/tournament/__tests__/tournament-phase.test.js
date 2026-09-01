/**
 * tournamentPhase — die EINE Ableitung „in welcher Phase ist das Turnier".
 *
 * Hintergrund (01.09.2026): POST /:id/start setzt nur `startedAt`, der
 * Status bleibt 'generated'. Alles, was die Phase aus dem Status las
 * (Listen-Karte, cardStatusLabel), zeigte ein laufendes Turnier als
 * „Bereit". Diese Tabelle ist die Wahrheit, gegen die Backend-DTO und
 * Frontend-Liste gleichermaßen laufen.
 */
import { describe, it, expect } from 'vitest';
import { tournamentPhase } from '../locks.js';

const DATE = new Date('2026-09-01T10:00:00Z');

describe('tournamentPhase(status, startedAt)', () => {
  it.each([
    ['draft', null, 'draft'],
    ['generated', null, 'ready'],
    ['generated', DATE, 'live'],
    ['generated', DATE.toISOString(), 'live'],
    ['draft', DATE, 'live'], // startedAt schlägt den Status — wie in canEdit
    ['finished', DATE, 'finished'],
    ['finished', null, 'finished'],
    ['cancelled', null, 'finished'],
    ['group_stage', null, 'live'], // Altbestand ohne startedAt
    ['ko_stage', null, 'live'],
    ['irgendwas', null, 'other'],
    [undefined, null, 'other'],
  ])('status=%s startedAt=%s → %s', (status, startedAt, expected) => {
    expect(tournamentPhase({ status, startedAt })).toBe(expected);
  });

  it('kein Objekt → other, kein Wurf', () => {
    expect(tournamentPhase(null)).toBe('other');
    expect(tournamentPhase(undefined)).toBe('other');
    expect(tournamentPhase('generated')).toBe('other');
  });
});
