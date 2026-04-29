-- CreateTable
CREATE TABLE "feedback_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "reportedUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_reports_status_idx" ON "feedback_reports"("status");

-- CreateIndex
CREATE INDEX "feedback_reports_createdAt_idx" ON "feedback_reports"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
