import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { reviewsService } from "./reviews.service.js";
import {
  createReviewSchema,
  productIdParam,
  shopIdParam,
} from "./reviews.schemas.js";

export const reviewsController = {
  async listForProduct(req: Request, res: Response) {
    const { id } = productIdParam.parse(req.params);
    const result = await reviewsService.listForProduct(id);
    res.status(200).json(result);
  },

  async shopRating(req: Request, res: Response) {
    const { id } = shopIdParam.parse(req.params);
    const result = await reviewsService.shopRating(id);
    res.status(200).json(result);
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = createReviewSchema.parse(req.body);
    const review = await reviewsService.create(req.user.id, input);
    res.status(201).json({ review });
  },
};
