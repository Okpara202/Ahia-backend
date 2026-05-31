-- Pre-rendered display text + archive timestamp on notifications so the
-- frontend can render rows verbatim without payload-parsing.
ALTER TABLE "notifications"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "body" TEXT,
  ADD COLUMN "link" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "notifications_user_id_read_at_idx";
CREATE INDEX "notifications_user_id_archived_at_read_at_idx"
  ON "notifications"("user_id", "archived_at", "read_at");
