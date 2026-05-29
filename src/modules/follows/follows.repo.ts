import { prisma } from "../../config/db.js";

export const followsRepo = {
  async add(userId: string, shopId: string) {
    try {
      await prisma.follow.create({ data: { userId, shopId } });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") return;
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
};
