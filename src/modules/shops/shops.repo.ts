import { prisma } from "../../config/db.js";
import type { Prisma, Shop } from "@prisma/client";

export const shopsRepo = {
  findById(id: string): Promise<Shop | null> {
    return prisma.shop.findUnique({ where: { id } });
  },

  findByOwnerIdAny(ownerId: string): Promise<Shop | null> {
    return prisma.shop.findFirst({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
    });
  },

  findByOwnerId(ownerId: string): Promise<Shop | null> {
    return prisma.shop.findFirst({
      where: { ownerId, deletedAt: null },
    });
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

  softDelete(id: string): Promise<Shop> {
    return prisma.shop.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },

  productCount(shopId: string): Promise<number> {
    return prisma.product.count({
      where: { shopId, deletedAt: null, hidden: false },
    });
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
