-- CreateTable
CREATE TABLE "follows" (
    "user_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("user_id","shop_id")
);

-- CreateIndex
CREATE INDEX "follows_shop_id_idx" ON "follows"("shop_id");

-- CreateIndex
CREATE INDEX "follows_user_id_idx" ON "follows"("user_id");

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
