import bcrypt from "bcrypt";
import { AppError, ConflictError, NotFoundError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";
import { adminRepo } from "../auth/admin.repo.js";
import { adminsRepo } from "./admin.admins.repo.js";
import type {
  ChangeRoleInput,
  CreateAdminInput,
  ListAdminsQuery,
  Reset2faInput,
  RestoreAdminInput,
  SuspendAdminInput,
} from "./admin.admins.schemas.js";
import type { AdminUser } from "@prisma/client";

const BCRYPT_ROUNDS = 12;

function publicAdmin(a: Awaited<ReturnType<typeof adminsRepo.findById>>) {
  if (!a) return null;
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    role: a.role,
    status: a.status,
    totpEnabled: a.totpEnabled,
    suspendedAt: a.suspendedAt?.toISOString() ?? null,
    suspendedReason: a.suspendedReason,
    suspendedById: a.suspendedById,
    lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
    createdById: a.createdById,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

async function assertNotLastSuperAdmin(targetId: string) {
  const target = await adminsRepo.findById(targetId);
  if (!target) throw new NotFoundError("Admin");
  if (target.role !== "super_admin" || target.status !== "active") return;
  const count = await adminsRepo.countActiveSuperAdmins();
  if (count <= 1) {
    throw new AppError(
      409,
      "last_super_admin",
      "Cannot perform this action — at least one active super_admin must remain.",
    );
  }
}

export const adminsService = {
  async list(query: ListAdminsQuery) {
    const rows = await adminsRepo.list({
      q: query.q,
      role: query.role,
      status: query.status,
      take: query.limit,
      cursor: query.cursor,
    });
    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;
    return {
      items: slice.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        role: a.role,
        status: a.status,
        totpEnabled: a.totpEnabled,
        suspendedAt: a.suspendedAt?.toISOString() ?? null,
        suspendedReason: a.suspendedReason,
        suspendedById: a.suspendedById,
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      nextCursor,
    };
  },

  async getById(id: string) {
    const row = await adminsRepo.findById(id);
    if (!row) throw new NotFoundError("Admin");
    return publicAdmin(row);
  },

  async invite(actor: AdminUser, input: CreateAdminInput, ip?: string, userAgent?: string) {
    const normalizedEmail = input.email.toLowerCase().trim();
    const existing = await adminRepo.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictError(
        "admin_exists",
        "An admin with that email already exists.",
        { email: "Already in use" },
      );
    }
    const passwordHash = await bcrypt.hash(input.initialPassword, BCRYPT_ROUNDS);
    const created = await adminsRepo.create({
      email: normalizedEmail,
      passwordHash,
      name: input.name,
      role: input.role,
      createdBy: { connect: { id: actor.id } },
    });

    await writeAudit({
      adminId: actor.id,
      action: "create_admin",
      targetType: "admin",
      targetId: created.id,
      ip,
      userAgent,
      metadata: { role: input.role, email: normalizedEmail },
    });

    return publicAdmin(await adminsRepo.findById(created.id));
  },

  async suspend(
    actor: AdminUser,
    targetId: string,
    input: SuspendAdminInput,
    ip?: string,
    userAgent?: string,
  ) {
    if (targetId === actor.id) {
      throw new AppError(409, "self_target", "You can't suspend yourself.");
    }
    const target = await adminsRepo.findById(targetId);
    if (!target) throw new NotFoundError("Admin");
    if (target.status === "suspended") {
      throw new AppError(409, "already_suspended", "Admin is already suspended.");
    }
    await assertNotLastSuperAdmin(targetId);

    await adminsRepo.update(targetId, {
      status: "suspended",
      suspendedAt: new Date(),
      suspendedReason: input.reason,
      suspendedBy: { connect: { id: actor.id } },
    });

    // Revoke ALL sessions so they're kicked out of every device on next request.
    await adminRepo.revokeAllForAdmin({
      adminId: targetId,
      reason: "suspended",
      revokedById: actor.id,
    });

    await writeAudit({
      adminId: actor.id,
      action: "suspend_admin",
      targetType: "admin",
      targetId,
      reason: input.reason,
      ip,
      userAgent,
    });
  },

  async restore(
    actor: AdminUser,
    targetId: string,
    input: RestoreAdminInput,
    ip?: string,
    userAgent?: string,
  ) {
    const target = await adminsRepo.findById(targetId);
    if (!target) throw new NotFoundError("Admin");
    if (target.status !== "suspended") {
      throw new AppError(409, "not_suspended", "Admin is not suspended.");
    }
    await adminsRepo.update(targetId, {
      status: "active",
      suspendedAt: null,
      suspendedReason: null,
      suspendedBy: { disconnect: true },
    });

    await writeAudit({
      adminId: actor.id,
      action: "restore_admin",
      targetType: "admin",
      targetId,
      reason: input.reason,
      ip,
      userAgent,
    });
  },

  async changeRole(
    actor: AdminUser,
    targetId: string,
    input: ChangeRoleInput,
    ip?: string,
    userAgent?: string,
  ) {
    if (targetId === actor.id) {
      throw new AppError(
        409,
        "self_target",
        "You can't change your own role.",
      );
    }
    const target = await adminsRepo.findById(targetId);
    if (!target) throw new NotFoundError("Admin");
    if (target.role === input.role) {
      throw new AppError(409, "role_unchanged", `Admin is already ${input.role}.`);
    }
    // Demoting a super_admin? Make sure we'd still have at least one left.
    if (target.role === "super_admin" && input.role !== "super_admin") {
      await assertNotLastSuperAdmin(targetId);
    }

    await adminsRepo.update(targetId, { role: input.role });

    await writeAudit({
      adminId: actor.id,
      action: target.role === "super_admin" ? "demote_admin" : "promote_admin",
      targetType: "admin",
      targetId,
      reason: input.reason,
      ip,
      userAgent,
      metadata: { from: target.role, to: input.role },
    });
  },

  async reset2fa(
    actor: AdminUser,
    targetId: string,
    input: Reset2faInput,
    ip?: string,
    userAgent?: string,
  ) {
    const target = await adminsRepo.findById(targetId);
    if (!target) throw new NotFoundError("Admin");
    if (!target.totpEnabled) {
      throw new AppError(
        409,
        "totp_not_enabled",
        "Admin has not completed 2FA setup yet — nothing to reset.",
      );
    }
    await adminsRepo.reset2fa(targetId);
    // Kick any active sessions — they can't keep using the app without 2FA.
    await adminRepo.revokeAllForAdmin({
      adminId: targetId,
      reason: "manual",
      revokedById: actor.id,
    });

    await writeAudit({
      adminId: actor.id,
      action: "reset_admin_2fa",
      targetType: "admin",
      targetId,
      reason: input.reason,
      ip,
      userAgent,
    });
  },
};
