-- CreateTable
CREATE TABLE "GroupDeputy" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "GroupDeputy_pkey" PRIMARY KEY ("groupId","userId")
);

-- AddForeignKey
ALTER TABLE "GroupDeputy" ADD CONSTRAINT "GroupDeputy_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupDeputy" ADD CONSTRAINT "GroupDeputy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
