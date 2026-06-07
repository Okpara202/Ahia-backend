import { AppError, NotFoundError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";
import { adminUsersRepo } from "./admin.users.repo.js";
import type {
  ListUsersQuery,
  RestoreUserInput,
  SuspendUserInput,
} from "./admin.users.schemas.js";
import type { AdminUser } from "@prisma/client";

function publicListRow(row: Awaited<ReturnType<typeof adminUsersRepo.list>>[number]) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatarUrl,
    status: row.status,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspendedReason: row.suspendedReason,
    createdAt: row.createdAt.toISOString(),
    shops: row.shops.map((s) => ({
      id: s.id,
      name: s.name,
      handle: s.handle,
      isActive: s.isActive,
      deactivated: s.adminSuspendedAt !== null,
    })),
  };
}

export const adminUsersService = {
  async list(query: ListUsersQuery) {
    const rows = await adminUsersRepo.list({
      q: query.q,
      status: query.status,
      take: query.limit,
      cursor: query.cursor,
    });
    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;
    return { items: slice.map(publicListRow), nextCursor };
  },

  async getById(userId: string) {
    const row = await adminUsersRepo.findById(userId);
    if (!row) throw new NotFoundError("User");
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatarUrl: row.avatarUrl,
      status: row.status,
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      suspendedReason: row.suspendedReason,
      suspendedById: row.suspendedById,
      owedBalance: Number(row.owedBalance),
      allowsColdDMs: row.allowsColdDMs,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      shops: row.shops.map((s) => ({
        id: s.id,
        name: s.name,
        handle: s.handle,
        isActive: s.isActive,
        deactivated: s.adminSuspendedAt !== null,
      })),
      counts: {
        buyerConversations: row._count.buyerConversations,
        sellerConversations: row._count.sellerConversations,
        disputesRaised: row._count.disputesRaised,
        invoicesAsBuyer: row._count.invoicesAsBuyer,
        invoicesAsSeller: row._count.invoicesAsSeller,
        shops: row._count.shops,
      },
    };
  },

  async suspend(
    admin: AdminUser,
    userId: string,
    input: SuspendUserInput,
    ip?: string,
    userAgent?: string,
  ) {
    const existing = await adminUsersRepo.findById(userId);
    if (!existing) throw new NotFoundError("User");
    if (existing.status === "suspended") {
      throw new AppError(409, "already_suspended", "User is already suspended.");
    }

    const updated = await adminUsersRepo.suspend({
      userId,
      reason: input.reason,
      suspendedById: admin.id,
    });

    await writeAudit({
      adminId: admin.id,
      action: "suspend_user",
      targetType: "user",
      targetId: userId,
      reason: input.reason,
      ip,
      userAgent,
      metadata: {
        suspendedShops: existing.shops.filter((s) => !s.adminSuspendedAt).length,
      },
    });

    return updated;
  },

  async restore(
    admin: AdminUser,
    userId: string,
    input: RestoreUserInput,
    ip?: string,
    userAgent?: string,
  ) {
    const existing = await adminUsersRepo.findById(userId);
    if (!existing) throw new NotFoundError("User");
    if (existing.status !== "suspended") {
      throw new AppError(409, "not_suspended", "User is not currently suspended.");
    }

    const updated = await adminUsersRepo.restore(userId);

    await writeAudit({
      adminId: admin.id,
      action: "restore_user",
      targetType: "user",
      targetId: userId,
      reason: input.reason,
      ip,
      userAgent,
    });

    return updated;
  },
};
