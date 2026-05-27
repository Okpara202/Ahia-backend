import crypto from "node:crypto";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../errors.js";
import {
  uploadImageBuffer,
  uploadVideoBuffer,
} from "../../integrations/cloudinary.js";
import { paystack } from "../../integrations/paystack.js";
import { broadcastToUser } from "../../realtime/socket.js";
import { getPlan, planEndDate } from "../boosts/boosts.plans.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { wishlistRepo } from "../wishlist/wishlist.repo.js";
import { discoverRepo } from "./discover.repo.js";
import type {
  CreateCampaignInput,
  CreateDiscoverPostInput,
  FeedQuery,
} from "./discover.schemas.js";
import type { BoostPlan } from "@prisma/client";

const DISCOVER_REF_PREFIX = "ahia_discover_";
const PAID_SLOTS_PER_PAGE = [2, 6, 10] as const;

function generateReference(): string {
  return `${DISCOVER_REF_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

type PaystackWebhookPayload = {
  event: string;
  data: {
    reference: string;
    amount: number;
    metadata?: {
      type?: string;
      userId?: string;
      postId?: string;
      plan?: string;
      [k: string]: unknown;
    };
  };
};

export const discoverService = {
  async createPost(
    userId: string,
    input: CreateDiscoverPostInput,
    files: { video?: Buffer; poster?: Buffer },
  ) {
    if (!files.video) {
      throw new BadRequestError("Video file is required");
    }
    const shop = await prisma.shop.findUnique({ where: { ownerId: userId } });
    if (!shop) {
      throw new ForbiddenError("You must have a shop to post to Discover");
    }

    if (input.ctaType === "product") {
      const product = await prisma.product.findFirst({
        where: { id: input.ctaTargetId, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new NotFoundError("CTA product");
    } else {
      const ctaShop = await prisma.shop.findUnique({
        where: { id: input.ctaTargetId },
        select: { id: true },
      });
      if (!ctaShop) throw new NotFoundError("CTA shop");
    }

    const folder = `ahia/discover/${shop.id}`;
    const { videoUrl, posterUrl: autoPoster } = await uploadVideoBuffer(
      files.video,
      { folder },
    );
    const posterUrl = files.poster
      ? await uploadImageBuffer(files.poster, { folder })
      : autoPoster;

    return discoverRepo.create({
      shop: { connect: { id: shop.id } },
      videoUrl,
      posterUrl,
      caption: input.caption,
      ctaType: input.ctaType,
      ctaTargetId: input.ctaTargetId,
    });
  },

  async getFeed(query: FeedQuery) {
    const limit = query.limit;
    const paidCount = Math.min(
      PAID_SLOTS_PER_PAGE.length,
      Math.floor(limit / 4),
    );
    const organicCount = limit - paidCount;

    const organic = await discoverRepo.listOrganic({
      take: organicCount,
      cursor: query.cursor,
    });
    const hasMore = organic.length > organicCount;
    const organicSlice = hasMore ? organic.slice(0, organicCount) : organic;
    const nextCursor = hasMore
      ? organicSlice[organicSlice.length - 1]?.id ?? null
      : null;
    const organicItems = organicSlice.map((p) => ({
      ...p,
      sponsored: false as const,
    }));

    const now = new Date();
    const paidPool = await discoverRepo.listActivePaid(now, paidCount * 3);
    const shuffled = paidPool
      .sort(() => Math.random() - 0.5)
      .slice(0, paidCount)
      .map((p) => ({ ...p, sponsored: true as const }));

    type FeedItem = (typeof organicItems)[number] | (typeof shuffled)[number];
    const items: FeedItem[] = [...organicItems];
    PAID_SLOTS_PER_PAGE.forEach((pos, i) => {
      const paid = shuffled[i];
      if (!paid) return;
      if (pos <= items.length) {
        items.splice(pos, 0, paid);
      } else {
        items.push(paid);
      }
    });

    return { items: items.slice(0, limit), nextCursor };
  },

  async recordImpression(postId: string) {
    const post = await discoverRepo.findById(postId);
    if (!post) return;
    await discoverRepo.incrementCounter(postId, "impressions");
    const now = new Date();
    const campaign = await discoverRepo.findActiveCampaignForPost(postId, now);
    if (campaign) {
      await discoverRepo.incrementDailyStat({
        campaignId: campaign.id,
        date: startOfUtcDay(now),
        field: "impressions",
      });
    }
  },

  async recordClick(postId: string) {
    const post = await discoverRepo.findById(postId);
    if (!post) return;
    await discoverRepo.incrementCounter(postId, "clicks");
    const now = new Date();
    const campaign = await discoverRepo.findActiveCampaignForPost(postId, now);
    if (campaign) {
      await discoverRepo.incrementDailyStat({
        campaignId: campaign.id,
        date: startOfUtcDay(now),
        field: "clicks",
      });
    }
  },

  async recordSave(userId: string, postId: string) {
    const post = await discoverRepo.findById(postId);
    if (!post) throw new NotFoundError("Post");
    if (post.ctaType === "product") {
      const product = await prisma.product.findFirst({
        where: { id: post.ctaTargetId, deletedAt: null },
        select: { id: true },
      });
      if (product) {
        await wishlistRepo.add(userId, post.ctaTargetId);
      }
    }
    await discoverRepo.incrementCounter(postId, "saves");
  },

  async initCampaign(userId: string, input: CreateCampaignInput) {
    const plan = getPlan(input.plan);
    if (!plan) throw new BadRequestError("Invalid plan");

    const post = await discoverRepo.findById(input.postId);
    if (!post) throw new NotFoundError("Discover post");

    const shop = await prisma.shop.findUnique({ where: { id: post.shopId } });
    if (!shop || shop.ownerId !== userId) {
      throw new ForbiddenError("You can only run campaigns on your own posts");
    }

    const buyer = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!buyer) throw new NotFoundError("User");

    const reference = generateReference();
    const amountInKobo = Math.round(plan.priceNaira * 100);

    const init = await paystack.initTransaction({
      email: buyer.email,
      amountInKobo,
      reference,
      metadata: {
        type: "discover",
        userId,
        postId: input.postId,
        plan: input.plan,
      },
      callbackUrl: input.callbackUrl,
    });

    return {
      authorization_url: init.authorization_url,
      reference: init.reference,
    };
  },

  async handlePaystackSuccess(payload: PaystackWebhookPayload) {
    const reference = payload.data.reference;
    const metadata = payload.data.metadata ?? {};
    const userId = metadata.userId;
    const postId = metadata.postId;
    const planId = metadata.plan;

    if (!userId || !postId || !planId) {
      logger.warn("paystack discover: missing metadata", { reference });
      return null;
    }
    const plan = getPlan(planId);
    if (!plan) {
      logger.warn("paystack discover: invalid plan", { planId, reference });
      return null;
    }

    const existing = await discoverRepo.findCampaignByReference(reference);
    if (existing) {
      logger.info("paystack discover: duplicate event ignored", { reference });
      return existing;
    }

    const startsAt = new Date();
    const endsAt = planEndDate(startsAt, plan);
    const amount = payload.data.amount / 100;

    const campaign = await discoverRepo.createCampaign({
      post: { connect: { id: postId } },
      plan: planId as BoostPlan,
      spend: amount,
      startsAt,
      endsAt,
      paystackRef: reference,
    });

    broadcastToUser(userId, "discover:campaign_started", { campaign });
    await notificationsService.createForUser(
      userId,
      "discover_campaign_started",
      {
        campaignId: campaign.id,
        postId,
        plan: planId,
        endsAt: endsAt.toISOString(),
      },
    );

    return campaign;
  },

  async listMyCampaigns(userId: string) {
    return discoverRepo.listCampaignsForUser(userId);
  },

  async getCampaignAnalytics(userId: string, campaignId: string) {
    const campaign = await discoverRepo.findCampaignWithStats(campaignId);
    if (!campaign) throw new NotFoundError("Campaign");
    if (campaign.post.shop.ownerId !== userId) {
      throw new ForbiddenError("Not your campaign");
    }

    return {
      campaign: {
        id: campaign.id,
        plan: campaign.plan,
        spend: Number(campaign.spend),
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      },
      post: {
        id: campaign.post.id,
        videoUrl: campaign.post.videoUrl,
        posterUrl: campaign.post.posterUrl,
        caption: campaign.post.caption,
        impressions: campaign.post.impressions,
        clicks: campaign.post.clicks,
      },
      daily: campaign.daily.map((d) => ({
        date: d.date.toISOString().slice(0, 10),
        impressions: d.impressions,
        clicks: d.clicks,
        spend: Number(d.spend),
      })),
    };
  },
};
