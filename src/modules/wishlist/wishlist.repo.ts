import { prisma } from "../../config/db.js";

export const wishlistRepo = {
  listForUser(userId: string) {
    return prisma.wishlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        product: { include: { shop: true } },
      },
    });
  },

  add(userId: string, productId: string) {
    return prisma.wishlistItem.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
    });
  },

  remove(userId: string, productId: string) {
    return prisma.wishlistItem.deleteMany({
      where: { userId, productId },
    });
  },
};
