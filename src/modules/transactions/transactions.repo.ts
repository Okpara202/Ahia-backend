import { prisma } from "../../config/db.js";
import type { Prisma, TransactionStatus } from "@prisma/client";

const transactionInclude = {
  invoice: {
    include: {
      lines: { orderBy: { position: "asc" } },
    },
  },
  buyer: { select: { id: true, name: true, avatarUrl: true } },
  seller: { select: { id: true, name: true, avatarUrl: true } },
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

  findByInvoiceId(invoiceId: string) {
    return prisma.transaction.findUnique({
      where: { invoiceId },
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
        sellerId: args.sellerId,
        ...(args.status ? { status: args.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      include: transactionInclude,
    });
  },
};
