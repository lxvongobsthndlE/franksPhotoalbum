/**
 * Match-DTO — die zentrale Anzeige-Einheit.
 *
 * Spec §13.11: "Eine einzige Match-Komponente wird in Spielplan, Gruppen, Baum
 * und Kontextspalte wiederverwendet." Daraus folgt: EIN DTO für alle Views.
 *
 * Roh-DB-Felder (Match):
 *   id, tournamentId, stageId, groupId, round, bracketType, bracketPos,
 *   teamHome, teamAway, placeholderHome, placeholderAway,
 *   scoreHome, scoreAway, status, field, scheduledAt,
 *   winnerAdvancesTo, loserAdvancesTo
 *
 * Pflicht-Felder im DTO:
 *   - id, label        (z.B. "VF 1", "Gruppenspiel A2")
 *   - round, roundLabel
 *   - home, away       (jeweils Team-Objekt ODER Placeholder-Text)
 *   - scoreHome, scoreAway
 *   - statusLabel      (deutsch: offen/läuft/beendet)
 *   - field, scheduledTime, scheduledWeekday
 *   - winnerLabel, loserLabel  (für "Sieger spielt im HF 1")
 *   - isFinished, winner, loser (team-id)
 *
 * `ctx` enthält Lookups:
 *   teams   : Map<teamId, preparedTeam>
 *   stages  : Map<stageId, { name, type, orderIndex }>
 *   groups  : Map<groupId, { key, name }>
 *   matches : Map<matchId, preparedMatch>   (für "Sieger HF 1" Lookup)
 *   options : { singleDay: boolean }
 */

import { resolvePlaceholder } from './placeholder.js';
import { matchStatusLabel, stageTypeLabel, roundLabel } from './status.js';
import { formatMatchTime, formatTime, formatWeekdayDate, formatDuration } from './time.js';

function safeNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function safeGet(map, key) {
  if (!map || key == null) return undefined;
  return map.get(key);
}

/**
 * Erzeugt die Match-Anzeigebezeichnung (Spec §8.6).
 *   - Gruppenphase:   "Gruppenspiel A2"  (zweites Spiel in Gruppe A)
 *   - KO:             "VF 1" / "HF 2" / "F" / "3RD"
 *   - Sonderfall 3RD: "Spiel um Platz 3"
 */
export function buildMatchLabel(rawMatch, ctx) {
  const round = rawMatch.round;
  const group = safeGet(ctx?.groups, rawMatch.groupId);
  const bracketPos = safeNumber(rawMatch.bracketPos);

  if (round === '3RD') return 'Spiel um Platz 3';
  if (round === 'F') return 'Finale';

  if (round && bracketPos != null) {
    const prefix = roundShortLabel(round);
    if (prefix) return `${prefix} ${bracketPos}`;
  }

  if (group?.key && bracketPos != null) {
    return `Gruppenspiel ${group.key}${bracketPos}`;
  }

  return 'Spiel';
}

// "VF 1" statt "Viertelfinale 1" — Spec §8.6: kurze Labels im UI.
function roundShortLabel(round) {
  switch (round) {
    case 'R32':
      return 'SF';
    case 'R16':
      return 'AF';
    case 'QF':
      return 'VF';
    case 'SF':
      return 'HF';
    case 'F':
      return 'F';
    default:
      return null;
  }
}

/**
 * Liefert true, wenn dieses Match einen Sieger braucht (alle KO).
 */
function isKoMatch(stageType) {
  return stageType === 'ko' || stageType === 'losers';
}

/**
 * Baut die Home/Away-Slots: entweder Team-DTO oder Placeholder.
 */
function buildSlot(side, rawHome, rawAway, placeholder, teams) {
  const teamId = side === 'home' ? rawHome : rawAway;
  const placeholderValue = side === 'home' ? placeholder : placeholder;

  if (teamId) {
    const team = teams?.get(teamId);
    return {
      kind: 'team',
      teamId,
      name: team?.name ?? '—',
      color: team?.color ?? null,
      logoUrl: team?.logoUrl ?? null,
    };
  }
  if (placeholderValue != null) {
    return {
      kind: 'placeholder',
      teamId: null,
      name: resolvePlaceholder(placeholderValue) ?? '—',
      color: null,
      logoUrl: null,
    };
  }
  return null;
}

/**
 * Hauptfunktion: Match-Roh-DB-Zeile → Anzeigeobjekt.
 *
 * @param {object} rawMatch         Match-DB-Zeile (oder preparedMatch)
 * @param {object} ctx              { teams, stages, groups, matches, options }
 */
export function prepareMatchView(rawMatch, ctx = {}) {
  if (rawMatch == null) return null;

  const {
    teams = new Map(),
    stages = new Map(),
    groups = new Map(),
    matches = new Map(),
    options = {},
  } = ctx;

  const stage = safeGet(stages, rawMatch.stageId);
  const group = safeGet(groups, rawMatch.groupId);
  const singleDay = options.singleDay !== false; // Default: eintägig
  const ko = isKoMatch(stage?.type);

  const home = buildSlot(
    'home',
    rawMatch.teamHome,
    rawMatch.teamAway,
    rawMatch.placeholderHome,
    teams
  );
  const away = buildSlot(
    'away',
    rawMatch.teamHome,
    rawMatch.teamAway,
    rawMatch.placeholderAway,
    teams
  );
  const homeTeamDto = safeGet(teams, rawMatch.teamHome);
  const awayTeamDto = safeGet(teams, rawMatch.teamAway);

  const status = rawMatch.status ?? 'scheduled';
  const isFinished = status === 'finished';
  const isLive = status === 'live';

  const scoreHome = safeNumber(rawMatch.scoreHome);
  const scoreAway = safeNumber(rawMatch.scoreAway);

  // Sieger/Verlierer nur in KO-Matches relevant.
  // IDs explizit als *TeamId markiert — Anzeige-Felder (winnerName)
  // sind die Quelle für die UI.
  let winnerTeamId = null;
  let loserTeamId = null;
  let winnerName = null;
  let loserName = null;
  if (isFinished && ko) {
    if (scoreHome != null && scoreAway != null) {
      if (scoreHome > scoreAway) {
        winnerTeamId = rawMatch.teamHome ?? null;
        loserTeamId = rawMatch.teamAway ?? null;
        winnerName = homeTeamDto?.name ?? null;
        loserName = awayTeamDto?.name ?? null;
      } else if (scoreAway > scoreHome) {
        winnerTeamId = rawMatch.teamAway ?? null;
        loserTeamId = rawMatch.teamHome ?? null;
        winnerName = awayTeamDto?.name ?? null;
        loserName = homeTeamDto?.name ?? null;
      }
      // Unentschieden in KO → kein Sieger (UI muss Penalty-Sieger anbieten)
    }
  }

  // Folge-Match-Lookups (für "Sieger spielt im …")
  const winnerAdvancesTo = safeGet(matches, rawMatch.winnerAdvancesTo);
  const loserAdvancesTo = safeGet(matches, rawMatch.loserAdvancesTo);

  return {
    id: rawMatch.id,
    tournamentId: rawMatch.tournamentId,
    stageId: rawMatch.stageId,
    stageName: stage?.name ?? '',
    stageType: stage?.type ?? null,
    stageTypeLabel: stageTypeLabel(stage?.type),
    orderIndex: stage?.orderIndex ?? null,

    groupId: rawMatch.groupId ?? null,
    groupKey: group?.key ?? null,
    groupName: group?.name ?? null,

    label: buildMatchLabel(rawMatch, ctx),
    round: rawMatch.round ?? null,
    roundLabel: roundLabel(rawMatch.round),
    bracketType: rawMatch.bracketType ?? null,
    bracketPos: safeNumber(rawMatch.bracketPos),

    home,
    away,

    scoreHome,
    scoreAway,
    status,
    statusLabel: matchStatusLabel(status),
    isFinished,
    isLive,

    // Technical IDs (folgen der "XxxId"-Namens-Konvention).
    winnerTeamId,
    loserTeamId,
    // Anzeige-Felder (Namen) — dürfen NIE wie eine DB-ID aussehen.
    winnerName,
    loserName,
    winnerLabel: winnerAdvancesTo ? `Sieger ${winnerAdvancesTo.label}` : null,
    loserLabel: loserAdvancesTo ? `Verlierer ${loserAdvancesTo.label}` : null,

    field: safeNumber(rawMatch.field),
    scheduledAt: rawMatch.scheduledAt ?? null,
    scheduledTime: formatTime(rawMatch.scheduledAt),
    scheduledDate: singleDay ? '' : formatWeekdayDate(rawMatch.scheduledAt),
    scheduledLabel: formatMatchTime(rawMatch.scheduledAt, { singleDay }),

    duration: formatDuration(rawMatch.durationMinutes ?? null),

    winnerAdvancesToId: rawMatch.winnerAdvancesTo ?? null,
    loserAdvancesToId: rawMatch.loserAdvancesTo ?? null,

    isPlaceholder: home?.kind === 'placeholder' || away?.kind === 'placeholder',
    isGroupMatch: stage?.type === 'group' || stage?.type === 'intermediate_group',
    isKoMatch: ko,
  };
}

/**
 * Liste → DTO-Liste.
 */
export function prepareMatchList(rawMatches, ctx) {
  if (!Array.isArray(rawMatches)) return [];
  return rawMatches.map((m) => prepareMatchView(m, ctx));
}

/**
 * Lookup-Map: matchId → preparedMatch.
 * Wird für Folge-Match-Labels gebraucht.
 */
export function buildMatchLookup(rawMatches, ctx) {
  const map = new Map();
  for (const raw of rawMatches ?? []) {
    map.set(raw.id, prepareMatchView(raw, ctx));
  }
  return map;
}
