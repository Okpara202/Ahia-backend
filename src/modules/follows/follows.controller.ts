import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError } from "../../errors.js";
import { followsService } from "./follows.service.js";

const shopIdParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const followsController = {
  async follow(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = shopIdParam.parse(req.params);
    await followsService.follow(req.user.id, id);
    res.status(204).end();
  },

  async unfollow(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = shopIdParam.parse(req.params);
    await followsService.unfollow(req.user.id, id);
    res.status(204).end();
  },

  async listFollowing(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const query = listQuery.parse(req.query);
    const result = await followsService.listFollowing(req.user.id, query);
    res.status(200).json(result);
  },

  async listMyFollowers(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const query = listQuery.parse(req.query);
    const result = await followsService.listMyFollowers(req.user.id, query);
    res.status(200).json(result);
  },
};
