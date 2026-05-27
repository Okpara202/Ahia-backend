import { ConflictError, NotFoundError } from "../../errors.js";
import { uploadImageBuffer } from "../../integrations/cloudinary.js";
import { shopsRepo } from "./shops.repo.js";
import type {
  CreateShopInput,
  ListShopProductsQuery,
  UpdateShopInput,
} from "./shops.schemas.js";

type ShopFiles = { avatar?: Buffer; banner?: Buffer };

async function uploadAvatar(userId: string, buf: Buffer) {
  return uploadImageBuffer(buf, { folder: `ahia/shops/${userId}`, publicId: "avatar" });
}

async function uploadBanner(userId: string, buf: Buffer) {
  return uploadImageBuffer(buf, { folder: `ahia/shops/${userId}`, publicId: "banner" });
}

export const shopsService = {
  async createForUser(userId: string, input: CreateShopInput, files: ShopFiles) {
    const existing = await shopsRepo.findByOwnerId(userId);
    if (existing) throw new ConflictError("SHOP_EXISTS", "You already have a shop");

    const handleTaken = await shopsRepo.findByHandle(input.handle);
    if (handleTaken) {
      throw new ConflictError("HANDLE_TAKEN", "That handle is taken", {
        handle: "Already taken",
      });
    }

    const avatarUrl = files.avatar ? await uploadAvatar(userId, files.avatar) : undefined;
    const bannerUrl = files.banner ? await uploadBanner(userId, files.banner) : undefined;

    return shopsRepo.create({
      owner: { connect: { id: userId } },
      name: input.name,
      handle: input.handle,
      bio: input.bio,
      location: input.location,
      showLegalName: input.showLegalName ?? false,
      avatarUrl,
      bannerUrl,
    });
  },

  async getMine(userId: string) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");
    return shop;
  },

  async getById(id: string) {
    const shop = await shopsRepo.findById(id);
    if (!shop) throw new NotFoundError("Shop");
    return shop;
  },

  async updateMine(userId: string, input: UpdateShopInput, files: ShopFiles) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");

    if (input.handle && input.handle !== shop.handle) {
      const taken = await shopsRepo.findByHandle(input.handle);
      if (taken) {
        throw new ConflictError("HANDLE_TAKEN", "That handle is taken", {
          handle: "Already taken",
        });
      }
    }

    const avatarUrl = files.avatar ? await uploadAvatar(userId, files.avatar) : undefined;
    const bannerUrl = files.banner ? await uploadBanner(userId, files.banner) : undefined;

    return shopsRepo.update(shop.id, {
      name: input.name,
      handle: input.handle,
      bio: input.bio,
      location: input.location,
      showLegalName: input.showLegalName,
      ...(avatarUrl && { avatarUrl }),
      ...(bannerUrl && { bannerUrl }),
    });
  },

  async listProducts(shopId: string, query: ListShopProductsQuery) {
    const shop = await shopsRepo.findById(shopId);
    if (!shop) throw new NotFoundError("Shop");

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
