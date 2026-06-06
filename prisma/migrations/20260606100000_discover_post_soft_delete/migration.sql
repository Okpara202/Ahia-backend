-- Add soft-delete column to DiscoverPost so sellers can remove their own
-- posts via DELETE /discover/posts/:id without losing analytics history
-- or breaking FK references from past campaigns / audit edits.

ALTER TABLE "discover_posts"
  ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "discover_posts_deleted_at_idx" ON "discover_posts"("deleted_at");
