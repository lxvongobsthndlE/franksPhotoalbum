-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityId" TEXT,
    "entityType" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "inApp_deputyAdded" BOOLEAN NOT NULL DEFAULT true,
    "inApp_deputyRemoved" BOOLEAN NOT NULL DEFAULT true,
    "inApp_contributorAdded" BOOLEAN NOT NULL DEFAULT true,
    "inApp_contributorRemoved" BOOLEAN NOT NULL DEFAULT true,
    "inApp_groupMemberJoined" BOOLEAN NOT NULL DEFAULT true,
    "inApp_groupMemberLeft" BOOLEAN NOT NULL DEFAULT true,
    "inApp_groupDeleted" BOOLEAN NOT NULL DEFAULT true,
    "inApp_photoLiked" BOOLEAN NOT NULL DEFAULT true,
    "inApp_photoCommented" BOOLEAN NOT NULL DEFAULT true,
    "inApp_newPhoto" BOOLEAN NOT NULL DEFAULT false,
    "inApp_newAlbum" BOOLEAN NOT NULL DEFAULT false,
    "email_deputyAdded" BOOLEAN NOT NULL DEFAULT true,
    "email_deputyRemoved" BOOLEAN NOT NULL DEFAULT true,
    "email_contributorAdded" BOOLEAN NOT NULL DEFAULT true,
    "email_contributorRemoved" BOOLEAN NOT NULL DEFAULT true,
    "email_groupMemberJoined" BOOLEAN NOT NULL DEFAULT false,
    "email_groupMemberLeft" BOOLEAN NOT NULL DEFAULT false,
    "email_groupDeleted" BOOLEAN NOT NULL DEFAULT true,
    "email_photoLiked" BOOLEAN NOT NULL DEFAULT false,
    "email_photoCommented" BOOLEAN NOT NULL DEFAULT true,
    "email_newPhoto" BOOLEAN NOT NULL DEFAULT false,
    "email_newAlbum" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
