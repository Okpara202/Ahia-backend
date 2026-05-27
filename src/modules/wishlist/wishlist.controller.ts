import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { wishlistService } from "./wishlist.service.js";
import { addToWishlistSchema, productIdParam } from "./wishlist.schemas.js";

export const wishlistController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const items = await wishlistService.list(req.user.id);
    res.status(200).json({ items });
  },

  async add(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { productId } = addToWishlistSchema.parse(req.body);
    await wishlistService.add(req.user.id, productId);
    res.status(204).end();
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { productId } = productIdParam.parse(req.params);
    await wishlistService.remove(req.user.id, productId);
    res.status(204).end();
  },
};
