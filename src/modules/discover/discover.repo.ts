import { prisma } from "../../config/db.js";
import type { Prisma } from "@prisma/client";

export const discoverRepo = {
  listOrganic(args: { take: number; cursor?: string; now: Date }) {
    return prisma.discoverPost.findMany({
      where: {
        expiresAt: { gt: args.now },
        shop: { deletedAt: null },
      },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
    });
  },

  listActivePaid(now: Date, take: number) {
    return prisma.discoverPost.findMany({
      where: {
        expiresAt: { gt: now },
        shop: { deletedAt: null },
        campaigns: {
          some: { startsAt: { lte: now }, endsAt: { gte: now } },
        },
      },
      take,
    });
  },

  countRecentFreeForShop(
    shopId: string,
    since: Date,
    demoteCutoff: Date,
  ) {
    // "Counts toward the free cap" = either:
    //   (a) intent was free at upload time, OR
    //   (b) intent was boost, but the post is older than the demote cutoff
    //       (≥30 min) AND no campaign was ever attached — abandoned Paystack.
    // Boost-intent posts mid-Paystack (under the cutoff) are not counted,
    // so a 4th free upload during the brief window isn't incorrectly rejected.
    return prisma.discoverPost.count({
      where: {
        shopId,
        createdAt: { gte: since },
        OR: [
          { intentFree: true },
          {
            intentFree: false,
            createdAt: { lt: demoteCutoff },
            campaigns: { none: {} },
          },
        ],
      },
    });
  },

  listForOwner(args: { ownerId: string; take: number; cursor?: string }) {
    return prisma.discoverPost.findMany({
      where: { shop: { ownerId: args.ownerId } },
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
    });
  },

  updatePost(id: string, data: Prisma.DiscoverPostUpdateInput) {
    return prisma.discoverPost.update({ where: { id }, data });
  },

  createEdit(data: Prisma.DiscoverPostEditCreateInput) {
    return prisma.discoverPostEdit.create({ data });
  },

  findById(id: string) {
    return prisma.discoverPost.findUnique({ where: { id } });
  },

  create(data: Prisma.DiscoverPostCreateInput) {
    return prisma.discoverPost.create({ data });
  },

  incrementCounter(id: string, counter: "impressions" | "clicks" | "saves") {
    return prisma.discoverPost.update({
      where: { id },
      data: { [counter]: { increment: 1 } },
    });
  },

  findActiveCampaignForPost(postId: string, now: Date) {
    return prisma.discoverCampaign.findFirst({
      where: { postId, startsAt: { lte: now }, endsAt: { gte: now } },
    });
  },

  incrementDailyStat(args: {
    campaignId: string;
    date: Date;
    field: "impressions" | "clicks";
  }) {
    return prisma.discoverDailyStat.upsert({
      where: {
        campaignId_date: { campaignId: args.campaignId, date: args.date },
      },
      create: {
        campaignId: args.campaignId,
        date: args.date,
        impressions: args.field === "impressions" ? 1 : 0,
        clicks: args.field === "clicks" ? 1 : 0,
      },
      update: {
        [args.field]: { increment: 1 },
      },
    });
  },

  createCampaign(data: Prisma.DiscoverCampaignCreateInput) {
    return prisma.discoverCampaign.create({
      data,
      include: { post: true },
    });
  },

  findCampaignByReference(reference: string) {
    return prisma.discoverCampaign.findUnique({
      where: { paystackRef: reference },
    });
  },

  listCampaignsForUser(userId: string) {
    return prisma.discoverCampaign.findMany({
      where: { post: { shop: { ownerId: userId } } },
      orderBy: { createdAt: "desc" },
      include: { post: true },
    });
  },

  findCampaignWithStats(campaignId: string) {
    return prisma.discoverCampaign.findUnique({
      where: { id: campaignId },
      include: {
        post: { include: { shop: true } },
        daily: { orderBy: { date: "asc" } },
      },
    });
  },
};
