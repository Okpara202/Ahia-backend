import type { Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { paystack } from "../../integrations/paystack.js";
import { boostsService } from "../boosts/boosts.service.js";
import { discoverService } from "../discover/discover.service.js";
import { invoicesService } from "../invoices/invoices.service.js";

type PaystackEvent = {
  event: string;
  data: {
    reference: string;
    amount: number;
    metadata?: { type?: string; [k: string]: unknown };
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
      await boostsService.handlePaystackSuccess(payload);
      return;
    case "discover":
      await discoverService.handlePaystackSuccess(payload);
      return;
    default:
      logger.warn("paystack: unknown metadata.type", {
        type,
        reference: payload.data.reference,
      });
  }
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
