import type { Request, Response } from "express";
import { env } from "../../../config/env.js";
import { UnauthorizedError } from "../../../errors.js";
import { ipFromRequest, uaFromRequest } from "../../../lib/audit.js";
import { adminAuthService } from "./admin.service.js";
import {
  changePasswordSchema,
  loginSchema,
  regenerateBackupCodesSchema,
  twoFactorSetupVerifySchema,
  twoFactorVerifySchema,
} from "./admin.schemas.js";

const SESSION_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function adminCookieAttrs() {
  const isProd = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    // SameSite=None is required because the admin app runs on a different
    // origin than the API (localhost:3001 → onrender.com in dev, and a
    // Vercel subdomain → onrender.com in staging). Lax cookies are NOT sent
    // on those cross-site requests, which breaks every authed call after
    // login. SameSite=None requires Secure, which is set in prod.
    sameSite: isProd ? ("none" as const) : ("lax" as const),
    path: "/",
  };
}

function setSessionCookie(res: Response, sessionId: string) {
  res.cookie(env.ADMIN_COOKIE_NAME, sessionId, {
    ...adminCookieAttrs(),
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
}

function clearSessionCookie(res: Response) {
  // Clear MUST mirror the set attributes — browsers reject the clear
  // otherwise and the cookie lingers.
  res.clearCookie(env.ADMIN_COOKIE_NAME, adminCookieAttrs());
}

export const adminAuthController = {
  async login(req: Request, res: Response) {
    const input = loginSchema.parse(req.body);
    const result = await adminAuthService.login(
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    res.status(200).json({ ok: true, ...result });
  },

  async twoFactorSetupStart(req: Request, res: Response) {
    const setupToken = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")
      || (req.query.token as string | undefined)
      || "";
    if (!setupToken) {
      throw new UnauthorizedError();
    }
    const result = await adminAuthService.startTwoFactorSetup(setupToken);
    res.status(200).json(result);
  },

  async twoFactorSetupVerify(req: Request, res: Response) {
    const input = twoFactorSetupVerifySchema.parse(req.body);
    const { adminId, backupCodes } = await adminAuthService.completeTwoFactorSetup(
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    const session = await adminAuthService.issueSession({
      adminId,
      ip: ipFromRequest(req),
      userAgent: uaFromRequest(req),
    });
    setSessionCookie(res, session.id);
    res.status(200).json({ ok: true, backupCodes });
  },

  async twoFactorVerify(req: Request, res: Response) {
    const input = twoFactorVerifySchema.parse(req.body);
    const { admin, backupCodesRemaining } = await adminAuthService.verifyTwoFactor(
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    const session = await adminAuthService.issueSession({
      adminId: admin.id,
      ip: ipFromRequest(req),
      userAgent: uaFromRequest(req),
    });
    setSessionCookie(res, session.id);
    const body: Record<string, unknown> = { ok: true };
    if (backupCodesRemaining !== null) {
      body.backupCodesRemaining = backupCodesRemaining;
    }
    res.status(200).json(body);
  },

  async logout(req: Request, res: Response) {
    const sessionId = req.cookies?.[env.ADMIN_COOKIE_NAME] as string | undefined;
    if (sessionId) {
      await adminAuthService.logout(
        sessionId,
        ipFromRequest(req),
        uaFromRequest(req),
      );
    }
    clearSessionCookie(res);
    res.status(204).end();
  },

  async me(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const admin = await adminAuthService.meBody(req.admin);
    res.status(200).json({ admin });
  },

  async changePassword(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const input = changePasswordSchema.parse(req.body);
    await adminAuthService.changePassword(
      req.admin.id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    // The service revoked all sessions; re-issue one for the active caller
    // so they're not kicked out of their own browser.
    const session = await adminAuthService.issueSession({
      adminId: req.admin.id,
      ip: ipFromRequest(req),
      userAgent: uaFromRequest(req),
    });
    setSessionCookie(res, session.id);
    res.status(200).json({ ok: true });
  },

  async regenerateBackupCodes(req: Request, res: Response) {
    if (!req.admin) throw new UnauthorizedError();
    const input = regenerateBackupCodesSchema.parse(req.body);
    const backupCodes = await adminAuthService.regenerateBackupCodes(
      req.admin.id,
      input,
      ipFromRequest(req),
      uaFromRequest(req),
    );
    // Plain codes ONLY returned here — never again. Frontend must surface
    // them to the user in a one-shot reveal screen with a copy button.
    res.status(200).json({ backupCodes });
  },
};
