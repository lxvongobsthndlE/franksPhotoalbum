/**
 * Die öffentliche Sicht auf ein Turnier — was ein Zuschauer ohne Konto sieht.
 *
 * Der wichtigste Satz dieser Datei:
 *
 *     Diese Schicht zählt auf, was RAUS darf. Sie streicht nicht,
 *     was drin bleiben soll.
 *
 * Eine Blocklist ("linkedUserIds löschen, players löschen") wäre eine Zeile
 * kürzer und in einem halben Jahr falsch: Wer dann ein Feld ins interne DTO
 * legt, hätte es ungefragt veröffentlicht — und niemand hätte an dieser
 * Datei vorbeikommen müssen. Mit der Allowlist ist der Fehler umgekehrt und
 * harmlos: Ein neues Feld fehlt draußen, bis es hier jemand einträgt.
 *
 * Was bewusst NICHT nach draußen geht:
 *
 *   teams[].linkedUserIds  Konto-IDs. Das DTO trägt sie seit jeher mit,
 *                          obwohl sein eigener Kommentar sagt, sie gehörten
 *                          nicht in ein Anzeigeobjekt.
 *   teams[].players        Klarnamen von Menschen. Auf einem Aushang im
 *                          Vereinsheim stehen sie vielleicht — im offenen
 *                          Netz sind sie personenbezogene Daten, und der
 *                          Zuschauer-Link ist für jeden abrufbar, der ihn
 *                          weitergereicht bekommt. Teamnamen genügen.
 *   publicToken            Der Leser hat ihn ohnehin. Ihn zusätzlich im
 *                          Rumpf zu spiegeln, macht ihn nur leichter
 *                          versehentlich kopierbar (Screenshot, Cache, Log).
 *   groupId, createdById   Innereien. Sie beantworten keine Frage, die ein
 *                          Zuschauer hat.
 *   rules                  Absicht, kein Versehen: das Regelwerk ist für
 *                          Teilnehmer geschrieben. Es aufzunehmen wäre eine
 *                          eigene Entscheidung.
 */

/** Turnier-Kopf: Was auf dem Aushang stünde. */
function publicTournament(t) {
  if (!t) return null;
  return {
    name: t.name,
    logoUrl: t.logoUrl,

    mode: t.mode,
    modeLabel: t.modeLabel,
    status: t.status,
    statusLabel: t.statusLabel,

    location: t.location,
    sport: t.sport,
    scoreLabel: t.scoreLabel,
    scoreShort: t.scoreShort,
    tableLabels: t.tableLabels,

    startsAt: t.startsAt,
    endsAt: t.endsAt,
    startsAtShort: t.startsAtShort,
    endsAtShort: t.endsAtShort,
    startsAtDate: t.startsAtDate,
    endsAtDate: t.endsAtDate,
    singleDay: t.singleDay,

    teamCount: t.teamCount,
    groupCount: t.groupCount,
    matchCount: t.matchCount,
    finishedCount: t.finishedCount,
  };
}

/** Team: Identifikation und Optik — keine Personen. */
function publicTeam(team) {
  if (!team) return null;
  return {
    id: team.id,
    name: team.name,
    color: team.color,
    logoUrl: team.logoUrl,
    seed: team.seed,
  };
}

/**
 * Spiel. Die Match-DTOs sind bereits Anzeigeobjekte (access/match.js) und
 * enthalten keine Personendaten — trotzdem gilt hier dieselbe Regel, damit
 * eine spätere Erweiterung von prepareMatchView nicht still nach außen
 * durchschlägt.
 */
function publicMatch(m) {
  if (!m) return null;
  return {
    id: m.id,
    stageId: m.stageId,
    stageType: m.stageType,
    stageName: m.stageName,
    groupId: m.groupId,
    groupKey: m.groupKey,
    round: m.round,
    roundLabel: m.roundLabel,
    bracketPos: m.bracketPos,
    label: m.label,
    home: publicSlot(m.home),
    away: publicSlot(m.away),
    scoreHome: m.scoreHome,
    scoreAway: m.scoreAway,
    status: m.status,
    statusLabel: m.statusLabel,
    isLive: m.isLive,
    isFinished: m.isFinished,
    isPlaceholder: m.isPlaceholder,
    isGroupMatch: m.isGroupMatch,
    isKoMatch: m.isKoMatch,
    field: m.field,
    scheduledAt: m.scheduledAt,
    scheduledTime: m.scheduledTime,
    scheduledDate: m.scheduledDate,
    scheduledLabel: m.scheduledLabel,
  };
}

/**
 * Ein Spiel-Slot ist entweder ein Team oder ein Platzhalter
 * („Sieger HF 1"). Auch hier zählt die Schicht auf statt zu streichen —
 * ein Slot bekommt seine Felder aus dem Team-DTO, und das trägt
 * Personendaten.
 */
function publicSlot(slot) {
  if (!slot) return null;
  return {
    kind: slot.kind,
    teamId: slot.teamId,
    name: slot.name,
    color: slot.color,
    logoUrl: slot.logoUrl,
  };
}

/**
 * Gruppe samt Tabelle.
 *
 * `members` bleibt draußen: Die Teamliste steht schon in `teams`, und die
 * Tabelle nennt jede Mannschaft ohnehin. Zwei Wege zu derselben Auskunft
 * sind zwei Wege, die auseinanderlaufen können.
 */
function publicGroup(g) {
  if (!g) return null;
  return {
    id: g.id,
    key: g.key,
    name: g.name,
    stageId: g.stageId,
    standings: Array.isArray(g.standings) ? g.standings.map(publicStanding) : [],
  };
}

/**
 * Tabellenzeile.
 *
 * Die Feldnamen folgen prepareStandings (access/group.js) — `name`, nicht
 * `teamName`, und `goalsFor`/`goalsAgainst`/`goalDiff`, auch wenn bei
 * Becherturnieren keine Tore gezählt werden. Der Name der Größe steht im
 * Turnier unter `scoreLabel`; die Spalte heißt dann „Becher".
 */
function publicStanding(row) {
  if (!row) return null;
  return {
    rank: row.rank,
    teamId: row.teamId,
    name: row.name,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDiff: row.goalDiff,
    points: row.points,
    qualifies: row.qualifies,
    unresolved: row.unresolved,
  };
}

function publicStage(s) {
  if (!s) return null;
  return {
    id: s.id,
    type: s.type,
    name: s.name,
    typeLabel: s.typeLabel,
    orderIndex: s.orderIndex,
  };
}

/**
 * Baut aus dem internen View-Kontext die Antwort für den Zuschauer-Link.
 *
 * @param {object} view  Ergebnis von buildTournamentViewContext
 * @returns {object}     Öffentliche Nutzlast, ohne Personen- und Innendaten
 */
export function buildPublicPayload(view) {
  return {
    tournament: publicTournament(view?.tournament),
    teams: Array.isArray(view?.teams) ? view.teams.map(publicTeam) : [],
    stages: Array.isArray(view?.stages) ? view.stages.map(publicStage) : [],
    groups: Array.isArray(view?.groups) ? view.groups.map(publicGroup) : [],
    matches: Array.isArray(view?.matches) ? view.matches.map(publicMatch) : [],
    // Ein Zuschauer liest. Das sagen wir ihm auch, statt es ihn aus dem
    // Fehlen von Knöpfen erschließen zu lassen.
    readOnly: true,
  };
}

/**
 * Feldnamen, die in einer öffentlichen Antwort auf KEINER Ebene vorkommen
 * dürfen. Der Regressionstest läuft rekursiv über die fertige Nutzlast —
 * so schlägt er auch an, wenn jemand ein Feld eine Ebene tiefer ergänzt.
 *
 * `groupId` steht bewusst NICHT hier: der Name trägt im Turniermodul zwei
 * verschiedene Bedeutungen. Auf einem Match zeigt er auf die Turniergruppe
 * („Gruppe A") und wird zum Zuordnen gebraucht; auf dem Turnier zeigt er
 * auf die Foto-Gruppe und ist eine Innerei. Eine Liste über alle Ebenen
 * kann die beiden nicht auseinanderhalten — deshalb prüft der Test den
 * Turnier-Kopf zusätzlich einzeln (siehe FORBIDDEN_TOURNAMENT_KEYS).
 */
export const FORBIDDEN_PUBLIC_KEYS = Object.freeze([
  'linkedUserIds',
  'players',
  'publicToken',
  'createdById',
  'isPublic',
  'publicEnabledAt',
  'publicRevokedAt',
]);

/** Zusätzlich verboten, aber nur direkt am Turnier-Kopf. */
export const FORBIDDEN_TOURNAMENT_KEYS = Object.freeze([
  'groupId',
  'rules',
  'coverUrl',
  'startedAt',
  'updatedAt',
]);
