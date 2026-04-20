-- Add imageUrl and entityUrl to Notification
ALTER TABLE "Notification" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Notification" ADD COLUMN "entityUrl" TEXT;

-- Add inApp_system and email_system to NotificationPreference
ALTER TABLE "NotificationPreference" ADD COLUMN "inApp_system" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NotificationPreference" ADD COLUMN "email_system" BOOLEAN NOT NULL DEFAULT false;
