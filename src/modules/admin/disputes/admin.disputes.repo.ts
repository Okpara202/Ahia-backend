import { prisma } from "../../../config/db.js";
import { messageInclude } from "../../conversations/conversations.repo.js";
import type { DisputeStatus, Prisma } from "@prisma/client";

const disputeListInclude = {
  invoiceLine: {
    include: {
      product: { select: { id: true, name: true, cover: true } },
      invoice: {
        select: {
          id: true,
          conversationId: true,
          buyer: { select: { id: true, name: true, email: true, avatarUrl: true } },
          seller: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
      },
    },
  },
  raisedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.DisputeInclude;

export const adminDisputesRepo = {
  list(args: {
    statuses: DisputeStatus[] | null; // null = all
    take: number;
    cursor?: string;
    sort: "oldest" | "newest" | "amount_desc" | "amount_asc";
  }) {
    const where: Prisma.DisputeWhereInput = {};
    if (args.statuses) where.status = { in: args.statuses };

    // For amount sorting we lean on the unitPrice * quantity on the invoice
    // line, but Prisma can't sort on a computed column directly — fall back
    // to ordering by unitPrice. Good enough for v1; if it matters we move
    // to a raw query later.
    const orderBy: Prisma.DisputeOrderByWithRelationInput[] =
      args.sort === "amount_desc"
        ? [{ invoiceLine: { unitPrice: "desc" } }, { createdAt: "desc" }]
        : args.sort === "amount_asc"
          ? [{ invoiceLine: { unitPrice: "asc" } }, { createdAt: "asc" }]
          : args.sort === "newest"
            ? [{ createdAt: "desc" }]
            : [{ createdAt: "asc" }];

    return prisma.dispute.findMany({
      where,
      orderBy,
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      include: disputeListInclude,
    });
  },

  countByBuyer(buyerId: string, excludeId?: string) {
    return prisma.dispute.count({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        invoiceLine: { invoice: { buyerId } },
      },
    });
  },

  countBySeller(sellerId: string, excludeId?: string) {
    return prisma.dispute.count({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        invoiceLine: { invoice: { sellerId } },
      },
    });
  },

  findById(id: string) {
    return prisma.dispute.findUnique({
      where: { id },
      include: {
        invoiceLine: {
          include: {
            product: { select: { id: true, name: true, cover: true } },
            invoice: {
              include: {
                buyer: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    avatarUrl: true,
                    status: true,
                  },
                },
                seller: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    avatarUrl: true,
                    status: true,
                    shops: {
                      where: { deletedAt: null },
                      select: { id: true, name: true, handle: true, adminSuspendedAt: true },
                    },
                  },
                },
                lines: { orderBy: { position: "asc" } },
              },
            },
          },
        },
        raisedBy: { select: { id: true, name: true, email: true } },
        resolvedByAdmin: { select: { id: true, name: true } },
      },
    });
  },

  listConversationMessages(conversationId: string) {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: messageInclude,
    });
  },

  countAdminMessagesInConversation(conversationId: string) {
    return prisma.message.count({
      where: { conversationId, adminAuthorId: { not: null } },
    });
  },
};
