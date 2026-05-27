import { prisma } from "../../config/db.js";
import type { Prisma, TransactionStatus } from "@prisma/client";

const transactionInclude = {
  product: { include: { shop: true } },
  buyer: {
    select: { id: true, name: true, avatarUrl: true, email: true },
  },
} satisfies Prisma.TransactionInclude;

export const transactionsRepo = {
  findById(id: string) {
    return prisma.transaction.findUnique({
      where: { id },
      include: transactionInclude,
    });
  },

  findByReference(reference: string) {
    return prisma.transaction.findUnique({
      where: { paystackRef: reference },
      include: transactionInclude,
    });
  },

  listForBuyer(args: {
    buyerId: string;
    take: number;
    cursor?: string;
    status?: TransactionStatus;
  }) {
    return prisma.transaction.findMany({
      where: {
        buyerId: args.buyerId,
        ...(args.status ? { status: args.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      include: transactionInclude,
    });
  },

  listForSeller(args: {
    sellerId: string;
    take: number;
    cursor?: string;
    status?: TransactionStatus;
  }) {
    return prisma.transaction.findMany({
      where: {
        product: { shop: { ownerId: args.sellerId } },
        ...(args.status ? { status: args.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      include: transactionInclude,
    });
  },

  create(data: Prisma.TransactionCreateInput) {
    return prisma.transaction.create({
      data,
      include: transactionInclude,
    });
  },

  update(id: string, data: Prisma.TransactionUpdateInput) {
    return prisma.transaction.update({
      where: { id },
      data,
      include: transactionInclude,
    });
  },

  findEligibleForAutoRelease(now: Date, daysSinceDelivered: number) {
    const cutoff = new Date(now.getTime() - daysSinceDelivered * 24 * 60 * 60 * 1000);
    return prisma.transaction.findMany({
      where: {
        status: "held",
        deliveredAt: { lte: cutoff },
      },
      include: transactionInclude,
    });
  },
};
