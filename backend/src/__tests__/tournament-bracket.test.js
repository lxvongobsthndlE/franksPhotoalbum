import { describe, expect, it } from 'vitest';
import {
  computeNextAdvancesForResult,
  flattenMatchesForDb,
  generateBracket,
  generateDoubleElim,
  generateGroupPhase,
  generateGroupPlusKnockoutGroupPhase,
  generateKnockoutFromStandings,
  generateRoundRobin,
  generateSingleElim,
  nextPowerOfTwoWithByes,
  snakeDraftIntoGroups,
  sortBySeed,
} from '../utils/tournament-bracket.js';

function e(id, seed = null) {
  return { id, seed, displayName: id };
}

describe('tournament-bracket utility', () => {
  describe('sortBySeed', () => {
    it('sorts by seed ascending and keeps unsorted tail stable', () => {
      const result = sortBySeed([e('a', null), e('b', 3), e('c', 1), e('d', null), e('e', 2)]);
      expect(result.map((entry) => entry.id)).toEqual(['c', 'e', 'b', 'a', 'd']);
    });
  });

  describe('nextPowerOfTwoWithByes', () => {
    it('rounds 3 up to 4 with 1 BYE', () => {
      expect(nextPowerOfTwoWithByes(3)).toEqual({ size: 4, byes: 1 });
    });
    it('returns 2 for n=1', () => {
      expect(nextPowerOfTwoWithByes(1)).toEqual({ size: 2, byes: 1 });
    });
    it('returns size 8 for n=5..8', () => {
      expect(nextPowerOfTwoWithByes(5).size).toBe(8);
      expect(nextPowerOfTwoWithByes(8).size).toBe(8);
      expect(nextPowerOfTwoWithByes(8).byes).toBe(0);
    });
    it('wirft bei > 256', () => {
      expect(() => nextPowerOfTwoWithByes(257)).toThrow();
    });
  });

  describe('snakeDraftIntoGroups', () => {
    it('verteilt 8 Teams in 2 Gruppen via Snake-Draft', () => {
      const teams = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => e(`t${n}`, n));
      const groups = snakeDraftIntoGroups(teams, 2);
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveLength(4);
      expect(groups[1]).toHaveLength(4);
      // Top-Seed in Gruppe 0, 2. in Gruppe 1, 3. in Gruppe 1, 4. in Gruppe 0 (snake)
      expect(groups[0][0].id).toBe('t1');
      expect(groups[1][0].id).toBe('t2');
      expect(groups[1][1].id).toBe('t3');
      expect(groups[0][1].id).toBe('t4');
    });

    it('verteilt 12 Teams in 3 Gruppen', () => {
      const teams = Array.from({ length: 12 }, (_, i) => e(`t${i + 1}`, i + 1));
      const groups = snakeDraftIntoGroups(teams, 3);
      expect(groups).toHaveLength(3);
      expect(groups.every((g) => g.length === 4)).toBe(true);
      // Top-Seed in Gruppe 0
      expect(groups[0][0].id).toBe('t1');
    });
  });

  describe('generateSingleElim', () => {
    it('4 Teams → 2 Rounds, 3 Matches mit entityType: team', () => {
      const result = generateSingleElim([e('A', 1), e('B', 2), e('C', 3), e('D', 4)], {
        entityType: 'team',
      });
      expect(result.stageType).toBe('single_elimination');
      expect(result.entityType).toBe('team');
      expect(result.rounds).toHaveLength(2);
      expect(result.rounds[0].matches).toHaveLength(2);
      expect(result.rounds[1].matches).toHaveLength(1);
      // homeEntityId/awayEntityId statt homeParticipantId
      expect(result.rounds[0].matches[0].homeEntityId).toBe('A');
      expect(result.rounds[0].matches[0].awayEntityId).toBe('D');
    });

    it('4 Participants → entityType: participant', () => {
      const result = generateSingleElim([e('A', 1), e('B', 2), e('C', 3), e('D', 4)], {
        entityType: 'participant',
      });
      expect(result.entityType).toBe('participant');
      expect(result.rounds[0].matches[0].homeEntityId).toBe('A');
    });

    it('5 Teams → 8 Slots, 3 BYE-Matches', () => {
      const result = generateSingleElim([e('A', 1), e('B', 2), e('C', 3), e('D', 4), e('E', 5)]);
      expect(result.byesApplied).toBe(3);
      const byes = result.rounds.flatMap((r) => r.matches).filter((m) => m.isBye);
      expect(byes).toHaveLength(3);
    });

    it('wirft bei weniger als 2 Teams', () => {
      expect(() => generateSingleElim([e('A')])).toThrow();
    });

    it('8 Teams → 3 Rounds, 7 Matches', () => {
      const result = generateSingleElim([1, 2, 3, 4, 5, 6, 7, 8].map((n) => e(`t${n}`, n)));
      expect(result.rounds).toHaveLength(3);
      expect(result.rounds[0].matches).toHaveLength(4);
      expect(result.rounds[1].matches).toHaveLength(2);
      expect(result.rounds[2].matches).toHaveLength(1);
    });
  });

  describe('generateRoundRobin', () => {
    it('4 Teams → 3 Spieltage, 6 Matches', () => {
      const result = generateRoundRobin([e('A', 1), e('B', 2), e('C', 3), e('D', 4)]);
      expect(result.entityType).toBe('team');
      expect(result.rounds).toHaveLength(3);
      const all = result.rounds.flatMap((r) => r.matches);
      expect(all).toHaveLength(6);
      const pairs = new Set(all.map((m) => [m.homeEntityId, m.awayEntityId].sort().join('|')));
      expect(pairs.size).toBe(6);
    });

    it('3 Teams (ungerade) → 3 Spieltage mit BYEs', () => {
      const result = generateRoundRobin([e('A', 1), e('B', 2), e('C', 3)]);
      const byes = result.rounds.flatMap((r) => r.matches).filter((m) => m.isBye);
      expect(byes).toHaveLength(3);
    });
  });

  describe('generateGroupPhase', () => {
    it('8 Teams in 2 Gruppen (4 pro Gruppe)', () => {
      const teams = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => e(`t${n}`, n));
      const result = generateGroupPhase(teams, { groupCount: 2, teamsPerGroup: 4 });
      expect(result.stageType).toBe('group_phase');
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].entities).toHaveLength(4);
      expect(result.groups[1].entities).toHaveLength(4);
      expect(result.groups[0].label).toBe('A');
      expect(result.groups[1].label).toBe('B');
      // 2 Gruppen × 4 Teams → 6 Matches pro Gruppe = 12 total
      const allMatches = result.rounds.flatMap((r) => r.matches);
      expect(allMatches).toHaveLength(12);
      // groupLabel ist gesetzt
      const groupLabels = new Set(result.rounds.map((r) => r.groupLabel));
      expect(groupLabels.size).toBe(2);
    });

    it('wirft bei falscher Team-Anzahl', () => {
      expect(() =>
        generateGroupPhase([e('A', 1), e('B', 2)], { groupCount: 2, teamsPerGroup: 4 })
      ).toThrow();
    });

    it('16 Teams in 4 Gruppen (4 pro Gruppe) → 4×6 = 24 Matches', () => {
      const teams = Array.from({ length: 16 }, (_, i) => e(`t${i + 1}`, i + 1));
      const result = generateGroupPhase(teams, { groupCount: 4, teamsPerGroup: 4 });
      expect(result.groups).toHaveLength(4);
      const allMatches = result.rounds.flatMap((r) => r.matches);
      expect(allMatches).toHaveLength(24);
    });
  });

  describe('generateKnockoutFromStandings', () => {
    it('2 Gruppen × 2 Advancer = 4 Teams, Single-Elim', () => {
      const groupA = { groupLabel: 'A', standings: [e('t1', 1), e('t4', 4)] };
      const groupB = { groupLabel: 'B', standings: [e('t2', 2), e('t3', 3)] };
      const result = generateKnockoutFromStandings([groupA, groupB], { entityType: 'team' });
      expect(result.stageType).toBe('single_elimination');
      expect(result.entityType).toBe('team');
      // 4 Teams → 2 Rounds, 3 Matches
      expect(result.rounds).toHaveLength(2);
      expect(result.rounds[0].matches).toHaveLength(2);
      // Alle Rounds haben phase: 'knockout'
      result.rounds.forEach((r) => expect(r.phase).toBe('knockout'));
    });

    it('wirft bei weniger als 2 Advancern', () => {
      expect(() => generateKnockoutFromStandings([{ standings: [e('t1')] }])).toThrow();
    });
  });

  describe('generateGroupPlusKnockoutGroupPhase', () => {
    it('routed auf generateGroupPhase', () => {
      const teams = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => e(`t${n}`, n));
      const result = generateGroupPlusKnockoutGroupPhase(teams, {
        groupCount: 2,
        teamsPerGroup: 4,
      });
      expect(result.stageType).toBe('group_phase');
    });
  });

  describe('generateBracket dispatcher', () => {
    it('leitet single_elimination weiter', () => {
      const result = generateBracket('single_elimination', [e('A', 1), e('B', 2)]);
      expect(result.stageType).toBe('single_elimination');
    });
    it('leitet group_plus_knockout an Group-Phase weiter', () => {
      const teams = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => e(`t${n}`, n));
      const result = generateBracket('group_plus_knockout', teams, {
        groupConfig: { groupCount: 2, teamsPerGroup: 4 },
      });
      expect(result.stageType).toBe('group_phase');
    });
    it('liefert skipped für custom', () => {
      const result = generateBracket('custom', [e('A', 1), e('B', 2)]);
      expect(result.skipped).toBeDefined();
    });
  });

  describe('computeNextAdvancesForResult', () => {
    it('liefert leeres Array bei Draw', () => {
      expect(
        computeNextAdvancesForResult({
          winnerTeamId: 't-1',
          isDraw: true,
          nextWinnerMatchId: 'm-3',
          nextWinnerSlot: 'home',
        })
      ).toEqual([]);
    });
    it('liefert leeres Array ohne nextWinnerMatchId', () => {
      expect(
        computeNextAdvancesForResult({
          winnerTeamId: 't-1',
          isDraw: false,
          nextWinnerMatchId: null,
        })
      ).toEqual([]);
    });
    it('liefert Slot für gültiges completed Match (winnerTeamId)', () => {
      expect(
        computeNextAdvancesForResult({
          winnerTeamId: 't-1',
          isDraw: false,
          nextWinnerMatchId: 'm-3',
          nextWinnerSlot: 'home',
        })
      ).toEqual([{ matchId: 'm-3', slot: 'home' }]);
    });
  });

  describe('flattenMatchesForDb', () => {
    it('flacht Rounds für entityType: team in homeTeamId/awayTeamId ab', () => {
      const rounds = [
        {
          roundNumber: 1,
          name: 'HF',
          phase: 'main',
          matches: [
            { matchNumber: 1, homeEntityId: 't1', awayEntityId: 't2', isBye: false },
            { matchNumber: 2, homeEntityId: null, awayEntityId: 't3', isBye: true },
          ],
        },
      ];
      const ctx = {
        instanceId: 'inst-1',
        entityType: 'team',
        roundIdByRoundNumber: new Map([[1, 'round-1']]),
      };
      const rows = flattenMatchesForDb(rounds, ctx);
      expect(rows).toHaveLength(2);
      expect(rows[0].homeTeamId).toBe('t1');
      expect(rows[0].awayTeamId).toBe('t2');
      expect(rows[0].homeParticipantId).toBeUndefined();
      // BYE
      expect(rows[1].status).toBe('completed');
      expect(rows[1].winnerTeamId).toBe('t3');
    });

    it('flacht Rounds für entityType: participant in homeParticipantId/awayParticipantId ab', () => {
      const rounds = [
        {
          roundNumber: 1,
          name: 'HF',
          phase: 'main',
          matches: [{ matchNumber: 1, homeEntityId: 'p1', awayEntityId: 'p2', isBye: false }],
        },
      ];
      const ctx = {
        instanceId: 'inst-1',
        entityType: 'participant',
        roundIdByRoundNumber: new Map([[1, 'round-1']]),
      };
      const rows = flattenMatchesForDb(rounds, ctx);
      expect(rows[0].homeParticipantId).toBe('p1');
      expect(rows[0].awayParticipantId).toBe('p2');
      expect(rows[0].homeTeamId).toBeUndefined();
    });

    it('propagiert groupLabel für group_phase-Matches', () => {
      const rounds = [
        {
          roundNumber: 1,
          name: 'Spieltag 1',
          phase: 'group',
          groupLabel: 'A',
          matches: [{ matchNumber: 1, homeEntityId: 't1', awayEntityId: 't2', isBye: false }],
        },
      ];
      const ctx = {
        instanceId: 'inst-1',
        entityType: 'team',
        roundIdByRoundNumber: new Map([[1, 'round-1']]),
      };
      const rows = flattenMatchesForDb(rounds, ctx);
      expect(rows[0].phase).toBe('group');
      expect(rows[0].groupLabel).toBe('A');
    });
  });
});
