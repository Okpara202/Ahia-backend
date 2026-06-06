import { prisma } from "../../../config/db.js";
import type { Prisma } from "@prisma/client";

export const adminRepo = {
  findByEmail(email: string) {
    return prisma.adminUser.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.adminUser.findUnique({ where: { id } });
  },

  count() {
    return prisma.adminUser.count();
  },

  create(data: Prisma.AdminUserCreateInput) {
    return prisma.adminUser.create({ data });
  },

  update(id: string, data: Prisma.AdminUserUpdateInput) {
    return prisma.adminUser.update({ where: { id }, data });
  },

  // ----- 2FA secret -----

  setTotpSecret(id: string, secret: string) {
    return prisma.adminUser.update({
      where: { id },
      data: { totpSecret: secret, totpEnabled: false },
    });
  },

  enableTotp(id: string) {
    return prisma.adminUser.update({
      where: { id },
      data: { totpEnabled: true },
    });
  },

  // ----- Backup codes -----

  replaceBackupCodes(adminId: string, hashes: string[]) {
    return prisma.$transaction([
      prisma.adminBackupCode.deleteMany({ where: { adminId } }),
      prisma.adminBackupCode.createMany({
        data: hashes.map((codeHash) => ({ adminId, codeHash })),
      }),
    ]);
  },

  listUnusedBackupCodes(adminId: string) {
    return prisma.adminBackupCode.findMany({
      where: { adminId, usedAt: null },
    });
  },

  markBackupCodeUsed(id: string) {
    return prisma.adminBackupCode.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  },

  countRemainingBackupCodes(adminId: string) {
    return prisma.adminBackupCode.count({
      where: { adminId, usedAt: null },
    });
  },

  // ----- Sessions -----

  createSession(args: {
    adminId: string;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
  }) {
    return prisma.adminSession.create({
      data: {
        adminId: args.adminId,
        expiresAt: args.expiresAt,
        createdIp: args.ip,
        createdUserAgent: args.userAgent,
      },
    });
  },

  findActiveSession(id: string) {
    return prisma.adminSession.findFirst({
      where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { admin: true },
    });
  },

  touchSession(id: string, expiresAt: Date) {
    return prisma.adminSession.update({
      where: { id },
      data: { lastUsedAt: new Date(), expiresAt },
    });
  },

  revokeSession(args: {
    id: string;
    reason: "logout" | "suspended" | "manual" | "expired";
    revokedById?: string;
  }) {
    return prisma.adminSession.update({
      where: { id: args.id },
      data: {
        revokedAt: new Date(),
        revokedReason: args.reason,
        revokedById: args.revokedById,
      },
    });
  },

  revokeAllForAdmin(args: {
    adminId: string;
    reason: "suspended" | "manual";
    revokedById?: string;
  }) {
    return prisma.adminSession.updateMany({
      where: { adminId: args.adminId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: args.reason,
        revokedById: args.revokedById,
      },
    });
  },
};
