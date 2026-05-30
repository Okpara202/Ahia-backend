import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { invoicesService } from "./invoices.service.js";
import {
  conversationInvoiceParam,
  createInvoiceSchema,
  disputeLineSchema,
  invoiceIdParam,
  lineIdParam,
  payInvoiceSchema,
} from "./invoices.schemas.js";

export const invoicesController = {
  async create(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationInvoiceParam.parse(req.params);
    const input = createInvoiceSchema.parse(req.body);
    const message = await invoicesService.create(req.user.id, id, input);
    res.status(201).json({ message });
  },

  async cancel(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { invoiceId } = invoiceIdParam.parse(req.params);
    const invoice = await invoicesService.cancel(req.user.id, invoiceId);
    res.status(200).json({ invoice });
  },

  async pay(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { invoiceId } = invoiceIdParam.parse(req.params);
    const input = payInvoiceSchema.parse(req.body ?? {});
    const result = await invoicesService.initPay(req.user.id, invoiceId, input);
    res.status(200).json(result);
  },

  async confirmLine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { lineId } = lineIdParam.parse(req.params);
    const line = await invoicesService.confirmLine(req.user.id, lineId);
    res.status(200).json({ line });
  },

  async disputeLine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { lineId } = lineIdParam.parse(req.params);
    const input = disputeLineSchema.parse(req.body);
    const result = await invoicesService.disputeLine(req.user.id, lineId, input);
    res.status(201).json(result);
  },
};
