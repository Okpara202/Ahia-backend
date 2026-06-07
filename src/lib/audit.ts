import type { Request } from "express";
import { prisma } from "../config/db.js";
import { logger } from "../config/logger.js";

export type AuditAction =
  | "login"
  | "login_failed"
  | "logout"
  | "read_dispute_messages"
  | "post_admin_message"
  | "resolve_dispute"
  | "auto_resolve_dispute"
  | "suspend_user"
  | "restore_user"
  | "deactivate_shop"
  | "restore_shop"
  | "create_admin"
  | "suspend_admin"
  | "restore_admin"
  | "promote_admin"
  | "demote_admin"
  | "reset_admin_2fa"
  | "change_admin_password";

export type AuditTargetType =
  | "admin"
  | "dispute"
  | "user"
  | "shop"
  | "auth"
  | "session";

type WriteArgs = {
  adminId: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
};

export async function writeAudit(args: WriteArgs): Promise<void> {
  try {
    await prisma.adminAction.create({
      data: {
        adminId: args.adminId,
        action: args.action,
        targetType: args.targetType,
        targetId: args.targetId,
        reason: args.reason,
        metadata: args.metadata as object | undefined,
        ipAddress: args.ip ?? null,
        userAgent: args.userAgent ?? null,
      },
    });
  } catch (err) {
    // Audit writes must not break the request — log and swallow.
    logger.error("audit: write failed", {
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function ipFromRequest(req: Request): string | undefined {
  // trust proxy is on (Render), so req.ip respects X-Forwarded-For
  return req.ip ?? undefined;
}

export function uaFromRequest(req: Request): string | undefined {
  const raw = req.header("user-agent");
  if (!raw) return undefined;
  return raw.slice(0, 500);
}
