-- AlterTable
ALTER TABLE "NotificationPreference" ALTER COLUMN "inApp_newPhoto" SET DEFAULT true,
ALTER COLUMN "inApp_newAlbum" SET DEFAULT true,
ALTER COLUMN "email_deputyRemoved" SET DEFAULT false,
ALTER COLUMN "email_contributorRemoved" SET DEFAULT false,
ALTER COLUMN "email_photoCommented" SET DEFAULT false;
