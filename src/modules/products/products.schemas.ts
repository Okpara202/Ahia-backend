import { z } from "zod";

export const listProductsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  category: z.string().optional(),
  location: z.string().optional(),
  q: z.string().optional(),
});

export const productIdParam = z.object({
  id: z.string().uuid(),
});

const stringNumber = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a number" });
      return z.NEVER;
    }
    return n;
  });

const imageUrlsField = z
  .union([
    z.array(z.string().url()),
    z.string().url().transform((s) => [s]),
  ])
  .optional()
  .default([]);

export const createProductSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().min(2).max(2000),
  price: stringNumber.refine((n) => n > 0, "Must be positive"),
  category: z.string().min(1).max(80),
  cover_index: z.coerce.number().int().min(0).optional().default(0),
  image_urls: imageUrlsField,
});

export const updateProductSchema = createProductSchema.partial();

export const visibilitySchema = z.object({
  hidden: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true")),
});

export type ListProductsQuery = z.infer<typeof listProductsQuery>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type VisibilityInput = z.infer<typeof visibilitySchema>;
