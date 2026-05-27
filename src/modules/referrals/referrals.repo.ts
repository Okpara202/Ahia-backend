import { prisma } from "../../config/db.js";
import type { Prisma, ReferralStatus } from "@prisma/client";

export const referralsRepo = {
  findByPair(referrerId: string, inviteeId: string) {
    return prisma.referral.findUnique({
      where: { referrerId_inviteeId: { referrerId, inviteeId } },
    });
  },

  create(data: Prisma.ReferralCreateInput) {
    return prisma.referral.create({ data });
  },

  countByReferrer(referrerId: string, status?: ReferralStatus) {
    return prisma.referral.count({
      where: { referrerId, ...(status ? { status } : {}) },
    });
  },

  sumRewardsForReferrer(referrerId: string) {
    return prisma.referral.aggregate({
      where: { referrerId, status: "completed" },
      _sum: { rewardNaira: true },
    });
  },

  findPendingByInvitee(inviteeId: string) {
    return prisma.referral.findMany({
      where: { inviteeId, status: "pending" },
    });
  },

  markCompleted(id: string) {
    return prisma.referral.update({
      where: { id },
      data: { status: "completed", completedAt: new Date() },
    });
  },
};
