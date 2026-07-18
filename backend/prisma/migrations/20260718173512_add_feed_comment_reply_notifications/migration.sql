-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "email_feedCommentReplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inApp_feedCommentReplied" BOOLEAN NOT NULL DEFAULT true;
