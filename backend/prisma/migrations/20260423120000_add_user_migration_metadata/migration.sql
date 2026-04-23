ALTER TABLE "User"
  ADD COLUMN "migratedFrom" TEXT,
  ADD COLUMN "migratedAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);
