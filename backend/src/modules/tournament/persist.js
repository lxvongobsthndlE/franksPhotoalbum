/**
 * DB-Persistierung für Engine-Output.
 *
 * Aus routes.js extrahiert, damit:
 *   1. Die Persistierung in Isolation getestet werden kann.
 *   2. Mehrere Engine-Phasen (Generate, Start-KO) sich denselben Helper teilen.
 *
 * Invarianten:
 *   - Eine Transaktion umschließt alle Schreibvorgänge.
 *   - Alte Stages dieses Turniers werden ZUERST gelöscht
 *     (Cascade entfernt Groups + Matches).
 *   - Bei einem Fehler mittendrin verwirft Postgres die gesamte
 *     Transaktion — kein Teilzustand bleibt.
 *
 * Spec §13: "Bei Fehlern im Schritt 4 oder 5 muss klar sein, dass nichts
 * halb angelegt wurde."
 */

import { Prisma } from '@prisma/client';

/**
 * Persistiert ein generateTournament-Ergebnis (Gruppenphase) in der DB.
 *
 * @param {object} prisma      Prisma-Client (oder Transaction-Client).
 * @param {string} tournamentId
 * @param {object} gen          generateTournament-Output:
 *                                { groups: [{ groupKey, groupName, members, matches }],
 *                                  bracket, unresolvedConflicts, … }
 * @returns {Promise<{ groupCount: number, matchCount: number, teamCount: number }>}
 *
 * Schema-Constraints, die hier beachtet werden müssen:
 *   - `matches.id` ist primary key → muss engine-konsistent sein (g_A_1, ko_QF_1, …)
 *   - `groups_.(stageId, key)` ist unique → kein Konflikt innerhalb einer Stage
 *   - `group_memberships.(groupId, teamId)` ist unique
 *
 * Foreign-Keys (laut migration.sql):
 *   - groups_.stageId → stages.id ON DELETE CASCADE
 *   - group_memberships.groupId → groups_.id ON DELETE CASCADE
 *   - group_memberships.teamId → tournament_teams.id ON DELETE CASCADE
 *   - matches.tournamentId, stageId, groupId, teamHome, teamAway → CASCADE / SET NULL
 */
export async function persistGenerated(prisma, tournamentId, gen) {
  return prisma.$transaction(async (tx) => {
    // 1) Alte Stages dieses Turniers löschen (Cascade auf Groups + Matches).
    await tx.stage.deleteMany({ where: { tournamentId } });

    // 2) Eine Stage für die Gruppenphase.
    const groupStage = await tx.stage.create({
      data: {
        tournamentId,
        type: 'group',
        name: 'Gruppenphase',
        orderIndex: 0,
      },
    });

    let matchCount = 0;
    let teamCount = 0;

    // 3) Pro Gruppe: Group_ + Memberships + Round-Robin-Matches.
    for (let i = 0; i < gen.groups.length; i++) {
      const g = gen.groups[i];

      // 3a) Group_-Row.
      const groupRow = await tx.group_.create({
        data: {
          stageId: groupStage.id,
          key: g.groupKey,
          name: g.groupName,
        },
      });

      // 3b) Memberships (Team → Gruppe).
      const members = g.members ?? [];
      if (members.length > 0) {
        await tx.groupMembership.createMany({
          data: members.map((t) => ({
            groupId: groupRow.id,
            teamId: t.id,
            position: t.seed ?? null,
          })),
        });
        teamCount += members.length;
      }

      // 3c) Matches. Jede Group hat n(n-1)/2 Round-Robin-Spiele.
      const matches = g.matches ?? [];
      if (matches.length > 0) {
        await tx.match.createMany({
          data: matches.map((m) => ({
            id: m.id,
            tournamentId,
            stageId: groupStage.id,
            groupId: groupRow.id,
            round: String(m.roundNumber ?? m.round ?? 1),
            bracketType: 'winner',
            bracketPos: m.bracketPos ?? null,
            teamHome: m.teamHome,
            teamAway: m.teamAway,
            placeholderHome: m.placeholderHome ?? undefined,
            placeholderAway: m.placeholderAway ?? undefined,
            status: 'scheduled',
            scheduledAt: m.scheduledAt ?? null,
            field: m.field ?? null,
          })),
        });
        matchCount += matches.length;
      }
    }

    // 4) KO-Bracket (falls vorhanden). Wird in einer separaten Phase erzeugt
    //    (nach Ende der Gruppenphase). Hier noch leer, der Helper bleibt
    //    offen dafür.
    //    TODO: wenn persistBracket() existiert, hier aufrufen.

    return { groupCount: gen.groups.length, matchCount, teamCount };
  });
}

/**
 * Schreibt einen Cascade-Reset ab einem Match (Spec §6.4).
 * Wird vom Result-Endpoint aufgerufen, wenn ein Match-Sieger sich ändert
 * und downstream-Matches ungültig werden.
 *
 * @returns {Promise<number>} Anzahl zurückgesetzter Matches.
 */
export async function cascadeResetMatches(prisma, rootMatchId) {
  const all = await prisma.match.findMany({
    where: {
      OR: [
        { winnerAdvancesTo: rootMatchId },
        { loserAdvancesTo: rootMatchId },
      ],
    },
    select: { id: true },
  });
  if (all.length === 0) return 0;
  // Iterativ — alle indirekten Nachfolger ebenfalls zurücksetzen.
  const visited = new Set([rootMatchId]);
  const queue = all.map((m) => m.id);
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const downstream = await prisma.match.findMany({
      where: {
        OR: [{ winnerAdvancesTo: id }, { loserAdvancesTo: id }],
      },
      select: { id: true },
    });
    queue.push(...downstream.map((m) => m.id));
  }
  const toReset = [...visited].filter((id) => id !== rootMatchId);
  if (toReset.length === 0) return 0;
  const result = await prisma.match.updateMany({
    where: { id: { in: toReset } },
    data: {
      teamHome: null,
      teamAway: null,
      scoreHome: null,
      scoreAway: null,
      status: 'scheduled',
    },
  });
  return result.count;
}

/**
 * Re-export für Aufrufer, die `Prisma` nicht direkt importieren wollen.
 */
export { Prisma };
