import crypto from "node:crypto";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../errors.js";
import { paystack } from "../../integrations/paystack.js";
import { notificationsService } from "../notifications/notifications.service.js";
import { notificationRenderers } from "../notifications/notifications.renderer.js";

const PAYOUT_REF_PREFIX = "ahia_payout_";
const MIN_PAYOUT_NAIRA = 500;
const PAYSTACK_FLAT_FEE = 25; // pass-through, approx NUBAN transfer fee
const AHIA_SURCHARGE_RATE = 0.01;
const RATE_LIMIT_WINDOW_HOURS = 24;
const COOLDOWN_AFTER_FAILURE_HOURS = 1;

function generateTransferRef(): string {
  return `${PAYOUT_REF_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
}

function computeBreakdown(owedBalance: number): {
  owedBalance: number;
  paystackFee: number;
  ahiaSurcharge: number;
  netToSeller: number;
} {
  const paystackFee = PAYSTACK_FLAT_FEE;
  const ahiaSurcharge = owedBalance > MIN_PAYOUT_NAIRA
    ? Math.round(owedBalance * AHIA_SURCHARGE_RATE * 100) / 100
    : 0;
  const netToSeller = Math.max(
    0,
    Math.round((owedBalance - paystackFee - ahiaSurcharge) * 100) / 100,
  );
  return { owedBalance, paystackFee, ahiaSurcharge, netToSeller };
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

async function eligibility(sellerId: string): Promise<{
  eligible: boolean;
  reason: string | null;
  owedBalance: number;
  hasPayoutAccount: boolean;
}> {
  const seller = await prisma.user.findUnique({
    where: { id: sellerId },
    select: {
      owedBalance: true,
      payoutAccount: { select: { paystackRecipientCode: true } },
    },
  });
  const owed = Number(seller?.owedBalance ?? 0);
  const hasAccount = !!seller?.payoutAccount?.paystackRecipientCode;

  if (owed <= MIN_PAYOUT_NAIRA) {
    return { eligible: false, reason: "below_minimum", owedBalance: owed, hasPayoutAccount: hasAccount };
  }
  if (!hasAccount) {
    return { eligible: false, reason: "no_payout_account", owedBalance: owed, hasPayoutAccount: hasAccount };
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000);
  const recent = await prisma.payout.findFirst({
    where: { sellerId, kind: "cash_out_now", createdAt: { gte: since } },
    select: { id: true, status: true },
  });
  if (recent) {
    return { eligible: false, reason: "rate_limited", owedBalance: owed, hasPayoutAccount: hasAccount };
  }

  const cooldownSince = new Date(Date.now() - COOLDOWN_AFTER_FAILURE_HOURS * 60 * 60 * 1000);
  const recentFailure = await prisma.payout.findFirst({
    where: { sellerId, kind: "cash_out_now", status: "failed", createdAt: { gte: cooldownSince } },
    select: { id: true },
  });
  if (recentFailure) {
    return { eligible: false, reason: "cooldown", owedBalance: owed, hasPayoutAccount: hasAccount };
  }

  return { eligible: true, reason: null, owedBalance: owed, hasPayoutAccount: hasAccount };
}

export const payoutCashout = {
  async preview(sellerId: string) {
    const e = await eligibility(sellerId);
    const breakdown = computeBreakdown(e.owedBalance);
    return { ...breakdown, eligible: e.eligible, reason: e.reason };
  },

  async execute(sellerId: string) {
    const e = await eligibility(sellerId);
    if (!e.eligible) {
      throw new AppError(
        e.reason === "no_payout_account" ? 403 : 409,
        e.reason ?? "ineligible",
        e.reason === "below_minimum"
          ? "Your balance is below the ₦500 minimum."
          : e.reason === "no_payout_account"
            ? "Add a payout account first."
            : e.reason === "rate_limited"
              ? "You've already cashed out in the last 24h. Try again tomorrow."
              : e.reason === "cooldown"
                ? "A recent cash-out failed. Try again in an hour."
                : "Not eligible right now.",
      );
    }

    const seller = await prisma.user.findUnique({
      where: { id: sellerId },
      select: { payoutAccount: { select: { paystackRecipientCode: true } } },
    });
    const recipientCode = seller?.payoutAccount?.paystackRecipientCode;
    if (!recipientCode) {
      throw new AppError(403, "no_payout_account", "Add a payout account first.");
    }

    const breakdown = computeBreakdown(e.owedBalance);
    const lines = await listEligibleReleasedLines(sellerId);
    if (lines.length === 0) {
      throw new AppError(409, "no_releasable_lines", "Nothing to cash out right now.");
    }

    const transferReference = generateTransferRef();
    const created = await prisma.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: {
          sellerId,
          amount: e.owedBalance,
          kind: "cash_out_now",
          status: "pending",
          paystackTransferRef: transferReference,
        },
      });
      await tx.payoutLine.createMany({
        data: lines.map((l) => ({ payoutId: payout.id, invoiceLineId: l.id })),
      });
      await tx.user.update({
        where: { id: sellerId },
        data: { owedBalance: { decrement: e.owedBalance } },
      });
      return payout;
    });

    let initOk = false;
    let paystackRaw: unknown = null;
    try {
      const result = await paystack.initiateTransfer({
        amountInKobo: Math.round(breakdown.netToSeller * 100),
        recipientCode,
        reason: "Ahia instant cash-out",
        reference: transferReference,
      });
      paystackRaw = result.raw;
      initOk = true;
    } catch (err) {
      logger.error("payouts: cash-out transfer init failed", {
        sellerId,
        payoutId: created.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (!initOk) {
      await prisma.$transaction(async (tx) => {
        await tx.payout.update({
          where: { id: created.id },
          data: { status: "failed", paystackResponse: paystackRaw as never },
        });
        await tx.payoutLine.deleteMany({ where: { payoutId: created.id } });
        await tx.user.update({
          where: { id: sellerId },
          data: { owedBalance: { increment: e.owedBalance } },
        });
      });
      throw new AppError(
        502,
        "PAYSTACK_TRANSFER_FAILED",
        "Couldn't reach Paystack right now. Your balance is untouched — try again in a moment.",
      );
    }

    await prisma.payout.update({
      where: { id: created.id },
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
          amount: breakdown.netToSeller,
          sellerId,
          payoutId: created.id,
        }),
      );
    } catch (err) {
      logger.warn("payouts: cash-out notification failed", {
        sellerId,
        payoutId: created.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return { ...breakdown, payoutId: created.id, eligible: true, reason: null };
  },
};
