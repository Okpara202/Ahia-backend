import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { Response } from "express";
import { env } from "../../config/env.js";
import { ConflictError, UnauthorizedError } from "../../errors.js";
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

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    domain: env.COOKIE_DOMAIN,
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
    return { user: publicUser(user), token: signSession(user) };
  },

  async me(userId: string) {
    const user = await authRepo.findById(userId);
    if (!user) throw new UnauthorizedError("Session no longer valid");
    return publicUser(user);
  },

  cookieOptions,

  issueSession(user: Pick<User, "id" | "role">, res: Response) {
    res.cookie("session", signSession(user), cookieOptions());
  },
};
