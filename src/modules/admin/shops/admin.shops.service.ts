import { AppError, NotFoundError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";
import { adminShopsRepo } from "./admin.shops.repo.js";
import type {
  DeactivateShopInput,
  ListShopsQuery,
  RestoreShopInput,
} from "./admin.shops.schemas.js";
import type { AdminUser } from "@prisma/client";

function statusOf(row: { deletedAt: Date | null; adminSuspendedAt: Date | null }) {
  if (row.deletedAt) return "demolished" as const;
  if (row.adminSuspendedAt) return "deactivated" as const;
  return "active" as const;
}

function publicListRow(row: Awaited<ReturnType<typeof adminShopsRepo.list>>[number]) {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    category: row.category,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    bannerUrl: row.bannerUrl,
    location: row.location,
    isActive: row.isActive,
    status: statusOf(row),
    // Public API uses the UX action verb "deactivate" to match the status
    // enum and the endpoint path; DB column stays admin_suspended_* for
    // historical reasons.
    deactivatedAt: row.adminSuspendedAt?.toISOString() ?? null,
    deactivatedReason: row.adminSuspendedReason,
    createdAt: row.createdAt.toISOString(),
    owner: row.owner,
  };
}

export const adminShopsService = {
  async list(query: ListShopsQuery) {
    const rows = await adminShopsRepo.list({
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

  async getById(shopId: string) {
    const row = await adminShopsRepo.findById(shopId);
    if (!row) throw new NotFoundError("Shop");
    return {
      id: row.id,
      name: row.name,
      handle: row.handle,
      category: row.category,
      bio: row.bio,
      avatarUrl: row.avatarUrl,
      bannerUrl: row.bannerUrl,
      location: row.location,
      isActive: row.isActive,
      showLegalName: row.showLegalName,
      status: statusOf(row),
      deactivatedAt: row.adminSuspendedAt?.toISOString() ?? null,
      deactivatedReason: row.adminSuspendedReason,
      deactivatedById: row.adminSuspendedById,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      owner: row.owner,
      counts: {
        products: row._count.products,
        followers: row._count.followers,
        discoverPosts: row._count.discoverPosts,
        stories: row._count.stories,
      },
    };
  },

  async deactivate(
    admin: AdminUser,
    shopId: string,
    input: DeactivateShopInput,
    ip?: string,
    userAgent?: string,
  ) {
    const existing = await adminShopsRepo.findById(shopId);
    if (!existing) throw new NotFoundError("Shop");
    if (existing.deletedAt) {
      throw new AppError(410, "shop_gone", "Shop has already been demolished.");
    }
    if (existing.adminSuspendedAt) {
      throw new AppError(
        409,
        "already_deactivated",
        "Shop is already deactivated.",
      );
    }

    await adminShopsRepo.deactivate({
      shopId,
      reason: input.reason,
      adminId: admin.id,
    });

    await writeAudit({
      adminId: admin.id,
      action: "deactivate_shop",
      targetType: "shop",
      targetId: shopId,
      reason: input.reason,
      ip,
      userAgent,
      metadata: { ownerId: existing.owner.id },
    });
  },

  async restore(
    admin: AdminUser,
    shopId: string,
    input: RestoreShopInput,
    ip?: string,
    userAgent?: string,
  ) {
    const existing = await adminShopsRepo.findById(shopId);
    if (!existing) throw new NotFoundError("Shop");
    if (existing.deletedAt) {
      throw new AppError(
        410,
        "shop_gone",
        "Shop has been permanently demolished and can't be restored.",
      );
    }
    if (!existing.adminSuspendedAt) {
      throw new AppError(
        409,
        "not_deactivated",
        "Shop is not currently deactivated.",
      );
    }

    await adminShopsRepo.restore(shopId);

    await writeAudit({
      adminId: admin.id,
      action: "restore_shop",
      targetType: "shop",
      targetId: shopId,
      reason: input.reason,
      ip,
      userAgent,
    });
  },
};
