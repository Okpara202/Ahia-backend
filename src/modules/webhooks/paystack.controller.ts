import type { Request, Response } from "express";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import { paystack } from "../../integrations/paystack.js";
import { boostsService } from "../boosts/boosts.service.js";
import { discoverService } from "../discover/discover.service.js";
import { invoicesService } from "../invoices/invoices.service.js";

type PaystackEvent = {
  event: string;
  data: {
    reference: string;
    amount?: number;
    metadata?: { type?: string; [k: string]: unknown };
    [k: string]: unknown;
  };
};

async function handleChargeSuccess(payload: PaystackEvent) {
  const type = payload.data.metadata?.type;
  switch (type) {
    case "invoice":
      await invoicesService.handlePaystackSuccess(
        payload as Parameters<typeof invoicesService.handlePaystackSuccess>[0],
      );
      return;
    case "boost":
      await boostsService.handlePaystackSuccess(payload as never);
      return;
    case "discover":
      await discoverService.handlePaystackSuccess(payload as never);
      return;
    default:
      logger.warn("paystack: unknown metadata.type", {
        type,
        reference: payload.data.reference,
      });
  }
}

async function handleTransferEvent(
  payload: PaystackEvent,
  finalStatus: "paid" | "failed",
) {
  const reference = payload.data.reference;
  if (!reference) {
    logger.warn("paystack: transfer event missing reference");
    return;
  }
  const payout = await prisma.payout.findUnique({
    where: { paystackTransferRef: reference },
    select: { id: true, sellerId: true, amount: true, status: true },
  });
  if (!payout) {
    logger.warn("paystack: transfer event for unknown reference", { reference });
    return;
  }
  if (payout.status === finalStatus) {
    logger.info("paystack: transfer event idempotent no-op", {
      reference,
      payoutId: payout.id,
      finalStatus,
    });
    return;
  }
  if (payout.status === "paid" && finalStatus === "failed") {
    // Late-arriving fail after success: re-credit seller, mark failed, drop lines.
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payout.id },
        data: { status: "failed", paystackResponse: payload.data as never },
      });
      await tx.payoutLine.deleteMany({ where: { payoutId: payout.id } });
      await tx.user.update({
        where: { id: payout.sellerId },
        data: { owedBalance: { increment: Number(payout.amount) } },
      });
    });
    logger.warn("paystack: transfer failed after success — re-credited seller", {
      reference,
      payoutId: payout.id,
    });
    return;
  }
  if (payout.status === "pending" && finalStatus === "paid") {
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: "paid",
        paidAt: new Date(),
        paystackResponse: payload.data as never,
      },
    });
    return;
  }
  if (payout.status === "pending" && finalStatus === "failed") {
    await prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payout.id },
        data: { status: "failed", paystackResponse: payload.data as never },
      });
      await tx.payoutLine.deleteMany({ where: { payoutId: payout.id } });
      await tx.user.update({
        where: { id: payout.sellerId },
        data: { owedBalance: { increment: Number(payout.amount) } },
      });
    });
    return;
  }
  logger.info("paystack: transfer event unhandled transition", {
    reference,
    from: payout.status,
    to: finalStatus,
  });
}

export const paystackWebhookController = {
  async handle(req: Request, res: Response) {
    const signature = req.header("x-paystack-signature");
    if (!signature) {
      logger.warn("paystack webhook: missing signature");
      res.status(401).json({
        error: { code: "INVALID_SIGNATURE", message: "Missing signature" },
      });
      return;
    }

    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      logger.error("paystack webhook: body is not a Buffer — raw-body middleware misconfigured");
      res.status(500).json({
        error: { code: "RAW_BODY_MISSING", message: "Raw body not available" },
      });
      return;
    }

    if (!paystack.verifyWebhookSignature(rawBody, signature)) {
      logger.warn("paystack webhook: invalid signature");
      res.status(401).json({
        error: { code: "INVALID_SIGNATURE", message: "Invalid signature" },
      });
      return;
    }

    let payload: PaystackEvent;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({
        error: { code: "INVALID_PAYLOAD", message: "Could not parse payload" },
      });
      return;
    }

    logger.info("paystack webhook: received", {
      event: payload.event,
      reference: payload.data?.reference,
      type: payload.data?.metadata?.type,
    });

    try {
      switch (payload.event) {
        case "charge.success":
          await handleChargeSuccess(payload);
          break;
        case "transfer.success":
          await handleTransferEvent(payload, "paid");
          break;
        case "transfer.failed":
        case "transfer.reversed":
          await handleTransferEvent(payload, "failed");
          break;
        default:
          logger.info("paystack webhook: unhandled event", { event: payload.event });
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error("paystack webhook: handler threw", {
        event: payload.event,
        reference: payload.data?.reference,
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({
        error: { code: "WEBHOOK_FAILED", message: "Processing failed" },
      });
    }
  },
};
