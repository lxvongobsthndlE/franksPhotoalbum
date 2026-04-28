-- AlterTable
ALTER TABLE "User" ADD COLUMN     "auth_source" TEXT,
ALTER COLUMN "displayNameField" DROP NOT NULL;
