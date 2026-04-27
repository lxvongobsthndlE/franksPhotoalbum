-- CreateTable
CREATE TABLE "changelog_entries" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "changelog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "changelog_entries_created_at_idx" ON "changelog_entries"("created_at" DESC);
