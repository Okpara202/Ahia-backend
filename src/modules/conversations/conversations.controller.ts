import type { Request, Response } from "express";
import { conversationsService } from "./conversations.service.js";
import {
  conversationIdParam,
  editTextSchema,
  messageIdParam,
  reactionSchema,
  readReceiptSchema,
  searchQuery,
  sendImageSchema,
  sendTextSchema,
  sendVoiceSchema,
  startConversationSchema,
} from "./conversations.schemas.js";
import { UnauthorizedError, ValidationError } from "../../errors.js";

function getFileBuffer(req: Request, field = "file"): Buffer | undefined {
  const single = req.file as Express.Multer.File | undefined;
  if (single) return single.buffer;
  const files = req.files as Express.Multer.File[] | Record<string, Express.Multer.File[]> | undefined;
  if (Array.isArray(files) && files[0]) return files[0].buffer;
  if (files && typeof files === "object" && !Array.isArray(files)) {
    const named = files[field];
    if (named && named[0]) return named[0].buffer;
  }
  return undefined;
}

export const conversationsController = {
  async start(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const input = startConversationSchema.parse(req.body);
    const result = await conversationsService.start(req.user.id, input);
    res.status(201).json(result);
  },

  async listMine(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const items = await conversationsService.listMine(req.user.id);
    res.status(200).json({ items });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const result = await conversationsService.getById(req.user.id, id);
    res.status(200).json(result);
  },

  async sendText(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const input = sendTextSchema.parse(req.body);
    const message = await conversationsService.sendText(req.user.id, id, input);
    res.status(201).json({ message });
  },

  async sendImage(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const input = sendImageSchema.parse(req.body);
    const buffer = getFileBuffer(req, "image_file");
    if (!buffer) {
      throw new ValidationError("Image file is required", { image_file: "Required" });
    }
    const message = await conversationsService.sendImage(req.user.id, id, buffer, input);
    res.status(201).json({ message });
  },

  async sendVoice(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const input = sendVoiceSchema.parse(req.body);
    const buffer = getFileBuffer(req, "audio_file");
    if (!buffer) {
      throw new ValidationError("Audio file is required", { audio_file: "Required" });
    }
    const message = await conversationsService.sendVoice(req.user.id, id, buffer, input);
    res.status(201).json({ message });
  },

  async editText(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id, messageId } = messageIdParam.parse(req.params);
    const input = editTextSchema.parse(req.body);
    const message = await conversationsService.editText(req.user.id, id, messageId, input);
    res.status(200).json({ message });
  },

  async reaction(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id, messageId } = messageIdParam.parse(req.params);
    const input = reactionSchema.parse(req.body);
    const result = await conversationsService.setReaction(req.user.id, id, messageId, input);
    res.status(200).json(result);
  },

  async markRead(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const input = readReceiptSchema.parse(req.body);
    const result = await conversationsService.markRead(req.user.id, id, input.throughMessageId);
    res.status(200).json(result);
  },

  async searchMessages(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { id } = conversationIdParam.parse(req.params);
    const { q } = searchQuery.parse(req.query);
    const matches = await conversationsService.searchMessages(req.user.id, id, q);
    res.status(200).json({ matches });
  },
};
