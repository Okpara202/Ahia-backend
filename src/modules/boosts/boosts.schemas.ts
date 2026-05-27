import { z } from "zod";

export const buyBoostSchema = z.object({
  productId: z.string().uuid(),
  plan: z.enum(["monthly", "quarterly", "biannual"]),
  callbackUrl: z.string().url().optional(),
});

export type BuyBoostInput = z.infer<typeof buyBoostSchema>;
