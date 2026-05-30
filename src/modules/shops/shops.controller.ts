import type { Request, Response } from "express";
import { shopsService } from "./shops.service.js";
import {
  createShopSchema,
  listShopProductsQuery,
  shopIdParam,
  updateShopSchema,
} from "./shops.schemas.js";
import { UnauthorizedError, ValidationError } from "../../errors.js";

function extractShopFiles(req: Request): { avatar?: Buffer; banner?: Buffer } {
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  // Accept both legacy field names (avatar/banner) and new ones (avatar_file/banner_file)
  return {
    avatar: files?.avatar_file?.[0]?.buffer ?? files?.avatar?.[0]?.buffer,
    banner: files?.banner_file?.[0]?.buffer ?? files?.banner?.[0]?.buffer,
  };
}

function extractSingleFile(req: Request, field: string): Buffer | undefined {
  const single = req.file as Express.Multer.File | undefined;
  if (single) return single.buffer;
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  return files?.[field]?.[0]?.buffer;
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
    const shop = await shopsService.getById(id, req.user?.id);
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

  async uploadAvatar(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const buf = extractSingleFile(req, "avatar_file");
    if (!buf) {
      throw new ValidationError("Avatar file is required", { avatar_file: "Required" });
    }
    const shop = await shopsService.uploadAvatar(req.user.id, buf);
    res.status(200).json({ shop });
  },

  async removeAvatar(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const shop = await shopsService.removeAvatar(req.user.id);
    res.status(200).json({ shop });
  },

  async uploadBanner(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const buf = extractSingleFile(req, "banner_file");
    if (!buf) {
      throw new ValidationError("Banner file is required", { banner_file: "Required" });
    }
    const shop = await shopsService.uploadBanner(req.user.id, buf);
    res.status(200).json({ shop });
  },

  async removeBanner(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const shop = await shopsService.removeBanner(req.user.id);
    res.status(200).json({ shop });
  },
};
