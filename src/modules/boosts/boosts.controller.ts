import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { boostsService } from "./boosts.service.js";
import { buyBoostSchema } from "./boosts.schemas.js";

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
};
