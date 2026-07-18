-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "email_feedPostLiked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inApp_feedPostLiked" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "GroupFeedPostLike" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupFeedPostLike_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateIndex
CREATE INDEX "GroupFeedPostLike_userId_createdAt_idx" ON "GroupFeedPostLike"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "GroupFeedPostLike" ADD CONSTRAINT "GroupFeedPostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "GroupFeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupFeedPostLike" ADD CONSTRAINT "GroupFeedPostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
