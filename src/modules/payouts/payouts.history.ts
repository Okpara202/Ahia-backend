import { prisma } from "../../config/db.js";

export const payoutsHistory = {
  async listForSeller(args: { sellerId: string; take: number; cursor?: string }) {
    const rows = await prisma.payout.findMany({
      where: { sellerId: args.sellerId },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      include: {
        lines: {
          select: { invoiceLineId: true },
        },
      },
    });
    return rows;
  },
};
