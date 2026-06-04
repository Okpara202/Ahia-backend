import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { storiesService } from "./stories.service.js";
import {
  createStorySchema,
  shopIdParam,
  storyIdParam,
} from "./stories.schemas.js";

function extractMedia(req: Request): { image?: Buffer; video?: Buffer } {
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  return {
    image: files?.image?.[0]?.buffer,
    video: files?.video?.[0]?.buffer,
  };
}

export const storiesController = {
  async listForShop(req: Request, res: Response) {
    const { id } = shopIdParam.parse(req.params);
    const items = await storiesService.listForShop(id, req.user?.id);
    res.status(200).json({ items });
  },

  async listMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const items = await storiesService.listMine(req.user.id);
    res.status(200).json({ items });
  },

  async getById(req: Request, res: Response) {
    const { id } = storyIdParam.parse(req.params);
    const story = await storiesService.getById(id, req.user?.id);
    res.status(200).json({ story });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = createStorySchema.parse(req.body);
    const { image, video } = extractMedia(req);
    const story = await storiesService.createForUser(req.user.id, {
      imageBuffer: image,
      videoBuffer: video,
      input,
    });
    res.status(201).json({ story });
  },

  async deleteMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = storyIdParam.parse(req.params);
    await storiesService.deleteMine(req.user.id, id);
    res.status(204).end();
  },

  async recordView(req: Request, res: Response) {
    const { id } = storyIdParam.parse(req.params);
    await storiesService.recordView(id, req.user?.id);
    res.status(204).end();
  },
};
