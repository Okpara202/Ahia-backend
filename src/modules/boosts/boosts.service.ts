import crypto from "node:crypto";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../errors.js";
import { paystack } from "../../integrations/paystack.js";
import { broadcastToUser } from "../../realtime/socket.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { notificationRenderers } from "../notifications/notifications.renderer.js";
import { BOOST_PLANS, getPlan, planEndDate } from "./boosts.plans.js";
import { boostsRepo } from "./boosts.repo.js";
import type { BuyBoostInput } from "./boosts.schemas.js";
import type { BoostPlan } from "@prisma/client";

const BOOST_REF_PREFIX = "ahia_boost_";

function generateReference(): string {
  return `${BOOST_REF_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
}

type PaystackWebhookPayload = {
  event: string;
  data: {
    reference: string;
    amount: number;
    metadata?: {
      type?: string;
      userId?: string;
      productId?: string;
      plan?: string;
      [k: string]: unknown;
    };
  };
};

export const boostsService = {
  listPlans() {
    return BOOST_PLANS;
  },

  async listMine(userId: string) {
    return boostsRepo.listForUser(userId);
  },

  async activeForProduct(productId: string) {
    return boostsRepo.findActiveForProduct(productId, new Date());
  },

  async activeForShop(shopId: string) {
    return boostsRepo.listActiveForShop(shopId, new Date());
  },

  async initPurchase(userId: string, input: BuyBoostInput) {
    const plan = getPlan(input.plan);
    if (!plan) throw new BadRequestError("Invalid plan");

    const product = await prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      include: { shop: true },
    });
    if (!product) throw new NotFoundError("Product");
    if (product.shop.ownerId !== userId) {
      throw new ForbiddenError("You can only boost your own products");
    }

    const buyer = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!buyer) throw new NotFoundError("User");

    const reference = generateReference();
    const amountKobo = Math.round(plan.priceNaira * 100);

    const init = await paystack.initTransaction({
      email: buyer.email,
      amountInKobo: amountKobo,
      reference,
      metadata: {
        type: "boost",
        userId,
        productId: input.productId,
        plan: input.plan,
      },
      callbackUrl: input.callbackUrl,
    });

    return {
      authorizationUrl: init.authorization_url,
      reference: init.reference,
    };
  },

  async handlePaystackSuccess(payload: PaystackWebhookPayload) {
    const reference = payload.data.reference;
    const metadata = payload.data.metadata ?? {};
    const userId = metadata.userId;
    const productId = metadata.productId;
    const planId = metadata.plan;

    if (!userId || !productId || !planId) {
      logger.warn("paystack boost: missing metadata", { reference });
      return null;
    }
    const plan = getPlan(planId);
    if (!plan) {
      logger.warn("paystack boost: invalid plan", { planId, reference });
      return null;
    }

    const existing = await boostsRepo.findByReference(reference);
    if (existing) {
      logger.info("paystack boost: duplicate event ignored", { reference });
      return existing;
    }

    const startsAt = new Date();
    const endsAt = planEndDate(startsAt, plan);
    const amount = payload.data.amount / 100;

    const boost = await prisma.$transaction(async (tx) => {
      const created = await tx.boost.create({
        data: {
          product: { connect: { id: productId } },
          plan: planId as BoostPlan,
          spend: amount,
          startsAt,
          endsAt,
          paystackRef: reference,
        },
      });
      await tx.product.update({
        where: { id: productId },
        data: { sponsored: true },
      });
      return created;
    });

    broadcastToUser(userId, "boost:purchased", { boost });
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { name: true },
    });
    await notificationsService.createForUser(
      userId,
      notificationRenderers.boostPurchased({
        productName: product?.name ?? "Your product",
        endsAt,
        productId,
        boostId: boost.id,
      }),
    );

    return boost;
  },
};

export const boostsBackground = {
  async expireStaleSponsoredFlags() {
    const now = new Date();
    const stale = await boostsRepo.findStaleSponsoredProducts(now);
    if (stale.length === 0) return 0;
    await prisma.product.updateMany({
      where: { id: { in: stale.map((p) => p.id) } },
      data: { sponsored: false },
    });
    logger.info("boosts: expired stale sponsored flags", { count: stale.length });
    return stale.length;
  },
};
