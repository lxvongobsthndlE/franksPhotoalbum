-- Turniermodul v4 — Komplett-Rewrite nach Spec §4.
--
-- Verbindlich laut §0:
--   "Alle Dateien des bisherigen Turniermoduls löschen" (Code)
--   "Die bisherigen Turniertabellen der Datenbank verwerfen und nach §4
--    vollständig neu anlegen" (DB)
--   Bestehende Testturniere gehen verloren; das ist beabsichtigt.
--
-- Bewusst NICHT in der neuen Struktur:
--   • group_modules            — Spec §1.1 verbietet Modul-Gating
--   • tournament_presets       — Spec §4 enthält keine Preset-Tabellen
--   • tournament_participants  — Spec §1.2: Teams = reine Datensätze, keine Konten
--   • tournament_match_results — Spec §4: Score lebt direkt auf dem Match
--   • Felder wie recorder/recordedById, metadata, venueLabel, matchNumber,
--     startedAt, completedAt, rulesText — existieren in §4 nicht

-- ---------------------------------------------------------------------------
-- DROP — alte Turnier-Tabellen weg
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "tournament_match_results" CASCADE;
DROP TABLE IF EXISTS "tournament_participants"    CASCADE;
DROP TABLE IF EXISTS "tournament_preset_stages"  CASCADE;
DROP TABLE IF EXISTS "tournament_presets"        CASCADE;
DROP TABLE IF EXISTS "tournament_matches"        CASCADE;
DROP TABLE IF EXISTS "tournament_group_memberships" CASCADE;
DROP TABLE IF EXISTS "tournament_groups"         CASCADE;
DROP TABLE IF EXISTS "tournament_stages"         CASCADE;
DROP TABLE IF EXISTS "tournament_teams"          CASCADE;
DROP TABLE IF EXISTS "tournaments"                CASCADE;
DROP TABLE IF EXISTS "group_modules"             CASCADE;

-- ---------------------------------------------------------------------------
-- CREATE — exakt nach §4
-- ---------------------------------------------------------------------------

-- tournaments (§4)
CREATE TABLE "tournaments" (
    "id"                 TEXT NOT NULL,
    "groupId"            TEXT NOT NULL,
    "name"               TEXT NOT NULL,
    "logoUrl"            TEXT,
    "coverUrl"           TEXT,
    "mode"               TEXT NOT NULL DEFAULT 'groups_ko',
    "status"             TEXT NOT NULL DEFAULT 'draft',
    "config"             JSONB,
    "isPublic"           BOOLEAN NOT NULL DEFAULT false,
    "publicToken"        TEXT,
    "publicEnabledAt"    TIMESTAMP(3),
    "publicRevokedAt"    TIMESTAMP(3),
    "startsAt"           TIMESTAMP(3),
    "endsAt"             TIMESTAMP(3),
    "createdById"        TEXT NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- tournament_teams (§4) — KEIN group_key hier, Zuordnung via memberships
CREATE TABLE "tournament_teams" (
    "id"              TEXT NOT NULL,
    "tournamentId"    TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "color"           TEXT,
    "logoUrl"         TEXT,
    "players"         TEXT,
    "linkedUserIds"   JSONB,
    "seed"            INTEGER,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_teams_pkey" PRIMARY KEY ("id")
);

-- stages (§4)
CREATE TABLE "stages" (
    "id"            TEXT NOT NULL,
    "tournamentId"  TEXT NOT NULL,
    "type"          TEXT NOT NULL,            -- 'group' | 'ko' | 'intermediate_group' | 'losers'
    "name"          TEXT NOT NULL,
    "orderIndex"    INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- groups_ (§4) — Turniergruppen, nicht zu verwechseln mit [kru:]nest-Gruppen
CREATE TABLE "groups_" (
    "id"          TEXT NOT NULL,
    "stageId"     TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "name"        TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups__pkey" PRIMARY KEY ("id")
);

-- group_memberships (§4) — N:M Team ↔ Turniergruppe, phasenübergreifend
CREATE TABLE "group_memberships" (
    "id"        TEXT NOT NULL,
    "groupId"   TEXT NOT NULL,
    "teamId"    TEXT NOT NULL,
    "position"  INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("id")
);

-- matches (§4)
CREATE TABLE "matches" (
    "id"                  TEXT NOT NULL,
    "tournamentId"        TEXT NOT NULL,
    "stageId"             TEXT NOT NULL,
    "groupId"             TEXT,
    "round"               TEXT,
    "bracketType"         TEXT,               -- 'winner' | 'loser' | 'grand_final'
    "bracketPos"          INTEGER,
    "teamHome"            TEXT,
    "teamAway"            TEXT,
    "placeholderHome"     JSONB,
    "placeholderAway"     JSONB,
    "scoreHome"           INTEGER,
    "scoreAway"           INTEGER,
    "status"              TEXT NOT NULL DEFAULT 'scheduled',
    "field"               INTEGER,
    "scheduledAt"         TIMESTAMP(3),
    "winnerAdvancesTo"    TEXT,
    "loserAdvancesTo"     TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- INDIZES
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "tournaments_publicToken_key" ON "tournaments"("publicToken");
CREATE INDEX "tournaments_groupId_status_idx"   ON "tournaments"("groupId", "status");
CREATE UNIQUE INDEX "tournaments_groupId_name_key" ON "tournaments"("groupId", "name");

CREATE UNIQUE INDEX "tournament_teams_tournamentId_name_key" ON "tournament_teams"("tournamentId", "name");
CREATE INDEX "tournament_teams_tournamentId_seed_idx" ON "tournament_teams"("tournamentId", "seed");

CREATE INDEX "stages_tournamentId_orderIndex_idx" ON "stages"("tournamentId", "orderIndex");
CREATE UNIQUE INDEX "groups__stageId_key_key" ON "groups_"("stageId", "key");
CREATE UNIQUE INDEX "group_memberships_groupId_teamId_key" ON "group_memberships"("groupId", "teamId");
CREATE INDEX "group_memberships_teamId_idx" ON "group_memberships"("teamId");

CREATE INDEX "matches_tournamentId_stageId_idx" ON "matches"("tournamentId", "stageId");
CREATE INDEX "matches_scheduledAt_idx"          ON "matches"("scheduledAt");
CREATE INDEX "matches_field_scheduledAt_idx"    ON "matches"("field", "scheduledAt");

-- ---------------------------------------------------------------------------
-- FOREIGN KEYS — CASCADE vom Turnier abwärts (§4)
-- ---------------------------------------------------------------------------
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_teams" ADD CONSTRAINT "tournament_teams_tournamentId_fkey"
    FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stages" ADD CONSTRAINT "stages_tournamentId_fkey"
    FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "groups_" ADD CONSTRAINT "groups__stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups_"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "tournament_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "matches" ADD CONSTRAINT "matches_tournamentId_fkey"
    FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups_"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_teamHome_fkey"
    FOREIGN KEY ("teamHome") REFERENCES "tournament_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_teamAway_fkey"
    FOREIGN KEY ("teamAway") REFERENCES "tournament_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_winnerAdvancesTo_fkey"
    FOREIGN KEY ("winnerAdvancesTo") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_loserAdvancesTo_fkey"
    FOREIGN KEY ("loserAdvancesTo") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
