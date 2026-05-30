import { z } from "zod";

export const transactionIdParam = z.object({
  id: z.string().uuid(),
});

export const referenceParam = z.object({
  reference: z.string().min(1),
});

export const listTransactionsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum([
      "pending",
      "held",
      "partial_released",
      "fully_released",
      "partial_refunded",
      "fully_refunded",
    ])
    .optional(),
});

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuery>;
