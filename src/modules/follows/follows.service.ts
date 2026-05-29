import { AppError, NotFoundError } from "../../errors.js";
import { shopsRepo } from "../shops/shops.repo.js";
import { followsRepo } from "./follows.repo.js";

export const followsService = {
  async follow(userId: string, shopId: string) {
    const shop = await shopsRepo.findById(shopId);
    if (!shop) throw new NotFoundError("Shop");
    if (shop.deletedAt) {
      throw new AppError(410, "shop_gone", "This shop is no longer available.");
    }
    if (shop.ownerId === userId) {
      throw new AppError(400, "self_follow", "You can't follow your own shop.");
    }
    await followsRepo.add(userId, shopId);
  },

  async unfollow(userId: string, shopId: string) {
    await followsRepo.remove(userId, shopId);
  },
};
