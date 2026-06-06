import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { ForbiddenError, UnauthorizedError } from "../errors.js";
import { adminRepo } from "../modules/admin/auth/admin.repo.js";
import { adminAuthService } from "../modules/admin/auth/admin.service.js";
import type { AdminRole, AdminUser } from "@prisma/client";

declare module "express-serve-static-core" {
  interface Request {
    admin?: AdminUser;
    adminSessionId?: string;
  }
}

const RANK: Record<AdminRole, number> = {
  admin: 1,
  super_admin: 2,
};

export function requireAdmin(minRole: AdminRole = "admin") {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const sessionId = req.cookies?.[env.ADMIN_COOKIE_NAME] as string | undefined;
    if (!sessionId) throw new UnauthorizedError("Admin session required");

    const session = await adminRepo.findActiveSession(sessionId);
    if (!session) throw new UnauthorizedError("Admin session expired");
    if (session.admin.status === "suspended") {
      throw new ForbiddenError("Admin account suspended");
    }
    if (!session.admin.totpEnabled) {
      throw new ForbiddenError("Complete 2FA setup to continue");
    }
    if (RANK[session.admin.role] < RANK[minRole]) {
      throw new ForbiddenError("Insufficient admin role");
    }

    // Sliding refresh — fire-and-forget so the request doesn't wait on it.
    void adminAuthService.refreshSession(sessionId);

    req.admin = session.admin;
    req.adminSessionId = sessionId;
    next();
  };
}
