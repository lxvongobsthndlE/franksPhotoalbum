/**
 * Tests: Gruppen-DTO und Tabellenstand-Anzeige.
 * Spec §5.4.
 */

import { describe, it, expect } from 'vitest';
import { prepareGroupView, prepareGroupList, prepareStandings } from '../access/group.js';
import { buildTeamLookup } from '../access/team.js';

const rawTeams = [
  { id: 'tA', name: 'Alpha', seed: 1 },
  { id: 'tB', name: 'Bravo', seed: 2 },
  { id: 'tC', name: 'Charlie', seed: 3 },
];
const teams = buildTeamLookup(rawTeams);

const rawGroups = [
  {
    id: 'gA',
    stageId: 's_group',
    key: 'A',
    name: 'Gruppe A',
    memberships: [
      { id: 'm1', groupId: 'gA', teamId: 'tA', position: 1 },
      { id: 'm2', groupId: 'gA', teamId: 'tB', position: 2 },
      { id: 'm3', groupId: 'gA', teamId: 'tC', position: 3 },
    ],
    matches: [
      {
        id: 'm1',
        tournamentId: 't',
        stageId: 's_group',
        groupId: 'gA',
        teamHome: 'tA',
        teamAway: 'tB',
        bracketPos: 1,
        scoreHome: 2,
        scoreAway: 1,
        status: 'finished',
      },
    ],
  },
];

describe('prepareGroupView', () => {
  it('null → null', () => {
    expect(prepareGroupView(null)).toBeNull();
  });

  it('liefert Gruppenheader + Mitglieder in Setzreihenfolge', () => {
    const v = prepareGroupView(rawGroups[0], { teams });
    expect(v.id).toBe('gA');
    expect(v.key).toBe('A');
    expect(v.name).toBe('Gruppe A');
    expect(v.memberCount).toBe(3);
    expect(v.members.map((m) => m.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sortiert Mitglieder nach position auch wenn unsortiert', () => {
    const unordered = {
      ...rawGroups[0],
      memberships: [
        { id: 'm3', groupId: 'gA', teamId: 'tC', position: 3 },
        { id: 'm1', groupId: 'gA', teamId: 'tA', position: 1 },
        { id: 'm2', groupId: 'gA', teamId: 'tB', position: 2 },
      ],
    };
    const v = prepareGroupView(unordered, { teams });
    expect(v.members[0].name).toBe('Alpha');
    expect(v.members[2].name).toBe('Charlie');
  });

  it('Member mit fehlender position landet am Ende', () => {
    const mixed = {
      ...rawGroups[0],
      memberships: [
        { id: 'm1', groupId: 'gA', teamId: 'tA', position: 1 },
        { id: 'mx', groupId: 'gA', teamId: 'tC' }, // keine position
        { id: 'm2', groupId: 'gA', teamId: 'tB', position: 2 },
      ],
    };
    const v = prepareGroupView(mixed, { teams });
    expect(v.members[0].name).toBe('Alpha');
    expect(v.members[1].name).toBe('Bravo');
    expect(v.members[2].name).toBe('Charlie');
  });

  it('liefert preparedMatches', () => {
    const v = prepareGroupView(rawGroups[0], { teams });
    expect(v.matches).toHaveLength(1);
    expect(v.matches[0].home.name).toBe('Alpha');
    expect(v.matches[0].away.name).toBe('Bravo');
  });

  it('Mitglied ohne Team-Lookup zeigt "—"', () => {
    const g = {
      id: 'g',
      stageId: 's',
      key: 'X',
      name: null,
      memberships: [{ id: 'm', groupId: 'g', teamId: 'unknown', position: 1 }],
      matches: [],
    };
    const v = prepareGroupView(g, { teams });
    expect(v.members[0].name).toBe('—');
    expect(v.name).toBe('X');
  });
});

describe('prepareGroupList', () => {
  it('null/undefined → []', () => {
    expect(prepareGroupList(null)).toEqual([]);
  });

  it('mehrere Gruppen', () => {
    const list = prepareGroupList(
      [
        { id: 'gA', stageId: 's', key: 'A', memberships: [], matches: [] },
        { id: 'gB', stageId: 's', key: 'B', memberships: [], matches: [] },
      ],
      { teams }
    );
    expect(list.map((g) => g.key)).toEqual(['A', 'B']);
  });
});

// ---------------------------------------------------------------------------
// prepareStandings
// ---------------------------------------------------------------------------

describe('prepareStandings', () => {
  const raw = [
    {
      teamId: 'tA',
      played: 2,
      won: 2,
      drawn: 0,
      lost: 0,
      goalsFor: 5,
      goalsAgainst: 1,
      goalDiff: 4,
      points: 6,
      rank: 1,
    },
    {
      teamId: 'tB',
      played: 2,
      won: 1,
      drawn: 0,
      lost: 1,
      goalsFor: 3,
      goalsAgainst: 3,
      goalDiff: 0,
      points: 3,
      rank: 2,
    },
    {
      teamId: 'tC',
      played: 2,
      won: 0,
      drawn: 0,
      lost: 2,
      goalsFor: 1,
      goalsAgainst: 5,
      goalDiff: -4,
      points: 0,
      rank: 3,
    },
  ];

  it('null/undefined → []', () => {
    expect(prepareStandings(null)).toEqual([]);
    expect(prepareStandings(undefined)).toEqual([]);
  });

  it('rendert jede Zeile', () => {
    const rows = prepareStandings(raw);
    expect(rows).toHaveLength(3);
    expect(rows[0].teamId).toBe('tA');
    expect(rows[0].points).toBe(6);
  });

  it('qualifies = true für Top-N', () => {
    const rows = prepareStandings(raw, { qualifyTop: 2 });
    expect(rows[0].qualifies).toBe(true);
    expect(rows[1].qualifies).toBe(true);
    expect(rows[2].qualifies).toBe(false);
  });

  it('qualifyTop 0 → niemand qualifiziert', () => {
    expect(prepareStandings(raw, { qualifyTop: 0 })[0].qualifies).toBe(false);
  });

  it('tiebreakerNote + unresolved werden propagiert', () => {
    const rows = prepareStandings([
      {
        teamId: 'tA',
        played: 1,
        won: 0,
        drawn: 1,
        lost: 0,
        goalsFor: 2,
        goalsAgainst: 2,
        points: 1,
        rank: 1,
        tiebreakerNote: 'Losentscheid',
        unresolved: true,
      },
    ]);
    expect(rows[0].tiebreakerNote).toBe('Losentscheid');
    expect(rows[0].unresolved).toBe(true);
  });

  it('rank Default = idx + 1', () => {
    const rows = prepareStandings([
      {
        teamId: 'tA',
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
      },
    ]);
    expect(rows[0].rank).toBe(1);
  });
});
