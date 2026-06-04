import type { Request, Response } from "express";
import { z } from "zod";
import { presenceService } from "./presence.service.js";

const userIdParam = z.object({ id: z.string().uuid() });

export const presenceController = {
  async get(req: Request, res: Response) {
    const { id } = userIdParam.parse(req.params);
    const state = await presenceService.getState(id);
    res.status(200).json(state);
  },
};
