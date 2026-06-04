-- Phase 7 partial: stories with media + view tracking, story chat snapshot,
-- cold-DM preference, payout accounts. Settlement / Transfer-on-release deferred
-- pending the A/B/C decision.

-- 1. New enum
CREATE TYPE "MediaType" AS ENUM ('image', 'video');

-- 2. Users: allows_cold_dms preference
ALTER TABLE "users"
  ADD COLUMN "allows_cold_dms" BOOLEAN NOT NULL DEFAULT true;

-- 3. Stories: media type + extras + view count + soft delete + product link + Cloudinary id
ALTER TABLE "stories"
  ADD COLUMN "media_type" "MediaType" NOT NULL DEFAULT 'image',
  ADD COLUMN "poster_url" TEXT,
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "product_id" UUID,
  ADD COLUMN "cloudinary_id" TEXT,
  ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Drop the default once columns exist (force explicit on inserts)
ALTER TABLE "stories" ALTER COLUMN "media_type" DROP DEFAULT;

CREATE INDEX "stories_deleted_at_idx" ON "stories"("deleted_at");

ALTER TABLE "stories"
  ADD CONSTRAINT "stories_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. story_views table
CREATE TABLE "story_views" (
  "story_id"   UUID NOT NULL,
  "user_id"    UUID NOT NULL,
  "viewed_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_views_pkey" PRIMARY KEY ("story_id", "user_id")
);
CREATE INDEX "story_views_user_id_idx" ON "story_views"("user_id");
ALTER TABLE "story_views"
  ADD CONSTRAINT "story_views_story_id_fkey"
  FOREIGN KEY ("story_id") REFERENCES "stories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_views"
  ADD CONSTRAINT "story_views_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Messages: story context snapshot fields
ALTER TABLE "messages"
  ADD COLUMN "story_context_story_id"    UUID,
  ADD COLUMN "story_context_media_url"   TEXT,
  ADD COLUMN "story_context_media_type"  "MediaType",
  ADD COLUMN "story_context_poster_url"  TEXT,
  ADD COLUMN "story_context_caption"     TEXT;

CREATE INDEX "messages_story_context_story_id_idx"
  ON "messages"("story_context_story_id");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_story_context_story_id_fkey"
  FOREIGN KEY ("story_context_story_id") REFERENCES "stories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. payout_accounts table
CREATE TABLE "payout_accounts" (
  "id"                       UUID NOT NULL,
  "user_id"                  UUID NOT NULL,
  "bank_code"                TEXT NOT NULL,
  "account_number"           TEXT NOT NULL,
  "account_name"             TEXT NOT NULL,
  "paystack_recipient_code"  TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payout_accounts_user_id_key" ON "payout_accounts"("user_id");
ALTER TABLE "payout_accounts"
  ADD CONSTRAINT "payout_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
