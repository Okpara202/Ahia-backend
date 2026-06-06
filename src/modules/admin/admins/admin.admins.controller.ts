import type { Request, Response } from "express";
import { UnauthorizedError } from "../../../errors.js";
import { ipFromRequest, uaFromRequest } from "../../../lib/audit.js";
import {
  adminIdParam,
  changeRoleSchema,
  createAdminSchema,
  listAdminsQuery,
  reset2faSchema,
  restoreAdminSchema,
  suspendAdminSchema,
} from "./admin.admins.schemas.js";
import { adminsService } from "./admin.admins.service.js";

export const adminsController = {
  async list(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const query = listAdminsQuery.parse(req.query);
    const result = await adminsService.list(query);
    res.status(200).json(result);
  },

  async getById(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = adminIdParam.parse(req.params);
    const admin = await adminsService.getById(id);
    res.status(200).json({ admin });
  },

  async invite(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const input = createAdminSchema.parse(req.body);
    const admin = await adminsService.invite(
      req.admin,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(201).json({ admin });
  },

  async suspend(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = adminIdParam.parse(req.params);
    const input = suspendAdminSchema.parse(req.body);
    await adminsService.suspend(
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
    const { id } = adminIdParam.parse(req.params);
    const input = restoreAdminSchema.parse(req.body);
    await adminsService.restore(
      req.admin,
      id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json({ ok: true });
  },

  async changeRole(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = adminIdParam.parse(req.params);
    const input = changeRoleSchema.parse(req.body);
    await adminsService.changeRole(
      req.admin,
      id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json({ ok: true });
  },

  async reset2fa(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = adminIdParam.parse(req.params);
    const input = reset2faSchema.parse(req.body);
    await adminsService.reset2fa(
      req.admin,
      id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json({ ok: true });
  },
};
