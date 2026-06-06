import { z } from "zod";

const REASON = z
  .string()
  .min(20, "Reason must be at least 20 characters")
  .max(2000);

// Relaxed so super_admin can pick a short temp password they'll share
// out-of-band. The new admin should change it immediately via
// POST /admin/auth/change-password (which enforces the strict policy).
const INITIAL_PASSWORD = z.string().min(6).max(256);

export const listAdminsQuery = z.object({
  q: z.string().min(1).max(200).optional(),
  role: z.enum(["admin", "super_admin", "all"]).default("all"),
  status: z.enum(["active", "suspended", "all"]).default("all"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const adminIdParam = z.object({
  id: z.string().uuid(),
});

export const createAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(["admin", "super_admin"]).default("admin"),
  initialPassword: INITIAL_PASSWORD,
});

export const suspendAdminSchema = z.object({ reason: REASON });
export const restoreAdminSchema = z.object({ reason: REASON });

export const changeRoleSchema = z.object({
  role: z.enum(["admin", "super_admin"]),
  reason: REASON,
});

export const reset2faSchema = z.object({ reason: REASON });

export type ListAdminsQuery = z.infer<typeof listAdminsQuery>;
export type CreateAdminInput = z.infer<typeof createAdminSchema>;
export type SuspendAdminInput = z.infer<typeof suspendAdminSchema>;
export type RestoreAdminInput = z.infer<typeof restoreAdminSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
export type Reset2faInput = z.infer<typeof reset2faSchema>;
