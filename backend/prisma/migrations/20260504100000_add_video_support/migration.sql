-- AlterTable
ALTER TABLE "Photo" ADD COLUMN "mediaType" TEXT NOT NULL DEFAULT 'image';
ALTER TABLE "Photo" ADD COLUMN "videoDuration" INTEGER;
