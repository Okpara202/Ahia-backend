import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { Response, CookieOptions } from "express";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError, ConflictError, UnauthorizedError } from "../../errors.js";
import { prisma } from "../../config/db.js";
import { authRepo } from "./auth.repo.js";
import type { LoginInput, SignupInput } from "./auth.schemas.js";
import type { User } from "@prisma/client";

const BCRYPT_ROUNDS = 12;
const SESSION_DAYS = 7;

function signSession(user: Pick<User, "id" | "role">): string {
  return jwt.sign({ id: user.id, role: user.role }, env.JWT_SECRET, {
    expiresIn: `${SESSION_DAYS}d`,
  });
}

function cookieOptions(): CookieOptions {
  const isProd = env.NODE_ENV === "production";
  let domain = env.COOKIE_DOMAIN;
  if (isProd && domain === "localhost") {
    logger.warn(
      "cookieOptions: COOKIE_DOMAIN=localhost in production is invalid — ignoring; cookie will be scoped to request host",
    );
    domain = undefined;
  }
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    ...(domain ? { domain } : {}),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

function publicUser(user: User) {
  const { passwordHash: _ph, ...rest } = user;
  return rest;
}

export const authService = {
  async signup(input: SignupInput) {
    const existing = await authRepo.findByEmail(input.email);
    if (existing) {
      throw new ConflictError("EMAIL_TAKEN", "Email is already in use", {
        email: "Already registered",
      });
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await authRepo.create({
      name: input.name,
      email: input.email,
      passwordHash,
    });
    return { user: publicUser(user), token: signSession(user) };
  },

  async login(input: LoginInput) {
    const user = await authRepo.findByEmail(input.email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedError("Email or password is incorrect", "INVALID_CREDENTIALS");
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedError("Email or password is incorrect", "INVALID_CREDENTIALS");
    }
    if (user.status === "suspended") {
      throw new AppError(
        403,
        "account_suspended",
        user.suspendedReason ?? "Your account has been suspended.",
      );
    }
    return { user: publicUser(user), token: signSession(user) };
  },

  async me(userId: string) {
    const user = await authRepo.findById(userId);
    if (!user) throw new UnauthorizedError("Session no longer valid");
    const [followingCount, payoutAccount] = await Promise.all([
      prisma.follow.count({ where: { userId } }),
      prisma.payoutAccount.findUnique({
        where: { userId },
        select: { paystackRecipientCode: true },
      }),
    ]);
    return {
      ...publicUser(user),
      followingCount,
      hasPayoutAccount: !!payoutAccount?.paystackRecipientCode,
      owedBalance: user.owedBalance,
    };
  },

  cookieOptions,

  issueSession(user: Pick<User, "id" | "role">, res: Response) {
    res.cookie("session", signSession(user), cookieOptions());
  },
};
