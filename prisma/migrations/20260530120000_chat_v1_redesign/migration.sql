-- Chat v1 redesign: one conversation per (buyer, seller), invoices with per-line
-- confirm/dispute, voice messages, reactions, read receipts. Wipes test data.

-- 1. Drop dependent tables in FK-safe order.
DROP TABLE IF EXISTS "disputes" CASCADE;
DROP TABLE IF EXISTS "reviews" CASCADE;
DROP TABLE IF EXISTS "messages" CASCADE;
DROP TABLE IF EXISTS "conversation_participants" CASCADE;
DROP TABLE IF EXISTS "transactions" CASCADE;
DROP TABLE IF EXISTS "conversations" CASCADE;

-- 2. Drop orphan notifications referencing the old chat/payment world.
DELETE FROM "notifications" WHERE "type" IN (
  'payment_paid',
  'payment_received',
  'payment_released',
  'dispute_opened',
  'dispute_resolved'
);

-- 3. Drop old enums.
DROP TYPE IF EXISTS "MessageType";
DROP TYPE IF EXISTS "OfferStatus";
DROP TYPE IF EXISTS "TransactionStatus";
DROP TYPE IF EXISTS "DisputeStatus";

-- 4. Create new enums.
CREATE TYPE "MessageType" AS ENUM ('text', 'voice', 'image', 'invoice', 'system');
CREATE TYPE "InvoiceStatus" AS ENUM ('pending', 'cancelled', 'paid', 'partial_released', 'fully_released', 'partial_refunded', 'fully_refunded', 'disputed');
CREATE TYPE "InvoiceLineKind" AS ENUM ('product', 'custom', 'discount');
CREATE TYPE "InvoiceLineStatus" AS ENUM ('pending', 'released', 'refunded');
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'held', 'partial_released', 'fully_released', 'partial_refunded', 'fully_refunded');
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'reviewing', 'resolved');
CREATE TYPE "DisputeResolution" AS ENUM ('refunded_to_buyer', 'released_to_seller');

-- 5. conversations
CREATE TABLE "conversations" (
  "id" UUID NOT NULL,
  "buyer_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "last_message_id" UUID,
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversations_buyer_id_seller_id_key" ON "conversations"("buyer_id", "seller_id");
CREATE UNIQUE INDEX "conversations_last_message_id_key" ON "conversations"("last_message_id");
CREATE INDEX "conversations_buyer_id_idx" ON "conversations"("buyer_id");
CREATE INDEX "conversations_seller_id_idx" ON "conversations"("seller_id");
CREATE INDEX "conversations_last_activity_at_idx" ON "conversations"("last_activity_at");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 6. messages
CREATE TABLE "messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "sender_id" UUID,
  "type" "MessageType" NOT NULL,
  "content" TEXT,
  "voice_url" TEXT,
  "voice_duration_ms" INTEGER,
  "image_url" TEXT,
  "invoice_id" UUID,
  "context_product_id" UUID,
  "edited_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "messages_invoice_id_key" ON "messages"("invoice_id");
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_context_product_id_fkey" FOREIGN KEY ("context_product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- conversations.last_message_id FK now that messages exists
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_last_message_id_fkey" FOREIGN KEY ("last_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. invoices
CREATE TABLE "invoices" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "buyer_id" UUID NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'pending',
  "total_amount" DECIMAL(12,2) NOT NULL,
  "platform_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "paystack_ref" TEXT,
  "paid_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoices_paystack_ref_key" ON "invoices"("paystack_ref");
CREATE INDEX "invoices_conversation_id_idx" ON "invoices"("conversation_id");
CREATE INDEX "invoices_buyer_id_status_idx" ON "invoices"("buyer_id", "status");
CREATE INDEX "invoices_seller_id_status_idx" ON "invoices"("seller_id", "status");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- messages.invoice_id FK now that invoices exists
ALTER TABLE "messages" ADD CONSTRAINT "messages_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. invoice_lines
CREATE TABLE "invoice_lines" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "kind" "InvoiceLineKind" NOT NULL,
  "product_id" UUID,
  "name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "status" "InvoiceLineStatus" NOT NULL DEFAULT 'pending',
  "position" INTEGER NOT NULL DEFAULT 0,
  "resolved_at" TIMESTAMP(3),
  "auto_release_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");
CREATE INDEX "invoice_lines_status_auto_release_at_idx" ON "invoice_lines"("status", "auto_release_at");
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 9. transactions
CREATE TABLE "transactions" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "buyer_id" UUID NOT NULL,
  "seller_id" UUID NOT NULL,
  "total_paid" DECIMAL(12,2) NOT NULL,
  "platform_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "paystack_ref" TEXT NOT NULL,
  "status" "TransactionStatus" NOT NULL DEFAULT 'held',
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transactions_invoice_id_key" ON "transactions"("invoice_id");
CREATE UNIQUE INDEX "transactions_paystack_ref_key" ON "transactions"("paystack_ref");
CREATE INDEX "transactions_buyer_id_idx" ON "transactions"("buyer_id");
CREATE INDEX "transactions_seller_id_idx" ON "transactions"("seller_id");
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 10. disputes (per invoice_line)
CREATE TABLE "disputes" (
  "id" UUID NOT NULL,
  "invoice_line_id" UUID NOT NULL,
  "raised_by_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence_url" TEXT,
  "status" "DisputeStatus" NOT NULL DEFAULT 'open',
  "resolution" "DisputeResolution",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "disputes_invoice_line_id_key" ON "disputes"("invoice_line_id");
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_id_fkey" FOREIGN KEY ("raised_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 11. reviews (now per invoice_line)
CREATE TABLE "reviews" (
  "id" UUID NOT NULL,
  "invoice_line_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "body" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reviews_invoice_line_id_key" ON "reviews"("invoice_line_id");
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 12. messages_read
CREATE TABLE "messages_read" (
  "message_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "delivered_at" TIMESTAMP(3),
  "read_at" TIMESTAMP(3),
  CONSTRAINT "messages_read_pkey" PRIMARY KEY ("message_id", "user_id")
);
CREATE INDEX "messages_read_user_id_idx" ON "messages_read"("user_id");
ALTER TABLE "messages_read" ADD CONSTRAINT "messages_read_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages_read" ADD CONSTRAINT "messages_read_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 13. message_reactions
CREATE TABLE "message_reactions" (
  "message_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "emoji" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("message_id", "user_id")
);
CREATE INDEX "message_reactions_message_id_idx" ON "message_reactions"("message_id");
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
