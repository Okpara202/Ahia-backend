import type { Request, Response } from "express";
import { UnauthorizedError } from "../../../errors.js";
import { listAuditQuery } from "./admin.audit.schemas.js";
import { auditService } from "./admin.audit.service.js";

export const auditController = {
  async list(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const query = listAuditQuery.parse(req.query);
    const result = await auditService.list(req.admin, query);
    res.status(200).json(result);
  },
};
