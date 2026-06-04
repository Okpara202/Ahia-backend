import { prisma } from "../../config/db.js";

export const followsRepo = {
  async add(userId: string, shopId: string): Promise<boolean> {
    try {
      await prisma.follow.create({ data: { userId, shopId } });
      return true;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") return false;
      throw err;
    }
  },

  async remove(userId: string, shopId: string) {
    await prisma.follow.deleteMany({ where: { userId, shopId } });
  },

  async exists(userId: string, shopId: string): Promise<boolean> {
    const row = await prisma.follow.findUnique({
      where: { userId_shopId: { userId, shopId } },
      select: { userId: true },
    });
    return row !== null;
  },

  count(shopId: string): Promise<number> {
    return prisma.follow.count({ where: { shopId } });
  },

  async followerIds(shopId: string): Promise<string[]> {
    const rows = await prisma.follow.findMany({
      where: { shopId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  },

  countForUser(userId: string): Promise<number> {
    return prisma.follow.count({ where: { userId } });
  },

  async listForUser(args: { userId: string; take: number; cursor?: string }) {
    const rows = await prisma.follow.findMany({
      where: { userId: args.userId },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { userId_shopId: { userId: args.userId, shopId: args.cursor } } : undefined,
      skip: args.cursor ? 1 : 0,
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            handle: true,
            avatarUrl: true,
            isActive: true,
            deletedAt: true,
            stories: {
              where: { deletedAt: null, expiresAt: { gt: new Date() } },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { createdAt: true },
            },
            owner: { select: { id: true } },
          },
        },
      },
    });
    return rows;
  },

  async listFollowersOfShop(args: { shopId: string; take: number; cursor?: string }) {
    const rows = await prisma.follow.findMany({
      where: { shopId: args.shopId },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { userId_shopId: { userId: args.cursor, shopId: args.shopId } } : undefined,
      skip: args.cursor ? 1 : 0,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            allowsColdDMs: true,
          },
        },
      },
    });
    return rows;
  },
};
