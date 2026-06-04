import { z } from "zod";

export const startConversationSchema = z
  .object({
    sellerId: z.string().uuid().optional(),
    buyerId: z.string().uuid().optional(),
    contextProductId: z.string().uuid().optional(),
  })
  .refine(
    (data) => Boolean(data.sellerId) !== Boolean(data.buyerId),
    { message: "Exactly one of sellerId or buyerId is required" },
  );

export const sendTextSchema = z.object({
  type: z.literal("text").optional(),
  content: z.string().min(1).max(4000),
  contextProductId: z.string().uuid().optional(),
  storyId: z.string().uuid().optional(),
});

export const sendImageSchema = z.object({
  caption: z.string().max(500).optional(),
  contextProductId: z.string().uuid().optional(),
});

export const sendVoiceSchema = z.object({
  durationMs: z.coerce.number().int().min(100).max(3 * 60 * 1000),
  contextProductId: z.string().uuid().optional(),
});

export const editTextSchema = z.object({
  content: z.string().min(1).max(4000),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});

export const readReceiptSchema = z.object({
  throughMessageId: z.string().uuid(),
});

export const conversationIdParam = z.object({
  id: z.string().uuid(),
});

export const messageIdParam = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const searchQuery = z.object({
  q: z.string().min(1).max(200),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type SendTextInput = z.infer<typeof sendTextSchema>;
export type SendImageInput = z.infer<typeof sendImageSchema>;
export type SendVoiceInput = z.infer<typeof sendVoiceSchema>;
export type EditTextInput = z.infer<typeof editTextSchema>;
export type ReactionInput = z.infer<typeof reactionSchema>;
export type ReadReceiptInput = z.infer<typeof readReceiptSchema>;
export type SearchQuery = z.infer<typeof searchQuery>;
