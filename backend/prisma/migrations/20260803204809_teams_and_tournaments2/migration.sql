/*
  Warnings:

  - A unique constraint covering the columns `[matchId,teamId]` on the table `tournament_match_results` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "tournament_matches_awayTeamId_idx";

-- DropIndex
DROP INDEX "tournament_matches_homeTeamId_idx";

-- DropIndex
DROP INDEX "tournament_matches_phase_idx";

-- AlterTable
ALTER TABLE "tournament_match_results" ADD COLUMN     "teamId" TEXT,
ALTER COLUMN "participantId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tournament_matches" ADD COLUMN     "groupLabel" TEXT,
ADD COLUMN     "winnerTeamId" TEXT;

-- CreateIndex
CREATE INDEX "tournament_match_results_teamId_createdAt_idx" ON "tournament_match_results"("teamId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_match_results_matchId_teamId_key" ON "tournament_match_results"("matchId", "teamId");

-- CreateIndex
CREATE INDEX "tournament_matches_instanceId_phase_idx" ON "tournament_matches"("instanceId", "phase");

-- AddForeignKey
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "tournament_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "tournament_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "tournament_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_match_results" ADD CONSTRAINT "tournament_match_results_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "tournament_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
