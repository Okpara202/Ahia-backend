import type { Request, Response } from "express";
import { UnauthorizedError, ValidationError } from "../../../errors.js";
import { ipFromRequest, uaFromRequest } from "../../../lib/audit.js";
import {
  disputeIdParam,
  listDisputesQuery,
  postAdminMessageSchema,
  resolveDisputeSchema,
} from "./admin.disputes.schemas.js";
import { adminDisputesService } from "./admin.disputes.service.js";

function getImageBuffer(req: Request): Buffer | undefined {
  const single = req.file as Express.Multer.File | undefined;
  if (single) return single.buffer;
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  return files?.image_file?.[0]?.buffer;
}

export const adminDisputesController = {
  async list(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const query = listDisputesQuery.parse(req.query);
    const result = await adminDisputesService.list(query);
    res.status(200).json(result);
  },

  async getById(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = disputeIdParam.parse(req.params);
    const result = await adminDisputesService.getById(
      req.admin,
      id,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json(result);
  },

  async postMessage(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = disputeIdParam.parse(req.params);
    const input = postAdminMessageSchema.parse(req.body);
    const buffer = getImageBuffer(req);
    if (!input.content && !buffer) {
      throw new ValidationError("Message must include text or an image.", {
        content: "Required when no image is sent",
      });
    }
    const message = await adminDisputesService.postMessage(
      req.admin,
      id,
      input,
      buffer,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(201).json({ message });
  },

  async resolve(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const { id } = disputeIdParam.parse(req.params);
    const input = resolveDisputeSchema.parse(req.body);
    const dispute = await adminDisputesService.resolve(
      req.admin,
      id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json({ dispute });
  },
};
