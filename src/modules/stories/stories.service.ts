import crypto from "node:crypto";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../errors.js";
import {
  destroyAsset,
  uploadStoryImageBuffer,
  uploadStoryVideoBuffer,
} from "../../integrations/cloudinary.js";
import { redis } from "../../integrations/redis.js";
import { followsRepo } from "../follows/follows.repo.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { notificationRenderers } from "../notifications/notifications.renderer.js";
import { storiesRepo } from "./stories.repo.js";
import type { CreateStoryInput } from "./stories.schemas.js";
import type { Prisma, Story } from "@prisma/client";

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const VIEW_FLUSH_EVERY = 10;

type StoryWithIncludes = Prisma.StoryGetPayload<{
  include: { shop: { select: { id: true; name: true; handle: true; avatarUrl: true } }; product: { select: { id: true; name: true; cover: true; price: true } } };
}>;

async function isViewed(storyId: string, viewerId?: string): Promise<boolean> {
  if (!viewerId) return false;
  const row = await storiesRepo.hasViewed(storyId, viewerId);
  return !!row;
}

function toStoryPayload(
  story: StoryWithIncludes,
  args: { viewed: boolean; includeViewCount: boolean },
) {
  return {
    id: story.id,
    shopId: story.shopId,
    media: {
      type: story.mediaType,
      url: story.mediaUrl,
      ...(story.posterUrl ? { poster: story.posterUrl } : {}),
    },
    caption: story.caption ?? undefined,
    productId: story.productId ?? undefined,
    durationMs: story.durationMs,
    createdAt: story.createdAt.toISOString(),
    expiresAt: story.expiresAt.toISOString(),
    viewCount: args.includeViewCount ? story.viewCount : 0,
    viewed: args.viewed,
    shop: {
      id: story.shop.id,
      name: story.shop.name,
      handle: story.shop.handle,
      avatarUrl: story.shop.avatarUrl ?? null,
    },
    product: story.product
      ? {
          id: story.product.id,
          name: story.product.name,
          cover: story.product.cover,
          price: story.product.price,
        }
      : null,
  };
}

export const storiesService = {
  async listForShop(shopId: string, viewerId?: string) {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });
    if (!shop) throw new NotFoundError("Shop");
    const stories = await storiesRepo.listActiveForShop(shopId, new Date());
    const viewedFlags = await Promise.all(
      stories.map((s) => isViewed(s.id, viewerId)),
    );
    return stories.map((s, i) =>
      toStoryPayload(s, { viewed: viewedFlags[i] ?? false, includeViewCount: false }),
    );
  },

  async listMine(userId: string) {
    const shop = await prisma.shop.findFirst({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!shop) throw new NotFoundError("Shop");
    const stories = await storiesRepo.listMineActive(shop.id, new Date());
    return stories.map((s) =>
      toStoryPayload(s, { viewed: true, includeViewCount: true }),
    );
  },

  async getById(id: string, viewerId?: string) {
    const story = await storiesRepo.findById(id);
    if (!story || story.deletedAt) {
      throw new AppError(404, "story_expired", "This story is no longer available.");
    }
    if (story.expiresAt <= new Date()) {
      throw new AppError(404, "story_expired", "This story is no longer available.");
    }
    const shop = await prisma.shop.findUnique({
      where: { id: story.shopId },
      select: { isActive: true, deletedAt: true },
    });
    if (!shop || shop.deletedAt || !shop.isActive) {
      throw new AppError(404, "story_expired", "This story is no longer available.");
    }
    const viewed = await isViewed(story.id, viewerId);
    return toStoryPayload(story, { viewed, includeViewCount: false });
  },

  async createForUser(
    userId: string,
    args: {
      imageBuffer?: Buffer;
      videoBuffer?: Buffer;
      input: CreateStoryInput;
    },
  ) {
    if (args.imageBuffer && args.videoBuffer) {
      throw new ValidationError("Send either an image OR a video, not both");
    }
    if (!args.imageBuffer && !args.videoBuffer) {
      throw new ValidationError("Media is required", { media: "Required" });
    }

    const shop = await prisma.shop.findFirst({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true, name: true, handle: true },
    });
    if (!shop) {
      throw new ForbiddenError("You must have a shop to post stories");
    }

    if (args.input.productId) {
      const ok = await prisma.product.findFirst({
        where: { id: args.input.productId, shopId: shop.id, deletedAt: null },
        select: { id: true },
      });
      if (!ok) {
        throw new ValidationError("Product not found in your shop", {
          productId: "Invalid",
        });
      }
    }

    const storyId = crypto.randomUUID();
    const folder = `ahia/stories/${shop.id}`;

    let mediaType: "image" | "video";
    let mediaUrl: string;
    let posterUrl: string | undefined;
    let cloudinaryId: string;

    if (args.videoBuffer) {
      const out = await uploadStoryVideoBuffer(args.videoBuffer, {
        folder,
        publicId: storyId,
      });
      mediaType = "video";
      mediaUrl = out.url;
      posterUrl = out.posterUrl;
      cloudinaryId = out.publicId;
    } else {
      const out = await uploadStoryImageBuffer(args.imageBuffer!, {
        folder,
        publicId: storyId,
      });
      mediaType = "image";
      mediaUrl = out.url;
      cloudinaryId = out.publicId;
    }

    const created = await storiesRepo.create({
      shop: { connect: { id: shop.id } },
      mediaType,
      mediaUrl,
      posterUrl,
      caption: args.input.caption,
      ...(args.input.productId && {
        product: { connect: { id: args.input.productId } },
      }),
      cloudinaryId,
      durationMs: args.input.durationMs,
      expiresAt: new Date(Date.now() + STORY_TTL_MS),
    });

    void this.fanOutStoryPostedNotification(shop.id, shop.handle, created);

    return toStoryPayload(created, { viewed: true, includeViewCount: true });
  },

  async fanOutStoryPostedNotification(
    shopId: string,
    handle: string,
    story: Story,
  ) {
    try {
      const followers = await followsRepo.followerIds(shopId);
      if (followers.length === 0) return;
      const rendered = notificationRenderers.storyPosted({
        shopHandle: handle,
        shopId,
        storyId: story.id,
        caption: story.caption ?? null,
      });
      await Promise.all(
        followers.map((followerId) =>
          notificationsService.createForUser(followerId, rendered),
        ),
      );
    } catch (err) {
      logger.error("stories: fanout failed", {
        storyId: story.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async deleteMine(userId: string, storyId: string) {
    const story = await storiesRepo.findById(storyId);
    if (!story) throw new NotFoundError("Story");
    const shop = await prisma.shop.findFirst({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!shop || shop.id !== story.shopId) {
      throw new ForbiddenError("Not your story");
    }
    if (story.deletedAt) return;

    await storiesRepo.softDelete(storyId);

    const refs = await storiesRepo.countMessageReferences(storyId);
    if (refs === 0 && story.cloudinaryId) {
      await destroyAsset(story.cloudinaryId, story.mediaType);
    }
  },

  async recordView(storyId: string, viewerId?: string) {
    const story = await storiesRepo.findById(storyId);
    if (!story || story.deletedAt || story.expiresAt <= new Date()) {
      throw new AppError(404, "story_expired", "This story is no longer available.");
    }

    if (viewerId) {
      await storiesRepo.upsertView(storyId, viewerId);
    }

    let totalBumps = 1;
    if (redis) {
      try {
        const key = `story:views:${storyId}`;
        totalBumps = await redis.incr(key);
        await redis.expire(key, 60 * 60 * 25);
      } catch (err) {
        logger.warn("stories: redis incr failed", {
          storyId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (totalBumps % VIEW_FLUSH_EVERY === 0) {
      await storiesRepo.incrementViewCount(storyId, VIEW_FLUSH_EVERY);
    }
  },
};

export const storiesBackground = {
  async sweepExpired() {
    const now = new Date();
    const expired = await storiesRepo.findExpiredOrUndeleted(now);
    if (expired.length === 0) return 0;
    let cleaned = 0;
    for (const story of expired) {
      try {
        await storiesRepo.softDelete(story.id);
        const refs = await storiesRepo.countMessageReferences(story.id);
        if (refs === 0 && story.cloudinaryId) {
          const full = await prisma.story.findUnique({
            where: { id: story.id },
            select: { mediaType: true },
          });
          if (full) await destroyAsset(story.cloudinaryId, full.mediaType);
        }
        cleaned++;
      } catch (err) {
        logger.error("stories: sweep failed for one", {
          storyId: story.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info("stories: swept expired", { count: cleaned });
    return cleaned;
  },
};
