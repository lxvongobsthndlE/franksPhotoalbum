-- CreateTable
CREATE TABLE "group_backups" (
    "id" TEXT NOT NULL,
    "zipKey" TEXT NOT NULL,
    "groupId" TEXT,
    "groupName" TEXT NOT NULL,
    "photoCount" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkExpiry" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_backups_zipKey_key" ON "group_backups"("zipKey");
