import { z } from "zod";

export const shopIdParam = z.object({
  id: z.string().uuid(),
});

export const createStorySchema = z.object({
  durationMs: z.coerce
    .number()
    .int()
    .min(1000)
    .max(15000)
    .optional()
    .default(5000),
});

export type CreateStoryInput = z.infer<typeof createStorySchema>;
