ALTER TABLE "Group"
ADD COLUMN "feedPostingRestrictedToModerators" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GroupFeedPost" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'post',
  "title" TEXT,
  "body" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "imageUrl" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupFeedPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GroupFeedPost_groupId_createdAt_idx"
ON "GroupFeedPost"("groupId", "createdAt" DESC);

CREATE INDEX "GroupFeedPost_createdById_createdAt_idx"
ON "GroupFeedPost"("createdById", "createdAt" DESC);

CREATE INDEX "GroupFeedPost_entityType_entityId_idx"
ON "GroupFeedPost"("entityType", "entityId");

ALTER TABLE "GroupFeedPost"
ADD CONSTRAINT "GroupFeedPost_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupFeedPost"
ADD CONSTRAINT "GroupFeedPost_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
