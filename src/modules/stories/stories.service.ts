import { prisma } from "../../config/db.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../errors.js";
import { uploadImageBuffer } from "../../integrations/cloudinary.js";
import { storiesRepo } from "./stories.repo.js";

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export const storiesService = {
  async listForShop(shopId: string) {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });
    if (!shop) throw new NotFoundError("Shop");
    return storiesRepo.listActiveForShop(shopId, new Date());
  },

  async createForUser(
    userId: string,
    fileBuffer: Buffer | undefined,
    durationMs: number,
  ) {
    if (!fileBuffer) {
      throw new ValidationError("Image is required", { image: "Required" });
    }
    const shop = await prisma.shop.findFirst({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!shop) {
      throw new ForbiddenError("You must have a shop to post stories");
    }

    const mediaUrl = await uploadImageBuffer(fileBuffer, {
      folder: `ahia/stories/${shop.id}`,
    });

    return storiesRepo.create({
      shop: { connect: { id: shop.id } },
      mediaUrl,
      durationMs,
      expiresAt: new Date(Date.now() + STORY_TTL_MS),
    });
  },
};
