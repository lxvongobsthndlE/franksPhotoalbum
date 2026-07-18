-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "email_feedCommentMentioned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "email_feedPostCommented" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inApp_feedCommentMentioned" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "inApp_feedPostCommented" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "GroupFeedComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "content" TEXT NOT NULL,
    "mentions" JSONB,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupFeedComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupFeedCommentHistory" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "editedById" TEXT,
    "previousContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupFeedCommentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupFeedCommentLike" (
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupFeedCommentLike_pkey" PRIMARY KEY ("commentId","userId")
);

-- CreateIndex
CREATE INDEX "GroupFeedComment_postId_parentCommentId_createdAt_idx" ON "GroupFeedComment"("postId", "parentCommentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GroupFeedComment_parentCommentId_createdAt_idx" ON "GroupFeedComment"("parentCommentId", "createdAt");

-- CreateIndex
CREATE INDEX "GroupFeedComment_userId_createdAt_idx" ON "GroupFeedComment"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GroupFeedComment_groupId_createdAt_idx" ON "GroupFeedComment"("groupId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GroupFeedCommentHistory_commentId_createdAt_idx" ON "GroupFeedCommentHistory"("commentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GroupFeedCommentHistory_editedById_createdAt_idx" ON "GroupFeedCommentHistory"("editedById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GroupFeedCommentLike_userId_createdAt_idx" ON "GroupFeedCommentLike"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "GroupFeedComment" ADD CONSTRAINT "GroupFeedComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "GroupFeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupFeedComment" ADD CONSTRAINT "GroupFeedComment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupFeedComment" ADD CONSTRAINT "GroupFeedComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupFeedComment" ADD CONSTRAINT "GroupFeedComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "GroupFeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupFeedComment" ADD CONSTRAINT "GroupFeedComment_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupFeedCommentHistory" ADD CONSTRAINT "GroupFeedCommentHistory_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "GroupFeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupFeedCommentHistory" ADD CONSTRAINT "GroupFeedCommentHistory_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupFeedCommentLike" ADD CONSTRAINT "GroupFeedCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "GroupFeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupFeedCommentLike" ADD CONSTRAINT "GroupFeedCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
