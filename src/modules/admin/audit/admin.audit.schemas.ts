import { z } from "zod";

export const listAuditQuery = z.object({
  adminId: z.string().uuid().optional(),
  action: z.string().min(1).max(64).optional(),
  targetType: z.enum(["admin", "dispute", "user", "shop", "auth", "session"]).optional(),
  targetId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListAuditQuery = z.infer<typeof listAuditQuery>;
