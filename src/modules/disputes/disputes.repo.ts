import { prisma } from "../../config/db.js";
import type { DisputeStatus, Prisma } from "@prisma/client";

const disputeInclude = {
  transaction: {
    include: {
      product: { include: { shop: true } },
      buyer: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.DisputeInclude;

export const disputesRepo = {
  findById(id: string) {
    return prisma.dispute.findUnique({ where: { id }, include: disputeInclude });
  },

  findByTransactionId(transactionId: string) {
    return prisma.dispute.findUnique({
      where: { transactionId },
      include: disputeInclude,
    });
  },

  listForUser(args: {
    userId: string;
    take: number;
    cursor?: string;
    status?: DisputeStatus;
  }) {
    return prisma.dispute.findMany({
      where: {
        OR: [
          { transaction: { buyerId: args.userId } },
          { transaction: { product: { shop: { ownerId: args.userId } } } },
        ],
        ...(args.status ? { status: args.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      include: disputeInclude,
    });
  },
};
