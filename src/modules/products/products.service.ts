import { ForbiddenError, NotFoundError, ValidationError } from "../../errors.js";
import {
  uploadImageBuffer,
  uploadImageFromUrl,
} from "../../integrations/cloudinary.js";
import { shopsRepo } from "../shops/shops.repo.js";
import { productsRepo } from "./products.repo.js";
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from "./products.schemas.js";
import type { Prisma } from "@prisma/client";

async function assertOwnership(productId: string, userId: string) {
  const product = await productsRepo.findById(productId);
  if (!product) throw new NotFoundError("Product");
  const withShop = product as typeof product & { shop: { ownerId: string } };
  if (withShop.shop.ownerId !== userId) {
    throw new ForbiddenError("You don't own this product");
  }
  return product;
}

async function resolveImageUrls(
  shopId: string,
  files: Express.Multer.File[],
  imageUrls: string[],
): Promise<string[]> {
  const folder = `ahia/products/${shopId}`;
  const fromFiles = await Promise.all(
    files.map((f) => uploadImageBuffer(f.buffer, { folder })),
  );
  const fromUrls = await Promise.all(
    imageUrls.map((url) => uploadImageFromUrl(url, { folder })),
  );
  return [...fromFiles, ...fromUrls];
}

function splitCover(all: string[], coverIndex: number): { cover: string; gallery: string[] } {
  const idx = Math.min(Math.max(coverIndex, 0), all.length - 1);
  const cover = all[idx]!;
  const gallery = all.filter((_, i) => i !== idx);
  return { cover, gallery };
}

export const productsService = {
  async getById(id: string) {
    const product = await productsRepo.findById(id);
    if (!product) throw new NotFoundError("Product");
    return product;
  },

  async list(query: ListProductsQuery) {
    const shopFilter: Prisma.ShopWhereInput = {
      isActive: true,
      deletedAt: null,
      owner: { role: "seller" },
    };
    if (query.location) shopFilter.location = query.location;

    const where: Prisma.ProductWhereInput = { shop: shopFilter };
    if (query.category) where.category = query.category;
    if (query.shop) where.shopId = query.shop;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
        { category: { contains: query.q, mode: "insensitive" } },
      ];
    }

    const rows = await productsRepo.list({
      where,
      take: query.limit,
      cursor: query.cursor ? { id: query.cursor } : undefined,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
    return { items, nextCursor };
  },

  async create(
    userId: string,
    input: CreateProductInput,
    files: Express.Multer.File[],
  ) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) {
      throw new ForbiddenError("You must create a shop before adding products");
    }

    const all = await resolveImageUrls(shop.id, files, input.image_urls);
    if (all.length === 0) {
      throw new ValidationError("At least one image is required", {
        images: "Required",
      });
    }
    const { cover, gallery } = splitCover(all, input.cover_index);

    return productsRepo.create({
      shop: { connect: { id: shop.id } },
      name: input.name,
      description: input.description,
      price: input.price,
      category: input.category,
      cover,
      gallery,
    });
  },

  async update(
    userId: string,
    id: string,
    input: UpdateProductInput,
    files: Express.Multer.File[],
  ) {
    const existing = await assertOwnership(id, userId);

    const hasNewImages = files.length > 0 || (input.image_urls?.length ?? 0) > 0;
    let imageUpdate: { cover?: string; gallery?: string[] } = {};
    if (hasNewImages) {
      const all = await resolveImageUrls(
        existing.shopId,
        files,
        input.image_urls ?? [],
      );
      const { cover, gallery } = splitCover(all, input.cover_index ?? 0);
      imageUpdate = { cover, gallery };
    }

    return productsRepo.update(id, {
      name: input.name,
      description: input.description,
      price: input.price,
      category: input.category,
      ...imageUpdate,
    });
  },

  async softDelete(userId: string, id: string) {
    await assertOwnership(id, userId);
    await productsRepo.softDelete(id);
  },

  async setVisibility(userId: string, id: string, hidden: boolean) {
    await assertOwnership(id, userId);
    return productsRepo.update(id, { hidden });
  },
};
