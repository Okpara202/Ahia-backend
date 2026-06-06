import type { Request, Response } from "express";
import { UnauthorizedError } from "../../../errors.js";
import { ipFromRequest, uaFromRequest } from "../../../lib/audit.js";
import {
  listUsersQuery,
  restoreUserSchema,
  suspendUserSchema,
  userIdParam,
} from "./admin.users.schemas.js";
import { adminUsersService } from "./admin.users.service.js";

export const adminUsersController = {
  async list(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const query = listUsersQuery.parse(req.query);
    const result = await adminUsersService.list(query);
    res.status(200).json(result);
  },

  async getById(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = userIdParam.parse(req.params);
    const user = await adminUsersService.getById(id);
    res.status(200).json({ user });
  },

  async suspend(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = userIdParam.parse(req.params);
    const input = suspendUserSchema.parse(req.body);
    await adminUsersService.suspend(
      req.admin,
      id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json({ ok: true });
  },

  async restore(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = userIdParam.parse(req.params);
    const input = restoreUserSchema.parse(req.body);
    await adminUsersService.restore(
      req.admin,
      id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json({ ok: true });
  },
};
