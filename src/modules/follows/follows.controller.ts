import type { Request, Response } from "express";
import { z } from "zod";
import { UnauthorizedError } from "../../errors.js";
import { followsService } from "./follows.service.js";

const shopIdParam = z.object({ id: z.string().uuid() });

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
};
