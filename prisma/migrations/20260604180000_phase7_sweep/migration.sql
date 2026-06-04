-- Phase 7 sweep: per-line seller_payout_amount + owed_balance on users + payouts
-- and payout_lines tables, plus PayoutKind/PayoutStatus enums.

CREATE TYPE "PayoutKind" AS ENUM ('sweep', 'cash_out_now');
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'paid', 'failed');

ALTER TABLE "users"
  ADD COLUMN "owed_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "invoice_lines"
  ADD COLUMN "seller_payout_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "payouts" (
  "id"                       UUID NOT NULL,
  "seller_id"                UUID NOT NULL,
  "amount"                   DECIMAL(12,2) NOT NULL,
  "kind"                     "PayoutKind" NOT NULL DEFAULT 'sweep',
  "status"                   "PayoutStatus" NOT NULL DEFAULT 'pending',
  "sweep_date"               DATE,
  "paystack_transfer_ref"    TEXT,
  "paystack_response"        JSONB,
  "paid_at"                  TIMESTAMP(3),
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payouts_paystack_transfer_ref_key" ON "payouts"("paystack_transfer_ref");
CREATE UNIQUE INDEX "payouts_seller_id_sweep_date_key" ON "payouts"("seller_id", "sweep_date");
CREATE INDEX "payouts_seller_id_created_at_idx" ON "payouts"("seller_id", "created_at");
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "payout_lines" (
  "payout_id"        UUID NOT NULL,
  "invoice_line_id"  UUID NOT NULL,
  CONSTRAINT "payout_lines_pkey" PRIMARY KEY ("payout_id", "invoice_line_id")
);
CREATE UNIQUE INDEX "payout_lines_invoice_line_id_key" ON "payout_lines"("invoice_line_id");
ALTER TABLE "payout_lines"
  ADD CONSTRAINT "payout_lines_payout_id_fkey"
  FOREIGN KEY ("payout_id") REFERENCES "payouts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payout_lines"
  ADD CONSTRAINT "payout_lines_invoice_line_id_fkey"
  FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
