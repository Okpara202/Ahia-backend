import { prisma } from "../../config/db.js";
import { AppError, ConflictError, NotFoundError } from "../../errors.js";
import { uploadImageBuffer } from "../../integrations/cloudinary.js";
import { followsRepo } from "../follows/follows.repo.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { shopsRepo } from "./shops.repo.js";
import type {
  CreateShopInput,
  ListShopProductsQuery,
  UpdateShopInput,
} from "./shops.schemas.js";
import type { Shop } from "@prisma/client";

type ShopFiles = { avatar?: Buffer; banner?: Buffer };

type ViewContext = {
  viewerId?: string;
  isOwner?: boolean;
};

async function uploadAvatar(userId: string, buf: Buffer) {
  return uploadImageBuffer(buf, { folder: `ahia/shops/${userId}`, publicId: "avatar" });
}

async function uploadBanner(userId: string, buf: Buffer) {
  return uploadImageBuffer(buf, { folder: `ahia/shops/${userId}`, publicId: "banner" });
}

async function ownerName(shop: Shop): Promise<string | null> {
  const owner = await prisma.user.findUnique({
    where: { id: shop.ownerId },
    select: { name: true },
  });
  return owner?.name ?? null;
}

async function withStats(shop: Shop, ctx: ViewContext = {}) {
  const [productsCount, followerCount, isFollowing, name] = await Promise.all([
    shopsRepo.productCount(shop.id),
    followsRepo.count(shop.id),
    ctx.viewerId ? followsRepo.exists(ctx.viewerId, shop.id) : Promise.resolve(null),
    ctx.isOwner || shop.showLegalName ? ownerName(shop) : Promise.resolve(null),
  ]);
  const base = { ...shop, productsCount, followerCount, isFollowing };
  if (name === null) return base;
  return { ...base, ownerName: name };
}

export const shopsService = {
  async createForUser(userId: string, input: CreateShopInput, files: ShopFiles) {
    const existing = await shopsRepo.findByOwnerId(userId);
    if (existing) throw new ConflictError("shop_exists", "You already have a shop.");

    const handleTaken = await shopsRepo.findByHandle(input.handle);
    if (handleTaken) {
      throw new ConflictError("handle_taken", "That handle is already in use.", {
        handle: "Already taken",
      });
    }

    const avatarUrl = files.avatar ? await uploadAvatar(userId, files.avatar) : undefined;
    const bannerUrl = files.banner ? await uploadBanner(userId, files.banner) : undefined;

    const shop = await shopsRepo.create({
      owner: { connect: { id: userId } },
      name: input.name,
      handle: input.handle,
      category: input.category,
      bio: input.bio,
      location: input.location,
      showLegalName: input.showLegalName ?? false,
      avatarUrl,
      bannerUrl,
    });
    return withStats(shop, { viewerId: userId, isOwner: true });
  },

  async getMine(userId: string) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");
    return withStats(shop, { viewerId: userId, isOwner: true });
  },

  async getById(id: string, viewerId?: string) {
    const shop = await shopsRepo.findById(id);
    if (!shop || shop.deletedAt) throw new NotFoundError("Shop");
    return withStats(shop, {
      viewerId,
      isOwner: viewerId === shop.ownerId,
    });
  },

  async updateMine(userId: string, input: UpdateShopInput, files: ShopFiles) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");

    if (input.handle && input.handle !== shop.handle) {
      const taken = await shopsRepo.findByHandle(input.handle);
      if (taken) {
        throw new ConflictError("handle_taken", "That handle is already in use.", {
          handle: "Already taken",
        });
      }
    }

    const avatarUrl = files.avatar ? await uploadAvatar(userId, files.avatar) : undefined;
    const bannerUrl = files.banner ? await uploadBanner(userId, files.banner) : undefined;

    const updated = await shopsRepo.update(shop.id, {
      name: input.name,
      handle: input.handle,
      category: input.category,
      bio: input.bio,
      location: input.location,
      showLegalName: input.showLegalName,
      isActive: input.isActive,
      ...(avatarUrl && { avatarUrl }),
      ...(bannerUrl && { bannerUrl }),
    });

    const reopened = shop.isActive === false && updated.isActive === true;
    if (reopened) {
      const followerIds = await followsRepo.followerIds(updated.id);
      await Promise.all(
        followerIds.map((followerId) =>
          notificationsService.createForUser(followerId, "shop_reopened", {
            shopId: updated.id,
            shopName: updated.name,
            shopHandle: updated.handle,
          }),
        ),
      );
    }

    return withStats(updated, { viewerId: userId, isOwner: true });
  },

  async uploadAvatar(userId: string, buf: Buffer) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");
    const avatarUrl = await uploadAvatar(userId, buf);
    const updated = await shopsRepo.update(shop.id, { avatarUrl });
    return withStats(updated, { viewerId: userId, isOwner: true });
  },

  async removeAvatar(userId: string) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");
    const updated = await shopsRepo.update(shop.id, { avatarUrl: null });
    return withStats(updated, { viewerId: userId, isOwner: true });
  },

  async uploadBanner(userId: string, buf: Buffer) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");
    const bannerUrl = await uploadBanner(userId, buf);
    const updated = await shopsRepo.update(shop.id, { bannerUrl });
    return withStats(updated, { viewerId: userId, isOwner: true });
  },

  async removeBanner(userId: string) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");
    const updated = await shopsRepo.update(shop.id, { bannerUrl: null });
    return withStats(updated, { viewerId: userId, isOwner: true });
  },

  async demolishMine(userId: string) {
    const existing = await shopsRepo.findByOwnerIdAny(userId);
    if (!existing) {
      throw new NotFoundError("Shop");
    }
    if (existing.deletedAt) {
      throw new AppError(410, "shop_gone", "Shop has already been closed.");
    }
    await prisma.$transaction([
      prisma.shop.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), isActive: false },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { role: "buyer" },
      }),
    ]);
  },

  async listProducts(shopId: string, query: ListShopProductsQuery) {
    const shop = await shopsRepo.findById(shopId);
    if (!shop || shop.deletedAt) throw new NotFoundError("Shop");

    const rows = await shopsRepo.listProducts({
      shopId,
      take: query.limit,
      cursor: query.cursor ? { id: query.cursor } : undefined,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
    return { items, nextCursor };
  },
};
