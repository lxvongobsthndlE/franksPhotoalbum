-- AlterTable: add resolution to feedback_reports
ALTER TABLE "feedback_reports" ADD COLUMN "resolution" TEXT;

-- CreateTable: feedback_messages
CREATE TABLE "feedback_messages" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_messages_reportId_idx" ON "feedback_messages"("reportId");

-- AddForeignKey: feedback_messages.reportId -> feedback_reports.id
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "feedback_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: feedback_messages.authorId -> User.id
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
