import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError } from "../../errors.js";
import { boostsService } from "./boosts.service.js";
import { buyBoostSchema } from "./boosts.schemas.js";

const productIdParam = z.object({ id: z.string().uuid() });
const shopIdParam = z.object({ id: z.string().uuid() });

export const boostsController = {
  async listPlans(_req: Request, res: Response) {
    res.status(200).json({ plans: boostsService.listPlans() });
  },

  async listMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const items = await boostsService.listMine(req.user.id);
    res.status(200).json({ items });
  },

  async buy(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = buyBoostSchema.parse(req.body);
    const result = await boostsService.initPurchase(req.user.id, input);
    res.status(200).json(result);
  },

  async getProductBoost(req: Request, res: Response) {
    const { id } = productIdParam.parse(req.params);
    const boost = await boostsService.activeForProduct(id);
    res.status(200).json({ boost });
  },

  async listShopBoosts(req: Request, res: Response) {
    const { id } = shopIdParam.parse(req.params);
    const items = await boostsService.activeForShop(id);
    res.status(200).json({ items });
  },
};
