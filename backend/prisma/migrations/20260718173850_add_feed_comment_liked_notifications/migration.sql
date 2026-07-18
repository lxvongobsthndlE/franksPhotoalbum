-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "email_feedCommentLiked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inApp_feedCommentLiked" BOOLEAN NOT NULL DEFAULT true;
