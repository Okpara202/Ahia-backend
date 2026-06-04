import { prisma } from "../../config/db.js";
import type { Prisma } from "@prisma/client";

const storyInclude = {
  shop: {
    select: { id: true, name: true, handle: true, avatarUrl: true },
  },
  product: {
    select: { id: true, name: true, cover: true, price: true },
  },
} satisfies Prisma.StoryInclude;

export const storiesRepo = {
  listActiveForShop(shopId: string, now: Date) {
    return prisma.story.findMany({
      where: {
        shopId,
        deletedAt: null,
        expiresAt: { gt: now },
        shop: { isActive: true, deletedAt: null },
      },
      orderBy: { createdAt: "desc" },
      include: storyInclude,
    });
  },

  listMineActive(shopId: string, now: Date) {
    return prisma.story.findMany({
      where: {
        shopId,
        deletedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      include: storyInclude,
    });
  },

  findById(id: string) {
    return prisma.story.findUnique({
      where: { id },
      include: storyInclude,
    });
  },

  create(data: Prisma.StoryCreateInput) {
    return prisma.story.create({ data, include: storyInclude });
  },

  softDelete(id: string) {
    return prisma.story.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  },

  findExpiredOrUndeleted(now: Date) {
    return prisma.story.findMany({
      where: {
        deletedAt: null,
        expiresAt: { lte: now },
      },
      select: { id: true, cloudinaryId: true },
    });
  },

  countMessageReferences(storyId: string) {
    return prisma.message.count({ where: { storyContextStoryId: storyId } });
  },

  upsertView(storyId: string, userId: string) {
    return prisma.storyView.upsert({
      where: { storyId_userId: { storyId, userId } },
      update: { viewedAt: new Date() },
      create: { storyId, userId },
    });
  },

  hasViewed(storyId: string, userId: string) {
    return prisma.storyView.findUnique({
      where: { storyId_userId: { storyId, userId } },
      select: { viewedAt: true },
    });
  },

  incrementViewCount(storyId: string, by: number) {
    return prisma.story.update({
      where: { id: storyId },
      data: { viewCount: { increment: by } },
    });
  },
};

export { storyInclude };
