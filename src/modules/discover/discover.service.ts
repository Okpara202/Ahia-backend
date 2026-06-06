import crypto from "node:crypto";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../errors.js";
import {
  destroyAsset,
  uploadImageBufferWithId,
  uploadVideoBuffer,
} from "../../integrations/cloudinary.js";
import { assertFileKind } from "../../middleware/mimeGuard.js";
import { paystack } from "../../integrations/paystack.js";
import { broadcastToUser } from "../../realtime/socket.js";
import { getPlan, planEndDate } from "../boosts/boosts.plans.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { notificationRenderers } from "../notifications/notifications.renderer.js";
import { wishlistRepo } from "../wishlist/wishlist.repo.js";
import { discoverRepo } from "./discover.repo.js";
import type {
  CreateCampaignInput,
  CreateDiscoverPostInput,
  EditPostInput,
  FeedQuery,
  ListMyPostsQuery,
} from "./discover.schemas.js";
import type { BoostPlan } from "@prisma/client";

const DISCOVER_REF_PREFIX = "ahia_discover_";
const FREE_POST_TTL_DAYS = 30;
const FREE_POST_CAP = 3;
const ORGANIC_TARGET_RATIO = 0.75;
const BOOST_INTENT_DEMOTE_MINUTES = 30;

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
    assertFileKind(files.video, "video", "video");
    if (files.poster) assertFileKind(files.poster, "image", "poster");
    const shop = await prisma.shop.findFirst({
      where: { ownerId: userId, deletedAt: null },
    });
    if (!shop) {
      throw new ForbiddenError("You must have a shop to post to Discover");
    }

    if (input.intent === "free") {
      const now = Date.now();
      const windowStart = new Date(
        now - FREE_POST_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
      const demoteCutoff = new Date(
        now - BOOST_INTENT_DEMOTE_MINUTES * 60 * 1000,
      );
      const recentFreeCount = await discoverRepo.countRecentFreeForShop(
        shop.id,
        windowStart,
        demoteCutoff,
      );
      if (recentFreeCount >= FREE_POST_CAP) {
        throw new AppError(
          429,
          "free_discover_limit",
          "You can post 3 free Discover videos per month. Boost an existing post or wait until your earliest free post expires.",
        );
      }
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
    let posterUrl: string | undefined = autoPoster;
    let posterPublicId: string | undefined;
    if (files.poster) {
      const uploaded = await uploadImageBufferWithId(files.poster, { folder });
      posterUrl = uploaded.url;
      posterPublicId = uploaded.publicId;
    }

    const expiresAt = new Date(
      Date.now() + FREE_POST_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    return discoverRepo.create({
      shop: { connect: { id: shop.id } },
      videoUrl,
      posterUrl,
      posterPublicId,
      caption: input.caption,
      ctaType: input.ctaType,
      ctaTargetId: input.ctaTargetId,
      expiresAt,
      intentFree: input.intent === "free",
    });
  },

  async getFeed(query: FeedQuery) {
    const limit = query.limit;
    const organicTarget = Math.floor(limit * ORGANIC_TARGET_RATIO);
    const now = new Date();

    const organic = await discoverRepo.listOrganic({
      take: organicTarget,
      cursor: query.cursor,
      now,
    });
    const hasMoreOrganic = organic.length > organicTarget;
    const organicSlice = hasMoreOrganic
      ? organic.slice(0, organicTarget)
      : organic;
    const nextCursor = hasMoreOrganic
      ? organicSlice[organicSlice.length - 1]?.id ?? null
      : null;

    // Pull a generous paid pool — we may need to fill ALL slots with paid if
    // organic supply runs short. Pool size up to `limit` covers the worst case.
    const paidPool = await discoverRepo.listActivePaid(now, limit);
    const paidNeeded = Math.max(0, limit - organicSlice.length);
    const paidPicks = paidPool
      .sort(() => Math.random() - 0.5)
      .slice(0, paidNeeded);

    const organicItems = organicSlice.map((p) => ({
      ...p,
      sponsored: false as const,
    }));
    const paidItems = paidPicks.map((p) => ({
      ...p,
      sponsored: true as const,
    }));

    type FeedItem = (typeof organicItems)[number] | (typeof paidItems)[number];
    const items: FeedItem[] = [];
    if (paidItems.length === 0) {
      items.push(...organicItems);
    } else if (organicItems.length === 0) {
      items.push(...paidItems);
    } else {
      // Spread paid slots roughly evenly through the feed:
      // positions = floor((i+1) * (organic+paid) / (paid+1))
      const total = organicItems.length + paidItems.length;
      const paidPositions = new Set<number>();
      for (let i = 0; i < paidItems.length; i++) {
        paidPositions.add(
          Math.floor(((i + 1) * total) / (paidItems.length + 1)),
        );
      }
      let oi = 0;
      let pi = 0;
      for (let pos = 0; pos < total; pos++) {
        if (paidPositions.has(pos) && pi < paidItems.length) {
          items.push(paidItems[pi]!);
          pi++;
        } else if (oi < organicItems.length) {
          items.push(organicItems[oi]!);
          oi++;
        } else if (pi < paidItems.length) {
          items.push(paidItems[pi]!);
          pi++;
        }
      }
    }

    return { items: items.slice(0, limit), nextCursor };
  },

  async recordImpression(postId: string) {
    const post = await discoverRepo.findById(postId);
    if (!post || post.deletedAt) return;
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
    if (!post || post.deletedAt) return;
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
    if (!post || post.deletedAt) throw new NotFoundError("Post");
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
    if (!post || post.deletedAt) throw new NotFoundError("Discover post");

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
      authorizationUrl: init.authorization_url,
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

    const startsAt = new Date();
    const endsAt = planEndDate(startsAt, plan);
    const amount = payload.data.amount / 100;

    // Race guards:
    //   - paystackRef is UNIQUE — duplicate webhook (same ref) is deduped
    //     inside the transaction.
    //   - For TWO DIFFERENT references arriving for the same post within
    //     milliseconds (rare: seller initiates two boost flows in parallel
    //     tabs), we lock the post row with SELECT FOR UPDATE before
    //     reading active-campaign state. The second transaction will see
    //     the first's campaign and correctly route to "extend" instead
    //     of both racing to "replace".
    const campaign = await prisma.$transaction(async (tx) => {
      // Lock the post row FIRST so that concurrent transactions for the
      // same post serialize. Once locked, re-check for a duplicate
      // reference — covers both same-ref retries AND different-ref races
      // where the lock-loser would otherwise try to insert a duplicate
      // and fail on the unique constraint.
      await tx.$queryRaw`SELECT id FROM "discover_posts" WHERE id = ${postId}::uuid FOR UPDATE`;
      const dup = await tx.discoverCampaign.findUnique({
        where: { paystackRef: reference },
      });
      if (dup) {
        logger.info("paystack discover: duplicate event ignored", { reference });
        return dup;
      }
      const post = await tx.discoverPost.findUnique({ where: { id: postId } });
      if (!post) {
        logger.warn("paystack discover: post vanished before campaign creation", {
          postId,
          reference,
        });
        return null;
      }
      if (post.deletedAt) {
        // Seller deleted the post between boost-init and Paystack callback.
        // We've already taken their money but the post is gone; skip campaign
        // creation so nothing reappears in the feed. Manual refund decision
        // lives outside this handler.
        logger.warn("paystack discover: post deleted before campaign creation", {
          postId,
          reference,
        });
        return null;
      }
      const activeCampaign = await tx.discoverCampaign.findFirst({
        where: {
          postId,
          startsAt: { lte: startsAt },
          endsAt: { gte: startsAt },
        },
      });
      const planDurationMs = plan.months * 30 * 24 * 60 * 60 * 1000;
      const newExpiresAt = activeCampaign
        ? new Date(post.expiresAt.getTime() + planDurationMs)
        : new Date(startsAt.getTime() + planDurationMs);

      const created = await tx.discoverCampaign.create({
        data: {
          post: { connect: { id: postId } },
          plan: planId as BoostPlan,
          spend: amount,
          startsAt,
          endsAt,
          paystackRef: reference,
        },
        include: { post: true },
      });
      await tx.discoverPost.update({
        where: { id: postId },
        data: { expiresAt: newExpiresAt },
      });
      return created;
    });

    if (!campaign) return null;

    broadcastToUser(userId, "discover:campaign_started", { campaign });
    await notificationsService.createForUser(
      userId,
      notificationRenderers.discoverCampaignStarted({
        campaignId: campaign.id,
        postId,
      }),
    );

    return campaign;
  },

  async listMyCampaigns(userId: string) {
    return discoverRepo.listCampaignsForUser(userId);
  },

  async getMyPostById(userId: string, postId: string) {
    const post = await discoverRepo.findById(postId);
    if (!post || post.deletedAt) throw new NotFoundError("Discover post");
    const shop = await prisma.shop.findUnique({
      where: { id: post.shopId },
      select: { ownerId: true },
    });
    if (!shop || shop.ownerId !== userId) {
      throw new ForbiddenError("Not your post");
    }
    const now = new Date();
    const active = await discoverRepo.findActiveCampaignForPost(post.id, now);
    const expired = post.expiresAt.getTime() <= now.getTime();
    return {
      ...post,
      sponsored: !!active,
      status: expired ? "expired" : active ? "boosted" : "organic",
    };
  },

  async listMyPosts(userId: string, query: ListMyPostsQuery) {
    const rows = await discoverRepo.listForOwner({
      ownerId: userId,
      take: query.limit,
      cursor: query.cursor,
    });
    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

    const now = new Date();
    // Batch the active-campaign lookup into ONE query instead of N. Below
    // ~10 posts the difference is invisible; above ~50 it's the difference
    // between a 200ms and a 2s response.
    const activeIds = await discoverRepo.findPostsWithActiveCampaigns(
      slice.map((p) => p.id),
      now,
    );
    const items = slice.map((post) => {
      const active = activeIds.has(post.id);
      const expired = post.expiresAt.getTime() <= now.getTime();
      return {
        ...post,
        sponsored: active,
        status: expired ? "expired" : active ? "boosted" : "organic",
      };
    });
    return { items, nextCursor };
  },

  async getPostAnalytics(userId: string, postId: string) {
    const post = await discoverRepo.findById(postId);
    if (!post || post.deletedAt) throw new NotFoundError("Discover post");
    const shop = await prisma.shop.findUnique({
      where: { id: post.shopId },
      select: { ownerId: true },
    });
    if (!shop || shop.ownerId !== userId) {
      throw new ForbiddenError("Not your post");
    }
    const now = new Date();
    const active = await discoverRepo.findActiveCampaignForPost(post.id, now);
    // If there's no active campaign, fall back to the most recent ended one
    // so the seller can review historical performance.
    const latest =
      active ?? (await discoverRepo.findMostRecentCampaignForPost(post.id));
    const campaign = latest
      ? await discoverRepo.findCampaignWithStats(latest.id)
      : null;

    return {
      post: {
        id: post.id,
        shopId: post.shopId,
        videoUrl: post.videoUrl,
        posterUrl: post.posterUrl,
        caption: post.caption,
        impressions: post.impressions,
        clicks: post.clicks,
        saves: post.saves,
        expiresAt: post.expiresAt.toISOString(),
        createdAt: post.createdAt.toISOString(),
      },
      campaign: campaign
        ? {
            id: campaign.id,
            plan: campaign.plan,
            spend: Number(campaign.spend),
            startsAt: campaign.startsAt.toISOString(),
            endsAt: campaign.endsAt.toISOString(),
            active: !!active,
          }
        : null,
      daily: campaign
        ? campaign.daily.map((d) => ({
            date: d.date.toISOString().slice(0, 10),
            impressions: d.impressions,
            clicks: d.clicks,
            spend: Number(d.spend),
          }))
        : [],
    };
  },

  async deletePost(userId: string, postId: string) {
    const post = await discoverRepo.findById(postId);
    if (!post) throw new NotFoundError("Discover post");
    const shop = await prisma.shop.findUnique({
      where: { id: post.shopId },
      select: { ownerId: true },
    });
    if (!shop || shop.ownerId !== userId) {
      throw new ForbiddenError("Not your post");
    }
    if (post.deletedAt) return; // idempotent — already removed

    const now = new Date();
    // Cancel any currently-active campaign by ending it now. Past/expired
    // campaigns are left as-is so the seller's analytics history survives.
    // No refund — this is a seller-initiated delete per the spec.
    await prisma.$transaction([
      prisma.discoverPost.update({
        where: { id: postId },
        data: { deletedAt: now },
      }),
      prisma.discoverCampaign.updateMany({
        where: { postId, startsAt: { lte: now }, endsAt: { gt: now } },
        data: { endsAt: now },
      }),
    ]);
  },

  async editPost(
    userId: string,
    postId: string,
    input: EditPostInput,
    posterBuffer: Buffer | undefined,
  ) {
    const post = await discoverRepo.findById(postId);
    if (!post || post.deletedAt) throw new NotFoundError("Discover post");

    const shop = await prisma.shop.findUnique({
      where: { id: post.shopId },
      select: { ownerId: true },
    });
    if (!shop || shop.ownerId !== userId) {
      throw new ForbiddenError("Not your post");
    }

    const now = new Date();
    if (post.expiresAt.getTime() <= now.getTime()) {
      throw new AppError(403, "post_expired", "This post has expired");
    }
    const active = await discoverRepo.findActiveCampaignForPost(postId, now);
    if (!active) {
      throw new AppError(403, "not_boosted", "Boost this post to edit it");
    }
    if (post.editsRemaining <= 0) {
      throw new AppError(
        400,
        "edit_limit_reached",
        "Can't edit more. Re-upload as a new post if you need further changes.",
      );
    }
    const hasCaption = input.caption !== undefined;
    const hasPoster = !!posterBuffer;
    if (!hasCaption && !hasPoster) {
      throw new AppError(400, "nothing_to_edit", "Nothing to update");
    }

    const fieldsChanged: string[] = [];
    const updateData: {
      caption?: string;
      posterUrl?: string;
      posterPublicId?: string;
      lastEditedAt: Date;
      editsRemaining: { decrement: number };
    } = {
      lastEditedAt: now,
      editsRemaining: { decrement: 1 },
    };

    if (hasCaption) {
      updateData.caption = input.caption;
      fieldsChanged.push("caption");
    }

    const folder = `ahia/discover/${post.shopId}`;
    let oldPosterPublicId: string | null = null;
    if (hasPoster) {
      assertFileKind(posterBuffer!, "image", "poster");
      const uploaded = await uploadImageBufferWithId(posterBuffer!, { folder });
      updateData.posterUrl = uploaded.url;
      updateData.posterPublicId = uploaded.publicId;
      fieldsChanged.push("poster");
      oldPosterPublicId = post.posterPublicId;
    }

    // Atomic: conditional decrement (race guard for editsRemaining) +
    // mirror the post update + write the audit row, all in one transaction.
    // If editsRemaining was raced to 0 by another in-flight edit, updateMany
    // matches 0 rows; we throw edit_limit_reached and leave the post intact.
    const updated = await prisma.$transaction(async (tx) => {
      const { count } = await tx.discoverPost.updateMany({
        where: { id: postId, editsRemaining: { gt: 0 } },
        data: updateData,
      });
      if (count === 0) {
        throw new AppError(
          400,
          "edit_limit_reached",
          "Can't edit more. Re-upload as a new post if you need further changes.",
        );
      }
      await tx.discoverPostEdit.create({
        data: {
          post: { connect: { id: postId } },
          editedAt: now,
          fieldsChanged,
          previousCaption: hasCaption ? post.caption : null,
          previousPosterUrl: hasPoster ? post.posterUrl : null,
        },
      });
      const fresh = await tx.discoverPost.findUnique({ where: { id: postId } });
      return fresh!;
    });

    // Destroy the replaced poster only AFTER the transaction commits, so we
    // never orphan-delete a poster the audit row would have referenced.
    if (oldPosterPublicId) {
      void destroyAsset(oldPosterPublicId, "image");
    }

    return updated;
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
