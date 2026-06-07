CREATE TABLE "admin_action_logs" (
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "action_type" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_action_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_action_logs_created_at_idx"
ON "admin_action_logs"("created_at" DESC);

CREATE INDEX "admin_action_logs_target_type_target_id_idx"
ON "admin_action_logs"("target_type", "target_id");

CREATE INDEX "admin_action_logs_action_type_created_at_idx"
ON "admin_action_logs"("action_type", "created_at" DESC);

ALTER TABLE "admin_action_logs"
ADD CONSTRAINT "admin_action_logs_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
