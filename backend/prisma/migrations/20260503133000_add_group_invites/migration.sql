-- CreateTable
CREATE TABLE "GroupInvite" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "maxUses" INTEGER,
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "notificationText" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "GroupInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupInviteGroup" (
  "inviteId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,

  CONSTRAINT "GroupInviteGroup_pkey" PRIMARY KEY ("inviteId", "groupId")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupInvite_token_key" ON "GroupInvite"("token");

-- CreateIndex
CREATE INDEX "GroupInvite_createdBy_idx" ON "GroupInvite"("createdBy");

-- CreateIndex
CREATE INDEX "GroupInvite_isActive_createdAt_idx" ON "GroupInvite"("isActive", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GroupInviteGroup_groupId_idx" ON "GroupInviteGroup"("groupId");

-- AddForeignKey
ALTER TABLE "GroupInvite"
ADD CONSTRAINT "GroupInvite_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInviteGroup"
ADD CONSTRAINT "GroupInviteGroup_inviteId_fkey"
FOREIGN KEY ("inviteId") REFERENCES "GroupInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInviteGroup"
ADD CONSTRAINT "GroupInviteGroup_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
