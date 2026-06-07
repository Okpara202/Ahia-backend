import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../errors.js";
import { paystack } from "../../integrations/paystack.js";
import { broadcastToUser } from "../../realtime/socket.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { notificationRenderers } from "../notifications/notifications.renderer.js";
import { recomputeInvoiceStatus } from "../invoices/invoices.repo.js";
import { disputesRepo } from "./disputes.repo.js";
import type { ListDisputesQuery, ResolveDisputeInput } from "./disputes.schemas.js";
import type { SessionUser } from "../../middleware/auth.js";

async function refundLineToBuyer(
  invoiceId: string,
  lineId: string,
  amountInNaira: number,
): Promise<void> {
  if (amountInNaira <= 0) return;
  try {
    const txn = await prisma.transaction.findUnique({
      where: { invoiceId },
      select: { paystackRef: true },
    });
    if (!txn) {
      logger.warn("disputes: refund skipped, no transaction", { invoiceId, lineId });
      return;
    }
    const result = await paystack.initiateRefund({
      transactionReference: txn.paystackRef,
      amountInKobo: Math.round(amountInNaira * 100),
    });
    logger.info("disputes: refund initiated", {
      invoiceId,
      lineId,
      amount: amountInNaira,
      refundId: result.refundId,
      status: result.status,
    });
  } catch (err) {
    logger.error("disputes: paystack refund failed", {
      invoiceId,
      lineId,
      amount: amountInNaira,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}

export const disputesService = {
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
    const buyerId = dispute.invoiceLine.invoice.buyerId;
    const sellerId = dispute.invoiceLine.invoice.sellerId;
    if (user.role !== "admin" && user.id !== buyerId && user.id !== sellerId) {
      throw new ForbiddenError("Not a participant in this dispute");
    }
    return dispute;
  },

  async resolve(id: string, input: ResolveDisputeInput) {
    const dispute = await disputesRepo.findById(id);
    if (!dispute) throw new NotFoundError("Dispute");
    if (dispute.status !== "open" && dispute.status !== "reviewing") {
      throw new ConflictError(
        "dispute_already_resolved",
        "This dispute was resolved by another admin or by auto-resolution.",
      );
    }

    const invoice = dispute.invoiceLine.invoice;
    const lineId = dispute.invoiceLineId;
    const lineStatus = input.resolution === "released_to_seller" ? "released" : "refunded";

    const lineRow = dispute.invoiceLine;
    let alreadyResolved = false;
    await prisma.$transaction(async (tx) => {
      // Race guard: re-read the line inside the tx. If the buyer confirmed
      // (status flipped to 'released') in the gap between admin opening the
      // dispute and clicking resolve, we'd double-credit. Same for refund.
      const fresh = await tx.invoiceLine.findUnique({
        where: { id: lineId },
        select: { status: true },
      });
      if (!fresh || fresh.status !== "pending") {
        alreadyResolved = true;
        return;
      }
      await tx.dispute.update({
        where: { id },
        data: {
          status: "resolved",
          resolution: input.resolution,
          resolvedAt: new Date(),
        },
      });
      await tx.invoiceLine.update({
        where: { id: lineId },
        data: { status: lineStatus, resolvedBy: "admin", resolvedAt: new Date() },
      });
      if (lineStatus === "released") {
        const credit = Number(lineRow.sellerPayoutAmount);
        if (credit > 0) {
          await tx.user.update({
            where: { id: invoice.sellerId },
            data: { owedBalance: { increment: credit } },
          });
        }
      }
    });
    if (alreadyResolved) {
      throw new ConflictError(
        "dispute_already_resolved",
        "This line was already resolved by another action — no change made.",
      );
    }

    if (lineStatus === "refunded") {
      void refundLineToBuyer(invoice.id, lineRow.id, Number(lineRow.unitPrice) * lineRow.quantity);
    }

    const invoiceStatus = await recomputeInvoiceStatus(invoice.id);

    const event = lineStatus === "released" ? "invoice:line_released" : "invoice:line_refunded";
    const payload = {
      lineId,
      invoiceId: invoice.id,
      conversationId: invoice.conversationId,
      resolution: lineStatus,
      invoiceStatus,
      disputeId: id,
    };
    broadcastToUser(invoice.buyerId, event, payload);
    broadcastToUser(invoice.sellerId, event, payload);

    const amount = Number(lineRow.unitPrice) * lineRow.quantity;
    await Promise.all([
      notificationsService.createForUser(
        invoice.buyerId,
        notificationRenderers.disputeResolved({
          recipient: "buyer",
          lineName: lineRow.name,
          amount,
          conversationId: invoice.conversationId,
          invoiceId: invoice.id,
          lineId,
          disputeId: id,
          resolution: input.resolution,
        }),
      ),
      notificationsService.createForUser(
        invoice.sellerId,
        notificationRenderers.disputeResolved({
          recipient: "seller",
          lineName: lineRow.name,
          amount,
          conversationId: invoice.conversationId,
          invoiceId: invoice.id,
          lineId,
          disputeId: id,
          resolution: input.resolution,
        }),
      ),
    ]);

    return disputesRepo.findById(id);
  },
};
