-- DropIndex
DROP INDEX "shops_owner_id_key";

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "shops_owner_id_idx" ON "shops"("owner_id");

-- CreateIndex
-- Partial unique: only one ACTIVE (non-deleted) shop per owner.
-- Tombstoned shops (deleted_at IS NOT NULL) don't count, so a user
-- can permanently close a shop and later open a brand-new one.
CREATE UNIQUE INDEX "shops_owner_id_active_key" ON "shops"("owner_id") WHERE "deleted_at" IS NULL;
