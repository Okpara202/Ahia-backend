import { prisma } from "../../../config/db.js";
import type { AdminRole, AdminStatus, Prisma } from "@prisma/client";

const listSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  totpEnabled: true,
  suspendedAt: true,
  suspendedReason: true,
  suspendedById: true,
  lastLoginAt: true,
  createdById: true,
  createdAt: true,
} satisfies Prisma.AdminUserSelect;

export const adminsRepo = {
  list(args: {
    q?: string;
    role: "admin" | "super_admin" | "all";
    status: "active" | "suspended" | "all";
    take: number;
    cursor?: string;
  }) {
    const where: Prisma.AdminUserWhereInput = {};
    if (args.role !== "all") where.role = args.role as AdminRole;
    if (args.status !== "all") where.status = args.status as AdminStatus;
    if (args.q) {
      where.OR = [
        { email: { contains: args.q, mode: "insensitive" } },
        { name: { contains: args.q, mode: "insensitive" } },
      ];
    }
    return prisma.adminUser.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: args.take + 1,
      cursor: args.cursor ? { id: args.cursor } : undefined,
      skip: args.cursor ? 1 : 0,
      select: listSelect,
    });
  },

  findById(id: string) {
    return prisma.adminUser.findUnique({
      where: { id },
      select: {
        ...listSelect,
        updatedAt: true,
      },
    });
  },

  countActiveSuperAdmins() {
    return prisma.adminUser.count({
      where: { role: "super_admin", status: "active" },
    });
  },

  create(data: Prisma.AdminUserCreateInput) {
    return prisma.adminUser.create({ data, select: listSelect });
  },

  update(id: string, data: Prisma.AdminUserUpdateInput) {
    return prisma.adminUser.update({ where: { id }, data, select: listSelect });
  },

  // Wipe TOTP entirely so the admin goes through 2FA setup on next login.
  // Also clears backup codes so a leaked code can't bypass the re-setup.
  reset2fa(adminId: string) {
    return prisma.$transaction([
      prisma.adminUser.update({
        where: { id: adminId },
        data: { totpEnabled: false, totpSecret: null },
        select: listSelect,
      }),
      prisma.adminBackupCode.deleteMany({ where: { adminId } }),
    ]);
  },
};
