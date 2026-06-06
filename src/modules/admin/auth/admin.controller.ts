import type { Request, Response } from "express";
import { env } from "../../../config/env.js";
import { UnauthorizedError } from "../../../errors.js";
import { ipFromRequest, uaFromRequest } from "../../../lib/audit.js";
import { adminAuthService } from "./admin.service.js";
import {
  changePasswordSchema,
  loginSchema,
  twoFactorSetupVerifySchema,
  twoFactorVerifySchema,
} from "./admin.schemas.js";

const SESSION_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function setSessionCookie(res: Response, sessionId: string) {
  res.cookie(env.ADMIN_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "lax" : "lax",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(env.ADMIN_COOKIE_NAME, { path: "/" });
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
    res.status(200).json({ admin: adminAuthService.toPublic(req.admin) });
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
};
