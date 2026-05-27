import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { storiesService } from "./stories.service.js";
import { createStorySchema, shopIdParam } from "./stories.schemas.js";

export const storiesController = {
  async listForShop(req: Request, res: Response) {
    const { id } = shopIdParam.parse(req.params);
    const items = await storiesService.listForShop(id);
    res.status(200).json({ items });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { durationMs } = createStorySchema.parse(req.body);
    const file = req.file as Express.Multer.File | undefined;
    const story = await storiesService.createForUser(
      req.user.id,
      file?.buffer,
      durationMs,
    );
    res.status(201).json({ story });
  },
};
