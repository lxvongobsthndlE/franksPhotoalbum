ALTER TABLE "Group"
ADD COLUMN "uploadsRestrictedToModerators" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GroupBlock" (
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "blockedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GroupBlock_pkey" PRIMARY KEY ("groupId","userId"),
  CONSTRAINT "GroupBlock_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GroupBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GroupBlock_blockedBy_fkey" FOREIGN KEY ("blockedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "GroupBlock_userId_idx" ON "GroupBlock"("userId");
