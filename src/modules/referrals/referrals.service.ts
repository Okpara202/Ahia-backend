import { prisma } from "../../config/db.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../errors.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { notificationRenderers } from "../notifications/notifications.renderer.js";
import { referralsRepo } from "./referrals.repo.js";

export const referralsService = {
  async getMine(userId: string) {
    const shop = await prisma.shop.findFirst({
      where: { ownerId: userId, deletedAt: null },
      select: { handle: true },
    });
    const code = shop?.handle.toLowerCase() ?? null;
    const link = code ? `/r/${code}` : null;

    const [completedCount, pendingCount, totals] = await Promise.all([
      referralsRepo.countByReferrer(userId, "completed"),
      referralsRepo.countByReferrer(userId, "pending"),
      referralsRepo.sumRewardsForReferrer(userId),
    ]);

    return {
      code,
      link,
      completedCount,
      pendingCount,
      totalEarnedNaira: totals._sum.rewardNaira ?? 0,
    };
  },

  async claim(inviteeId: string, rawCode: string) {
    const code = rawCode.toLowerCase().trim();
    const shop = await prisma.shop.findUnique({
      where: { handle: code },
      select: { ownerId: true },
    });
    if (!shop) throw new NotFoundError("Referral code");
    const referrerId = shop.ownerId;
    if (referrerId === inviteeId) {
      throw new BadRequestError("You can't refer yourself");
    }
    const existing = await referralsRepo.findByPair(referrerId, inviteeId);
    if (existing) return existing;
    return referralsRepo.create({
      referrer: { connect: { id: referrerId } },
      invitee: { connect: { id: inviteeId } },
      code,
    });
  },

  async markFirstTransaction(inviteeId: string) {
    const pending = await referralsRepo.findPendingByInvitee(inviteeId);
    if (pending.length === 0) return;
    const invitee = await prisma.user.findUnique({
      where: { id: inviteeId },
      select: { name: true },
    });
    for (const r of pending) {
      await referralsRepo.markCompleted(r.id);
      await notificationsService.createForUser(
        r.referrerId,
        notificationRenderers.referralCompleted({
          inviteeName: invitee?.name ?? "Your invitee",
          rewardNaira: r.rewardNaira,
          referralId: r.id,
        }),
      );
    }
  },
};
