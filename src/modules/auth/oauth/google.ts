import { Router } from "express";
import type { Request, Response } from "express";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { BadRequestError, UnauthorizedError } from "../../../errors.js";
import { authRepo } from "../auth.repo.js";
import { authService } from "../auth.service.js";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleProfile,
  generateState,
  requireGoogleConfig,
  sanitizeNext,
  signOAuthState,
  verifyOAuthState,
} from "./google.helpers.js";

const OAUTH_STATE_COOKIE = "google_oauth_state";
const STATE_COOKIE_PATH = "/auth/google";

function stateCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 5 * 60 * 1000,
    path: STATE_COOKIE_PATH,
  };
}

const router = Router();

router.get("/start", (req: Request, res: Response) => {
  const config = requireGoogleConfig();
  const next = sanitizeNext(
    typeof req.query.next === "string" ? req.query.next : undefined,
  );
  const state = generateState();
  const stateToken = signOAuthState({ state, next });

  res.cookie(OAUTH_STATE_COOKIE, stateToken, stateCookieOptions());

  const url = buildGoogleAuthUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
  });
  res.redirect(url);
});

router.get("/callback", async (req: Request, res: Response) => {
  const config = requireGoogleConfig();

  const errorParam = typeof req.query.error === "string" ? req.query.error : null;
  if (errorParam) {
    logger.warn("google oauth: user denied or error", { error: errorParam });
    res.redirect(`${env.CLIENT_URL}/login?error=oauth_denied`);
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  if (!code || !state) throw new BadRequestError("Missing code or state");

  const stateToken = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
  if (!stateToken) throw new UnauthorizedError("OAuth state cookie missing");

  let statePayload: { state: string; next: string };
  try {
    statePayload = verifyOAuthState(stateToken);
  } catch {
    throw new UnauthorizedError("OAuth state invalid or expired");
  }
  if (statePayload.state !== state) {
    throw new UnauthorizedError("OAuth state mismatch");
  }
  res.clearCookie(OAUTH_STATE_COOKIE, { path: STATE_COOKIE_PATH });

  const tokens = await exchangeCodeForTokens({ code, config });
  const profile = await fetchGoogleProfile(tokens.access_token);
  if (!profile.email_verified) {
    throw new UnauthorizedError("Google account email is not verified");
  }

  const email = profile.email.toLowerCase();
  let user = await authRepo.findByGoogleId(profile.sub);
  let isNew = false;

  if (!user) {
    const byEmail = await authRepo.findByEmail(email);
    if (byEmail) {
      user = await authRepo.linkGoogleId(byEmail.id, profile.sub);
    } else {
      user = await authRepo.create({
        name: profile.name,
        email,
        googleId: profile.sub,
        avatarUrl: profile.picture,
      });
      isNew = true;
    }
  }

  authService.issueSession(user, res);

  const target = isNew ? "/onboarding" : statePayload.next;
  res.redirect(`${env.CLIENT_URL}${target}`);
});

export default router;
