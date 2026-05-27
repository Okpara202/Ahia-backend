import { z } from "zod";

export const addToWishlistSchema = z.object({
  productId: z.string().uuid(),
});

export const productIdParam = z.object({
  productId: z.string().uuid(),
});
