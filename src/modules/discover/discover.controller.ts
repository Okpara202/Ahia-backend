import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { discoverService } from "./discover.service.js";
import {
  campaignIdParam,
  createCampaignSchema,
  createDiscoverPostSchema,
  feedQuery,
  postIdParam,
} from "./discover.schemas.js";

function extractFiles(req: Request): { video?: Buffer; poster?: Buffer } {
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  return {
    video: files?.video?.[0]?.buffer,
    poster: files?.poster?.[0]?.buffer,
  };
}

export const discoverController = {
  async getFeed(req: Request, res: Response) {
    const query = feedQuery.parse(req.query);
    const result = await discoverService.getFeed(query);
    res.status(200).json(result);
  },

  async createPost(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = createDiscoverPostSchema.parse(req.body);
    const post = await discoverService.createPost(
      req.user.id,
      input,
      extractFiles(req),
    );
    res.status(201).json({ post });
  },

  async impression(req: Request, res: Response) {
    const { id } = postIdParam.parse(req.params);
    await discoverService.recordImpression(id);
    res.status(204).end();
  },

  async click(req: Request, res: Response) {
    const { id } = postIdParam.parse(req.params);
    await discoverService.recordClick(id);
    res.status(204).end();
  },

  async save(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = postIdParam.parse(req.params);
    await discoverService.recordSave(req.user.id, id);
    res.status(204).end();
  },

  async initCampaign(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = createCampaignSchema.parse(req.body);
    const result = await discoverService.initCampaign(req.user.id, input);
    res.status(200).json(result);
  },

  async listMyCampaigns(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const items = await discoverService.listMyCampaigns(req.user.id);
    res.status(200).json({ items });
  },

  async campaignAnalytics(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = campaignIdParam.parse(req.params);
    const result = await discoverService.getCampaignAnalytics(req.user.id, id);
    res.status(200).json(result);
  },
};
