import { z } from "zod";

export const listUsersQuery = z.object({
  q: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "suspended", "all"]).default("all"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const userIdParam = z.object({
  id: z.string().uuid(),
});

export const suspendUserSchema = z.object({
  reason: z
    .string()
    .min(20, "Reason must be at least 20 characters")
    .max(2000),
});

export const restoreUserSchema = z.object({
  reason: z
    .string()
    .min(20, "Reason must be at least 20 characters")
    .max(2000),
});

export type ListUsersQuery = z.infer<typeof listUsersQuery>;
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;
export type RestoreUserInput = z.infer<typeof restoreUserSchema>;
