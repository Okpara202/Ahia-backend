import { prisma } from "../../config/db.js";
import { AppError, NotFoundError } from "../../errors.js";
import { presenceService } from "../presence/presence.service.js";
import { shopsRepo } from "../shops/shops.repo.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { notificationRenderers } from "../notifications/notifications.renderer.js";
import { followsRepo } from "./follows.repo.js";

function paginate<T>(rows: T[], limit: number, getCursor: (r: T) => string) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? getCursor(items[items.length - 1]!) : null;
  return { items, nextCursor };
}

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
    const created = await followsRepo.add(userId, shopId);
    // Idempotent: only fire the notification when this is a NEW follow,
    // not a duplicate POST. followsRepo.add returns the row count via the
    // .count return; if 0, the follow already existed and we skip.
    if (created) {
      const follower = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          shops: {
            where: { deletedAt: null },
            select: { handle: true },
            take: 1,
          },
        },
      });
      if (follower) {
        await notificationsService.createForUser(
          shop.ownerId,
          notificationRenderers.followReceived({
            followerName: follower.name,
            followerHandle: follower.shops[0]?.handle ?? null,
            followerId: userId,
            shopId,
          }),
        );
      }
    }
  },

  async unfollow(userId: string, shopId: string) {
    await followsRepo.remove(userId, shopId);
  },

  async listFollowing(userId: string, args: { limit: number; cursor?: string }) {
    const rows = await followsRepo.listForUser({
      userId,
      take: args.limit,
      cursor: args.cursor,
    });
    const ownerIds = rows.map((r) => r.shop.owner.id);
    const onlineMap = await presenceService.bulkOnline(ownerIds);
    const items = rows.map((r) => ({
      shopId: r.shop.id,
      name: r.shop.name,
      handle: r.shop.handle,
      avatarUrl: r.shop.avatarUrl ?? undefined,
      isActive: r.shop.isActive,
      deletedAt: r.shop.deletedAt?.toISOString() ?? null,
      lastStoryAt: r.shop.stories[0]?.createdAt.toISOString() ?? undefined,
      isOnline: onlineMap.get(r.shop.owner.id) ?? false,
    }));
    return paginate(items, args.limit, (i) => i.shopId);
  },

  async listMyFollowers(userId: string, args: { limit: number; cursor?: string }) {
    const shop = await shopsRepo.findByOwnerId(userId);
    if (!shop) throw new NotFoundError("Shop");
    const rows = await followsRepo.listFollowersOfShop({
      shopId: shop.id,
      take: args.limit,
      cursor: args.cursor,
    });
    const userIds = rows.map((r) => r.user.id);
    const onlineMap = await presenceService.bulkOnline(userIds);
    const items = rows.map((r) => ({
      userId: r.user.id,
      name: r.user.name,
      avatarUrl: r.user.avatarUrl ?? undefined,
      followedAt: r.createdAt.toISOString(),
      isOnline: onlineMap.get(r.user.id) ?? false,
      allowsColdDMs: r.user.allowsColdDMs,
    }));
    return paginate(items, args.limit, (i) => i.userId);
  },
};
