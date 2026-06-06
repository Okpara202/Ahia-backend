import bcrypt from "bcrypt";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { adminRepo } from "../modules/admin/auth/admin.repo.js";

/**
 * Runs on every app boot. If ADMIN_BOOTSTRAP_EMAIL + ADMIN_BOOTSTRAP_PASSWORD
 * are set AND no admin row exists for that email, creates a `super_admin` row.
 * After first login the operator should REMOVE both env vars on the next
 * deploy — the row exists, the bootstrap is a no-op, and the env vars sitting
 * in Render's config are an unnecessary attack surface.
 */
export async function bootstrapSuperAdminIfNeeded(): Promise<void> {
  const email = env.ADMIN_BOOTSTRAP_EMAIL;
  const password = env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) return;

  const normalized = email.toLowerCase().trim();
  const existing = await adminRepo.findByEmail(normalized);
  if (existing) {
    logger.info("bootstrap: super admin already exists, skipping", {
      adminId: existing.id,
    });
    return;
  }

  const totalAdmins = await adminRepo.count();
  if (totalAdmins > 0) {
    // Don't auto-create another super_admin just because the env var was
    // pointing at a different email. If the operator wants this email as
    // an admin, an existing super_admin should invite them through the UI.
    logger.warn(
      "bootstrap: env var points at a new admin but admins already exist — skipping",
      { email: normalized },
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const created = await adminRepo.create({
    email: normalized,
    passwordHash,
    name: "Super Admin",
    role: "super_admin",
  });
  logger.warn(
    "bootstrap: created super_admin from env vars. ROTATE PASSWORD AND REMOVE ENV ON NEXT DEPLOY.",
    { adminId: created.id, email: normalized },
  );
}
