// ──────────────────────────────────────────────────────────────────────────────
// Tournament Bracket Generator (Phase 3 – entityType-aware + Group+Knockout)
// ──────────────────────────────────────────────────────────────────────────────
//
// Reine Funktionen, die aus einer Liste von Entities (Teams ODER Participants)
// eine Match-Struktur (Rounds + Matches) erzeugen. Keine DB-Zugriffe.
//
// Jede Entity ist ein Objekt mit mindestens:
//   - id            (string)
//   - seed          (number|null)
//   - displayName   (string)
//   - teamId        (string|null) – nur bei Participants relevant
//
// Modi:
//   - 'team' | 'pair'  → entityType: 'team'        → Matches referenzieren Teams
//   - 'individual'     → entityType: 'participant'  → Matches referenzieren Participants
//
// Jedes Match in der Ausgabe hat generische Felder (homeEntityId, awayEntityId).
// flattenMatchesForDb schreibt sie in die richtigen DB-Spalten je nach entityType.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Bringt Entities in eine stabile Seed-Reihenfolge.
 */
export function sortBySeed(entities) {
  return entities
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => {
      const sa = a.e.seed;
      const sb = b.e.seed;
      if (sa != null && sb != null) return sa - sb;
      if (sa != null) return -1;
      if (sb != null) return 1;
      return a.idx - b.idx;
    })
    .map((entry) => entry.e);
}

/**
 * Rundet die Anzahl auf die nächste Zweierpotenz auf und liefert die BYE-Anzahl.
 */
export function nextPowerOfTwoWithByes(n) {
  if (n < 2) return { size: 2, byes: 2 - n };
  let size = 2;
  while (size < n) size *= 2;
  if (size > 256) {
    throw new Error('Tournament bracket generation is limited to 256 participants');
  }
  return { size, byes: size - n };
}

/**
 * Snake-Draft-Verteilung: Top-Seed zu Gruppe 0, zweitbester zu letzter Gruppe,
 * drittbester zu vorletzter Gruppe, etc. (Wikipedia "Snake seeding")
 * @returns {Array<Array<Entity>>} groups[groupIndex] = [entities...]
 */
export function snakeDraftIntoGroups(entities, groupCount) {
  const sorted = sortBySeed(entities);
  const groups = Array.from({ length: groupCount }, () => []);
  for (let i = 0; i < sorted.length; i += 1) {
    const round = Math.floor(i / groupCount);
    const pos = i % groupCount;
    const groupIdx = round % 2 === 0 ? pos : groupCount - 1 - pos;
    groups[groupIdx].push(sorted[i]);
  }
  return groups;
}

/**
 * Verteilt Round-Robin-Paarungen für eine einzelne Gruppe (Circle-Method).
 * @returns {Array<{roundNumber, matches: [{homeEntity, awayEntity}]}>}
 */
function generateRoundRobinForGroup(groupEntities, groupLabel) {
  const n = groupEntities.length;
  if (n < 2) return [];
  const isOdd = n % 2 === 1;
  const slots = isOdd ? [...groupEntities, null] : [...groupEntities];
  const numRounds = slots.length - 1;
  const halfSize = slots.length / 2;
  const rounds = [];
  let working = [...slots];

  for (let r = 0; r < numRounds; r += 1) {
    const matches = [];
    for (let i = 0; i < halfSize; i += 1) {
      const home = working[i];
      const away = working[slots.length - 1 - i];
      matches.push({
        matchNumber: i + 1,
        homeEntityId: home?.id ?? null,
        awayEntityId: away?.id ?? null,
        isBye: !home || !away,
      });
    }
    rounds.push({
      roundNumber: r + 1,
      name: `Spieltag ${r + 1}`,
      bracket: 'group',
      groupLabel,
      matches,
    });
    const fixed = working[0];
    const rest = working.slice(1);
    rest.unshift(rest.pop());
    working = [fixed, ...rest];
  }
  return rounds;
}

/**
 * Group-Phase-Generator: Snake-Draft + Round-Robin in jeder Gruppe.
 *
 * @param {Array} entities – alle spielenden Entities (Teams oder Participants)
 * @param {{ groupCount: number, teamsPerGroup: number }} config
 * @returns {{ stageType: string, rounds: Array, groups: Array, entityType: string }}
 */
export function generateGroupPhase(entities, config = {}) {
  const groupCount = Math.max(1, Number(config.groupCount) || 1);
  const teamsPerGroup = Math.max(2, Number(config.teamsPerGroup) || 2);
  const expectedTotal = groupCount * teamsPerGroup;

  if (entities.length !== expectedTotal) {
    throw new Error(
      `Group-Phase erwartet ${expectedTotal} Teams (${groupCount} Gruppen × ${teamsPerGroup}), aber ${entities.length} vorhanden.`
    );
  }

  const groups = snakeDraftIntoGroups(entities, groupCount);
  const allRounds = [];
  const groupLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  groups.forEach((groupEntities, idx) => {
    const label = groupLabels[idx] || `G${idx + 1}`;
    const rounds = generateRoundRobinForGroup(groupEntities, label);
    // Setze globale roundNumber
    rounds.forEach((r) => {
      r.roundNumber = allRounds.length + 1;
      allRounds.push(r);
    });
  });

  return {
    stageType: 'group_phase',
    entityType: 'team', // default; im Frontend konfigurierbar
    rounds: allRounds,
    groups: groups.map((g, idx) => ({
      label: groupLabels[idx] || `G${idx + 1}`,
      entities: g,
    })),
  };
}

/**
 * Single-Elimination-Bracket aus einer Liste von Entities.
 * @param {Array} entities
 * @param {{ entityType?: 'team' | 'participant' }} options
 * @returns {{ stageType: string, rounds: Array, entityType: string, byesApplied: number }}
 */
export function generateSingleElim(entities, options = {}) {
  const entityType = options.entityType || 'team';
  if (!Array.isArray(entities) || entities.length < 2) {
    throw new Error('Mindestens 2 Entities für Single-Elimination erforderlich');
  }

  const { size, byes } = nextPowerOfTwoWithByes(entities.length);
  const seeded = sortBySeed(entities).slice(0, size);
  const order = computeSeedingOrder(size);
  const slots = order.map((idx) => seeded[idx] || null);

  const rounds = [];
  const round1Matches = [];
  for (let i = 0; i < size; i += 2) {
    const home = slots[i];
    const away = slots[i + 1];
    round1Matches.push({
      matchNumber: i / 2 + 1,
      homeEntityId: home?.id ?? null,
      awayEntityId: away?.id ?? null,
      nextWinnerMatchId: null,
      nextWinnerSlot: null,
      nextLoserMatchId: null,
      nextLoserSlot: null,
      isBye: !home || !away,
    });
  }
  rounds.push({
    roundNumber: 1,
    name: size === 2 ? 'Finale' : size === 4 ? 'Halbfinale' : `Runde 1 (${size} Teilnehmer)`,
    bracket: 'main',
    phase: 'main',
    matches: round1Matches,
  });

  let matchesInRound = size / 4;
  let roundNumber = 2;
  while (matchesInRound >= 1) {
    const matches = [];
    for (let m = 0; m < matchesInRound; m += 1) {
      matches.push({
        matchNumber: m + 1,
        homeEntityId: null,
        awayEntityId: null,
        nextWinnerMatchId: null,
        nextWinnerSlot: null,
        nextLoserMatchId: null,
        nextLoserSlot: null,
        isBye: false,
      });
    }
    const isFinal = matchesInRound === 1;
    rounds.push({
      roundNumber,
      name: isFinal ? 'Finale' : roundNameFor(matchesInRound * 2),
      bracket: 'main',
      phase: 'main',
      matches,
    });
    matchesInRound = Math.floor(matchesInRound / 2);
    roundNumber += 1;
  }
  wireWinnerAdvancement(rounds);

  return { stageType: 'single_elimination', entityType, rounds, byesApplied: byes };
}

/**
 * Double-Elimination – Winners + Losers + Grand Final.
 */
export function generateDoubleElim(entities, options = {}) {
  const entityType = options.entityType || 'team';
  if (!Array.isArray(entities) || entities.length < 3) {
    throw new Error('Mindestens 3 Entities für Double-Elimination empfohlen');
  }

  const { size, byes } = nextPowerOfTwoWithByes(entities.length);
  const seeded = sortBySeed(entities).slice(0, size);
  const order = computeSeedingOrder(size);
  const slots = order.map((idx) => seeded[idx] || null);

  const wbRounds = [];
  const wbRound1 = [];
  for (let i = 0; i < size; i += 2) {
    const home = slots[i];
    const away = slots[i + 1];
    wbRound1.push({
      matchNumber: i / 2 + 1,
      homeEntityId: home?.id ?? null,
      awayEntityId: away?.id ?? null,
      isBye: !home || !away,
    });
  }
  wbRounds.push({
    roundNumber: 1,
    name: 'WB Runde 1',
    bracket: 'winners',
    phase: 'main',
    matches: wbRound1,
  });
  let wbMatchesInRound = size / 4;
  let wbRound = 2;
  while (wbMatchesInRound >= 1) {
    const matches = [];
    for (let m = 0; m < wbMatchesInRound; m += 1) {
      matches.push({
        matchNumber: m + 1,
        homeEntityId: null,
        awayEntityId: null,
        isBye: false,
      });
    }
    const isWbFinal = wbMatchesInRound === 1;
    wbRounds.push({
      roundNumber: wbRound,
      name: isWbFinal ? 'WB Finale' : `WB Runde ${wbRound}`,
      bracket: 'winners',
      phase: 'main',
      matches,
    });
    wbMatchesInRound = Math.floor(wbMatchesInRound / 2);
    wbRound += 1;
  }
  wireWinnerAdvancement(wbRounds);

  const lbRounds = [];
  let lbInRound = size / 2;
  let lbRoundNum = 1;
  while (lbInRound >= 1) {
    const matches = [];
    for (let m = 0; m < lbInRound; m += 1) {
      matches.push({
        matchNumber: m + 1,
        homeEntityId: null,
        awayEntityId: null,
        isBye: false,
      });
    }
    lbRounds.push({
      roundNumber: lbRoundNum,
      name: `LB Runde ${lbRoundNum}`,
      bracket: 'losers',
      phase: 'main',
      matches,
    });
    lbInRound = Math.floor(lbInRound / 2);
    lbRoundNum += 1;
  }
  wireWinnerAdvancement(lbRounds);

  const grandFinal = {
    roundNumber: 1,
    name: 'Grand Final',
    bracket: 'grand_final',
    phase: 'main',
    matches: [{ matchNumber: 1, homeEntityId: null, awayEntityId: null, isBye: false }],
  };
  wireWinnerAdvancement([grandFinal]);

  const allRounds = [...wbRounds, ...lbRounds, grandFinal];
  let globalRound = 1;
  for (const round of allRounds) {
    round.roundNumber = globalRound;
    globalRound += 1;
  }
  return { stageType: 'double_elimination', entityType, rounds: allRounds, byesApplied: byes };
}

/**
 * Round Robin – ein großer Topf, jeder gegen jeden.
 */
export function generateRoundRobin(entities, options = {}) {
  const entityType = options.entityType || 'team';
  if (!Array.isArray(entities) || entities.length < 2) {
    throw new Error('Mindestens 2 Entities für Round-Robin erforderlich');
  }
  const sorted = sortBySeed(entities);
  const n = sorted.length;
  const isOdd = n % 2 === 1;
  const slots = isOdd ? [...sorted, null] : [...sorted];
  const numRounds = slots.length - 1;
  const halfSize = slots.length / 2;
  const rounds = [];
  let working = [...slots];

  for (let r = 0; r < numRounds; r += 1) {
    const matches = [];
    for (let i = 0; i < halfSize; i += 1) {
      const home = working[i];
      const away = working[slots.length - 1 - i];
      matches.push({
        matchNumber: i + 1,
        homeEntityId: home?.id ?? null,
        awayEntityId: away?.id ?? null,
        isBye: !home || !away,
      });
    }
    rounds.push({
      roundNumber: r + 1,
      name: `Spieltag ${r + 1}`,
      bracket: 'main',
      phase: 'main',
      matches,
    });
    const fixed = working[0];
    const rest = working.slice(1);
    rest.unshift(rest.pop());
    working = [fixed, ...rest];
  }
  return { stageType: 'round_robin', entityType, rounds };
}

/**
 * Group + Knockout (zweistufig). Liefert NUR die Group-Phase jetzt zurück;
 * die KO-Phase wird nach Abschluss der Gruppen separat generiert
 * (siehe generateKnockoutFromStandings).
 */
export function generateGroupPlusKnockoutGroupPhase(entities, config = {}) {
  return generateGroupPhase(entities, config);
}

/**
 * Erzeugt das KO-Bracket aus den Top-N-Entities jeder Gruppe.
 * Wird aufgerufen NACHDEM alle Group-Phase-Matches completed sind.
 *
 * @param {Array<{groupLabel: string, standings: Array<Entity>}>} groupResults
 * @param {{ entityType?: 'team' | 'participant' }} options
 */
export function generateKnockoutFromStandings(groupResults, options = {}) {
  const entityType = options.entityType || 'team';
  // groupResults: [{ groupLabel, standings: [entity, ...] }] – standings bereits sortiert
  const advancers = [];
  groupResults.forEach((g) => {
    g.standings.forEach((entity, idx) => {
      // Jede Gruppe liefert die Top X (X = längste Standings-Liste aller Gruppen)
      // Wir nehmen alle Entities, die in den Standings sind, bis zur Mindestlänge
      advancers.push({ entity, groupLabel: g.groupLabel, groupPosition: idx + 1 });
    });
  });
  // Bestimme advancingPerGroup = min(advancers pro Gruppe) – konservativ
  // In der Praxis kommt das aus config. Hier: advancers.length = groupCount × advancingPerGroup
  const total = advancers.length;
  if (total < 2) {
    throw new Error('Mindestens 2 Advancer nötig für KO-Phase');
  }
  // Konvertiere zu flacher Entity-Liste mit Seeding basierend auf Gruppen-Platzierung
  // + Tie-Breaker: gleicher Gruppen-Platz → Teams mit besserem Seeding vorne
  const advancerEntities = advancers
    .sort((a, b) => {
      if (a.groupPosition !== b.groupPosition) return a.groupPosition - b.groupPosition;
      return (a.entity.seed ?? 999) - (b.entity.seed ?? 999);
    })
    .map((a) => a.entity);

  // Erzeuge KO-Bracket aus den Advancern
  const ko = generateSingleElim(advancerEntities, { entityType });
  // Markiere alle Rounds als 'knockout'-Phase
  ko.rounds.forEach((r) => {
    r.phase = 'knockout';
  });
  return ko;
}

/**
 * Dispatcher: generiert je nach stageType die passende Struktur.
 */
export function generateBracket(stageType, entities, options = {}) {
  switch (stageType) {
    case 'single_elimination':
      return generateSingleElim(entities, options);
    case 'double_elimination':
      return generateDoubleElim(entities, options);
    case 'round_robin':
      return generateRoundRobin(entities, options);
    case 'group_plus_knockout':
      return generateGroupPhase(entities, options.groupConfig || {});
    case 'group_phase':
      return generateGroupPhase(entities, options.groupConfig || {});
    case 'custom':
    default:
      return { stageType, rounds: [], skipped: 'bracket_generation_not_supported_for_stage' };
  }
}

// ── Hilfsfunktionen ────────────────────────────────────────────────────────

function wireWinnerAdvancement(rounds) {
  for (let r = 0; r < rounds.length - 1; r += 1) {
    const current = rounds[r].matches;
    const next = rounds[r + 1].matches;
    if (!next || next.length === 0) continue;
    current.forEach((match, idx) => {
      const nextIdx = Math.floor(idx / 2);
      const slot = idx % 2 === 0 ? 'home' : 'away';
      const nextMatch = next[nextIdx];
      if (nextMatch) {
        match.nextWinnerMatchId = temporaryMatchId(nextMatch);
        match.nextWinnerSlot = slot;
      }
    });
  }
}

function temporaryMatchId(match) {
  return `__tmp_match_${match.matchNumber}`;
}

function computeSeedingOrder(n) {
  if (n < 2) return [0];
  if (n === 2) return [0, 1];
  const prev = computeSeedingOrder(n / 2);
  const result = [];
  for (let i = 0; i < prev.length; i += 1) {
    result.push(prev[i]);
    result.push(n - 1 - prev[i]);
  }
  return result;
}

function roundNameFor(participantCount) {
  if (participantCount === 2) return 'Finale';
  if (participantCount === 4) return 'Halbfinale';
  if (participantCount === 8) return 'Viertelfinale';
  if (participantCount === 16) return 'Achtelfinale';
  if (participantCount === 32) return 'Sechzehntelfinale';
  return `Runde mit ${participantCount} Teilnehmern`;
}

/**
 * Hilfsfunktion für Auto-Advance-Logik in der Route.
 */
export function computeNextAdvancesForResult(completedMatch) {
  if (
    !completedMatch?.winnerEntityId &&
    !completedMatch?.winnerParticipantId &&
    !completedMatch?.winnerTeamId
  )
    return [];
  if (completedMatch.isDraw) return [];
  if (!completedMatch.nextWinnerMatchId || !completedMatch.nextWinnerSlot) return [];
  return [
    {
      matchId: completedMatch.nextWinnerMatchId,
      slot: completedMatch.nextWinnerSlot,
    },
  ];
}

/**
 * Wandelt eine Generator-Ausgabe in flache Match-Rows um, die direkt in die DB
 * geschrieben werden können. Schreibt je nach entityType in die richtigen Spalten.
 *
 * @param {Array<{roundNumber, name, matches, phase, groupLabel}>} rounds
 * @param {{ roundIdByRoundNumber: Map<number,string>, instanceId: string, entityType: 'team' | 'participant' }} ctx
 */
export function flattenMatchesForDb(rounds, ctx) {
  const out = [];
  for (const round of rounds) {
    const roundId = ctx.roundIdByRoundNumber.get(round.roundNumber);
    if (!roundId) continue;
    for (const m of round.matches) {
      const isTeam = ctx.entityType === 'team';
      const homeField = isTeam ? 'homeTeamId' : 'homeParticipantId';
      const awayField = isTeam ? 'awayTeamId' : 'awayParticipantId';
      out.push({
        instanceId: ctx.instanceId,
        roundId,
        matchNumber: m.matchNumber,
        status: m.isBye ? 'completed' : 'planned',
        phase: round.phase || 'main',
        groupLabel: round.groupLabel || null,
        [homeField]: m.homeEntityId,
        [awayField]: m.awayEntityId,
        nextWinnerSlot: m.nextWinnerSlot,
        nextLoserMatchId: m.nextLoserMatchId,
        nextLoserSlot: m.nextLoserSlot,
        metadata: m.isBye ? { bye: true } : null,
        completedAt: m.isBye ? new Date() : null,
        winnerTeamId: m.isBye && isTeam ? m.homeEntityId || m.awayEntityId || null : null,
        winnerParticipantId: m.isBye && !isTeam ? m.homeEntityId || m.awayEntityId || null : null,
      });
    }
  }
  return out;
}
