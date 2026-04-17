/*
  Warnings:

  - You are about to drop the column `albumId` on the `Photo` table. All the data in the column will be lost.

*/
-- CreateTable (before dropping albumId so we can migrate data)
CREATE TABLE "PhotoAlbum" (
    "photoId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,

    CONSTRAINT "PhotoAlbum_pkey" PRIMARY KEY ("photoId","albumId")
);

-- Migrate existing albumId data into PhotoAlbum join table
INSERT INTO "PhotoAlbum" ("photoId", "albumId")
SELECT "id", "albumId" FROM "Photo" WHERE "albumId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Photo" DROP CONSTRAINT "Photo_albumId_fkey";

-- AlterTable
ALTER TABLE "Photo" DROP COLUMN "albumId";

-- AddForeignKey
ALTER TABLE "PhotoAlbum" ADD CONSTRAINT "PhotoAlbum_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoAlbum" ADD CONSTRAINT "PhotoAlbum_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;
