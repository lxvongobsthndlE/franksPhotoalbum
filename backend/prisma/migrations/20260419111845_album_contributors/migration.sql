-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "createdBy" TEXT;

-- CreateTable
CREATE TABLE "AlbumContributor" (
    "albumId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AlbumContributor_pkey" PRIMARY KEY ("albumId","userId")
);

-- AddForeignKey
ALTER TABLE "AlbumContributor" ADD CONSTRAINT "AlbumContributor_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumContributor" ADD CONSTRAINT "AlbumContributor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
