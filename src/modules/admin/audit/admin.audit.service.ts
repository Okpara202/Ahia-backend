import { auditRepo } from "./admin.audit.repo.js";
import type { ListAuditQuery } from "./admin.audit.schemas.js";
import type { AdminUser, Prisma } from "@prisma/client";

export const auditService = {
  async list(actor: AdminUser, query: ListAuditQuery) {
    const where: Prisma.AdminActionWhereInput = {};
    // Permission: regular admins ONLY see their own actions. Super-admin
    // sees everyone's. A regular admin trying to pass `adminId` for someone
    // else is silently scoped to themselves (no error — just no leak).
    if (actor.role !== "super_admin") {
      where.adminId = actor.id;
    } else if (query.adminId) {
      where.adminId = query.adminId;
    }
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = query.from;
      if (query.to) where.createdAt.lte = query.to;
    }

    const rows = await auditRepo.list({
      where,
      take: query.limit,
      cursor: query.cursor,
    });
    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

    return {
      items: slice.map((row) => ({
        id: row.id,
        adminId: row.adminId,
        admin: row.admin
          ? {
              id: row.admin.id,
              name: row.admin.name,
              email: row.admin.email,
              role: row.admin.role,
            }
          : null,
        // adminId NULL = system action (e.g., auto_resolve_dispute cron)
        actor: row.admin ? row.admin.name : "system",
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor,
    };
  },
};
