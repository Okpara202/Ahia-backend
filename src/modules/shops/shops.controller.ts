import type { Request, Response } from "express";
import { shopsService } from "./shops.service.js";
import {
  createShopSchema,
  listShopProductsQuery,
  shopIdParam,
  updateShopSchema,
} from "./shops.schemas.js";
import { UnauthorizedError } from "../../errors.js";

function extractShopFiles(req: Request): { avatar?: Buffer; banner?: Buffer } {
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  return {
    avatar: files?.avatar?.[0]?.buffer,
    banner: files?.banner?.[0]?.buffer,
  };
}

export const shopsController = {
  async createMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = createShopSchema.parse(req.body);
    const shop = await shopsService.createForUser(req.user.id, input, extractShopFiles(req));
    res.status(201).json({ shop });
  },

  async getMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const shop = await shopsService.getMine(req.user.id);
    res.status(200).json({ shop });
  },

  async updateMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = updateShopSchema.parse(req.body);
    const shop = await shopsService.updateMine(req.user.id, input, extractShopFiles(req));
    res.status(200).json({ shop });
  },

  async getById(req: Request, res: Response) {
    const { id } = shopIdParam.parse(req.params);
    const shop = await shopsService.getById(id);
    res.status(200).json({ shop });
  },

  async listProducts(req: Request, res: Response) {
    const { id } = shopIdParam.parse(req.params);
    const query = listShopProductsQuery.parse(req.query);
    const result = await shopsService.listProducts(id, query);
    res.status(200).json(result);
  },

  async demolishMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    await shopsService.demolishMine(req.user.id);
    res.status(204).end();
  },
};
