CREATE TABLE "GroupFeedPostSave" (
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GroupFeedPostSave_pkey" PRIMARY KEY ("userId", "postId")
);

CREATE TABLE "GroupFeedPostHistory" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "editedById" TEXT,
  "previousTitle" TEXT,
  "previousBody" TEXT NOT NULL,
  "previousMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GroupFeedPostHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GroupFeedPostSave_userId_savedAt_idx"
ON "GroupFeedPostSave"("userId", "savedAt" DESC);

CREATE INDEX "GroupFeedPostSave_postId_idx"
ON "GroupFeedPostSave"("postId");

CREATE INDEX "GroupFeedPostHistory_postId_createdAt_idx"
ON "GroupFeedPostHistory"("postId", "createdAt" DESC);

CREATE INDEX "GroupFeedPostHistory_editedById_createdAt_idx"
ON "GroupFeedPostHistory"("editedById", "createdAt" DESC);

ALTER TABLE "GroupFeedPostSave"
ADD CONSTRAINT "GroupFeedPostSave_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupFeedPostSave"
ADD CONSTRAINT "GroupFeedPostSave_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "GroupFeedPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupFeedPostHistory"
ADD CONSTRAINT "GroupFeedPostHistory_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "GroupFeedPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupFeedPostHistory"
ADD CONSTRAINT "GroupFeedPostHistory_editedById_fkey"
FOREIGN KEY ("editedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;