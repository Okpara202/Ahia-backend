import type { Request, Response } from "express";
import { UnauthorizedError, ValidationError } from "../../errors.js";
import { usersService } from "./users.service.js";
import { updateProfileSchema, updateRoleSchema } from "./users.schemas.js";

function getAvatarBuffer(req: Request): Buffer | undefined {
  const single = req.file as Express.Multer.File | undefined;
  if (single) return single.buffer;
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  return files?.avatar_file?.[0]?.buffer;
}

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

  async uploadAvatar(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const buffer = getAvatarBuffer(req);
    if (!buffer) {
      throw new ValidationError("Avatar file is required", { avatar_file: "Required" });
    }
    const user = await usersService.uploadAvatar(req.user.id, buffer);
    res.status(200).json({ user });
  },

  async removeAvatar(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const user = await usersService.removeAvatar(req.user.id);
    res.status(200).json({ user });
  },
};
