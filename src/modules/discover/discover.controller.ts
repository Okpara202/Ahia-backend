import type { Request, Response } from "express";
import { AppError, UnauthorizedError } from "../../errors.js";
import { discoverService } from "./discover.service.js";
import {
  EDITABLE_POST_BODY_KEYS,
  campaignIdParam,
  createCampaignSchema,
  createDiscoverPostSchema,
  editPostSchema,
  feedQuery,
  listMyPostsQuery,
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

function extractPoster(req: Request): Buffer | undefined {
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  return files?.poster?.[0]?.buffer;
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

  async listMyPosts(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const query = listMyPostsQuery.parse(req.query);
    const result = await discoverService.listMyPosts(req.user.id, query);
    res.status(200).json(result);
  },

  async getMyPostById(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = postIdParam.parse(req.params);
    const post = await discoverService.getMyPostById(req.user.id, id);
    res.status(200).json({ post });
  },

  async postAnalytics(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = postIdParam.parse(req.params);
    const result = await discoverService.getPostAnalytics(req.user.id, id);
    res.status(200).json(result);
  },

  async deletePost(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = postIdParam.parse(req.params);
    await discoverService.deletePost(req.user.id, id);
    res.status(204).end();
  },

  async editPost(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = postIdParam.parse(req.params);

    // Spec-required guard: reject any body key that isn't editable BEFORE
    // schema parse, so the frontend gets the exact error code they expect.
    for (const key of Object.keys(req.body ?? {})) {
      if (!EDITABLE_POST_BODY_KEYS.has(key)) {
        throw new AppError(
          400,
          "field_not_editable",
          `Cannot edit '${key}' — only caption and poster can change.`,
        );
      }
    }
    const input = editPostSchema.parse(req.body);
    const post = await discoverService.editPost(
      req.user.id,
      id,
      input,
      extractPoster(req),
    );
    res.status(200).json({ post });
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
