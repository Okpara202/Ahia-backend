import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError } from "../../errors.js";
import { prisma } from "../../config/db.js";

const referenceParam = z.object({ reference: z.string().min(1) });

type VerifyResult =
  | { status: "success"; next: string; id: string }
  | { status: "pending" };

async function verifyInvoice(reference: string, userId: string): Promise<VerifyResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { paystackRef: reference },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      conversationId: true,
      status: true,
    },
  });
  if (!invoice) return { status: "pending" };
  if (invoice.buyerId !== userId && invoice.sellerId !== userId) {
    return { status: "pending" };
  }
  if (invoice.status === "pending") return { status: "pending" };
  return {
    status: "success",
    next: `/inbox/${invoice.conversationId}`,
    id: invoice.id,
  };
}

async function verifyBoost(reference: string, userId: string): Promise<VerifyResult> {
  const boost = await prisma.boost.findUnique({
    where: { paystackRef: reference },
    select: {
      id: true,
      product: { select: { shop: { select: { ownerId: true } } } },
    },
  });
  if (!boost) return { status: "pending" };
  if (boost.product.shop.ownerId !== userId) return { status: "pending" };
  return { status: "success", next: "/seller/products", id: boost.id };
}

async function verifyDiscover(reference: string, userId: string): Promise<VerifyResult> {
  const campaign = await prisma.discoverCampaign.findUnique({
    where: { paystackRef: reference },
    select: { id: true, post: { select: { shopId: true, shop: { select: { ownerId: true } } } } },
  });
  if (!campaign) return { status: "pending" };
  if (campaign.post.shop.ownerId !== userId) return { status: "pending" };
  return { status: "success", next: `/seller/ads/${campaign.id}`, id: campaign.id };
}

export const paymentsController = {
  async verify(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { reference } = referenceParam.parse(req.params);
    const userId = req.user.id;

    let result: VerifyResult;
    if (reference.startsWith("ahia_invoice_")) {
      result = await verifyInvoice(reference, userId);
    } else if (reference.startsWith("ahia_boost_")) {
      result = await verifyBoost(reference, userId);
    } else if (reference.startsWith("ahia_discover_")) {
      result = await verifyDiscover(reference, userId);
    } else {
      result = { status: "pending" };
    }

    res.status(200).json(result);
  },
};
