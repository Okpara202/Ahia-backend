-- CreateEnum
CREATE TYPE "InvoiceLineResolvedBy" AS ENUM ('buyer', 'auto', 'admin', 'seller');

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN "resolved_by" "InvoiceLineResolvedBy";
