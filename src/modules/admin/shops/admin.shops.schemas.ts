import { z } from "zod";

export const listShopsQuery = z.object({
  q: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "deactivated", "demolished", "all"]).default("all"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const shopIdParam = z.object({
  id: z.string().uuid(),
});

export const deactivateShopSchema = z.object({
  reason: z
    .string()
    .min(20, "Reason must be at least 20 characters")
    .max(2000),
});

export const restoreShopSchema = z.object({
  reason: z
    .string()
    .min(20, "Reason must be at least 20 characters")
    .max(2000),
});

export type ListShopsQuery = z.infer<typeof listShopsQuery>;
export type DeactivateShopInput = z.infer<typeof deactivateShopSchema>;
export type RestoreShopInput = z.infer<typeof restoreShopSchema>;
