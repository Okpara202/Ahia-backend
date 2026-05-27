import { z } from "zod";

export const initTransactionSchema = z.object({
  productId: z.string().uuid(),
  callbackUrl: z.string().url().optional(),
});

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
    .enum(["held", "released", "disputed", "refunded", "cancelled"])
    .optional(),
});

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuery>;
export type InitTransactionInput = z.infer<typeof initTransactionSchema>;
