-- CreateTable
CREATE TABLE "tournament_presets" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "baseType" TEXT NOT NULL DEFAULT 'single_elimination',
  "participantMode" TEXT NOT NULL DEFAULT 'team',
  "minParticipants" INTEGER NOT NULL DEFAULT 2,
  "maxParticipants" INTEGER NOT NULL DEFAULT 128,
  "defaultMatchBestOf" INTEGER NOT NULL DEFAULT 1,
  "config" JSONB,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tournament_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_preset_stages" (
  "id" TEXT NOT NULL,
  "presetId" TEXT NOT NULL,
  "stageOrder" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "stageType" TEXT NOT NULL DEFAULT 'single_elimination',
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tournament_preset_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_instances" (
  "id" TEXT NOT NULL,
  "presetId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "config" JSONB,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "startedBy" TEXT,
  "endedBy" TEXT,
  "cancelledBy" TEXT,
  "cancelledReason" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tournament_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_teams" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "seed" INTEGER,
  "metadata" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tournament_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_participants" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "teamId" TEXT,
  "seed" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'registered',
  "points" INTEGER NOT NULL DEFAULT 0,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "draws" INTEGER NOT NULL DEFAULT 0,
  "eliminatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tournament_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_rounds" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "roundNumber" INTEGER NOT NULL,
  "stageKey" TEXT,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tournament_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_matches" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "roundId" TEXT,
  "matchNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "scheduledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "venueLabel" TEXT,
  "homeParticipantId" TEXT,
  "awayParticipantId" TEXT,
  "winnerParticipantId" TEXT,
  "isDraw" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "recordedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tournament_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_match_results" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "outcome" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tournament_match_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_presets_groupId_name_key" ON "tournament_presets"("groupId", "name");
CREATE INDEX "tournament_presets_groupId_createdAt_idx" ON "tournament_presets"("groupId", "createdAt" DESC);
CREATE INDEX "tournament_presets_createdBy_createdAt_idx" ON "tournament_presets"("createdBy", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_preset_stages_presetId_stageOrder_key" ON "tournament_preset_stages"("presetId", "stageOrder");
CREATE INDEX "tournament_preset_stages_presetId_stageOrder_idx" ON "tournament_preset_stages"("presetId", "stageOrder");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_instances_groupId_name_key" ON "tournament_instances"("groupId", "name");
CREATE INDEX "tournament_instances_groupId_status_createdAt_idx" ON "tournament_instances"("groupId", "status", "createdAt" DESC);
CREATE INDEX "tournament_instances_presetId_createdAt_idx" ON "tournament_instances"("presetId", "createdAt" DESC);
CREATE INDEX "tournament_instances_status_startAt_idx" ON "tournament_instances"("status", "startAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_teams_instanceId_name_key" ON "tournament_teams"("instanceId", "name");
CREATE INDEX "tournament_teams_instanceId_seed_idx" ON "tournament_teams"("instanceId", "seed");
CREATE INDEX "tournament_teams_createdBy_idx" ON "tournament_teams"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_participants_instanceId_userId_key" ON "tournament_participants"("instanceId", "userId");
CREATE INDEX "tournament_participants_instanceId_status_idx" ON "tournament_participants"("instanceId", "status");
CREATE INDEX "tournament_participants_instanceId_points_wins_idx" ON "tournament_participants"("instanceId", "points" DESC, "wins" DESC);
CREATE INDEX "tournament_participants_teamId_idx" ON "tournament_participants"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_rounds_instanceId_roundNumber_key" ON "tournament_rounds"("instanceId", "roundNumber");
CREATE INDEX "tournament_rounds_instanceId_status_roundNumber_idx" ON "tournament_rounds"("instanceId", "status", "roundNumber");

-- CreateIndex
CREATE INDEX "tournament_matches_instanceId_status_matchNumber_idx" ON "tournament_matches"("instanceId", "status", "matchNumber");
CREATE INDEX "tournament_matches_roundId_matchNumber_idx" ON "tournament_matches"("roundId", "matchNumber");
CREATE INDEX "tournament_matches_scheduledAt_idx" ON "tournament_matches"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_match_results_matchId_participantId_key" ON "tournament_match_results"("matchId", "participantId");
CREATE INDEX "tournament_match_results_participantId_createdAt_idx" ON "tournament_match_results"("participantId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "tournament_presets" ADD CONSTRAINT "tournament_presets_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_presets" ADD CONSTRAINT "tournament_presets_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_preset_stages" ADD CONSTRAINT "tournament_preset_stages_presetId_fkey"
FOREIGN KEY ("presetId") REFERENCES "tournament_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_instances" ADD CONSTRAINT "tournament_instances_presetId_fkey"
FOREIGN KEY ("presetId") REFERENCES "tournament_presets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tournament_instances" ADD CONSTRAINT "tournament_instances_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_instances" ADD CONSTRAINT "tournament_instances_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_instances" ADD CONSTRAINT "tournament_instances_startedBy_fkey"
FOREIGN KEY ("startedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_instances" ADD CONSTRAINT "tournament_instances_endedBy_fkey"
FOREIGN KEY ("endedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_instances" ADD CONSTRAINT "tournament_instances_cancelledBy_fkey"
FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_teams" ADD CONSTRAINT "tournament_teams_instanceId_fkey"
FOREIGN KEY ("instanceId") REFERENCES "tournament_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_teams" ADD CONSTRAINT "tournament_teams_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_instanceId_fkey"
FOREIGN KEY ("instanceId") REFERENCES "tournament_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "tournament_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_rounds" ADD CONSTRAINT "tournament_rounds_instanceId_fkey"
FOREIGN KEY ("instanceId") REFERENCES "tournament_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_instanceId_fkey"
FOREIGN KEY ("instanceId") REFERENCES "tournament_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_roundId_fkey"
FOREIGN KEY ("roundId") REFERENCES "tournament_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_homeParticipantId_fkey"
FOREIGN KEY ("homeParticipantId") REFERENCES "tournament_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_awayParticipantId_fkey"
FOREIGN KEY ("awayParticipantId") REFERENCES "tournament_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_winnerParticipantId_fkey"
FOREIGN KEY ("winnerParticipantId") REFERENCES "tournament_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_recordedBy_fkey"
FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tournament_match_results" ADD CONSTRAINT "tournament_match_results_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "tournament_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_match_results" ADD CONSTRAINT "tournament_match_results_participantId_fkey"
FOREIGN KEY ("participantId") REFERENCES "tournament_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
