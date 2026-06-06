import { prisma } from "../config/db.js";
import { logger } from "../config/logger.js";
import { paystack } from "../integrations/paystack.js";
import { broadcastToUser } from "../realtime/socket.js";
import { writeAudit } from "../lib/audit.js";
import { notificationsService } from "../modules/notifications/notifications.service.js";
import { notificationRenderers } from "../modules/notifications/notifications.renderer.js";
import { recomputeInvoiceStatus } from "../modules/invoices/invoices.repo.js";

const TICK_MS = 60 * 60 * 1000; // hourly
const SLA_DAYS = 14;
const AUTO_NOTE = "Auto-resolved after 14-day admin response window.";

let timer: NodeJS.Timeout | null = null;

async function findOverdueDisputes() {
  const cutoff = new Date(Date.now() - SLA_DAYS * 24 * 60 * 60 * 1000);
  return prisma.dispute.findMany({
    where: {
      status: { in: ["open", "reviewing"] },
      createdAt: { lt: cutoff },
    },
    take: 50, // batch cap so a backlog doesn't lock the loop
    include: {
      invoiceLine: {
        include: {
          invoice: {
            select: {
              id: true,
              buyerId: true,
              sellerId: true,
              conversationId: true,
            },
          },
        },
      },
    },
  });
}

async function refundLineToBuyer(invoiceId: string, lineId: string, amountInNaira: number) {
  if (amountInNaira <= 0) return;
  try {
    const txn = await prisma.transaction.findUnique({
      where: { invoiceId },
      select: { paystackRef: true },
    });
    if (!txn) {
      logger.warn("disputeAutoResolve: refund skipped, no transaction", {
        invoiceId,
        lineId,
      });
      return;
    }
    const result = await paystack.initiateRefund({
      transactionReference: txn.paystackRef,
      amountInKobo: Math.round(amountInNaira * 100),
    });
    logger.info("disputeAutoResolve: refund initiated", {
      invoiceId,
      lineId,
      amount: amountInNaira,
      refundId: result.refundId,
    });
  } catch (err) {
    logger.error("disputeAutoResolve: paystack refund failed", {
      invoiceId,
      lineId,
      amount: amountInNaira,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function resolveOne(d: Awaited<ReturnType<typeof findOverdueDisputes>>[number]) {
  const line = d.invoiceLine;
  const invoice = line.invoice;
  const amount = Number(line.unitPrice) * line.quantity;
  let alreadyResolved = false;

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.invoiceLine.findUnique({
      where: { id: line.id },
      select: { status: true },
    });
    if (!fresh || fresh.status !== "pending") {
      alreadyResolved = true;
      return;
    }
    await tx.dispute.update({
      where: { id: d.id },
      data: {
        status: "resolved",
        resolution: "refunded_to_buyer",
        resolvedAt: new Date(),
        resolvedByAdminId: null, // signals "system, not a human"
        resolutionNote: AUTO_NOTE,
      },
    });
    await tx.invoiceLine.update({
      where: { id: line.id },
      data: { status: "refunded", resolvedAt: new Date() },
    });
  });

  if (alreadyResolved) {
    logger.info("disputeAutoResolve: dispute already resolved by another action", {
      disputeId: d.id,
    });
    return;
  }

  void refundLineToBuyer(invoice.id, line.id, amount);

  const invoiceStatus = await recomputeInvoiceStatus(invoice.id);

  const payload = {
    lineId: line.id,
    invoiceId: invoice.id,
    conversationId: invoice.conversationId,
    resolution: "refunded",
    invoiceStatus,
    disputeId: d.id,
    auto: true,
  };
  broadcastToUser(invoice.buyerId, "invoice:line_refunded", payload);
  broadcastToUser(invoice.sellerId, "invoice:line_refunded", payload);

  await Promise.all([
    notificationsService.createForUser(
      invoice.buyerId,
      notificationRenderers.disputeAutoResolved({
        recipient: "buyer",
        lineName: line.name,
        amount,
        conversationId: invoice.conversationId,
        invoiceId: invoice.id,
        lineId: line.id,
        disputeId: d.id,
      }),
    ),
    notificationsService.createForUser(
      invoice.sellerId,
      notificationRenderers.disputeAutoResolved({
        recipient: "seller",
        lineName: line.name,
        amount,
        conversationId: invoice.conversationId,
        invoiceId: invoice.id,
        lineId: line.id,
        disputeId: d.id,
      }),
    ),
  ]);

  await writeAudit({
    adminId: null, // NULL = system auto-resolve, distinguishes from human resolves
    action: "auto_resolve_dispute",
    targetType: "dispute",
    targetId: d.id,
    reason: AUTO_NOTE,
    metadata: { resolution: "refunded_to_buyer", amount, ageDays: SLA_DAYS },
  });
}

export async function disputeAutoResolveTick() {
  try {
    const overdue = await findOverdueDisputes();
    if (overdue.length === 0) return;
    logger.info("disputeAutoResolve: processing batch", { count: overdue.length });
    for (const d of overdue) {
      try {
        await resolveOne(d);
      } catch (err) {
        logger.error("disputeAutoResolve: failed for one", {
          disputeId: d.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error("disputeAutoResolve: tick failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startDisputeAutoResolve() {
  if (timer) return;
  // Fire once on boot in case we missed ticks during downtime, then hourly.
  void disputeAutoResolveTick();
  timer = setInterval(() => {
    void disputeAutoResolveTick();
  }, TICK_MS);
}

export function stopDisputeAutoResolve() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
