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
import { makeCuid } from './engine/cuid.js';

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
    // 1) Alte Matches dieses Turniers explizit entfernen.
    //
    //    Hintergrund: Wenn die Engine für die neue Konfig IDs produziert,
    //    die bereits in der DB liegen (z.B. Re-Generate nach Teamentfernung
    //    oder Konfig-Anpassung), würde das anschließende createMany() mit
    //    "Unique constraint failed on the (not available)" abbrechen.
    //    Der CASCADE auf matches.stageId → stages.id sollte das eigentlich
    //    über die folgende stage.deleteMany erledigen — als
    //    belt-and-suspenders räumen wir hier explizit auf, BEVOR wir die
    //    Stages anfassen. Damit ist die Reihenfolge unabhängig vom
    //    CASCADE-Verhalten der DB.
    await tx.match.deleteMany({ where: { tournamentId } });

    // 2) Alte Stages dieses Turniers löschen (Cascade auf Groups).
    await tx.stage.deleteMany({ where: { tournamentId } });

    // 3) Eine Stage für die Gruppenphase.
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
    // engineId → cuid wird im Verlauf der Transaktion aufgebaut:
    //   - zuerst für die Gruppen-Matches (damit KO-Verweise auf Gruppen
    //     zeigen könnten — Spec §6.3.2 macht das für den direkten Aufstieg)
    //   - dann für die KO-Matches (winnerAdvancesTo / loserAdvancesTo)
    const idMap = new Map();

    // 4) Pro Gruppe: Group_ + Memberships + Round-Robin-Matches.
    for (let i = 0; i < gen.groups.length; i++) {
      const g = gen.groups[i];

      // 4a) Group_-Row.
      const groupRow = await tx.group_.create({
        data: {
          stageId: groupStage.id,
          key: g.groupKey,
          name: g.groupName,
        },
      });

      // 4b) Memberships (Team → Gruppe).
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

      // 4c) Matches. Jede Group hat n(n-1)/2 Round-Robin-Spiele.
      //
      //     Issue 1 Fix (2026-08-12): Wir nehmen NICHT die Engine-ID
      //     (`g_A_1`, `g_B_1`, …) als DB-Primary-Key. Die ist zwar
      //     INNERHALB dieses generate-Aufrufs stabil, aber NICHT global
      //     eindeutig — zwei Turniere mit derselben Konfig würden
      //     kollidierende IDs erzeugen, was die PRIMARY KEY auf matches.id
      //     verletzt und mit "Unique constraint failed on the (not
      //     available)" abbricht. Der vorherige defensive
      //     `match.deleteMany({where:{tournamentId}})` deckt nur Re-Generate
      //     für DASSELBE Turnier ab — ein NEUES Turnier mit kollidierenden
      //     IDs blieb hängen.
      //
      //     Wir generieren daher JETZT pro Match einen frischen cuid,
      //     BEVOR wir inserten, und merken uns das Mapping
      //     engineId → cuid in `idMap`. KO-Matches in Schritt 5
      //     rewiren ihre `winnerAdvancesTo` / `loserAdvancesTo` darüber.
      const matches = g.matches ?? [];
      if (matches.length > 0) {
        await tx.match.createMany({
          data: matches.map((m) => {
            const dbId = makeCuid();
            if (m.id) idMap.set(m.id, dbId);
            return {
              // Frische global-eindeutige ID — kein Risiko mehr, mit
              // Matches anderer Turniere zu kollidieren.
              id: dbId,
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
            };
          }),
        });
        matchCount += matches.length;
      }
    }

    // 5) KO-Bracket (falls vorhanden).
    //
    //    P0-Folge-Aufgabe zu Issue 1 (2026-08-12): Die Verweise
    //    `winnerAdvancesTo` und `loserAdvancesTo` zeigen in der Engine
    //    auf Engine-Labels (`ko_SF_1`, `ko_3RD_1`, …). Wir rewiren
    //    sie HIER über `idMap` auf die frisch generierten cuid-IDs,
    //    BEVOR wir inserten. Sonst zeigen die Folge-Match-Verweise ins
    //    Leere, und ein Viertelfinal-Sieger taucht im Halbfinale nicht auf.
    //
    //    Ablauf:
    //      a) KO-Stage anlegen.
    //      b) Für jedes KO-Match: cuid vergeben, in idMap eintragen.
    //      c) `winnerAdvancesTo` / `loserAdvancesTo` per idMap ersetzen
    //         (oder null, wenn das Ziel-Match nicht gefunden wurde —
    //         das darf in einer korrekten Engine-Ausgabe nicht passieren).
    //      d) `homeSourceMatchId` / `awaySourceMatchId` ebenfalls rewiren
    //         (auch wenn sie aktuell nicht persistiert werden, dokumentieren
    //         wir die Konsistenz am Objekt).
    //      e) Alle KO-Matches in einer createMany einfügen.
    //
    //    Idempotenz: Re-Generate leert oben via match.deleteMany +
    //    stage.deleteMany ALLE Stages dieses Turniers inkl. KO-Stage.
    //    Wir bauen also eine NEUE KO-Stage mit NEUEN cuids.
    let bracketMatchCount = 0;
    const bracket = gen.bracket ?? { matches: [] };
    if (bracket.matches && bracket.matches.length > 0) {
      const koStage = await tx.stage.create({
        data: {
          tournamentId,
          type: 'ko',
          name: 'KO-Phase',
          orderIndex: 1,
        },
      });

      // 5b) Zwei-Phasen-Rewiring:
      //
      //   Pass 1: cuid vergeben und idMap aufbauen — BEVOR irgendwelche
      //   Referenzen aufgelöst werden. Hintergrund: In einem einzigen
      //   .map()-Durchlauf ist `idMap.get('ko_SF_1')` undefined, wenn
      //   ko_QF_1 verarbeitet wird — SF_1 kommt erst später dran. Daher
      //   erst die komplette Map füllen, dann rewiren.
      //
      //   Pass 2: pro Match die winnerAdvancesTo / loserAdvancesTo per
      //   idMap auf die frischen cuid-IDs umschreiben. dangling refs
      //   (Engine-Bug: verweist auf nicht-existente Engine-ID) werden als
      //   null geschrieben UND geloggt, damit der Bug sichtbar wird.
      for (const m of bracket.matches) {
        const dbId = makeCuid();
        idMap.set(m.id, dbId);
      }

      const koRows = bracket.matches.map((m) => {
        const winnerTarget = m.winnerAdvancesTo ? (idMap.get(m.winnerAdvancesTo) ?? null) : null;
        const loserTarget = m.loserAdvancesTo ? (idMap.get(m.loserAdvancesTo) ?? null) : null;

        if (m.winnerAdvancesTo && !winnerTarget) {
          console.warn(
            `[persistGenerated] KO-Match ${m.id} (${m.round}/${m.bracketPos}) ` +
              `verweist auf unbekanntes winnerAdvancesTo ${m.winnerAdvancesTo}`
          );
        }
        if (m.loserAdvancesTo && !loserTarget) {
          console.warn(
            `[persistGenerated] KO-Match ${m.id} (${m.round}/${m.bracketPos}) ` +
              `verweist auf unbekanntes loserAdvancesTo ${m.loserAdvancesTo}`
          );
        }

        return {
          id: idMap.get(m.id),
          tournamentId,
          stageId: koStage.id,
          groupId: null,
          round: m.round ?? null,
          bracketType: m.bracketType ?? 'winner',
          bracketPos: m.bracketPos ?? null,
          teamHome: m.teamHome ?? null,
          teamAway: m.teamAway ?? null,
          placeholderHome: m.placeholderHome ?? undefined,
          placeholderAway: m.placeholderAway ?? undefined,
          status: 'scheduled',
          scheduledAt: m.scheduledAt ?? null,
          field: m.field ?? null,
          winnerAdvancesTo: winnerTarget,
          loserAdvancesTo: loserTarget,
        };
      });

      // 5e) KO-Matches als Batch einfügen.
      await tx.match.createMany({ data: koRows });
      bracketMatchCount = koRows.length;
    }

    return {
      groupCount: gen.groups.length,
      matchCount,
      bracketMatchCount,
      teamCount,
    };
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
      OR: [{ winnerAdvancesTo: rootMatchId }, { loserAdvancesTo: rootMatchId }],
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
