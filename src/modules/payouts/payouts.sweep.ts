import crypto from "node:crypto";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import { paystack } from "../../integrations/paystack.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { notificationRenderers } from "../notifications/notifications.renderer.js";

const PAYOUT_REF_PREFIX = "ahia_payout_";
const MIN_PAYOUT_NAIRA = 500;

function generateTransferRef(): string {
  return `${PAYOUT_REF_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
}

// Returns the sweep date for "today" in Africa/Lagos as YYYY-MM-DD, then
// constructed as a UTC Date (which Postgres stores as plain DATE).
function todayLagosSweepDate(): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  // en-CA gives YYYY-MM-DD-friendly order. Build a midnight-UTC Date for it.
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
}

async function listEligibleReleasedLines(sellerId: string) {
  return prisma.invoiceLine.findMany({
    where: {
      status: "released",
      sellerPayoutAmount: { gt: 0 },
      payoutLine: null,
      invoice: { sellerId },
    },
    select: { id: true },
  });
}

export const payoutSweep = {
  async runForSeller(
    sellerId: string,
    sweepDate: Date,
  ): Promise<{ outcome: "settled" | "no_balance" | "no_account" | "below_min" | "duplicate" | "failed"; payoutId?: string }> {
    const seller = await prisma.user.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        owedBalance: true,
        payoutAccount: {
          select: {
            paystackRecipientCode: true,
            accountName: true,
          },
        },
      },
    });
    if (!seller) return { outcome: "no_balance" };

    const owed = Number(seller.owedBalance);
    if (owed <= 0) return { outcome: "no_balance" };

    if (owed < MIN_PAYOUT_NAIRA) {
      return { outcome: "below_min" };
    }

    if (!seller.payoutAccount?.paystackRecipientCode) {
      try {
        await notificationsService.createForUser(
          sellerId,
          notificationRenderers.payoutAwaitingAccount({
            amount: owed,
            sellerId,
          }),
        );
      } catch (err) {
        logger.warn("payouts: notify awaiting-account failed", {
          sellerId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return { outcome: "no_account" };
    }

    const lines = await listEligibleReleasedLines(sellerId);
    if (lines.length === 0) return { outcome: "no_balance" };

    const transferReference = generateTransferRef();

    // Atomically: create payout row (with unique (sellerId, sweepDate)),
    // link the lines, decrement owedBalance. If unique conflict, return duplicate.
    let payoutId: string;
    try {
      const created = await prisma.$transaction(async (tx) => {
        const payout = await tx.payout.create({
          data: {
            sellerId,
            amount: owed,
            kind: "sweep",
            status: "pending",
            sweepDate,
            paystackTransferRef: transferReference,
          },
        });
        await tx.payoutLine.createMany({
          data: lines.map((l) => ({ payoutId: payout.id, invoiceLineId: l.id })),
        });
        await tx.user.update({
          where: { id: sellerId },
          data: { owedBalance: { decrement: owed } },
        });
        return payout;
      });
      payoutId = created.id;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") return { outcome: "duplicate" };
      throw err;
    }

    let initOk = false;
    let paystackRaw: unknown = null;
    try {
      const transfer = await paystack.initiateTransfer({
        amountInKobo: Math.round(owed * 100),
        recipientCode: seller.payoutAccount.paystackRecipientCode,
        reason: `Ahia daily payout for ${sweepDate.toISOString().slice(0, 10)}`,
        reference: transferReference,
      });
      paystackRaw = transfer.raw;
      initOk = true;
    } catch (err) {
      logger.error("payouts: paystack transfer init failed", {
        sellerId,
        payoutId,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (!initOk) {
      await prisma.$transaction(async (tx) => {
        await tx.payout.update({
          where: { id: payoutId },
          data: { status: "failed", paystackResponse: paystackRaw as never },
        });
        await tx.payoutLine.deleteMany({ where: { payoutId } });
        await tx.user.update({
          where: { id: sellerId },
          data: { owedBalance: { increment: owed } },
        });
      });
      return { outcome: "failed", payoutId };
    }

    await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: "paid",
        paidAt: new Date(),
        paystackResponse: paystackRaw as never,
      },
    });

    try {
      await notificationsService.createForUser(
        sellerId,
        notificationRenderers.payoutSettled({
          amount: owed,
          sellerId,
          payoutId,
        }),
      );
    } catch (err) {
      logger.warn("payouts: notify settled failed", {
        sellerId,
        payoutId,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return { outcome: "settled", payoutId };
  },

  async sweepNow(): Promise<{ ran: number; settled: number; skipped: number; failed: number }> {
    const sweepDate = todayLagosSweepDate();
    // Pull all sellers with a positive balance — quick filter
    const candidates = await prisma.user.findMany({
      where: { owedBalance: { gt: 0 } },
      select: { id: true },
    });
    let settled = 0;
    let skipped = 0;
    let failed = 0;
    for (const s of candidates) {
      try {
        const result = await this.runForSeller(s.id, sweepDate);
        if (result.outcome === "settled") settled++;
        else if (result.outcome === "failed") failed++;
        else skipped++;
      } catch (err) {
        failed++;
        logger.error("payouts: sweep iteration threw", {
          sellerId: s.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info("payouts: sweep complete", {
      ran: candidates.length,
      settled,
      skipped,
      failed,
      sweepDate: sweepDate.toISOString().slice(0, 10),
    });
    return { ran: candidates.length, settled, skipped, failed };
  },
};
