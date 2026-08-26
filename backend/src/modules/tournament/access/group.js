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
  const zeile = (teamId, position) => {
    const team = teams.get(teamId);
    return {
      teamId: teamId ?? null,
      name: team?.name ?? '—',
      color: team?.color ?? null,
      logoUrl: team?.logoUrl ?? null,
      seed: team?.seed ?? null,
      position: position ?? null,
    };
  };

  // ── EINE WAHRHEIT: wer hier spielt, ist hier drin ─────────────────
  //
  // Befund 2026-08-26 (Jonas: „gruppen gehen nicht mehr … die gruppen
  // sind weiterhin bei 0 spielen obwohl ergebnis steht"), an der echten
  // Datenbank gemessen: In JEDER Gruppe des Turniers waren drei von vier
  // Mitgliedern Teams, die dort kein Spiel haben — und drei von vier
  // Teams, die dort spielen, keine Mitglieder.
  //
  //   Gruppe A  Mitglieder:   Team 12, Team 3, Team 7, Team 10
  //             spielen dort: Team 6,  Team 3, Team 5, Team 4
  //
  // Ursache ist kein Datenschaden, sondern eine Entwurfsluecke:
  // `POST /:id/balance-shuffle-groups` („Zufaellig verteilen") schreibt
  // ausdruecklich nur die Mitgliedschaften um — der Kommentar dort sagt
  // „keine Team-, Match- oder Stage-Aenderungen". Die MATCHES tragen die
  // Paarungen aber weiter, und ab da widersprechen sich zwei Quellen.
  //
  // Die Folge war nicht nur eine falsche Tabelle. Aus der Tabelle kommen
  // die Qualifikanten fuer die K.-o.-Phase; aus derselben Liste kommt die
  // Gruppenanzeige im Teams-Tab und auf dem Druckbogen. Drei Ansichten,
  // die dasselbe behaupten sollen, taten es nicht.
  //
  // Deshalb wird die Frage HIER entschieden, an der einen Stelle, an der
  // alle drei ihre Gruppe herbekommen: Sobald eine Gruppe Spiele hat,
  // sind ihre Spiele die Wahrheit. Vorher (Entwurf, noch nichts
  // generiert) ist die Mitgliederliste die einzige Auskunft — und gilt.
  //
  // Bewusst KEINE Vereinigung: ein Mitglied ohne ein einziges Spiel in
  // dieser Gruppe mit 0 Punkten in ihre Tabelle zu schreiben, behauptet
  // eine Teilnahme, die es nicht gibt.
  // Die Umschaltung passiert NUR bei echtem Widerspruch — also wenn in
  // dieser Gruppe jemand spielt, der nicht Mitglied ist. Alles andere
  // laesst die Mitgliederliste unangetastet.
  //
  // Diese Verschaerfung stammt aus einem Testlauf: der erste Entwurf hat
  // die Spiele IMMER gewinnen lassen und dabei ein Mitglied verloren, das
  // nur noch kein Spiel in der uebergebenen Liste hatte. Die Annahme
  // „die Liste der Spiele ist vollstaendig" ist nicht garantiert — ein
  // Aufrufer darf auch nur die beendeten uebergeben. Ein Fix, der im
  // Normalfall Daten verliert, ist schlimmer als der Fehler, den er
  // behebt.
  const ausSpielen = new Set();
  for (const m of matches) {
    if (m?.teamHome) ausSpielen.add(m.teamHome);
    if (m?.teamAway) ausSpielen.add(m.teamAway);
  }
  const mitgliedIds = new Set(memberships.map((m) => m?.teamId).filter(Boolean));
  const fremde = [...ausSpielen].filter((id) => !mitgliedIds.has(id));

  let members;
  if (fremde.length === 0) {
    // Kein Widerspruch: beide Quellen sagen dasselbe (oder die Spiele
    // sagen noch nichts). Die Mitgliederliste gilt, samt Setzreihenfolge.
    members = memberships.map((m) => zeile(m?.teamId, m?.position));
  } else {
    // Widerspruch: die Spiele gewinnen. Mitglieder, die hier tatsaechlich
    // spielen, behalten ihre Setzreihenfolge; die uebrigen fallen weg,
    // weil sie in dieser Gruppe nicht antreten.
    const behalten = memberships.filter((m) => ausSpielen.has(m?.teamId));
    const bekannt = new Set(behalten.map((m) => m?.teamId));
    members = [
      ...behalten.map((m) => zeile(m?.teamId, m?.position)),
      ...[...ausSpielen].filter((id) => !bekannt.has(id)).map((id) => zeile(id, null)),
    ];
  }

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
