-- CreateTable
CREATE TABLE "user_exports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "zipKey" TEXT NOT NULL,
    "downloadToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "photoCount" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" BIGINT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "linkExpiry" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_exports_zipKey_key" ON "user_exports"("zipKey");

-- CreateIndex
CREATE UNIQUE INDEX "user_exports_downloadToken_key" ON "user_exports"("downloadToken");

-- CreateIndex
CREATE INDEX "user_exports_userId_createdAt_idx" ON "user_exports"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "user_exports_status_createdAt_idx" ON "user_exports"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "user_exports_linkExpiry_idx" ON "user_exports"("linkExpiry");

-- AddForeignKey
ALTER TABLE "user_exports"
ADD CONSTRAINT "user_exports_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
