/**
 * Unit-Tests für die Wizard-Payload-Builder.
 *
 * buildPatchPayload + buildGeneratePayload sind reine Funktionen, die
 * Wizard-State auf HTTP-Body mappen. Sie sind der Risikopunkt: wenn
 * ein Feld fehlt, generiert der User ein Turnier mit falschen
 * Einstellungen und merkt es nicht. Spec §13: keine stillen Annahmen.
 *
 * Diese Tests sind die Feldzuordnung in ausführbarer Form.
 */

import { describe, it, expect } from 'vitest';
import { buildPatchPayload, buildGeneratePayload } from '../tournament.js';

const FULL_STATE = {
  step: 5,
  name: 'Bierpong Stadtmeisterschaft',
  date: '2026-09-12',
  location: 'Sporthalle A, Reutlingen',
  sport: 'becher',
  logoUrl: null,
  teamInput: '',
  teams: Array.from({ length: 12 }, (_, i) => ({
    name: `Team ${i + 1}`,
    color: null,
    seed: i + 1,
  })),
  mode: 'groups_ko',
  numGroups: 3,
  distributionMethod: 'snake',
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  tiebreakers: ['points', 'goalDiff', 'goalsFor', 'goalsAgainst'],
  advancePerGroup: 2,
  bestThirdsCount: 2,
  thirdPlaceMatch: true,
  numTables: 4,
  tableNames: ['Platte 1', 'Platte 2', 'Platte 3', 'Platte 4'],
  startTime: '14:00',
  matchDuration: 45,
  pauseMinutes: 5,
  tournamentId: 't-1',
};

describe('buildPatchPayload — alle Felder', () => {
  it('liefert location, sport, tableLabels, config', () => {
    const body = buildPatchPayload(FULL_STATE);
    expect(body.location).toBe('Sporthalle A, Reutlingen');
    expect(body.sport).toBe('becher');
    expect(body.tableLabels).toEqual(['Platte 1', 'Platte 2', 'Platte 3', 'Platte 4']);
    expect(body.config).toBeDefined();
  });

  it('Config-Mapping: Wizard-State → Engine-Config', () => {
    const cfg = buildPatchPayload(FULL_STATE).config;
    expect(cfg.distribution).toBe('snake');
    expect(cfg.pointsPerWin).toBe(3);
    expect(cfg.pointsPerDraw).toBe(1);
    expect(cfg.pointsPerLoss).toBe(0);
    expect(cfg.tiebreakers).toEqual(['points', 'goalDiff', 'goalsFor', 'goalsAgainst']);
    expect(cfg.qualifyPerGroup).toBe(2);
    expect(cfg.bestThirds).toBe(2);
    expect(cfg.hasThirdPlacePlayoff).toBe(true);
    expect(cfg.schedule.parallelFields).toBe(4);
    expect(cfg.schedule.matchDurationMinutes).toBe(45);
    expect(cfg.schedule.pauseAfterMatches).toBe(5);
    expect(cfg.schedule.startTime).toBe('14:00');
    // Bug 2 (2026-08-17): slotMinutes wird jetzt aus matchDuration + pause
    // berechnet (vorher Hardcode 15). 45 + 5 = 50.
    expect(cfg.schedule.slotMinutes).toBe(50);
  });

  it('Wizard hat KEIN doubleRoundRobin mehr in der Config', () => {
    const cfg = buildPatchPayload(FULL_STATE).config;
    expect('doubleRoundRobin' in cfg).toBe(false);
  });

  it('Wizard hat KEIN lottery mehr in den Tiebreakern', () => {
    const cfg = buildPatchPayload(FULL_STATE).config;
    expect(cfg.tiebreakers).not.toContain('lottery');
  });
});

describe('buildPatchPayload — changedFields-Filter', () => {
  it('Nur Step-1-Felder: nur location + sport, kein config', () => {
    const body = buildPatchPayload(FULL_STATE, {
      changedFields: ['location', 'sport'],
    });
    expect(body.location).toBe('Sporthalle A, Reutlingen');
    expect(body.sport).toBe('becher');
    expect(body.tableLabels).toBeUndefined();
    expect(body.config).toBeUndefined();
  });

  it('Nur Step-3-Felder: nur config, keine Meta-Felder', () => {
    const body = buildPatchPayload(FULL_STATE, {
      changedFields: ['pointsWin', 'tiebreakers'],
    });
    expect(body.config.pointsPerWin).toBe(3);
    expect(body.config.tiebreakers).toEqual(['points', 'goalDiff', 'goalsFor', 'goalsAgainst']);
    expect(body.location).toBeUndefined();
    expect(body.sport).toBeUndefined();
  });

  it('Nur Step-4-Felder: config.schedule + tableLabels', () => {
    const body = buildPatchPayload(FULL_STATE, {
      changedFields: ['numTables', 'startTime', 'tableNames'],
    });
    expect(body.config.schedule.parallelFields).toBe(4);
    expect(body.config.schedule.startTime).toBe('14:00');
    expect(body.tableLabels).toEqual(['Platte 1', 'Platte 2', 'Platte 3', 'Platte 4']);
  });

  it('changedFields mit distributionMethod → config.distribution', () => {
    const body = buildPatchPayload(FULL_STATE, {
      changedFields: ['distributionMethod'],
    });
    expect(body.config.distribution).toBe('snake');
  });
});

describe('buildPatchPayload — Edge-Cases', () => {
  it('tableNames leer → tableLabels null', () => {
    const state = { ...FULL_STATE, tableNames: [] };
    expect(buildPatchPayload(state).tableLabels).toBe(null);
  });

  it('location leerer String → null', () => {
    const state = { ...FULL_STATE, location: '' };
    expect(buildPatchPayload(state).location).toBe(null);
  });

  it('sport unbekannt wird trotzdem durchgereicht (Server validiert)', () => {
    // Server lehnt 400 ab; der Client darf das senden, der Server
    // ist die einzige Wahrheit für die Whitelist.
    const state = { ...FULL_STATE, sport: 'fussball' };
    expect(buildPatchPayload(state).sport).toBe('fussball');
  });

  it('teams-Liste leer: kein groupSize-Problem', () => {
    const state = { ...FULL_STATE, teams: [] };
    const body = buildPatchPayload(state);
    // PATCH braucht das nicht zu wissen — groupSize ist Sache von /generate.
    expect(body.config).toBeDefined();
  });
});

describe('buildGeneratePayload', () => {
  it('baseDate, numGroups, groupSize', () => {
    const body = buildGeneratePayload(FULL_STATE);
    expect(body.baseDate).toBe('2026-09-12');
    expect(body.numGroups).toBe(3);
    // 12 Teams / 3 Gruppen → groupSize 4
    expect(body.groupSize).toBe(4);
  });

  it('groupSize = ceil(teams / numGroups)', () => {
    // 13 Teams / 3 Gruppen → ceil(13/3) = 5
    const state = {
      ...FULL_STATE,
      teams: FULL_STATE.teams.concat([{ name: 'Team 13', color: null, seed: 13 }]),
    };
    expect(buildGeneratePayload(state).groupSize).toBe(5);
  });

  it('confirmTournamentName wird nur gesetzt wenn übergeben', () => {
    expect(buildGeneratePayload(FULL_STATE).confirmTournamentName).toBeUndefined();
    expect(
      buildGeneratePayload(FULL_STATE, { confirmTournamentName: 'X' }).confirmTournamentName
    ).toBe('X');
  });

  it('baseDate leer → Feld fehlt (Engine nutzt dann null)', () => {
    const state = { ...FULL_STATE, date: '' };
    const body = buildGeneratePayload(state);
    expect('baseDate' in body).toBe(false);
  });

  it('NICHT im Body: config, sport, location, points, tiebreakers', () => {
    // Diese landen vorher via PATCH am Turnier, nicht im Generate-Body.
    const body = buildGeneratePayload(FULL_STATE);
    expect('config' in body).toBe(false);
    expect('sport' in body).toBe(false);
    expect('location' in body).toBe(false);
    expect('points' in body).toBe(false);
    expect('tiebreakers' in body).toBe(false);
  });

  it('NICHT im Body: name, teams (sind schon in DB)', () => {
    const body = buildGeneratePayload(FULL_STATE);
    expect('name' in body).toBe(false);
    expect('teams' in body).toBe(false);
  });
});
