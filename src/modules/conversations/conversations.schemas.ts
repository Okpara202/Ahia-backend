import { z } from "zod";

export const startConversationSchema = z
  .object({
    productId: z.string().uuid().optional(),
    shopId: z.string().uuid().optional(),
  })
  .refine((data) => !!data.productId || !!data.shopId, {
    message: "Either productId or shopId is required",
  });

export const sendTextSchema = z.object({
  body: z.string().min(1).max(4000),
});

export const sendImageSchema = z.object({
  caption: z.string().max(500).optional(),
});

const positiveNumber = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (Number.isNaN(n) || n <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be a positive number",
      });
      return z.NEVER;
    }
    return n;
  });

export const sendOfferSchema = z.object({
  amount: positiveNumber,
  note: z.string().max(500).optional(),
});

export const resolveOfferSchema = z.object({
  status: z.enum(["accepted", "declined"]),
});

export const conversationIdParam = z.object({
  id: z.string().uuid(),
});

export const offerMessageIdParam = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const listMessagesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;
