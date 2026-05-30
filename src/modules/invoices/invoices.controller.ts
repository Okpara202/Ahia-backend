import type { Request, Response } from "express";
import { UnauthorizedError } from "../../errors.js";
import { uploadImageBuffer } from "../../integrations/cloudinary.js";
import { invoicesService } from "./invoices.service.js";
import {
  conversationInvoiceParam,
  createInvoiceSchema,
  disputeLineSchema,
  extendLineSchema,
  invoiceIdParam,
  lineIdParam,
  payInvoiceSchema,
} from "./invoices.schemas.js";

function getEvidenceBuffer(req: Request): Buffer | undefined {
  const single = req.file as Express.Multer.File | undefined;
  if (single) return single.buffer;
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  return files?.evidence_file?.[0]?.buffer;
}

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

  async extendLine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { lineId } = lineIdParam.parse(req.params);
    const input = extendLineSchema.parse(req.body);
    const line = await invoicesService.extendLine(req.user.id, lineId, input);
    res.status(200).json({ line });
  },

  async disputeLine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { lineId } = lineIdParam.parse(req.params);
    const buf = getEvidenceBuffer(req);
    let evidenceUrl: string | undefined;
    if (buf) {
      evidenceUrl = await uploadImageBuffer(buf, {
        folder: `ahia/disputes/${lineId}`,
        publicId: "evidence",
      });
    }
    const parsed = disputeLineSchema.parse({
      reason: req.body?.reason,
      evidenceUrl: evidenceUrl ?? req.body?.evidenceUrl,
    });
    const result = await invoicesService.disputeLine(req.user.id, lineId, parsed);
    res.status(201).json(result);
  },
};
