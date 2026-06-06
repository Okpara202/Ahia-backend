import bcrypt from "bcrypt";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env.js";
import { AppError } from "../../../errors.js";
import { totp } from "../../../integrations/totp.js";
import { writeAudit, type AuditAction } from "../../../lib/audit.js";
import { adminRepo } from "./admin.repo.js";
import type {
  ChangePasswordInput,
  LoginInput,
  TwoFactorSetupVerifyInput,
  TwoFactorVerifyInput,
} from "./admin.schemas.js";
import type { AdminRole, AdminUser } from "@prisma/client";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_SLIDING_MS = 60 * 60 * 1000;
const SETUP_TOKEN_TTL_S = 10 * 60;
const LOGIN_CHALLENGE_TTL_S = 5 * 60;
const BCRYPT_ROUNDS = 12;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 5; // 10 hex chars

type Stage = "setup" | "challenge";

type StageToken = {
  stage: Stage;
  sub: string; // admin id
};

function signStageToken(payload: StageToken, ttlSeconds: number): string {
  const secret = env.ADMIN_COOKIE_SECRET ?? env.JWT_SECRET;
  return jwt.sign(payload, secret, { expiresIn: ttlSeconds });
}

function verifyStageToken(token: string, stage: Stage): StageToken {
  const secret = env.ADMIN_COOKIE_SECRET ?? env.JWT_SECRET;
  try {
    const decoded = jwt.verify(token, secret) as StageToken;
    if (decoded.stage !== stage) {
      throw new AppError(401, "invalid_token", "Stage token does not match");
    }
    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, "invalid_token", "Invalid or expired token");
  }
}

function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    codes.push(crypto.randomBytes(BACKUP_CODE_BYTES).toString("hex"));
  }
  return codes;
}

async function logAudit(
  adminId: string | null,
  action: AuditAction,
  ip?: string,
  userAgent?: string,
  metadata?: Record<string, unknown>,
) {
  await writeAudit({
    adminId,
    action,
    targetType: action === "login" || action === "login_failed" || action === "logout"
      ? "auth"
      : "admin",
    targetId: adminId ?? "00000000-0000-0000-0000-000000000000",
    ip,
    userAgent,
    metadata,
  });
}

export type LoginResult =
  | { next: "2fa_setup"; setupToken: string }
  | { next: "2fa_verify"; loginChallenge: string };

export const adminAuthService = {
  async login(
    input: LoginInput,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const admin = await adminRepo.findByEmail(normalizedEmail);
    if (!admin) {
      await logAudit(null, "login_failed", ip, userAgent, {
        email: normalizedEmail,
        reason: "unknown_email",
      });
      throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    if (admin.status === "suspended") {
      await logAudit(admin.id, "login_failed", ip, userAgent, {
        reason: "account_suspended",
      });
      throw new AppError(
        403,
        "account_suspended",
        admin.suspendedReason ?? "This admin account has been suspended.",
      );
    }
    const ok = await bcrypt.compare(input.password, admin.passwordHash);
    if (!ok) {
      await logAudit(admin.id, "login_failed", ip, userAgent, {
        reason: "wrong_password",
      });
      throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
    }

    if (!admin.totpEnabled) {
      return {
        next: "2fa_setup",
        setupToken: signStageToken({ stage: "setup", sub: admin.id }, SETUP_TOKEN_TTL_S),
      };
    }

    return {
      next: "2fa_verify",
      loginChallenge: signStageToken(
        { stage: "challenge", sub: admin.id },
        LOGIN_CHALLENGE_TTL_S,
      ),
    };
  },

  async startTwoFactorSetup(setupToken: string) {
    const { sub: adminId } = verifyStageToken(setupToken, "setup");
    const admin = await adminRepo.findById(adminId);
    if (!admin) throw new AppError(401, "invalid_token", "Admin not found.");
    if (admin.totpEnabled) {
      throw new AppError(409, "totp_already_enabled", "2FA is already set up.");
    }
    const secret = totp.generateSecret();
    await adminRepo.setTotpSecret(adminId, secret);
    const otpauth = totp.buildOtpAuthUrl(admin.email, secret);
    const qrDataUrl = await totp.qrDataUrl(otpauth);
    return { secret, qrDataUrl, otpauth };
  },

  async completeTwoFactorSetup(
    input: TwoFactorSetupVerifyInput,
    ip?: string,
    userAgent?: string,
  ) {
    const { sub: adminId } = verifyStageToken(input.setupToken, "setup");
    const admin = await adminRepo.findById(adminId);
    if (!admin || !admin.totpSecret) {
      throw new AppError(400, "totp_setup_missing", "Start 2FA setup before verifying.");
    }
    if (!(await totp.verify(input.totpCode, admin.totpSecret))) {
      throw new AppError(401, "invalid_totp", "Code didn't match. Try again.");
    }
    const plainCodes = generateBackupCodes();
    const hashes = await Promise.all(
      plainCodes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS)),
    );
    await adminRepo.replaceBackupCodes(adminId, hashes);
    await adminRepo.enableTotp(adminId);
    await logAudit(adminId, "login", ip, userAgent, { firstLogin: true });
    // Caller is expected to issue a session now (controller does this).
    return { adminId, backupCodes: plainCodes };
  },

  async verifyTwoFactor(
    input: TwoFactorVerifyInput,
    ip?: string,
    userAgent?: string,
  ) {
    const { sub: adminId } = verifyStageToken(input.loginChallenge, "challenge");
    const admin = await adminRepo.findById(adminId);
    if (!admin || !admin.totpEnabled || !admin.totpSecret) {
      throw new AppError(401, "totp_not_enabled", "2FA is not set up for this account.");
    }

    let backupCodesRemaining: number | null = null;

    if (input.totpCode) {
      if (!(await totp.verify(input.totpCode, admin.totpSecret))) {
        await logAudit(adminId, "login_failed", ip, userAgent, {
          reason: "wrong_totp",
        });
        throw new AppError(401, "invalid_totp", "Code didn't match. Try again.");
      }
    } else if (input.backupCode) {
      const codes = await adminRepo.listUnusedBackupCodes(adminId);
      let matched: { id: string } | null = null;
      for (const c of codes) {
        if (await bcrypt.compare(input.backupCode, c.codeHash)) {
          matched = c;
          break;
        }
      }
      if (!matched) {
        await logAudit(adminId, "login_failed", ip, userAgent, {
          reason: "wrong_backup_code",
        });
        throw new AppError(401, "invalid_backup_code", "Backup code didn't match.");
      }
      await adminRepo.markBackupCodeUsed(matched.id);
      backupCodesRemaining = await adminRepo.countRemainingBackupCodes(adminId);
    }

    await adminRepo.update(adminId, { lastLoginAt: new Date() });
    await logAudit(adminId, "login", ip, userAgent);
    return { admin, backupCodesRemaining };
  },

  async issueSession(args: {
    adminId: string;
    ip?: string;
    userAgent?: string;
  }) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    return adminRepo.createSession({
      adminId: args.adminId,
      expiresAt,
      ip: args.ip,
      userAgent: args.userAgent,
    });
  },

  async refreshSession(sessionId: string) {
    // Sliding refresh: bump expiresAt by SESSION_SLIDING_MS, capped at the
    // original SESSION_TTL_MS from createdAt. Caller already verified the
    // session is active.
    const session = await adminRepo.findActiveSession(sessionId);
    if (!session) return null;
    const cap = new Date(session.createdAt.getTime() + SESSION_TTL_MS);
    const next = new Date(Date.now() + SESSION_SLIDING_MS);
    const newExpiry = next.getTime() < cap.getTime() ? next : cap;
    return adminRepo.touchSession(sessionId, newExpiry);
  },

  async logout(sessionId: string, ip?: string, userAgent?: string) {
    const session = await adminRepo.findActiveSession(sessionId);
    if (session) {
      await adminRepo.revokeSession({ id: sessionId, reason: "logout" });
      await logAudit(session.adminId, "logout", ip, userAgent);
    }
  },

  async changePassword(
    adminId: string,
    input: ChangePasswordInput,
    ip?: string,
    userAgent?: string,
  ) {
    const admin = await adminRepo.findById(adminId);
    if (!admin) throw new AppError(404, "not_found", "Admin not found.");
    const ok = await bcrypt.compare(input.currentPassword, admin.passwordHash);
    if (!ok) {
      throw new AppError(
        401,
        "invalid_credentials",
        "Current password is incorrect.",
      );
    }
    const newHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    await adminRepo.update(adminId, { passwordHash: newHash });
    // Revoke ALL other sessions on password change (the current session
    // gets re-issued in the response, see controller).
    await adminRepo.revokeAllForAdmin({
      adminId,
      reason: "manual",
      revokedById: adminId,
    });
    await logAudit(adminId, "change_admin_password", ip, userAgent);
  },

  toPublic(admin: AdminUser) {
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role as AdminRole,
      totpEnabled: admin.totpEnabled,
      status: admin.status,
    };
  },
};
