import { z } from "zod";

export const openDisputeSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().min(10).max(2000),
});

export const resolveDisputeSchema = z.object({
  resolution: z.enum(["resolved_buyer", "resolved_seller", "cancelled"]),
  note: z.string().max(2000).optional(),
});

export const disputeIdParam = z.object({
  id: z.string().uuid(),
});

export const listDisputesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum(["open", "resolved_buyer", "resolved_seller", "cancelled"])
    .optional(),
});

export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
export type ListDisputesQuery = z.infer<typeof listDisputesQuery>;
