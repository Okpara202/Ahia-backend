import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError } from "../../errors.js";
import { prisma } from "../../config/db.js";
import { payoutsService } from "./payouts.service.js";
import { payoutsHistory } from "./payouts.history.js";
import { payoutCashout } from "./payouts.cashout.js";
import {
  resolveAccountQuery,
  savePayoutAccountSchema,
} from "./payouts.schemas.js";

const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const payoutsController = {
  async listBanks(_req: Request, res: Response) {
    const banks = await payoutsService.listBanks();
    res.status(200).json({ banks });
  },

  async resolveAccount(req: Request, res: Response) {
    const query = resolveAccountQuery.parse(req.query);
    const result = await payoutsService.resolveAccount(query);
    res.status(200).json(result);
  },

  async getMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const account = await payoutsService.getMine(req.user.id);
    res.status(200).json({ account });
  },

  async save(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = savePayoutAccountSchema.parse(req.body);
    const account = await payoutsService.save(req.user.id, input);
    res.status(200).json({ account });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    await payoutsService.remove(req.user.id);
    res.status(204).end();
  },

  async cashOutPreview(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const result = await payoutCashout.preview(req.user.id);
    res.status(200).json(result);
  },

  async cashOutExecute(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const result = await payoutCashout.execute(req.user.id);
    res.status(200).json(result);
  },

  async listMyPayouts(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const query = listQuery.parse(req.query);
    const rows = await payoutsHistory.listForSeller({
      sellerId: req.user.id,
      take: query.limit,
      cursor: query.cursor,
    });
    const hasMore = rows.length > query.limit;
    const items = (hasMore ? rows.slice(0, query.limit) : rows).map((p) => ({
      id: p.id,
      amount: p.amount,
      kind: p.kind,
      status: p.status,
      sweepDate: p.sweepDate ? p.sweepDate.toISOString().slice(0, 10) : null,
      paystackTransferRef: p.paystackTransferRef,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      invoiceLineIds: p.lines.map((l) => l.invoiceLineId),
    }));
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
    const seller = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { owedBalance: true },
    });
    res.status(200).json({
      items,
      nextCursor,
      owedBalance: seller?.owedBalance ?? 0,
    });
  },
};
