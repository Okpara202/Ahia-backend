import { prisma } from "../../config/db.js";
import type { Prisma, Shop } from "@prisma/client";

export const shopsRepo = {
  findById(id: string): Promise<Shop | null> {
    return prisma.shop.findUnique({ where: { id } });
  },

  findByOwnerId(ownerId: string): Promise<Shop | null> {
    return prisma.shop.findUnique({ where: { ownerId } });
  },

  findByHandle(handle: string): Promise<Shop | null> {
    return prisma.shop.findUnique({ where: { handle } });
  },

  create(data: Prisma.ShopCreateInput): Promise<Shop> {
    return prisma.shop.create({ data });
  },

  update(id: string, data: Prisma.ShopUpdateInput): Promise<Shop> {
    return prisma.shop.update({ where: { id }, data });
  },

  listProducts(args: { shopId: string; take: number; cursor?: { id: string } }) {
    return prisma.product.findMany({
      where: { shopId: args.shopId, deletedAt: null, hidden: false },
      take: args.take + 1,
      cursor: args.cursor,
      orderBy: [{ createdAt: "desc" }],
    });
  },
};
