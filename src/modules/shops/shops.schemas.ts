import { z } from "zod";

const HANDLE_REGEX = /^[a-z0-9][a-z0-9._-]{1,30}$/;

const stringBool = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => (typeof v === "boolean" ? v : v === "true"));

export const createShopSchema = z.object({
  name: z.string().min(2, "Shop name is required").max(80),
  handle: z
    .string()
    .toLowerCase()
    .regex(HANDLE_REGEX, "Use lowercase letters, numbers, dots, dashes."),
  category: z.string().min(1).max(80),
  bio: z.string().max(500).optional(),
  location: z.string().max(80).optional(),
  showLegalName: stringBool.optional(),
});

export const updateShopSchema = createShopSchema.partial().extend({
  isActive: stringBool.optional(),
});

export const shopIdParam = z.object({
  id: z.string().uuid(),
});

export const listShopProductsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export type CreateShopInput = z.infer<typeof createShopSchema>;
export type UpdateShopInput = z.infer<typeof updateShopSchema>;
export type ListShopProductsQuery = z.infer<typeof listShopProductsQuery>;
