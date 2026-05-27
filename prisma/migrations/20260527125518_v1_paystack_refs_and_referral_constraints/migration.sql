/*
  Warnings:

  - A unique constraint covering the columns `[paystack_ref]` on the table `boosts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[paystack_ref]` on the table `discover_campaigns` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[referrer_id,invitee_id]` on the table `referrals` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "referrals_code_key";

-- AlterTable
ALTER TABLE "boosts" ADD COLUMN     "paystack_ref" TEXT;

-- AlterTable
ALTER TABLE "discover_campaigns" ADD COLUMN     "paystack_ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "boosts_paystack_ref_key" ON "boosts"("paystack_ref");

-- CreateIndex
CREATE INDEX "boosts_product_id_ends_at_idx" ON "boosts"("product_id", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "discover_campaigns_paystack_ref_key" ON "discover_campaigns"("paystack_ref");

-- CreateIndex
CREATE INDEX "discover_campaigns_post_id_ends_at_idx" ON "discover_campaigns"("post_id", "ends_at");

-- CreateIndex
CREATE INDEX "discover_posts_shop_id_idx" ON "discover_posts"("shop_id");

-- CreateIndex
CREATE INDEX "referrals_invitee_id_status_idx" ON "referrals"("invitee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referrer_id_invitee_id_key" ON "referrals"("referrer_id", "invitee_id");

-- AddForeignKey
ALTER TABLE "discover_posts" ADD CONSTRAINT "discover_posts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
