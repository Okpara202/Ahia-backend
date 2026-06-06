-- Admin Phase 2 — let admins post into a buyer-seller conversation when there
-- is an open dispute on it. messages.sender_id stays null for admin messages;
-- the admin author is tracked separately in admin_author_id.

ALTER TABLE "messages"
  ADD COLUMN "admin_author_id" UUID;

CREATE INDEX "messages_admin_author_id_idx" ON "messages"("admin_author_id");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_admin_author_id_fkey"
  FOREIGN KEY ("admin_author_id") REFERENCES "admin_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
