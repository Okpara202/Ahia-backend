// Polls Paystack for invoices stuck in 'pending' status whose paystack_ref is
// set but our webhook never arrived (network blip, Paystack delivery failure,
// our server bouncing at the wrong instant). Runs every 10 minutes and only
// looks at invoices older than 15 minutes — younger ones might just be
// mid-flight on Paystack's side.

import { prisma } from "../config/db.js";
import { logger } from "../config/logger.js";
import { paystack } from "../integrations/paystack.js";
import { invoicesService } from "../modules/invoices/invoices.service.js";

const TICK_MS = 10 * 60 * 1000;
const STUCK_AFTER_MS = 15 * 60 * 1000;
const STUCK_BEFORE_MS = 48 * 60 * 60 * 1000; // don't recover invoices older than 48h

let timer: NodeJS.Timeout | null = null;

async function runOnce() {
  const now = Date.now();
  const stuckAfter = new Date(now - STUCK_AFTER_MS);
  const stuckBefore = new Date(now - STUCK_BEFORE_MS);

  const candidates = await prisma.invoice.findMany({
    where: {
      status: "pending",
      paystackRef: { not: null },
      createdAt: { lte: stuckAfter, gte: stuckBefore },
    },
    select: { id: true, paystackRef: true, totalAmount: true, sellerId: true, buyerId: true },
    take: 50,
  });

  if (candidates.length === 0) return;
  logger.info("paystack recovery: checking stuck invoices", { count: candidates.length });

  for (const inv of candidates) {
    if (!inv.paystackRef) continue;
    try {
      const verified = await paystack.verifyTransaction(inv.paystackRef);
      if (verified.status !== "success") continue;

      logger.warn("paystack recovery: simulating missed webhook", {
        invoiceId: inv.id,
        reference: inv.paystackRef,
      });

      await invoicesService.handlePaystackSuccess({
        data: {
          reference: inv.paystackRef,
          amount: verified.amount,
          metadata: { type: "invoice", invoiceId: inv.id, ...verified.metadata },
        },
      });
    } catch (err) {
      logger.error("paystack recovery: invoice check failed", {
        invoiceId: inv.id,
        reference: inv.paystackRef,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startPaystackRecovery() {
  if (timer) return;
  void runOnce().catch((err) =>
    logger.error("paystack recovery: initial run failed", {
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  timer = setInterval(() => {
    void runOnce().catch((err) =>
      logger.error("paystack recovery: tick failed", {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }, TICK_MS);
  logger.info("paystack recovery: scheduled", { everyMs: TICK_MS });
}

export function stopPaystackRecovery() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
