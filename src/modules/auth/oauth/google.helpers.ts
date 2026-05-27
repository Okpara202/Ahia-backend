import axios from "axios";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env.js";
import { InternalError } from "../../../errors.js";

const STATE_TTL_SECONDS = 300;

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleProfile = {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
};

export function requireGoogleConfig(): GoogleConfig {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new InternalError(
      "Google OAuth not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI",
    );
  }
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
  };
}

export function generateState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function buildGoogleAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: args.state,
    access_type: "online",
    prompt: "select_account",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(args: {
  code: string;
  config: GoogleConfig;
}): Promise<{ access_token: string; id_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.config.clientId,
    client_secret: args.config.clientSecret,
    redirect_uri: args.config.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await axios.post("https://oauth2.googleapis.com/token", body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data;
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await axios.get("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}

export function signOAuthState(payload: { state: string; next: string }): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: STATE_TTL_SECONDS });
}

export function verifyOAuthState(token: string): { state: string; next: string } {
  return jwt.verify(token, env.JWT_SECRET) as { state: string; next: string };
}

export function sanitizeNext(next: string | undefined): string {
  if (!next) return "/feed";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("://")) {
    return "/feed";
  }
  return next;
}
