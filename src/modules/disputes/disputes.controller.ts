import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { disputesService } from "./disputes.service.js";
import {
  disputeIdParam,
  listDisputesQuery,
  resolveDisputeSchema,
} from "./disputes.schemas.js";

export const disputesController = {
  async listMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const query = listDisputesQuery.parse(req.query);
    const result = await disputesService.listMine(req.user.id, query);
    res.status(200).json(result);
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = disputeIdParam.parse(req.params);
    const dispute = await disputesService.getById(req.user, id);
    res.status(200).json({ dispute });
  },

  async resolve(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = disputeIdParam.parse(req.params);
    const input = resolveDisputeSchema.parse(req.body);
    const dispute = await disputesService.resolve(id, input);
    res.status(200).json({ dispute });
  },
};
