-- Tournament: Teams als spielende Einheit
--
-- 1) TournamentMatch: zusätzliche Spalten für Team-Referenzen (im team/pair-Modus
--    referenzieren Matches Teams statt Participants).
-- 2) TournamentTeam bekommt Stats-Spalten (in team/pair-Modus sind die Stats auf
--    dem Team, nicht auf einem Stellvertreter-Participant).
-- 3) Backfill: bestehende Team-Stats aus dem 1:1-Ghost-Teilnehmer übernehmen
--    (für Instanzen, die schon in team-Mode laufen).

-- 1) TournamentMatch: Team-Referenzen
ALTER TABLE "tournament_matches"
  ADD COLUMN "homeTeamId" TEXT;
ALTER TABLE "tournament_matches"
  ADD COLUMN "awayTeamId" TEXT;
ALTER TABLE "tournament_matches"
  ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'main';

-- Indizes
CREATE INDEX "tournament_matches_homeTeamId_idx" ON "tournament_matches"("homeTeamId");
CREATE INDEX "tournament_matches_awayTeamId_idx" ON "tournament_matches"("awayTeamId");
CREATE INDEX "tournament_matches_phase_idx" ON "tournament_matches"("phase");

-- 2) TournamentTeam: Stats-Spalten
ALTER TABLE "tournament_teams"
  ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tournament_teams"
  ADD COLUMN "wins"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tournament_teams"
  ADD COLUMN "losses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tournament_teams"
  ADD COLUMN "draws"  INTEGER NOT NULL DEFAULT 0;

-- 3) Backfill: bestehende 1:1-Ghost-Teilnehmer-Stats auf das Team übertragen
UPDATE "tournament_teams" t
SET
  points = COALESCE(src.points, 0),
  wins   = COALESCE(src.wins, 0),
  losses = COALESCE(src.losses, 0),
  draws  = COALESCE(src.draws, 0)
FROM (
  SELECT DISTINCT ON ("teamId") "teamId", points, wins, losses, draws
  FROM "tournament_participants"
  WHERE "teamId" IS NOT NULL AND "userId" IS NULL
  ORDER BY "teamId", "createdAt" DESC
) src
WHERE t.id = src."teamId";
