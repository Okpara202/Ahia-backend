import type { Request, Response } from "express";
import { UnauthorizedError } from "../../../errors.js";
import { ipFromRequest, uaFromRequest } from "../../../lib/audit.js";
import {
  deactivateShopSchema,
  listShopsQuery,
  restoreShopSchema,
  shopIdParam,
} from "./admin.shops.schemas.js";
import { adminShopsService } from "./admin.shops.service.js";

export const adminShopsController = {
  async list(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const query = listShopsQuery.parse(req.query);
    const result = await adminShopsService.list(query);
    res.status(200).json(result);
  },

  async getById(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = shopIdParam.parse(req.params);
    const shop = await adminShopsService.getById(id);
    res.status(200).json({ shop });
  },

  async deactivate(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = shopIdParam.parse(req.params);
    const input = deactivateShopSchema.parse(req.body);
    await adminShopsService.deactivate(
      req.admin,
      id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json({ ok: true });
  },

  async restore(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = shopIdParam.parse(req.params);
    const input = restoreShopSchema.parse(req.body);
    await adminShopsService.restore(
      req.admin,
      id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json({ ok: true });
  },
};
