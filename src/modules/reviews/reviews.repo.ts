import { prisma } from "../../config/db.js";
import type { Prisma } from "@prisma/client";

export const reviewsRepo = {
  listForProduct(productId: string) {
    return prisma.review.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  },

  productAggregate(productId: string) {
    return prisma.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: true,
    });
  },

  shopAggregate(shopId: string) {
    return prisma.review.aggregate({
      where: { shopId },
      _avg: { rating: true },
      _count: true,
    });
  },

  findByTransactionId(transactionId: string) {
    return prisma.review.findUnique({ where: { transactionId } });
  },

  create(data: Prisma.ReviewCreateInput) {
    return prisma.review.create({ data });
  },
};
