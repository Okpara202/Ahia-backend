import { prisma } from "../../config/db.js";
import type { Prisma } from "@prisma/client";

export const storiesRepo = {
  listActiveForShop(shopId: string, now: Date) {
    return prisma.story.findMany({
      where: { shopId, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
  },

  create(data: Prisma.StoryCreateInput) {
    return prisma.story.create({ data });
  },
};
