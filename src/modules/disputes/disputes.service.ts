import { prisma } from "../../config/db.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../errors.js";
import { broadcastToUser } from "../../realtime/socket.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { recomputeInvoiceStatus } from "../invoices/invoices.repo.js";
import { disputesRepo } from "./disputes.repo.js";
import type { ListDisputesQuery, ResolveDisputeInput } from "./disputes.schemas.js";
import type { SessionUser } from "../../middleware/auth.js";

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
      throw new BadRequestError("Dispute already resolved");
    }

    const invoice = dispute.invoiceLine.invoice;
    const lineId = dispute.invoiceLineId;
    const lineStatus = input.resolution === "released_to_seller" ? "released" : "refunded";

    await prisma.$transaction(async (tx) => {
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
        data: { status: lineStatus, resolvedAt: new Date() },
      });
    });

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

    await Promise.all([
      notificationsService.createForUser(invoice.buyerId, "dispute_resolved", {
        disputeId: id,
        lineId,
        invoiceId: invoice.id,
        resolution: input.resolution,
      }),
      notificationsService.createForUser(invoice.sellerId, "dispute_resolved", {
        disputeId: id,
        lineId,
        invoiceId: invoice.id,
        resolution: input.resolution,
      }),
    ]);

    return disputesRepo.findById(id);
  },
};
