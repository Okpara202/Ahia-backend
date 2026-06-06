import { prisma } from "../../../config/db.js";
import type { Prisma, UserStatus } from "@prisma/client";

const listSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatarUrl: true,
  status: true,
  suspendedAt: true,
  suspendedReason: true,
  createdAt: true,
  shops: {
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      handle: true,
      isActive: true,
      adminSuspendedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

export const adminUsersRepo = {
  list(args: {
    q?: string;
    status: "active" | "suspended" | "all";
    take: number;
    cursor?: string;
  }) {
    const where: Prisma.UserWhereInput = {};
    if (args.status !== "all") where.status = args.status as UserStatus;
    if (args.q) {
      where.OR = [
        { email: { contains: args.q, mode: "insensitive" } },
        { name: { contains: args.q, mode: "insensitive" } },
      ];
    }
    return prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      select: listSelect,
    });
  },

  findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        ...listSelect,
        suspendedById: true,
        owedBalance: true,
        allowsColdDMs: true,
        updatedAt: true,
        _count: {
          select: {
            buyerConversations: true,
            sellerConversations: true,
            disputesRaised: true,
            invoicesAsBuyer: true,
            invoicesAsSeller: true,
            shops: { where: { deletedAt: null } },
          },
        },
      },
    });
  },

  suspend(args: {
    userId: string;
    reason: string;
    suspendedById: string;
  }) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: args.userId },
        data: {
          status: "suspended",
          suspendedAt: now,
          suspendedReason: args.reason,
          suspendedById: args.suspendedById,
        },
      });
      // Cascade: any non-demolished shop the user owns gets admin-suspended
      // with the same reason and timestamp so they share lifecycle.
      await tx.shop.updateMany({
        where: {
          ownerId: args.userId,
          deletedAt: null,
          adminSuspendedAt: null,
        },
        data: {
          adminSuspendedAt: now,
          adminSuspendedReason: args.reason,
          adminSuspendedById: args.suspendedById,
        },
      });
      return user;
    });
  },

  restore(userId: string) {
    return prisma.$transaction(async (tx) => {
      // Snapshot the cascade timestamp BEFORE we clear it — we only lift
      // shop suspensions that match this exact timestamp (the cascade
      // signature). Independent admin-actioned shop suspensions with
      // different timestamps stay suspended.
      const before = await tx.user.findUnique({
        where: { id: userId },
        select: { suspendedAt: true },
      });
      const cascadeStamp = before?.suspendedAt ?? null;

      const user = await tx.user.update({
        where: { id: userId },
        data: {
          status: "active",
          suspendedAt: null,
          suspendedReason: null,
          suspendedById: null,
        },
      });

      if (cascadeStamp) {
        await tx.shop.updateMany({
          where: {
            ownerId: userId,
            adminSuspendedAt: cascadeStamp,
          },
          data: {
            adminSuspendedAt: null,
            adminSuspendedReason: null,
            adminSuspendedById: null,
          },
        });
      }
      return user;
    });
  },
};
