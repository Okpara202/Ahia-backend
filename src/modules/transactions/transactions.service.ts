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
import { referralsService } from "../referrals/referrals.service.js";
import { transactionsRepo } from "./transactions.repo.js";
import type { ListTransactionsQuery } from "./transactions.schemas.js";

const ESCROW_REF_PREFIX = "ahia_escrow_";

function generateReference(): string {
  return `${ESCROW_REF_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
}

function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}

async function assertParticipant(txnId: string, userId: string) {
  const txn = await transactionsRepo.findById(txnId);
  if (!txn) throw new NotFoundError("Transaction");
  const isBuyer = txn.buyerId === userId;
  const isSeller = txn.product.shop.ownerId === userId;
  if (!isBuyer && !isSeller) {
    throw new ForbiddenError("Not a participant in this transaction");
  }
  return { txn, isBuyer, isSeller };
}

async function releaseEscrowInternal(id: string) {
  const txn = await transactionsRepo.update(id, {
    status: "released",
    releasedAt: new Date(),
  });
  const sellerId = txn.product.shop.ownerId;
  broadcastToUser(txn.buyerId, "transaction:released", { transaction: txn });
  broadcastToUser(sellerId, "transaction:released", { transaction: txn });

  await Promise.all([
    notificationsService.createForUser(txn.buyerId, "payment_released", {
      transactionId: txn.id,
    }),
    notificationsService.createForUser(sellerId, "payment_released", {
      transactionId: txn.id,
      amount: Number(txn.amount),
    }),
  ]);

  return txn;
}

type PaystackWebhookPayload = {
  event: string;
  data: {
    reference: string;
    amount: number;
    metadata?: {
      type?: string;
      buyerId?: string;
      productId?: string;
      shopId?: string;
      [k: string]: unknown;
    };
  };
};

export const transactionsService = {
  async initPurchase(
    userId: string,
    productId: string,
    callbackUrl: string | undefined,
  ) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { shop: true },
    });
    if (!product) throw new NotFoundError("Product");
    if (product.hidden) throw new BadRequestError("Product is unavailable");
    if (product.shop.ownerId === userId) {
      throw new BadRequestError("You can't buy your own product");
    }

    const buyer = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!buyer) throw new NotFoundError("User");

    const reference = generateReference();
    const amountInKobo = Math.round(Number(product.price) * 100);

    const init = await paystack.initTransaction({
      email: buyer.email,
      amountInKobo,
      reference,
      metadata: {
        type: "escrow",
        buyerId: userId,
        productId: product.id,
        shopId: product.shopId,
      },
      callbackUrl,
    });

    return {
      authorization_url: init.authorization_url,
      reference: init.reference,
    };
  },

  async handlePaystackSuccess(payload: PaystackWebhookPayload) {
    const reference = payload.data.reference;
    const metadata = payload.data.metadata ?? {};

    const existing = await transactionsRepo.findByReference(reference);
    if (existing) {
      logger.info("paystack: duplicate event ignored", { reference });
      return existing;
    }

    const buyerId = metadata.buyerId;
    const productId = metadata.productId;
    if (!buyerId || !productId) {
      throw new BadRequestError("Webhook metadata missing buyerId or productId");
    }

    const amount = payload.data.amount / 100;
    const txn = await transactionsRepo.create({
      buyer: { connect: { id: buyerId } },
      product: { connect: { id: productId } },
      amount,
      status: "held",
      paystackRef: reference,
      heldAt: new Date(),
    });

    const sellerId = txn.product.shop.ownerId;
    broadcastToUser(buyerId, "transaction:paid", { transaction: txn });
    broadcastToUser(sellerId, "transaction:paid", { transaction: txn });

    await Promise.all([
      notificationsService.createForUser(buyerId, "payment_paid", {
        transactionId: txn.id,
        productId: txn.productId,
        amount,
      }),
      notificationsService.createForUser(sellerId, "payment_received", {
        transactionId: txn.id,
        productId: txn.productId,
        amount,
      }),
    ]);

    await referralsService.markFirstTransaction(buyerId);

    return txn;
  },

  async listMine(userId: string, query: ListTransactionsQuery) {
    const rows = await transactionsRepo.listForBuyer({
      buyerId: userId,
      take: query.limit,
      cursor: query.cursor,
      status: query.status,
    });
    return paginate(rows, query.limit);
  },

  async listSales(userId: string, query: ListTransactionsQuery) {
    const rows = await transactionsRepo.listForSeller({
      sellerId: userId,
      take: query.limit,
      cursor: query.cursor,
      status: query.status,
    });
    return paginate(rows, query.limit);
  },

  async getById(userId: string, id: string) {
    const { txn } = await assertParticipant(id, userId);
    return txn;
  },

  async getByReference(userId: string, reference: string) {
    const txn = await transactionsRepo.findByReference(reference);
    if (!txn) throw new NotFoundError("Transaction");
    const isBuyer = txn.buyerId === userId;
    const isSeller = txn.product.shop.ownerId === userId;
    if (!isBuyer && !isSeller) {
      throw new ForbiddenError("Not a participant in this transaction");
    }
    return txn;
  },

  async markDelivered(userId: string, id: string) {
    const { txn } = await assertParticipant(id, userId);
    if (txn.status !== "held") {
      throw new BadRequestError("Transaction not in held state");
    }
    if (txn.deliveredAt) {
      throw new BadRequestError("Already marked delivered");
    }
    const updated = await transactionsRepo.update(id, {
      deliveredAt: new Date(),
    });
    broadcastToUser(txn.buyerId, "transaction:delivered", { transaction: updated });
    broadcastToUser(txn.product.shop.ownerId, "transaction:delivered", {
      transaction: updated,
    });
    return updated;
  },

  async release(userId: string, id: string) {
    const { txn, isBuyer } = await assertParticipant(id, userId);
    if (!isBuyer) {
      throw new ForbiddenError("Only the buyer can release escrow");
    }
    if (txn.status !== "held") {
      throw new BadRequestError("Transaction not in held state");
    }
    return releaseEscrowInternal(id);
  },
};

export const transactionsBackground = {
  releaseEscrow: releaseEscrowInternal,
};
