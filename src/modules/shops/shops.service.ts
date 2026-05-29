import { prisma } from "../../config/db.js";
import { AppError, ConflictError, NotFoundError } from "../../errors.js";
import { uploadImageBuffer } from "../../integrations/cloudinary.js";
import { shopsRepo } from "./shops.repo.js";
import type {
  CreateShopInput,
  ListShopProductsQuery,
  UpdateShopInput,
} from "./shops.schemas.js";
import type { Shop } from "@prisma/client";

type ShopFiles = { avatar?: Buffer; banner?: Buffer };

async function uploadAvatar(userId: string, buf: Buffer) {
  return uploadImageBuffer(buf, { folder: `ahia/shops/${userId}`, publicId: "avatar" });
}

async function uploadBanner(userId: string, buf: Buffer) {
  return uploadImageBuffer(buf, { folder: `ahia/shops/${userId}`, publicId: "banner" });
}

async function withStats(shop: Shop) {
  const productsCount = await shopsRepo.productCount(shop.id);
  return { ...shop, productsCount };
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
    return withStats(shop);
  },

  async getMine(userId: string) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");
    return withStats(shop);
  },

  async getById(id: string) {
    const shop = await shopsRepo.findById(id);
    if (!shop || shop.deletedAt) throw new NotFoundError("Shop");
    return withStats(shop);
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
    return withStats(updated);
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
