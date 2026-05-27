import { prisma } from "../../config/db.js";
import { NotFoundError } from "../../errors.js";
import { wishlistRepo } from "./wishlist.repo.js";

export const wishlistService = {
  async list(userId: string) {
    return wishlistRepo.listForUser(userId);
  },

  async add(userId: string, productId: string) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundError("Product");
    await wishlistRepo.add(userId, productId);
  },

  async remove(userId: string, productId: string) {
    await wishlistRepo.remove(userId, productId);
  },
};
