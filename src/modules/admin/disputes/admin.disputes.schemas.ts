import { z } from "zod";

export const listDisputesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["open", "reviewing", "resolved", "all"]).default("open"),
  sort: z
    .enum(["oldest", "newest", "amount_desc", "amount_asc"])
    .default("oldest"),
});

export const disputeIdParam = z.object({
  id: z.string().uuid(),
});

export const resolveDisputeSchema = z.object({
  resolution: z.enum(["refunded", "released"]),
  note: z
    .string()
    .min(20, "Resolution note must be at least 20 characters")
    .max(2000),
});

export const postAdminMessageSchema = z.object({
  content: z.string().max(4000).optional(),
});

export type ListDisputesQuery = z.infer<typeof listDisputesQuery>;
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
export type PostAdminMessageInput = z.infer<typeof postAdminMessageSchema>;
