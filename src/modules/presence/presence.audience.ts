import { prisma } from "../../config/db.js";

// Returns the set of user IDs that should receive presence updates for `userId`:
// counterparties in any conversation, plus followers of the user's shop, plus
// shop owners they follow. Caps result to avoid runaway emits.
export const presenceAudience = {
  async audienceFor(userId: string, max = 500): Promise<string[]> {
    const seen = new Set<string>();

    const convoCounterparts = await prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: { buyerId: true, sellerId: true },
      take: max,
    });
    for (const c of convoCounterparts) {
      const other = c.buyerId === userId ? c.sellerId : c.buyerId;
      if (other !== userId) seen.add(other);
      if (seen.size >= max) return Array.from(seen);
    }

    const shop = await prisma.shop.findFirst({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    if (shop) {
      const followers = await prisma.follow.findMany({
        where: { shopId: shop.id },
        select: { userId: true },
        take: max,
      });
      for (const f of followers) {
        if (f.userId !== userId) seen.add(f.userId);
        if (seen.size >= max) return Array.from(seen);
      }
    }

    const following = await prisma.follow.findMany({
      where: { userId },
      select: { shop: { select: { ownerId: true } } },
      take: max,
    });
    for (const f of following) {
      if (f.shop.ownerId !== userId) seen.add(f.shop.ownerId);
      if (seen.size >= max) return Array.from(seen);
    }

    return Array.from(seen);
  },
};
