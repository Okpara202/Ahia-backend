-- Add buyer-controlled auto-release extension fields to invoice_lines.
ALTER TABLE "invoice_lines"
  ADD COLUMN "extended_at" TIMESTAMP(3),
  ADD COLUMN "extension_reason" VARCHAR(200);
