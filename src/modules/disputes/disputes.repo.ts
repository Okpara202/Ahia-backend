import { prisma } from "../../config/db.js";
import type { DisputeStatus, Prisma } from "@prisma/client";

const disputeInclude = {
  invoiceLine: {
    include: {
      invoice: {
        include: {
          buyer: { select: { id: true, name: true, avatarUrl: true } },
          seller: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
    },
  },
  raisedBy: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.DisputeInclude;

export const disputesRepo = {
  findById(id: string) {
    return prisma.dispute.findUnique({ where: { id }, include: disputeInclude });
  },

  findByLineId(invoiceLineId: string) {
    return prisma.dispute.findUnique({
      where: { invoiceLineId },
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
          { invoiceLine: { invoice: { buyerId: args.userId } } },
          { invoiceLine: { invoice: { sellerId: args.userId } } },
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
