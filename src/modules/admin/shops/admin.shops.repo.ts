import { prisma } from "../../../config/db.js";
import type { Prisma } from "@prisma/client";

const listSelect = {
  id: true,
  name: true,
  handle: true,
  category: true,
  bio: true,
  avatarUrl: true,
  bannerUrl: true,
  location: true,
  isActive: true,
  deletedAt: true,
  adminSuspendedAt: true,
  adminSuspendedReason: true,
  adminSuspendedById: true,
  createdAt: true,
  owner: {
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
    },
  },
} satisfies Prisma.ShopSelect;

export const adminShopsRepo = {
  list(args: {
    q?: string;
    status: "active" | "deactivated" | "demolished" | "all";
    take: number;
    cursor?: string;
  }) {
    const where: Prisma.ShopWhereInput = {};
    if (args.status === "active") {
      where.deletedAt = null;
      where.adminSuspendedAt = null;
    } else if (args.status === "deactivated") {
      where.deletedAt = null;
      where.adminSuspendedAt = { not: null };
    } else if (args.status === "demolished") {
      where.deletedAt = { not: null };
    }
    if (args.q) {
      where.OR = [
        { handle: { contains: args.q, mode: "insensitive" } },
        { name: { contains: args.q, mode: "insensitive" } },
      ];
    }
    return prisma.shop.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      select: listSelect,
    });
  },

  findById(id: string) {
    return prisma.shop.findUnique({
      where: { id },
      select: {
        ...listSelect,
        showLegalName: true,
        updatedAt: true,
        _count: {
          select: {
            products: { where: { deletedAt: null } },
            followers: true,
            discoverPosts: { where: { deletedAt: null } },
            stories: { where: { deletedAt: null } },
          },
        },
      },
    });
  },

  deactivate(args: {
    shopId: string;
    reason: string;
    adminId: string;
  }) {
    return prisma.shop.update({
      where: { id: args.shopId },
      data: {
        adminSuspendedAt: new Date(),
        adminSuspendedReason: args.reason,
        adminSuspendedById: args.adminId,
      },
    });
  },

  restore(shopId: string) {
    return prisma.shop.update({
      where: { id: shopId },
      data: {
        adminSuspendedAt: null,
        adminSuspendedReason: null,
        adminSuspendedById: null,
      },
    });
  },
};
