import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { transactionsService } from "./transactions.service.js";
import {
  listTransactionsQuery,
  referenceParam,
  transactionIdParam,
} from "./transactions.schemas.js";

export const transactionsController = {
  async listMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const query = listTransactionsQuery.parse(req.query);
    const result = await transactionsService.listMine(req.user.id, query);
    res.status(200).json(result);
  },

  async listSales(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const query = listTransactionsQuery.parse(req.query);
    const result = await transactionsService.listSales(req.user.id, query);
    res.status(200).json(result);
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = transactionIdParam.parse(req.params);
    const transaction = await transactionsService.getById(req.user.id, id);
    res.status(200).json({ transaction });
  },

  async getByReference(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { reference } = referenceParam.parse(req.params);
    const transaction = await transactionsService.getByReference(req.user.id, reference);
    res.status(200).json({ transaction });
  },
};
