/**
 * Tests: Status-/Modus-Enums und Label-Funktionen.
 * Spec §1.2, §4, §7, §8.6.
 */

import { describe, it, expect } from 'vitest';
import {
  TOURNAMENT_STATUS,
  TOURNAMENT_MODE,
  MATCH_STATUS,
  STAGE_TYPE,
  ROUND_LABEL,
  tournamentStatusLabel,
  tournamentModeLabel,
  matchStatusLabel,
  stageTypeLabel,
  roundLabel,
} from '../access/status.js';

describe('Status-Enums', () => {
  it('TOURNAMENT_STATUS enthält alle §1.2-Werte', () => {
    expect(TOURNAMENT_STATUS).toEqual({
      draft: 'Entwurf',
      generated: 'Bereit',
      group_stage: 'Gruppenphase',
      ko_stage: 'K.-o.-Runde',
      finished: 'Beendet',
    });
  });

  it('TOURNAMENT_MODE enthält alle §3-Varianten', () => {
    expect(TOURNAMENT_MODE.groups_ko).toBe('Gruppen + K.-o.');
    expect(TOURNAMENT_MODE.groups_only).toBe('Nur Gruppen');
    expect(TOURNAMENT_MODE.ko_only).toBe('Nur K.-o.');
    expect(TOURNAMENT_MODE.double_elim).toBe('Doppel-K.O.');
  });

  it('MATCH_STATUS mappt auf deutsch', () => {
    expect(MATCH_STATUS.scheduled).toBe('offen');
    expect(MATCH_STATUS.live).toBe('läuft');
    expect(MATCH_STATUS.finished).toBe('beendet');
  });

  it('STAGE_TYPE enthält alle 4 Stufentypen', () => {
    expect(STAGE_TYPE.group).toBe('Gruppenphase');
    expect(STAGE_TYPE.ko).toBe('K.-o.-Runde');
    expect(STAGE_TYPE.intermediate_group).toBe('Zwischenrunde');
    expect(STAGE_TYPE.losers).toBe('Loser-Bracket');
  });

  it('ROUND_LABEL enthält KO-Runden', () => {
    expect(ROUND_LABEL.R32).toBe('Sechzehntelfinale');
    expect(ROUND_LABEL.R16).toBe('Achtelfinale');
    expect(ROUND_LABEL.QF).toBe('Viertelfinale');
    expect(ROUND_LABEL.SF).toBe('Halbfinale');
    expect(ROUND_LABEL.F).toBe('Finale');
    expect(ROUND_LABEL['3RD']).toBe('Spiel um Platz 3');
  });

  it('Enums sind eingefroren', () => {
    expect(Object.isFrozen(TOURNAMENT_STATUS)).toBe(true);
    expect(Object.isFrozen(MATCH_STATUS)).toBe(true);
  });
});

describe('Label-Funktionen', () => {
  it('tournamentStatusLabel für null → leerer String', () => {
    expect(tournamentStatusLabel(null)).toBe('');
  });

  it('tournamentStatusLabel für bekannten Wert', () => {
    expect(tournamentStatusLabel('group_stage')).toBe('Gruppenphase');
    expect(tournamentStatusLabel('finished')).toBe('Beendet');
  });

  it('tournamentStatusLabel für unbekannten Wert → roher Wert', () => {
    expect(tournamentStatusLabel('unknown_xyz')).toBe('unknown_xyz');
  });

  it('tournamentModeLabel', () => {
    expect(tournamentModeLabel('groups_ko')).toBe('Gruppen + K.-o.');
    expect(tournamentModeLabel('ko_only')).toBe('Nur K.-o.');
  });

  it('matchStatusLabel default → "offen"', () => {
    expect(matchStatusLabel(null)).toBe('offen');
    expect(matchStatusLabel('scheduled')).toBe('offen');
    expect(matchStatusLabel('live')).toBe('läuft');
    expect(matchStatusLabel('finished')).toBe('beendet');
  });

  it('stageTypeLabel', () => {
    expect(stageTypeLabel('group')).toBe('Gruppenphase');
    expect(stageTypeLabel('ko')).toBe('K.-o.-Runde');
    expect(stageTypeLabel('losers')).toBe('Loser-Bracket');
  });

  it('roundLabel', () => {
    expect(roundLabel('QF')).toBe('Viertelfinale');
    expect(roundLabel('F')).toBe('Finale');
    expect(roundLabel('3RD')).toBe('Spiel um Platz 3');
    expect(roundLabel(null)).toBe('');
  });
});
