/**
 * Team-DTO.
 *
 * Teams sind reine Datensätze (Spec §1.2) — kein Login, keine Rolle, kein Status.
 * Anzeigeobjekt = Identifikation + optische Eigenschaften + Setzliste.
 *
 * Roh-DB-Felder (TournamentTeam):
 *   id, tournamentId, name, color, logoUrl, players, linkedUserIds, seed
 */

export function prepareTeamView(rawTeam) {
  if (rawTeam == null) return null;
  return {
    id: rawTeam.id,
    name: rawTeam.name ?? '',
    color: rawTeam.color ?? null,
    logoUrl: rawTeam.logoUrl ?? null,
    players: rawTeam.players ?? null,
    seed: rawTeam.seed ?? null,
    // linkedUserIds sind IDs von Konten — gehören nicht ins öffentliche Anzeigeobjekt.
    // Stufe B (§11) regelt, wer benachrichtigt wird; das ist KEIN Anzeige-Detail.
    linkedUserIds: Array.isArray(rawTeam.linkedUserIds) ? rawTeam.linkedUserIds.slice() : [],
  };
}

export function prepareTeamList(rawTeams) {
  if (!Array.isArray(rawTeams)) return [];
  return rawTeams.map(prepareTeamView);
}

/**
 * Lookup-Map: teamId → Team-DTO.
 * Wird vom Match-/Group-DTO gebraucht, um IDs aufzulösen.
 */
export function buildTeamLookup(rawTeams) {
  const map = new Map();
  for (const raw of rawTeams ?? []) {
    map.set(raw.id, prepareTeamView(raw));
  }
  return map;
}
