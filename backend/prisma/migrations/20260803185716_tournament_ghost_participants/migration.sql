-- Tournament Ghost Participants + Bracket Auto-Advance
--
-- 1) TournamentParticipant.userId wird optional ("Ghost"-Teilnehmer ohne User möglich).
-- 2) displayName als Snapshot des Anzeigenamens (User-Name ODER Team-Name ODER Freitext).
-- 3) assignedAt: Zeitpunkt der letzten User-Zuordnung (null = noch Ghost).
-- 4) TournamentMatch bekommt nextWinnerMatchId/Slot + nextLoserMatchId/Slot für Auto-Advance.
--
-- Backfill: bestehende Teilnehmer bekommen ihren Anzeigenamen aus dem verknüpften User.

-- 1) userId optional
ALTER TABLE "tournament_participants"
  ALTER COLUMN "userId" DROP NOT NULL;

-- 2) displayName hinzufügen
ALTER TABLE "tournament_participants"
  ADD COLUMN "displayName" TEXT;

-- 3) assignedAt hinzufügen
ALTER TABLE "tournament_participants"
  ADD COLUMN "assignedAt" TIMESTAMP(3);

-- Backfill: displayName aus verknüpftem User ableiten
UPDATE "tournament_participants" tp
SET "displayName" = COALESCE(u."name", u."username", u."email")
FROM "User" u
WHERE tp."userId" = u."id" AND tp."displayName" IS NULL;

-- 4) Bracket-Auto-Advance-Felder
ALTER TABLE "tournament_matches"
  ADD COLUMN "nextWinnerMatchId" TEXT;
ALTER TABLE "tournament_matches"
  ADD COLUMN "nextWinnerSlot" TEXT;
ALTER TABLE "tournament_matches"
  ADD COLUMN "nextLoserMatchId" TEXT;
ALTER TABLE "tournament_matches"
  ADD COLUMN "nextLoserSlot" TEXT;
