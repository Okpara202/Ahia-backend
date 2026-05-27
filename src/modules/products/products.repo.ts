import { prisma } from "../../config/db.js";
import type { Prisma, Product } from "@prisma/client";

export const productsRepo = {
  findById(id: string) {
    return prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { shop: true },
    });
  },

  findByIdRaw(id: string) {
    return prisma.product.findUnique({
      where: { id },
      include: { shop: true },
    });
  },

  list(args: {
    where: Prisma.ProductWhereInput;
    take: number;
    cursor?: Prisma.ProductWhereUniqueInput;
  }): Promise<Product[]> {
    return prisma.product.findMany({
      where: { ...args.where, deletedAt: null, hidden: false },
      take: args.take + 1,
      cursor: args.cursor,
      orderBy: [{ sponsored: "desc" }, { createdAt: "desc" }],
      include: { shop: true },
    });
  },

  create(data: Prisma.ProductCreateInput): Promise<Product> {
    return prisma.product.create({ data });
  },

  update(id: string, data: Prisma.ProductUpdateInput): Promise<Product> {
    return prisma.product.update({ where: { id }, data });
  },

  softDelete(id: string): Promise<Product> {
    return prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  },
};
