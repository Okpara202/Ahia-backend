import { prisma } from "../../config/db.js";
import type { Prisma } from "@prisma/client";

const boostInclude = {
  product: { include: { shop: true } },
} satisfies Prisma.BoostInclude;

export const boostsRepo = {
  listForUser(userId: string) {
    return prisma.boost.findMany({
      where: { product: { shop: { ownerId: userId } } },
      orderBy: { createdAt: "desc" },
      include: boostInclude,
    });
  },

  findByReference(reference: string) {
    return prisma.boost.findUnique({
      where: { paystackRef: reference },
      include: boostInclude,
    });
  },

  create(data: Prisma.BoostCreateInput) {
    return prisma.boost.create({ data, include: boostInclude });
  },

  findStaleSponsoredProducts(now: Date) {
    return prisma.product.findMany({
      where: {
        sponsored: true,
        boosts: { none: { endsAt: { gte: now } } },
      },
      select: { id: true },
    });
  },
};
