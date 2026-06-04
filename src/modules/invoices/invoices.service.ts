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
  notificationRenderers,
  summarizeLines,
} from "../notifications/notifications.renderer.js";
import {
  invoicesRepo,
  recomputeInvoiceStatus,
} from "./invoices.repo.js";
import type {
  CreateInvoiceInput,
  DisputeLineInput,
  ExtendLineInput,
  InvoiceLineInput,
  PayInvoiceInput,
} from "./invoices.schemas.js";

const INVOICE_REF_PREFIX = "ahia_invoice_";
const AUTO_RELEASE_DAYS = 7;
const PLATFORM_FEE_RATE = 0.05;
const PAYSTACK_FEE_RATE = 0.015;
const PAYSTACK_FEE_FLAT = 100;
const PAYSTACK_FEE_FLAT_THRESHOLD = 2500;
const PAYSTACK_FEE_CAP = 2000;

function generateReference(): string {
  return `${INVOICE_REF_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
}

function computePlatformFee(totalAmount: number): number {
  return Math.round(totalAmount * PLATFORM_FEE_RATE * 100) / 100;
}

function estimatePaystackFee(totalAmount: number): number {
  const flat = totalAmount >= PAYSTACK_FEE_FLAT_THRESHOLD ? PAYSTACK_FEE_FLAT : 0;
  const raw = totalAmount * PAYSTACK_FEE_RATE + flat;
  const capped = Math.min(raw, PAYSTACK_FEE_CAP);
  return Math.round(capped * 100) / 100;
}

// Given total seller payout for the invoice, distribute proportionally across
// non-discount lines by their gross value. Discount lines contribute 0; any
// rounding leftover gets dumped onto the last positive line.
function allocateLinePayouts(
  lines: Array<{ id: string; kind: "product" | "custom" | "discount"; unitPrice: number; quantity: number }>,
  totalSellerPayout: number,
): Map<string, number> {
  const map = new Map<string, number>();
  const positive = lines.filter((l) => l.kind !== "discount");
  const grossSum = positive.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  if (grossSum <= 0 || totalSellerPayout <= 0) {
    for (const l of lines) map.set(l.id, 0);
    return map;
  }
  let allocated = 0;
  for (let i = 0; i < positive.length; i++) {
    const l = positive[i]!;
    const lineGross = l.unitPrice * l.quantity;
    let share = Math.round((lineGross / grossSum) * totalSellerPayout * 100) / 100;
    if (i === positive.length - 1) {
      share = Math.round((totalSellerPayout - allocated) * 100) / 100;
    }
    map.set(l.id, share);
    allocated += share;
  }
  for (const l of lines) {
    if (!map.has(l.id)) map.set(l.id, 0);
  }
  return map;
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
      const unitPrice = raw.unitPrice !== undefined ? raw.unitPrice : Number(product.price);
      const name = raw.name !== undefined ? raw.name : product.name;
      const lineTotal = unitPrice * raw.quantity;
      lines.push({
        kind: "product",
        productId: product.id,
        name,
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

    const seller = await prisma.user.findUnique({
      where: { id: convo.sellerId },
      select: { name: true },
    });
    await notificationsService.createForUser(
      convo.buyerId,
      notificationRenderers.invoiceReceived({
        sellerName: seller?.name ?? "Seller",
        itemSummary: summarizeLines(lines.map((l) => ({ name: l.name, kind: l.kind }))),
        total,
        conversationId,
        invoiceId: invoice.id,
      }),
    );

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

    // Always generate a fresh reference. Paystack rejects re-initialising with
    // an already-known reference (regardless of whether the prior attempt
    // succeeded, was declined, or was abandoned), so reusing the stored one
    // breaks retries after a decline. The webhook still finds the invoice via
    // metadata.invoiceId, so any prior reference is harmless on Paystack's side.
    const reference = generateReference();
    const amountInKobo = Math.round(Number(invoice.totalAmount) * 100);

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { paystackRef: reference },
    });

    let init;
    try {
      init = await paystack.initTransaction({
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
    } catch (err) {
      logger.error("paystack: initTransaction failed", {
        invoiceId,
        reference,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new AppError(
        502,
        "PAYSTACK_INIT_FAILED",
        "Couldn't reach Paystack right now. Try again in a moment.",
      );
    }

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
    const totalAmount = Number(existing.totalAmount);
    const platformFee = computePlatformFee(totalAmount);
    const paystackFee = estimatePaystackFee(totalAmount);
    const totalSellerPayout = Math.max(0, Math.round((totalAmount - platformFee - paystackFee) * 100) / 100);

    const updated = await invoicesRepo.setPaid(invoiceId, reference, autoReleaseAt, platformFee);

    // Compute per-line seller payout amounts and persist
    const lineAllocations = allocateLinePayouts(
      existing.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        unitPrice: Number(l.unitPrice),
        quantity: l.quantity,
      })),
      totalSellerPayout,
    );
    await prisma.$transaction(
      Array.from(lineAllocations.entries()).map(([lineId, amount]) =>
        prisma.invoiceLine.update({
          where: { id: lineId },
          data: { sellerPayoutAmount: amount },
        }),
      ),
    );

    await prisma.transaction.create({
      data: {
        invoice: { connect: { id: invoiceId } },
        buyer: { connect: { id: existing.buyerId } },
        seller: { connect: { id: existing.sellerId } },
        totalPaid: existing.totalAmount,
        platformFee,
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

    const buyer = await prisma.user.findUnique({
      where: { id: existing.buyerId },
      select: { name: true },
    });
    await Promise.all([
      notificationsService.createForUser(
        existing.buyerId,
        notificationRenderers.invoicePaid({
          total: Number(existing.totalAmount),
          conversationId: existing.conversationId,
          invoiceId,
        }),
      ),
      notificationsService.createForUser(
        existing.sellerId,
        notificationRenderers.invoiceReceivedPayment({
          buyerName: buyer?.name ?? "Buyer",
          total: Number(existing.totalAmount),
          conversationId: existing.conversationId,
          invoiceId,
        }),
      ),
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
    await creditSellerForLine(invoice.sellerId, line.id, Number(line.sellerPayoutAmount));
    const invoiceStatus = await recomputeInvoiceStatus(invoice.id);

    await broadcastInvoiceEvent(invoice.buyerId, invoice.sellerId, "invoice:line_confirmed", {
      lineId,
      invoiceId: invoice.id,
      conversationId: invoice.conversationId,
      status: "released",
      releasedAmount: Number(line.unitPrice) * line.quantity,
      sellerPayoutAmount: Number(line.sellerPayoutAmount),
      invoiceStatus,
    });

    const buyerForConfirm = await prisma.user.findUnique({
      where: { id: invoice.buyerId },
      select: { name: true },
    });
    await notificationsService.createForUser(
      invoice.sellerId,
      notificationRenderers.invoiceLineReleased({
        buyerName: buyerForConfirm?.name ?? "Buyer",
        lineName: line.name,
        amount: Number(line.unitPrice) * line.quantity,
        conversationId: invoice.conversationId,
        invoiceId: invoice.id,
        lineId,
      }),
    );

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

    const buyerForDispute = await prisma.user.findUnique({
      where: { id: invoice.buyerId },
      select: { name: true },
    });
    await notificationsService.createForUser(
      invoice.sellerId,
      notificationRenderers.invoiceLineDisputed({
        buyerName: buyerForDispute?.name ?? "Buyer",
        lineName: line.name,
        amount: Number(line.unitPrice) * line.quantity,
        conversationId: invoice.conversationId,
        invoiceId: invoice.id,
        lineId,
        disputeId: dispute.id,
      }),
    );

    return { dispute, line: await invoicesRepo.findLine(lineId) };
  },

  async extendLine(userId: string, lineId: string, input: ExtendLineInput) {
    const line = await invoicesRepo.findLine(lineId);
    if (!line) throw new NotFoundError("Invoice line");
    const invoice = line.invoice;
    if (invoice.buyerId !== userId) {
      throw new AppError(403, "not_buyer", "Only the buyer can extend a line.");
    }
    if (line.status !== "pending" || line.autoReleaseAt === null) {
      throw new AppError(
        409,
        "not_pending",
        "Only pending lines that aren't under dispute can be extended.",
      );
    }
    if (line.extendedAt !== null) {
      throw new AppError(
        409,
        "already_extended",
        "This line has already been extended.",
      );
    }

    const newAutoReleaseAt = new Date(Date.now() + AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000);
    const updated = await invoicesRepo.extendLine(lineId, newAutoReleaseAt, input.reason);

    await broadcastInvoiceEvent(invoice.buyerId, invoice.sellerId, "invoice:line_extended", {
      lineId,
      invoiceId: invoice.id,
      conversationId: invoice.conversationId,
      autoReleaseAt: newAutoReleaseAt.toISOString(),
      extendedAt: updated.extendedAt?.toISOString(),
      extensionReason: input.reason,
    });

    const buyerForExtend = await prisma.user.findUnique({
      where: { id: invoice.buyerId },
      select: { name: true },
    });
    await notificationsService.createForUser(
      invoice.sellerId,
      notificationRenderers.invoiceLineExtended({
        buyerName: buyerForExtend?.name ?? "Buyer",
        lineName: line.name,
        amount: Number(line.unitPrice) * line.quantity,
        conversationId: invoice.conversationId,
        invoiceId: invoice.id,
        lineId,
        autoReleaseAt: newAutoReleaseAt.toISOString(),
        extensionReason: input.reason,
      }),
    );

    return invoicesRepo.findLine(lineId);
  },
};

async function creditSellerForLine(sellerId: string, _lineId: string, amount: number) {
  if (amount <= 0) return;
  await prisma.user.update({
    where: { id: sellerId },
    data: { owedBalance: { increment: amount } },
  });
}

export const invoicesBackground = {
  async autoReleaseLine(lineId: string) {
    const line = await invoicesRepo.findLine(lineId);
    if (!line || line.status !== "pending") return;
    await invoicesRepo.setLineStatus(lineId, "released");
    await creditSellerForLine(line.invoice.sellerId, line.id, Number(line.sellerPayoutAmount));
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

    await notificationsService.createForUser(
      line.invoice.sellerId,
      notificationRenderers.invoiceLineReleased({
        buyerName: "Auto",
        lineName: line.name,
        amount: Number(line.unitPrice) * line.quantity,
        conversationId: line.invoice.conversationId,
        invoiceId: line.invoice.id,
        lineId,
        autoReleased: true,
      }),
    );
  },
};

