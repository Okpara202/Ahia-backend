import { prisma } from "../../config/db.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../errors.js";
import { broadcastToUser } from "../../realtime/socket.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { transactionsRepo } from "../transactions/transactions.repo.js";
import { disputesRepo } from "./disputes.repo.js";
import type {
  ListDisputesQuery,
  OpenDisputeInput,
  ResolveDisputeInput,
} from "./disputes.schemas.js";
import type { SessionUser } from "../../middleware/auth.js";

function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}

export const disputesService = {
  async open(userId: string, input: OpenDisputeInput) {
    const txn = await transactionsRepo.findById(input.transactionId);
    if (!txn) throw new NotFoundError("Transaction");

    const buyerId = txn.buyerId;
    const sellerId = txn.product.shop.ownerId;
    if (userId !== buyerId && userId !== sellerId) {
      throw new ForbiddenError("Not a participant in this transaction");
    }
    if (txn.status !== "held") {
      throw new BadRequestError("Can only dispute transactions in held state");
    }

    const existing = await disputesRepo.findByTransactionId(input.transactionId);
    if (existing) {
      throw new ConflictError(
        "DISPUTE_EXISTS",
        "Dispute already opened for this transaction",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.dispute.create({
        data: {
          transaction: { connect: { id: input.transactionId } },
          raisedById: userId,
          reason: input.reason,
        },
      });
      await tx.transaction.update({
        where: { id: input.transactionId },
        data: { status: "disputed" },
      });
    });

    const full = await disputesRepo.findByTransactionId(input.transactionId);
    if (!full) throw new NotFoundError("Dispute");

    const otherUserId = userId === buyerId ? sellerId : buyerId;
    broadcastToUser(otherUserId, "dispute:opened", { dispute: full });

    await Promise.all([
      notificationsService.createForUser(buyerId, "dispute_opened", {
        disputeId: full.id,
        transactionId: input.transactionId,
        raisedBy: userId,
      }),
      notificationsService.createForUser(sellerId, "dispute_opened", {
        disputeId: full.id,
        transactionId: input.transactionId,
        raisedBy: userId,
      }),
    ]);

    return full;
  },

  async listMine(userId: string, query: ListDisputesQuery) {
    const rows = await disputesRepo.listForUser({
      userId,
      take: query.limit,
      cursor: query.cursor,
      status: query.status,
    });
    return paginate(rows, query.limit);
  },

  async getById(user: SessionUser, id: string) {
    const dispute = await disputesRepo.findById(id);
    if (!dispute) throw new NotFoundError("Dispute");
    const buyerId = dispute.transaction.buyerId;
    const sellerId = dispute.transaction.product.shop.ownerId;
    if (user.role !== "admin" && user.id !== buyerId && user.id !== sellerId) {
      throw new ForbiddenError("Not a participant in this dispute");
    }
    return dispute;
  },

  async resolve(id: string, input: ResolveDisputeInput) {
    const dispute = await disputesRepo.findById(id);
    if (!dispute) throw new NotFoundError("Dispute");
    if (dispute.status !== "open") {
      throw new BadRequestError("Dispute already resolved");
    }

    const buyerId = dispute.transaction.buyerId;
    const sellerId = dispute.transaction.product.shop.ownerId;

    const newTxnStatus =
      input.resolution === "resolved_buyer"
        ? ("refunded" as const)
        : input.resolution === "resolved_seller"
          ? ("released" as const)
          : ("held" as const);

    await prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id },
        data: {
          status: input.resolution,
          resolution: input.note,
          resolvedAt: new Date(),
        },
      });
      await tx.transaction.update({
        where: { id: dispute.transactionId },
        data: {
          status: newTxnStatus,
          ...(newTxnStatus === "released" ? { releasedAt: new Date() } : {}),
        },
      });
    });

    const full = await disputesRepo.findById(id);

    broadcastToUser(buyerId, "dispute:resolved", { dispute: full });
    broadcastToUser(sellerId, "dispute:resolved", { dispute: full });

    await Promise.all([
      notificationsService.createForUser(buyerId, "dispute_resolved", {
        disputeId: id,
        resolution: input.resolution,
      }),
      notificationsService.createForUser(sellerId, "dispute_resolved", {
        disputeId: id,
        resolution: input.resolution,
      }),
    ]);

    return full;
  },
};
