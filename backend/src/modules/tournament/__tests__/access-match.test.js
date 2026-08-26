/**
 * Tests: Match-DTO.
 * Spec §8.6, §13.11 — EIN Match-DTO für alle Views.
 */

import { describe, it, expect } from 'vitest';
import {
  prepareMatchView,
  prepareMatchList,
  buildMatchLookup,
  buildMatchLabel,
} from '../access/match.js';
import { prepareTeamView } from '../access/team.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const teamA = prepareTeamView({ id: 'tA', name: 'Alpha', color: '#f00' });
const teamB = prepareTeamView({ id: 'tB', name: 'Bravo', color: '#0f0' });
const teamC = prepareTeamView({ id: 'tC', name: 'Charlie' });

const teams = new Map([
  ['tA', teamA],
  ['tB', teamB],
  ['tC', teamC],
]);

const stages = new Map([
  ['s_group', { id: 's_group', name: 'Gruppenphase', type: 'group', orderIndex: 1 }],
  ['s_ko', { id: 's_ko', name: 'K.-o.-Runde', type: 'ko', orderIndex: 2 }],
  ['s_losers', { id: 's_losers', name: 'Loser-Bracket', type: 'losers', orderIndex: 3 }],
]);

const groups = new Map([
  ['gA', { id: 'gA', key: 'A', name: 'Gruppe A' }],
  ['gB', { id: 'gB', key: 'B', name: 'Gruppe B' }],
]);

const ctx = { teams, stages, groups, options: { singleDay: true } };

// ---------------------------------------------------------------------------
// buildMatchLabel
// ---------------------------------------------------------------------------

describe('buildMatchLabel', () => {
  it('KO-Spiel "VF 1"', () => {
    const m = { stageId: 's_ko', round: 'QF', bracketPos: 1 };
    expect(buildMatchLabel(m, ctx)).toBe('VF 1');
  });

  it('KO-Spiel "HF 2"', () => {
    expect(buildMatchLabel({ stageId: 's_ko', round: 'SF', bracketPos: 2 }, ctx)).toBe('HF 2');
  });

  it('Finale', () => {
    expect(buildMatchLabel({ stageId: 's_ko', round: 'F', bracketPos: 1 }, ctx)).toBe('Finale');
  });

  it('Spiel um Platz 3', () => {
    expect(buildMatchLabel({ stageId: 's_ko', round: '3RD', bracketPos: 1 }, ctx)).toBe(
      'Spiel um Platz 3'
    );
  });

  it('Achtelfinale "AF 1"', () => {
    expect(buildMatchLabel({ stageId: 's_ko', round: 'R16', bracketPos: 1 }, ctx)).toBe('AF 1');
  });

  it('Sechzehntelfinale "SF 1"', () => {
    expect(buildMatchLabel({ stageId: 's_ko', round: 'R32', bracketPos: 1 }, ctx)).toBe('SF 1');
  });

  it('Gruppenspiel "Gruppenspiel A1"', () => {
    expect(buildMatchLabel({ stageId: 's_group', groupId: 'gA', bracketPos: 1 }, ctx)).toBe(
      'Gruppenspiel A1'
    );
  });

  it('Gruppenspiel "Gruppenspiel B3"', () => {
    expect(buildMatchLabel({ stageId: 's_group', groupId: 'gB', bracketPos: 3 }, ctx)).toBe(
      'Gruppenspiel B3'
    );
  });

  it('Fallback ohne Kontext', () => {
    expect(buildMatchLabel({}, {})).toBe('Spiel');
  });
});

// ---------------------------------------------------------------------------
// prepareMatchView — Gruppenphase
// ---------------------------------------------------------------------------

describe('prepareMatchView — Gruppenphase', () => {
  const raw = {
    id: 'm1',
    tournamentId: 'trn_1',
    stageId: 's_group',
    groupId: 'gA',
    round: null,
    bracketType: null,
    bracketPos: 1,
    teamHome: 'tA',
    teamAway: 'tB',
    placeholderHome: null,
    placeholderAway: null,
    scoreHome: 2,
    scoreAway: 1,
    status: 'finished',
    field: 3,
    scheduledAt: new Date('2026-09-05T14:20:00'),
    winnerAdvancesTo: null,
    loserAdvancesTo: null,
  };

  it('liefert aufgelöste Teamnamen statt IDs', () => {
    const v = prepareMatchView(raw, ctx);
    expect(v.home.name).toBe('Alpha');
    expect(v.away.name).toBe('Bravo');
    expect(v.home.teamId).toBe('tA');
  });

  it('Label "Gruppenspiel A1"', () => {
    expect(prepareMatchView(raw, ctx).label).toBe('Gruppenspiel A1');
  });

  it('Status deutsch ("beendet")', () => {
    expect(prepareMatchView(raw, ctx).statusLabel).toBe('beendet');
  });

  it('isFinished = true', () => {
    expect(prepareMatchView(raw, ctx).isFinished).toBe(true);
  });

  it('scheduledTime = "14:20"', () => {
    expect(prepareMatchView(raw, ctx).scheduledTime).toBe('14:20');
  });

  it('scheduledLabel eintägig = nur Zeit', () => {
    expect(prepareMatchView(raw, ctx).scheduledLabel).toBe('14:20');
  });

  it('scheduledLabel mehrtägig = "Sa, 05.09. · 14:20"', () => {
    const v = prepareMatchView(raw, { ...ctx, options: { singleDay: false } });
    expect(v.scheduledLabel).toBe('Sa, 05.09. · 14:20');
  });

  it('isGroupMatch = true, isKoMatch = false', () => {
    const v = prepareMatchView(raw, ctx);
    expect(v.isGroupMatch).toBe(true);
    expect(v.isKoMatch).toBe(false);
  });

  it('Sieger/Verlierer in Gruppenphase NICHT gesetzt', () => {
    const v = prepareMatchView(raw, ctx);
    expect(v.winnerTeamId).toBeNull();
    expect(v.loserTeamId).toBeNull();
    expect(v.winnerName).toBeNull();
    expect(v.loserName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// prepareMatchView — KO-Runde mit Folgematch
// ---------------------------------------------------------------------------

describe('prepareMatchView — KO mit Folgematch', () => {
  const koFinal = {
    id: 'mFinal',
    tournamentId: 'trn_1',
    stageId: 's_ko',
    groupId: null,
    round: 'F',
    bracketPos: 1,
    teamHome: 'tA',
    teamAway: 'tB',
    placeholderHome: null,
    placeholderAway: null,
    scoreHome: 3,
    scoreAway: 1,
    status: 'finished',
    field: 1,
    scheduledAt: new Date('2026-09-05T20:00:00'),
    winnerAdvancesTo: null,
    loserAdvancesTo: null,
  };

  const koSf1 = {
    id: 'mSF1',
    tournamentId: 'trn_1',
    stageId: 's_ko',
    groupId: null,
    round: 'SF',
    bracketPos: 1,
    teamHome: 'tA',
    teamAway: 'tC',
    scoreHome: null,
    scoreAway: null,
    status: 'scheduled',
    field: 1,
    scheduledAt: new Date('2026-09-05T18:00:00'),
    winnerAdvancesTo: 'mFinal',
    loserAdvancesTo: null,
  };

  const koSf2 = {
    id: 'mSF2',
    tournamentId: 'trn_1',
    stageId: 's_ko',
    groupId: null,
    round: 'SF',
    bracketPos: 2,
    teamHome: 'tB',
    teamAway: null, // kommt noch aus VF
    placeholderHome: null,
    placeholderAway: { type: 'match_winner', matchLabel: 'VF 2' },
    scoreHome: null,
    scoreAway: null,
    status: 'scheduled',
    winnerAdvancesTo: 'mFinal',
    loserAdvancesTo: null,
  };

  const matches = new Map([
    ['mFinal', prepareMatchView(koFinal, ctx)],
    ['mSF1', prepareMatchView(koSf1, ctx)],
    ['mSF2', prepareMatchView(koSf2, ctx)],
  ]);
  const ctxWithMatches = { ...ctx, matches };

  it('Label "Finale"', () => {
    expect(prepareMatchView(koFinal, ctxWithMatches).label).toBe('Finale');
  });

  it('Sieger in beendetem KO-Match korrekt ermittelt (ID + Name getrennt)', () => {
    const v = prepareMatchView(koFinal, ctxWithMatches);
    expect(v.winnerTeamId).toBe('tA');
    expect(v.loserTeamId).toBe('tB');
    expect(v.winnerName).toBe('Alpha');
    expect(v.loserName).toBe('Bravo');
    expect(v.isFinished).toBe(true);
  });

  it('Unentschieden in KO → kein Sieger', () => {
    const draw = { ...koFinal, scoreHome: 2, scoreAway: 2 };
    const v = prepareMatchView(draw, ctxWithMatches);
    expect(v.winnerTeamId).toBeNull();
    expect(v.loserTeamId).toBeNull();
    expect(v.winnerName).toBeNull();
    expect(v.loserName).toBeNull();
  });

  it('winnerLabel referenziert Folgematch (Sieger HF 1)', () => {
    const v = prepareMatchView(koSf1, ctxWithMatches);
    expect(v.winnerLabel).toBe('Sieger Finale');
  });

  it('Placeholder away im HF 2 wird aufgelöst', () => {
    const v = prepareMatchView(koSf2, ctxWithMatches);
    expect(v.away.kind).toBe('placeholder');
    expect(v.away.name).toBe('Sieger VF 2');
  });

  it('isKoMatch = true', () => {
    expect(prepareMatchView(koFinal, ctxWithMatches).isKoMatch).toBe(true);
  });

  it('Loser-Bracket: isKoMatch via type=losers', () => {
    const l = { ...koFinal, stageId: 's_losers', round: null };
    expect(prepareMatchView(l, ctxWithMatches).isKoMatch).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('prepareMatchView — Edge Cases', () => {
  it('null → null', () => {
    expect(prepareMatchView(null)).toBeNull();
  });

  it('Match ohne Teams/Placeholders → null-Slots', () => {
    const v = prepareMatchView(
      { id: 'm', tournamentId: 't', stageId: 's_group', bracketPos: 1 },
      ctx
    );
    expect(v.home).toBeNull();
    expect(v.away).toBeNull();
  });

  it('status default "scheduled" → statusLabel "offen"', () => {
    const v = prepareMatchView(
      { id: 'm', tournamentId: 't', stageId: 's_group', bracketPos: 1 },
      ctx
    );
    expect(v.status).toBe('scheduled');
    expect(v.statusLabel).toBe('offen');
  });

  it('field null → null im DTO', () => {
    const v = prepareMatchView(
      {
        id: 'm',
        tournamentId: 't',
        stageId: 's_group',
        bracketPos: 1,
        teamHome: 'tA',
        teamAway: 'tB',
        scheduledAt: new Date('2026-09-05T12:00:00'),
      },
      ctx
    );
    expect(v.field).toBeNull();
  });

  it('scheduledAt null → leere Zeitstrings', () => {
    const v = prepareMatchView(
      {
        id: 'm',
        tournamentId: 't',
        stageId: 's_group',
        bracketPos: 1,
        teamHome: 'tA',
        teamAway: 'tB',
      },
      ctx
    );
    expect(v.scheduledTime).toBe('');
    expect(v.scheduledLabel).toBe('');
  });

  it('Team-ID ohne Lookup → "—" als Name', () => {
    const v = prepareMatchView(
      {
        id: 'm',
        tournamentId: 't',
        stageId: 's_group',
        bracketPos: 1,
        teamHome: 'unknown',
        teamAway: 'tB',
      },
      ctx
    );
    expect(v.home.name).toBe('—');
  });

  it('live-Status wird erkannt', () => {
    const v = prepareMatchView(
      {
        id: 'm',
        tournamentId: 't',
        stageId: 's_group',
        bracketPos: 1,
        status: 'live',
      },
      ctx
    );
    expect(v.isLive).toBe(true);
    expect(v.statusLabel).toBe('läuft');
  });
});

// ---------------------------------------------------------------------------
// prepareMatchList / buildMatchLookup
// ---------------------------------------------------------------------------

describe('prepareMatchList', () => {
  it('null → []', () => {
    expect(prepareMatchList(null, ctx)).toEqual([]);
  });

  it('iteriert korrekt', () => {
    const list = prepareMatchList(
      [
        { id: 'm1', tournamentId: 't', stageId: 's_group', bracketPos: 1 },
        { id: 'm2', tournamentId: 't', stageId: 's_group', bracketPos: 2 },
      ],
      ctx
    );
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('m1');
  });
});

describe('buildMatchLookup', () => {
  it('erstellt Map<id, preparedMatch>', () => {
    const map = buildMatchLookup(
      [
        { id: 'm1', tournamentId: 't', stageId: 's_group', groupId: 'gA', bracketPos: 1 },
        { id: 'm2', tournamentId: 't', stageId: 's_ko', round: 'QF', bracketPos: 1 },
      ],
      ctx
    );
    expect(map).toBeInstanceOf(Map);
    expect(map.get('m1').label).toBe('Gruppenspiel A1');
    expect(map.get('m2').label).toBe('VF 1');
  });

  it('leere Eingabe', () => {
    expect(buildMatchLookup(null, ctx).size).toBe(0);
  });
});
