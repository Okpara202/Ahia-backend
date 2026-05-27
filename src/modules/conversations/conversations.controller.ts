import type { Request, Response } from "express";
import { conversationsService } from "./conversations.service.js";
import {
  conversationIdParam,
  listMessagesQuery,
  offerMessageIdParam,
  resolveOfferSchema,
  sendImageSchema,
  sendOfferSchema,
  sendTextSchema,
  startConversationSchema,
} from "./conversations.schemas.js";
import { UnauthorizedError, ValidationError } from "../../errors.js";

function getFileBuffer(req: Request): Buffer | undefined {
  return (req.file as Express.Multer.File | undefined)?.buffer;
}

export const conversationsController = {
  async start(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = startConversationSchema.parse(req.body);
    const conversation = await conversationsService.start(req.user.id, input);
    res.status(201).json({ conversation });
  },

  async listMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const items = await conversationsService.listMine(req.user.id);
    res.status(200).json({ items });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const conversation = await conversationsService.getById(req.user.id, id);
    res.status(200).json({ conversation });
  },

  async listMessages(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const query = listMessagesQuery.parse(req.query);
    const result = await conversationsService.listMessages(req.user.id, id, query);
    res.status(200).json(result);
  },

  async sendText(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const { body } = sendTextSchema.parse(req.body);
    const message = await conversationsService.sendText(req.user.id, id, body);
    res.status(201).json({ message });
  },

  async sendImage(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const { caption } = sendImageSchema.parse(req.body);
    const buffer = getFileBuffer(req);
    if (!buffer) {
      throw new ValidationError("Image file is required", { image: "Required" });
    }
    const message = await conversationsService.sendImage(req.user.id, id, buffer, caption);
    res.status(201).json({ message });
  },

  async sendOffer(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const { amount, note } = sendOfferSchema.parse(req.body);
    const message = await conversationsService.sendOffer(req.user.id, id, amount, note);
    res.status(201).json({ message });
  },

  async resolveOffer(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id, messageId } = offerMessageIdParam.parse(req.params);
    const { status } = resolveOfferSchema.parse(req.body);
    const result = await conversationsService.resolveOffer(req.user.id, id, messageId, status);
    res.status(200).json(result);
  },
};
