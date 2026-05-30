import crypto from "node:crypto";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import { AppError, BadRequestError, NotFoundError } from "../../errors.js";
import { paystack } from "../../integrations/paystack.js";
import { broadcastToUser } from "../../realtime/socket.js";
import { conversationsService } from "../conversations/conversations.service.js";
import { conversationsRepo } from "../conversations/conversations.repo.js";
import { formatMessageOut } from "../conversations/conversations.mapper.js";
import { notificationsService } from "../notifications/notifications.service.js";
import {
  invoicesRepo,
  recomputeInvoiceStatus,
} from "./invoices.repo.js";
import type {
  CreateInvoiceInput,
  DisputeLineInput,
  InvoiceLineInput,
  PayInvoiceInput,
} from "./invoices.schemas.js";

const INVOICE_REF_PREFIX = "ahia_invoice_";
const AUTO_RELEASE_DAYS = 7;

function generateReference(): string {
  return `${INVOICE_REF_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
}

async function expandLines(
  sellerId: string,
  input: InvoiceLineInput[],
): Promise<{ lines: Array<{ kind: "product" | "custom" | "discount"; productId: string | null; name: string; quantity: number; unitPrice: number; position: number }>; total: number }> {
  const lines: Array<{
    kind: "product" | "custom" | "discount";
    productId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    position: number;
  }> = [];
  let total = 0;

  for (let i = 0; i < input.length; i++) {
    const raw = input[i]!;
    if (raw.kind === "product") {
      const product = await prisma.product.findFirst({
        where: { id: raw.productId, deletedAt: null },
        include: { shop: { select: { ownerId: true } } },
      });
      if (!product) {
        throw new AppError(400, "invalid_line", `Product ${raw.productId} not found.`);
      }
      if (product.shop.ownerId !== sellerId) {
        throw new AppError(
          400,
          "invalid_line",
          "You can only bill for your own products.",
        );
      }
      const unitPrice = Number(product.price);
      const lineTotal = unitPrice * raw.quantity;
      lines.push({
        kind: "product",
        productId: product.id,
        name: product.name,
        quantity: raw.quantity,
        unitPrice,
        position: i,
      });
      total += lineTotal;
    } else if (raw.kind === "custom") {
      const lineTotal = raw.unitPrice * raw.quantity;
      lines.push({
        kind: "custom",
        productId: null,
        name: raw.name,
        quantity: raw.quantity,
        unitPrice: raw.unitPrice,
        position: i,
      });
      total += lineTotal;
    } else {
      // discount
      lines.push({
        kind: "discount",
        productId: null,
        name: raw.name,
        quantity: 1,
        unitPrice: raw.unitPrice,
        position: i,
      });
      total += raw.unitPrice;
    }
  }

  return { lines, total };
}

async function broadcastInvoiceEvent(
  buyerId: string,
  sellerId: string,
  event: string,
  payload: unknown,
) {
  broadcastToUser(buyerId, event, payload);
  broadcastToUser(sellerId, event, payload);
}

async function refreshInvoiceMessage(invoiceId: string) {
  const message = await prisma.message.findFirst({
    where: { invoiceId },
    select: { id: true, conversationId: true },
  });
  if (!message) return null;
  const full = await conversationsRepo.findMessageById(message.id);
  return full ? { full, conversationId: message.conversationId } : null;
}

export const invoicesService = {
  async create(userId: string, conversationId: string, input: CreateInvoiceInput) {
    const convo = await conversationsService.assertParticipant(conversationId, userId);
    if (convo.sellerId !== userId) {
      throw new AppError(403, "not_seller", "Only the seller can create invoices.");
    }

    const { lines, total } = await expandLines(userId, input.lines);
    if (total <= 0) {
      throw new AppError(400, "zero_total", "Invoice total must be greater than zero.");
    }

    const invoice = await invoicesRepo.create({
      conversationId,
      sellerId: convo.sellerId,
      buyerId: convo.buyerId,
      totalAmount: total,
      lines,
    });

    const message = await conversationsRepo.createMessage({
      conversation: { connect: { id: conversationId } },
      sender: { connect: { id: userId } },
      type: "invoice",
      invoice: { connect: { id: invoice.id } },
    });
    await conversationsRepo.touchConversation(conversationId, message.id);

    const full = await conversationsRepo.findMessageById(message.id);
    const out = formatMessageOut(full!, userId);
    await broadcastInvoiceEvent(convo.buyerId, convo.sellerId, "invoice:created", {
      conversationId,
      message: out,
    });
    broadcastToUser(convo.buyerId, "message:new", { conversationId, message: out });

    await notificationsService.createForUser(convo.buyerId, "invoice_received", {
      invoiceId: invoice.id,
      conversationId,
      totalAmount: total,
    });

    return out;
  },

  async cancel(userId: string, invoiceId: string) {
    const invoice = await invoicesRepo.findById(invoiceId);
    if (!invoice) throw new NotFoundError("Invoice");
    if (invoice.sellerId !== userId) {
      throw new AppError(403, "not_seller", "Only the seller can cancel this invoice.");
    }
    if (invoice.status === "cancelled") {
      throw new AppError(409, "already_cancelled", "Invoice already cancelled.");
    }
    if (invoice.status !== "pending") {
      throw new AppError(409, "already_paid", "Invoice cannot be cancelled now.");
    }
    const updated = await invoicesRepo.cancel(invoiceId);
    await broadcastInvoiceEvent(invoice.buyerId, invoice.sellerId, "invoice:cancelled", {
      invoiceId,
      conversationId: invoice.conversationId,
      cancelledAt: updated.cancelledAt?.toISOString(),
    });
    return updated;
  },

  async initPay(userId: string, invoiceId: string, input: PayInvoiceInput) {
    const invoice = await invoicesRepo.findById(invoiceId);
    if (!invoice) throw new NotFoundError("Invoice");
    if (invoice.buyerId !== userId) {
      throw new AppError(403, "not_buyer", "Only the buyer can pay this invoice.");
    }
    if (invoice.status !== "pending") {
      throw new AppError(409, "not_pending", "Invoice can no longer be paid.");
    }

    const buyer = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!buyer) throw new NotFoundError("User");

    const reference = invoice.paystackRef ?? generateReference();
    const amountInKobo = Math.round(Number(invoice.totalAmount) * 100);

    if (!invoice.paystackRef) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { paystackRef: reference },
      });
    }

    const init = await paystack.initTransaction({
      email: buyer.email,
      amountInKobo,
      reference,
      metadata: {
        type: "invoice",
        invoiceId,
        buyerId: userId,
        sellerId: invoice.sellerId,
      },
      callbackUrl: input.callbackUrl,
    });

    return {
      authorizationUrl: init.authorization_url,
      reference: init.reference,
    };
  },

  async handlePaystackSuccess(payload: {
    data: { reference: string; amount: number; metadata?: { invoiceId?: string } };
  }) {
    const reference = payload.data.reference;
    const invoiceId = payload.data.metadata?.invoiceId;
    if (!invoiceId) {
      throw new BadRequestError("Webhook missing invoiceId");
    }
    const existing = await invoicesRepo.findById(invoiceId);
    if (!existing) throw new NotFoundError("Invoice");

    if (existing.status !== "pending") {
      logger.info("invoice: paystack duplicate ignored", { reference, invoiceId });
      return existing;
    }

    const autoReleaseAt = new Date(Date.now() + AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000);
    const updated = await invoicesRepo.setPaid(invoiceId, reference, autoReleaseAt);

    await prisma.transaction.create({
      data: {
        invoice: { connect: { id: invoiceId } },
        buyer: { connect: { id: existing.buyerId } },
        seller: { connect: { id: existing.sellerId } },
        totalPaid: existing.totalAmount,
        paystackRef: reference,
        status: "held",
        paidAt: new Date(),
      },
    });

    const refreshed = await refreshInvoiceMessage(invoiceId);
    if (refreshed) {
      const out = formatMessageOut(refreshed.full, existing.buyerId);
      broadcastToUser(existing.buyerId, "message:edited", {
        conversationId: refreshed.conversationId,
        message: out,
      });
      broadcastToUser(existing.sellerId, "message:edited", {
        conversationId: refreshed.conversationId,
        message: out,
      });
    }

    await broadcastInvoiceEvent(existing.buyerId, existing.sellerId, "invoice:paid", {
      invoiceId,
      conversationId: existing.conversationId,
      paidAt: updated.paidAt?.toISOString(),
    });

    await Promise.all([
      notificationsService.createForUser(existing.buyerId, "invoice_paid", {
        invoiceId,
        amount: Number(existing.totalAmount),
      }),
      notificationsService.createForUser(existing.sellerId, "invoice_received_payment", {
        invoiceId,
        amount: Number(existing.totalAmount),
      }),
    ]);

    return updated;
  },

  async confirmLine(userId: string, lineId: string) {
    const line = await invoicesRepo.findLine(lineId);
    if (!line) throw new NotFoundError("Invoice line");
    const invoice = line.invoice;
    if (invoice.buyerId !== userId) {
      throw new AppError(403, "not_buyer", "Only the buyer can confirm a line.");
    }
    if (line.status !== "pending") {
      throw new BadRequestError("Line is not pending");
    }
    if (invoice.status !== "paid" && invoice.status !== "partial_released" && invoice.status !== "partial_refunded") {
      throw new BadRequestError("Invoice is not in a payable state");
    }

    await invoicesRepo.setLineStatus(lineId, "released");
    const invoiceStatus = await recomputeInvoiceStatus(invoice.id);

    await broadcastInvoiceEvent(invoice.buyerId, invoice.sellerId, "invoice:line_confirmed", {
      lineId,
      invoiceId: invoice.id,
      conversationId: invoice.conversationId,
      status: "released",
      releasedAmount: Number(line.unitPrice) * line.quantity,
      invoiceStatus,
    });

    await notificationsService.createForUser(invoice.sellerId, "invoice_line_released", {
      invoiceId: invoice.id,
      lineId,
      amount: Number(line.unitPrice) * line.quantity,
    });

    return invoicesRepo.findLine(lineId);
  },

  async disputeLine(userId: string, lineId: string, input: DisputeLineInput) {
    const line = await invoicesRepo.findLine(lineId);
    if (!line) throw new NotFoundError("Invoice line");
    const invoice = line.invoice;
    if (invoice.buyerId !== userId) {
      throw new AppError(403, "not_buyer", "Only the buyer can dispute a line.");
    }
    if (line.status !== "pending") {
      throw new BadRequestError("Line is not pending");
    }

    const dispute = await prisma.$transaction(async (tx) => {
      const created = await tx.dispute.create({
        data: {
          invoiceLine: { connect: { id: lineId } },
          raisedBy: { connect: { id: userId } },
          reason: input.reason,
          evidenceUrl: input.evidenceUrl,
        },
      });
      await tx.invoiceLine.update({
        where: { id: lineId },
        data: { autoReleaseAt: null }, // freeze auto-release while disputed
      });
      return created;
    });

    await broadcastInvoiceEvent(invoice.buyerId, invoice.sellerId, "invoice:line_disputed", {
      lineId,
      invoiceId: invoice.id,
      conversationId: invoice.conversationId,
      disputeId: dispute.id,
    });

    await Promise.all([
      notificationsService.createForUser(invoice.sellerId, "invoice_line_disputed", {
        invoiceId: invoice.id,
        lineId,
        disputeId: dispute.id,
      }),
      notificationsService.createForUser(invoice.buyerId, "invoice_line_disputed", {
        invoiceId: invoice.id,
        lineId,
        disputeId: dispute.id,
      }),
    ]);

    return { dispute, line: await invoicesRepo.findLine(lineId) };
  },
};

export const invoicesBackground = {
  async autoReleaseLine(lineId: string) {
    const line = await invoicesRepo.findLine(lineId);
    if (!line || line.status !== "pending") return;
    await invoicesRepo.setLineStatus(lineId, "released");
    const invoiceStatus = await recomputeInvoiceStatus(line.invoice.id);
    await broadcastInvoiceEvent(line.invoice.buyerId, line.invoice.sellerId, "invoice:line_confirmed", {
      lineId,
      invoiceId: line.invoice.id,
      conversationId: line.invoice.conversationId,
      status: "released",
      releasedAmount: Number(line.unitPrice) * line.quantity,
      invoiceStatus,
      autoReleased: true,
    });
  },
};

