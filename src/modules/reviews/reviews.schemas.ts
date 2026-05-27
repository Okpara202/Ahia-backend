import { z } from "zod";

export const createReviewSchema = z.object({
  transactionId: z.string().uuid(),
  productId: z.string().uuid(),
  shopId: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  body: z.string().max(2000).optional(),
});

export const productIdParam = z.object({
  id: z.string().uuid(),
});

export const shopIdParam = z.object({
  id: z.string().uuid(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
