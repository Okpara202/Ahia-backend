import { z } from "zod";

export const resolveDisputeSchema = z.object({
  resolution: z.enum(["refunded_to_buyer", "released_to_seller"]),
  note: z.string().max(2000).optional(),
});

export const disputeIdParam = z.object({
  id: z.string().uuid(),
});

export const listDisputesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["open", "reviewing", "resolved"]).optional(),
});

export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
export type ListDisputesQuery = z.infer<typeof listDisputesQuery>;
