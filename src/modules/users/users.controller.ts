import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { usersService } from "./users.service.js";
import { updateProfileSchema, updateRoleSchema } from "./users.schemas.js";

export const usersController = {
  async updateProfile(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = updateProfileSchema.parse(req.body);
    const user = await usersService.updateProfile(req.user.id, input);
    res.status(200).json({ user });
  },

  async updateRole(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = updateRoleSchema.parse(req.body);
    const user = await usersService.updateRole(req.user.id, input);
    res.status(200).json({ user });
  },
};
