/**
 * Aufbereitungsschicht — der Trennpunkt zwischen DB-Zeilen und UI-DTOs.
 *
 * Spec §12 Schritt 3: "Kein Bildschirm greift direkt auf Datenbankzeilen zu.
 * Diese Schicht verhindert die gesamte Fehlerklasse aus §8.0 Punkt 12."
 *
 * Die Routes rufen HIER, nicht die Prisma-Client-Methoden direkt. Wenn eine
 * Anzeige ein Feld braucht, das nicht im DTO steht, wird die Render-Funktion
 * in `access/` erweitert — nicht ein Sonder-Property in einer Route.
 *
 * Public-API für Routen:
 *
 *   buildTournamentViewContext(prisma, tournamentId, opts)
 *     → Liefert alle DTO-Listen für eine Detail-Anzeige:
 *       { tournament, teams, stages, groups, matches, stats }
 *
 *   buildTournamentListContext(prisma, groupId, user, isAdmin)
 *     → Liefert eine Tournament-Liste als DTO-Liste.
 *
 *   buildTeamLookup(rawTeams)
 *     → Map<id, preparedTeam> für Folge-Lookups in Match-DTOs.
 *
 *   buildStageLookup(rawStages)
 *   buildGroupLookup(rawGroups)
 *   buildMatchLookup(rawMatches, ctx)
 */

import {
  prepareTournamentView,
  prepareTournamentList,
  prepareTeamList,
  buildTeamLookup,
  prepareMatchList,
  buildMatchLookup,
  prepareGroupList,
  prepareStandings,
  aggregateTournamentStats,
} from './access/index.js';
import { stageTypeLabel } from './access/status.js';
import { buildListWhereClause } from './auth.js';
import { compareTournaments } from './access/visibility.js';

/**
 * Liefert alle für die Detail-Anzeige nötigen Daten als DTOs.
 *
 * @param {object} prisma
 * @param {string} tournamentId
 * @param {object} [opts]
 * @param {boolean} [opts.singleDay]   wird in Match/Tournament-DTOs durchgereicht
 * @returns {Promise<{
 *   tournament: object,
 *   teams: object[],
 *   stages: object[],
 *   groups: object[],
 *   matches: object[],
 *   stats: { teamCount, groupCount, matchCount, finishedCount } | null,
 * }>}
 */
export async function buildTournamentViewContext(prisma, tournamentId, opts = {}) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });
  if (!tournament) {
    const err = new Error('Turnier nicht gefunden');
    err.statusCode = 404;
    throw err;
  }

  const [teams, stages, groups, matches] = await Promise.all([
    prisma.tournamentTeam.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.stage.findMany({
      where: { tournamentId },
      orderBy: { orderIndex: 'asc' },
    }),
    prisma.group_.findMany({
      where: { stage: { tournamentId } },
      orderBy: { key: 'asc' },
      include: {
        memberships: {
          include: { team: true },
          orderBy: { position: 'asc' },
        },
        matches: true,
      },
    }),
    prisma.match.findMany({
      where: { tournamentId },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  // Lookups, auf die Match-/Group-DTOs zurückgreifen.
  const teamsLookup = buildTeamLookup(teams);
  const stagesLookup = buildStageLookup(stages);
  const groupsLookup = buildGroupLookup(groups);
  // Folge-Match-Labels brauchen ein Lookup über bereits präparierte Matches.
  const matchCtx = {
    teams: teamsLookup,
    stages: stagesLookup,
    groups: groupsLookup,
    options: { singleDay: opts.singleDay !== false },
  };
  const matchesLookup = buildMatchLookup(matches, matchCtx);

  const groupDtos = prepareGroupList(groups, {
    teams: teamsLookup,
    stages: stagesLookup,
    groups: groupsLookup,
    matches: matchesLookup,
    options: { singleDay: opts.singleDay !== false },
  });

  const matchDtos = prepareMatchList(matches, {
    teams: teamsLookup,
    stages: stagesLookup,
    groups: groupsLookup,
    matches: matchesLookup,
    options: { singleDay: opts.singleDay !== false },
  });

  const finishedCount = matches.filter((m) => m.status === 'finished').length;

  return {
    tournament: prepareTournamentView(tournament, {
      stats: {
        teamCount: teams.length,
        groupCount: groups.length,
        matchCount: matches.length,
        finishedCount,
      },
      singleDay: opts.singleDay,
    }),
    teams: prepareTeamList(teams),
    stages: stages.map((s) => ({
      id: s.id,
      // technisches Feld, das per DTO-Guard als erlaubt gilt — dient
      // Sortier- und Routing-Logik; das UI greift auf typeLabel zu.
      type: s.type,
      typeLabel: stageTypeLabel(s.type),
      name: s.name,
      orderIndex: s.orderIndex,
    })),
    groups: groupDtos,
    matches: matchDtos,
    // Interne Lookups, die nachgelagerte Helfer brauchen.
    _lookups: { teamsLookup, stagesLookup, groupsLookup, matchesLookup },
    stats: {
      teamCount: teams.length,
      groupCount: groups.length,
      matchCount: matches.length,
      finishedCount,
    },
  };
}

/**
 * Listen-Kontext für eine Gruppe: liefert DTO-Tournaments in der richtigen
 * Sortierung + Counts (Teams/Gruppen/Spiele) für die Karten-Kurzinfo.
 *
 * Spec §13.2: pro Karte braucht das Frontend
 *   "16 Teams · 4 Gruppen · 12 von 24 Spielen gespielt"
 * — also teamCount, groupCount, matchCount, finishedCount.
 *
 * Performance: zwei Aggregations-Queries für ALLE Turniere statt N+1
 * (1× tournament.findMany für Teams/Stages, 1× match.groupBy für Spiele).
 */
export async function buildTournamentListContext(prisma, groupId, user, isAdmin) {
  const where = buildListWhereClause(prisma, groupId, user, isAdmin);
  const raw = await prisma.tournament.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  const sorted = raw.slice().sort(compareTournaments);
  const statsById = await aggregateTournamentStats(
    prisma,
    sorted.map((t) => t.id)
  );
  return {
    tournaments: prepareTournamentList(sorted, { statsById }),
    isAdmin,
    rawCount: raw.length,
  };
}

/**
 * Stage-Lookup.
 */
export function buildStageLookup(rawStages) {
  const map = new Map();
  for (const s of rawStages ?? []) map.set(s.id, s);
  return map;
}

/**
 * Group-Lookup.
 */
export function buildGroupLookup(rawGroups) {
  const map = new Map();
  for (const g of rawGroups ?? []) map.set(g.id, g);
  return map;
}

/**
 * Ermittelt, WER in einer Gruppe spielt.
 *
 * Bis 2026-08-26 war das schlicht die Mitgliederliste (`group.members`).
 * Das ist richtig, solange Mitgliedschaft und Spielplan dasselbe sagen —
 * und genau das ist nicht garantiert:
 *
 *   Die Gruppeneinteilung laesst sich nach der Generierung noch aendern
 *   („Zufaellig verteilen", Paar-Tausch). Die MATCHES bleiben dabei
 *   bewusst, wo sie sind — der Hinweistext im Einstellungen-Tab sagt das
 *   ausdruecklich: „DnD aendert nur die Anzeige der Gruppentabellen — die
 *   Spielpaarungen bleiben gleich."
 *
 * Nur stimmte das letzte Halbsatz nicht: die Tabelle wurde eben NICHT
 * nur anders angezeigt, sie wurde falsch. `computeStandings` zaehlt ein
 * Spiel nur, wenn beide Teams in der uebergebenen Liste stehen. Nach
 * einem Neuverteilen waren das im gemessenen Fall (26.08., „Franks
 * Bierpong Turnier 2.0") in JEDER Gruppe drei von vier Teams nicht mehr
 * — Ergebnis: drei Tabellen, in denen alle Teams bei 0 Spielen standen,
 * obwohl Ergebnisse eingetragen waren.
 *
 * Die Wahrheit einer Gruppentabelle sind die Spiele, die in dieser Gruppe
 * stattfinden. Wer dort spielt, gehoert in die Tabelle. Solange es noch
 * keine Spiele gibt (Entwurf), ist die Mitgliederliste die einzige
 * Auskunft — dann gilt sie.
 *
 * Bewusst KEINE Vereinigung beider Mengen: ein Mitglied, das in dieser
 * Gruppe kein einziges Spiel hat, mit 0 Punkten in ihre Tabelle zu
 * schreiben, behauptet eine Teilnahme, die es nicht gibt.
 */
export function teilnehmerDerGruppe(groupMatches, teamIds) {
  const ausSpielen = new Set();
  for (const m of groupMatches ?? []) {
    if (m?.teamHome) ausSpielen.add(m.teamHome);
    if (m?.teamAway) ausSpielen.add(m.teamAway);
  }
  const liste = Array.isArray(teamIds) ? teamIds : [];
  // Nur bei echtem WIDERSPRUCH umschalten — also wenn hier jemand spielt,
  // der nicht auf der Liste steht. Sonst bleibt die Liste gueltig.
  // Der erste Entwurf hat die Spiele immer gewinnen lassen und dabei ein
  // Mitglied verloren, das nur noch kein Spiel hatte: die Annahme, die
  // uebergebene Spielliste sei vollstaendig, ist nicht garantiert.
  const mitglied = new Set(liste);
  const fremde = [...ausSpielen].filter((id) => !mitglied.has(id));
  if (fremde.length === 0) return liste;
  // Reihenfolge der Mitgliederliste bewahren, wo sie deckungsgleich ist —
  // sie traegt die Setzreihenfolge. Was nur in den Spielen vorkommt,
  // haengt hinten an; die Sortierung macht ohnehin die Tabelle selbst.
  const bekannt = liste.filter((id) => ausSpielen.has(id));
  const rest = [...ausSpielen].filter((id) => !bekannt.includes(id));
  return [...bekannt, ...rest];
}

/**
 * Bereitet Standings inklusive Engine-Berechnung auf.
 * Engine wird hier aufgerufen, NICHT im Route-Layer.
 *
 * @param {object[]} groupMatches - alle Matches einer Gruppe (roh)
 * @param {string[]} teamIds - Mitgliederliste; gilt nur, solange die
 *   Gruppe noch keine Spiele hat (siehe teilnehmerDerGruppe)
 * @param {object} config
 * @param {object} engineApi - { computeStandings, applyTiebreaker }
 * @returns {object[]}
 */
export function buildStandingsForGroup(groupMatches, teamIds, config, engineApi) {
  const finishedForEngine = groupMatches
    .filter((m) => m.status === 'finished')
    .map((m) => ({
      teamHome: m.teamHome,
      teamAway: m.teamAway,
      scoreHome: m.scoreHome,
      scoreAway: m.scoreAway,
      status: m.status,
    }));
  const teilnehmer = teilnehmerDerGruppe(groupMatches, teamIds);
  const rows = engineApi.computeStandings(teilnehmer, finishedForEngine, config);
  const sorted = engineApi.applyTiebreaker(rows, finishedForEngine, config);
  return prepareStandings(sorted.sortedRows ?? sorted, { qualifyTop: 0 });
}

export { prepareStandings };
