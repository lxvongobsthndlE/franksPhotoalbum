-- AlterTable
ALTER TABLE "feedback_reports"
  ADD COLUMN "waitingFor" TEXT NOT NULL DEFAULT 'support',
  ADD COLUMN "unreadAdmin" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "unreadUser" BOOLEAN NOT NULL DEFAULT false;

-- Data backfill for existing records
-- Old 'read' is interpreted as open/waiting_for_user with unreadUser=true
UPDATE "feedback_reports"
SET
  "status" = 'open',
  "waitingFor" = 'user',
  "unreadAdmin" = false,
  "unreadUser" = true
WHERE "status" = 'read';

-- Closed tickets should not wait for anyone
UPDATE "feedback_reports"
SET "waitingFor" = 'none'
WHERE "status" = 'closed';
