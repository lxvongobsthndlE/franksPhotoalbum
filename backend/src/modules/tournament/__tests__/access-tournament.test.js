/**
 * Tests: Turnier-DTO und singleDay-Heuristik.
 * Spec §7, §1.2, §8.6, §11.
 */

import { describe, it, expect } from 'vitest';
import {
  detectSingleDay,
  prepareTournamentView,
  prepareTournamentList,
} from '../access/tournament.js';

const baseRaw = {
  id: 'trn_1',
  groupId: 'grp_1',
  name: 'Sommer-Tourney',
  logoUrl: '/uploads/logo.png',
  coverUrl: null,
  mode: 'groups_ko',
  status: 'group_stage',
  config: { someConfig: true },
  isPublic: false,
  publicToken: null,
  publicEnabledAt: null,
  publicRevokedAt: null,
  startsAt: new Date('2026-09-05T10:00:00'),
  endsAt: new Date('2026-09-05T20:00:00'),
  createdById: 'user_1',
  createdAt: new Date('2026-08-01'),
  updatedAt: new Date('2026-08-15'),
};

describe('detectSingleDay', () => {
  it('gleicher Tag → true', () => {
    expect(detectSingleDay(new Date('2026-09-05T09:00:00'), new Date('2026-09-05T20:00:00'))).toBe(
      true
    );
  });

  it('verschiedene Tage → false', () => {
    expect(detectSingleDay(new Date('2026-09-05T20:00:00'), new Date('2026-09-06T18:00:00'))).toBe(
      false
    );
  });

  it('nur startsAt gesetzt → true (Default)', () => {
    expect(detectSingleDay(new Date('2026-09-05'), null)).toBe(true);
  });

  it('nur endsAt gesetzt → true', () => {
    expect(detectSingleDay(null, new Date('2026-09-05'))).toBe(true);
  });

  it('gar nichts gesetzt → true', () => {
    expect(detectSingleDay(null, null)).toBe(true);
  });

  it('Monatswechsel zählt als mehrtägig', () => {
    expect(detectSingleDay(new Date('2026-08-31T20:00:00'), new Date('2026-09-01T18:00:00'))).toBe(
      false
    );
  });

  it('Jahreswechsel', () => {
    expect(detectSingleDay(new Date('2026-12-31T22:00:00'), new Date('2027-01-01T02:00:00'))).toBe(
      false
    );
  });
});

describe('prepareTournamentView', () => {
  it('null → null', () => {
    expect(prepareTournamentView(null)).toBeNull();
  });

  it('liefert sauberes DTO', () => {
    const v = prepareTournamentView(baseRaw);
    expect(v.id).toBe('trn_1');
    expect(v.name).toBe('Sommer-Tourney');
    expect(v.modeLabel).toBe('Gruppen + K.-o.');
    expect(v.statusLabel).toBe('Gruppenphase');
    expect(v.isPublic).toBe(false);
    expect(v.publicToken).toBeNull();
  });

  it('modeLabel unbekannt → roher Wert', () => {
    const v = prepareTournamentView({ ...baseRaw, mode: 'unknown_mode' });
    expect(v.modeLabel).toBe('unknown_mode');
  });

  it('statusLabel unbekannt → roher Wert', () => {
    const v = prepareTournamentView({ ...baseRaw, status: 'pending' });
    expect(v.statusLabel).toBe('pending');
  });

  it('eintägig → startsAtDate leer', () => {
    const v = prepareTournamentView(baseRaw);
    expect(v.singleDay).toBe(true);
    expect(v.startsAtDate).toBe('');
    expect(v.endsAtDate).toBe('');
  });

  it('mehrtägig → startsAtDate gesetzt', () => {
    const raw = {
      ...baseRaw,
      endsAt: new Date('2026-09-06T20:00:00'),
    };
    const v = prepareTournamentView(raw);
    expect(v.singleDay).toBe(false);
    expect(v.startsAtDate).toMatch(/05\.09\./);
    expect(v.endsAtDate).toMatch(/06\.09\./);
  });

  it('publicToken + isPublic', () => {
    const raw = {
      ...baseRaw,
      isPublic: true,
      publicToken: 'abc123',
      publicEnabledAt: new Date('2026-08-20'),
    };
    const v = prepareTournamentView(raw);
    expect(v.isPublic).toBe(true);
    expect(v.publicToken).toBe('abc123');
    expect(v.publicEnabledAt).toBeInstanceOf(Date);
  });

  it('stats werden propagiert', () => {
    const v = prepareTournamentView(baseRaw, {
      stats: { teamCount: 12, groupCount: 3, matchCount: 18, finishedCount: 6 },
    });
    expect(v.teamCount).toBe(12);
    expect(v.groupCount).toBe(3);
    expect(v.matchCount).toBe(18);
    expect(v.finishedCount).toBe(6);
  });

  it('ohne stats → null', () => {
    const v = prepareTournamentView(baseRaw);
    expect(v.teamCount).toBeNull();
    expect(v.finishedCount).toBeNull();
  });

  it('isPublic default false, publicToken default null', () => {
    const v = prepareTournamentView({ ...baseRaw, isPublic: undefined, publicToken: undefined });
    expect(v.isPublic).toBe(false);
    expect(v.publicToken).toBeNull();
  });

  it('optionale singleDay-Override', () => {
    const v = prepareTournamentView(baseRaw, { singleDay: false });
    expect(v.singleDay).toBe(false);
    expect(v.startsAtDate).not.toBe('');
  });
});

describe('prepareTournamentList', () => {
  it('null/undefined → []', () => {
    expect(prepareTournamentList(null)).toEqual([]);
    expect(prepareTournamentList(undefined)).toEqual([]);
  });

  it('mehrere Turniere', () => {
    const list = prepareTournamentList([
      { ...baseRaw, id: 't1' },
      { ...baseRaw, id: 't2', status: 'finished' },
    ]);
    expect(list).toHaveLength(2);
    expect(list[1].statusLabel).toBe('Beendet');
  });

  it('gestartetes Turnier: phase live und Karte „Läuft" — der Status sagt weiter „Bereit"', () => {
    // POST /:id/start setzt nur startedAt, status bleibt 'generated'.
    // Vor dem 01.09.2026 kam cardStatusLabel aus dem Status → „Bereit".
    const [ready, live, done] = prepareTournamentList([
      { ...baseRaw, id: 't1', status: 'generated', startedAt: null },
      { ...baseRaw, id: 't2', status: 'generated', startedAt: new Date('2026-09-01T10:00:00Z') },
      { ...baseRaw, id: 't3', status: 'finished', startedAt: new Date('2026-09-01T10:00:00Z') },
    ]);
    expect(ready.phase).toBe('ready');
    expect(ready.phaseLabel).toBe('Bereit');
    expect(ready.cardStatusLabel).toBe('Bereit');

    expect(live.statusLabel).toBe('Bereit'); // Status unverändert — bewusst
    expect(live.phase).toBe('live');
    expect(live.phaseLabel).toBe('Läuft');
    expect(live.cardStatusLabel).toBe('Läuft');

    expect(done.phase).toBe('finished'); // beendet schlägt gestartet
    expect(done.cardStatusLabel).toBe('Beendet');
  });

  it('Entwurf und unbekannter Status: draft bzw. other, nie stillschweigend „Bereit"', () => {
    const [draft, weird] = prepareTournamentList([
      { ...baseRaw, id: 't1', status: 'draft', startedAt: null },
      { ...baseRaw, id: 't2', status: 'irgendwas', startedAt: null },
    ]);
    expect(draft.phase).toBe('draft');
    expect(weird.phase).toBe('other');
    expect(weird.cardStatusLabel).toBe('Sonstige');
  });
});
