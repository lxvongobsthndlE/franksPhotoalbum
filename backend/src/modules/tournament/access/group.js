/**
 * Gruppen-DTO und Tabellenstand.
 *
 * Spec §5.4: "Standings werden live aus den beendeten Spielen berechnet."
 *   → Die eigentliche Berechnung lebt in der Engine (computeStandings).
 *   → Hier wird das Ergebnis der Engine nur noch in ein Anzeigeobjekt gegossen.
 *
 * Roh-DB-Felder (Group_ + GroupMembership):
 *   Group_:           id, stageId, key, name
 *   GroupMembership:  id, groupId, teamId, position
 *
 * Anzeige:
 *   - Schlüssel ("A", "B", …)
 *   - Mitglieder in Setzreihenfolge
 *   - Spiele der Gruppe
 *   - Tabelle (nach Engine-Aufruf)
 */

import { prepareMatchList } from './match.js';

export function prepareGroupView(rawGroup, ctx = {}) {
  if (rawGroup == null) return null;

  const matches = rawGroup.matches ?? [];

  // Mitglieder in Setzreihenfolge sortieren (Spec §5.1).
  const memberships = [...(rawGroup.memberships ?? [])];
  memberships.sort((a, b) => {
    const pa = a.position ?? Number.POSITIVE_INFINITY;
    const pb = b.position ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });

  const teams = ctx.teams ?? new Map();
  const members = memberships.map((m) => {
    const team = teams.get(m?.teamId);
    return {
      teamId: m?.teamId ?? null,
      name: team?.name ?? '—',
      color: team?.color ?? null,
      logoUrl: team?.logoUrl ?? null,
      seed: team?.seed ?? null,
      position: m?.position ?? null,
    };
  });

  return {
    id: rawGroup.id,
    stageId: rawGroup.stageId,
    key: rawGroup.key ?? '',
    name: rawGroup.name ?? rawGroup.key ?? '',
    members,
    matches: prepareMatchList(matches, ctx),
    memberCount: members.length,
    // Standings werden separat über prepareStandings() angefügt.
  };
}

export function prepareGroupList(rawGroups, ctx = {}) {
  if (!Array.isArray(rawGroups)) return [];
  return rawGroups.map((g) => prepareGroupView(g, ctx));
}

/**
 * Tabellenzeile. Roh-Standings (aus Engine.computeStandings) → DTO.
 *
 * Roh-Standings (Beispiel):
 *   [
 *     { teamId, played, won, drawn, lost, goalsFor, goalsAgainst,
 *       goalDiff, points, rank, tiebreakerNote? },
 *     …
 *   ]
 *
 * Wir geben pro Zeile aus:
 *   rank, teamId, name, played, won, drawn, lost, goalsFor/Against,
 *   goalDiff, points, qualification
 */
export function prepareStandings(rawStandings, opts = {}) {
  const { qualifyTop = 0 } = opts; // Top-N bekommen Qualifikations-Markierung
  if (!Array.isArray(rawStandings)) return [];

  return rawStandings.map((row, idx) => {
    const rank = row.rank ?? idx + 1;
    return {
      rank,
      teamId: row.teamId ?? null,
      name: row.name ?? '—',
      played: row.played ?? 0,
      won: row.won ?? 0,
      drawn: row.drawn ?? 0,
      lost: row.lost ?? 0,
      goalsFor: row.goalsFor ?? 0,
      goalsAgainst: row.goalsAgainst ?? 0,
      goalDiff: row.goalDiff ?? 0,
      points: row.points ?? 0,
      qualifies: qualifyTop > 0 && rank <= qualifyTop,
      tiebreakerNote: row.tiebreakerNote ?? null,
      unresolved: row.unresolved === true,
    };
  });
}