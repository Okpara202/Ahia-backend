-- Discover v2: post TTL, edit tracking, poster cleanup, edit audit log.

-- Add new columns to discover_posts. Backfill expires_at for existing rows
-- using created_at + 30d so the new NOT NULL constraint holds.
ALTER TABLE "discover_posts"
  ADD COLUMN "expires_at"        TIMESTAMP(3),
  ADD COLUMN "edits_remaining"   INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "last_edited_at"    TIMESTAMP(3),
  ADD COLUMN "poster_public_id"  TEXT;

UPDATE "discover_posts"
   SET "expires_at" = "created_at" + INTERVAL '30 days'
 WHERE "expires_at" IS NULL;

ALTER TABLE "discover_posts"
  ALTER COLUMN "expires_at" SET NOT NULL;

CREATE INDEX "discover_posts_expires_at_idx" ON "discover_posts"("expires_at");

-- Audit log table for paid-tier edits. Silent backend store; admin app will
-- read this when it exists. CASCADE on post delete (post deletes are not in
-- the product spec today, but keeps things tidy if we ever hard-delete).
CREATE TABLE "discover_post_edits" (
  "id"                   UUID NOT NULL,
  "post_id"              UUID NOT NULL,
  "edited_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fields_changed"       TEXT[] NOT NULL,
  "previous_caption"     TEXT,
  "previous_poster_url"  TEXT,
  CONSTRAINT "discover_post_edits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discover_post_edits_post_id_edited_at_idx"
  ON "discover_post_edits"("post_id", "edited_at");

ALTER TABLE "discover_post_edits"
  ADD CONSTRAINT "discover_post_edits_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "discover_posts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
