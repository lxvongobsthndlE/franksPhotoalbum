/**
 * Tests: Team-DTO.
 * Spec §1.2 — Teams sind reine Datensätze.
 */

import { describe, it, expect } from 'vitest';
import { prepareTeamView, prepareTeamList, buildTeamLookup } from '../access/team.js';

const raw = {
  id: 'team_1',
  tournamentId: 'trn_1',
  name: 'FC Bayern',
  color: '#dc052d',
  logoUrl: '/uploads/bayern.png',
  players: 'Musiala, Müller',
  linkedUserIds: ['user_42'],
  seed: 1,
  createdAt: new Date('2026-08-01'),
};

describe('prepareTeamView', () => {
  it('null → null', () => {
    expect(prepareTeamView(null)).toBeNull();
  });

  it('liefert sauberes Anzeigeobjekt', () => {
    const v = prepareTeamView(raw);
    expect(v).toEqual({
      id: 'team_1',
      name: 'FC Bayern',
      color: '#dc052d',
      logoUrl: '/uploads/bayern.png',
      players: 'Musiala, Müller',
      seed: 1,
      linkedUserIds: ['user_42'],
    });
  });

  it('liefert keine ID-Felder wie tournamentId heraus', () => {
    const v = prepareTeamView(raw);
    expect(v.tournamentId).toBeUndefined();
    expect(v.createdAt).toBeUndefined();
  });

  it('Default-Werte', () => {
    const v = prepareTeamView({ id: 't', name: 'x' });
    expect(v.color).toBeNull();
    expect(v.logoUrl).toBeNull();
    expect(v.players).toBeNull();
    expect(v.seed).toBeNull();
    expect(v.linkedUserIds).toEqual([]);
  });

  it('linkedUserIds wird kopiert, nicht referenziert', () => {
    const v = prepareTeamView(raw);
    v.linkedUserIds.push('hacked');
    expect(raw.linkedUserIds).toEqual(['user_42']);
  });

  it('fehlendes linkedUserIds → leeres Array', () => {
    const v = prepareTeamView({ id: 't', name: 'x' });
    expect(v.linkedUserIds).toEqual([]);
  });
});

describe('prepareTeamList', () => {
  it('null/undefined → leeres Array', () => {
    expect(prepareTeamList(null)).toEqual([]);
    expect(prepareTeamList(undefined)).toEqual([]);
  });

  it('mappt korrekt', () => {
    const list = prepareTeamList([raw, { id: 't2', name: 'B' }]);
    expect(list).toHaveLength(2);
    expect(list[1].name).toBe('B');
  });
});

describe('buildTeamLookup', () => {
  it('erstellt Map<id, preparedTeam>', () => {
    const map = buildTeamLookup([raw, { id: 't2', name: 'B' }]);
    expect(map).toBeInstanceOf(Map);
    expect(map.get('team_1').name).toBe('FC Bayern');
    expect(map.get('t2').name).toBe('B');
    expect(map.get('unknown')).toBeUndefined();
  });

  it('leere Eingabe → leere Map', () => {
    expect(buildTeamLookup(null).size).toBe(0);
    expect(buildTeamLookup([]).size).toBe(0);
  });
});
