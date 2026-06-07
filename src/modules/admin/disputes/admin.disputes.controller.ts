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

function getFileBuffer(
  req: Request,
  field: "image_file" | "audio_file",
): Buffer | undefined {
  const single = req.file as Express.Multer.File | undefined;
  if (single && single.fieldname === field) return single.buffer;
  const files = req.files as
    | { [field: string]: Express.Multer.File[] | undefined }
    | undefined;
  return files?.[field]?.[0]?.buffer;
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
    const imageBuffer = getFileBuffer(req, "image_file");
    const audioBuffer = getFileBuffer(req, "audio_file");
    if (audioBuffer && imageBuffer) {
      throw new ValidationError(
        "Send either an image or a voice note, not both.",
      );
    }
    if (audioBuffer && !input.durationMs) {
      throw new ValidationError("durationMs is required with audio_file.", {
        durationMs: "Required",
      });
    }
    if (!input.content && !imageBuffer && !audioBuffer) {
      throw new ValidationError(
        "Message must include text, an image, or a voice note.",
        { content: "Required when no media is sent" },
      );
    }
    const message = await adminDisputesService.postMessage(
      req.admin,
      id,
      input,
      { imageBuffer, audioBuffer },
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
