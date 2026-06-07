CREATE TABLE "blocked_login_identities" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "auth_source" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "blocked_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "blocked_login_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blocked_login_identities_email_normalized_auth_source_key"
ON "blocked_login_identities"("email_normalized", "auth_source");

CREATE INDEX "blocked_login_identities_created_at_idx"
ON "blocked_login_identities"("created_at" DESC);

ALTER TABLE "blocked_login_identities"
ADD CONSTRAINT "blocked_login_identities_blocked_by_user_id_fkey"
FOREIGN KEY ("blocked_by_user_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
