import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/db.js";
import { AppError, ForbiddenError, UnauthorizedError } from "../errors.js";

export type SessionUser = {
  id: string;
  role: "buyer" | "seller" | "admin";
};

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.session as string | undefined;
  if (!token) throw new UnauthorizedError();

  let payload: SessionUser;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as SessionUser;
  } catch {
    throw new UnauthorizedError("Invalid or expired session");
  }

  // Suspended users have their JWT invalidated on the next authed request.
  // One indexed lookup; the user's primary key is in the JWT already.
  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { status: true },
  });
  if (!user) throw new UnauthorizedError("Account no longer exists");
  if (user.status === "suspended") {
    throw new AppError(
      403,
      "account_suspended",
      "Your account has been suspended.",
    );
  }
  req.user = payload;
  next();
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.session as string | undefined;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as SessionUser;
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { status: true },
    });
    // Suspended users browse as guests, not as themselves.
    if (user && user.status === "active") {
      req.user = payload;
    }
  } catch {
    // Silently ignore — guest behavior
  }
  next();
}

export function requireRole(...roles: SessionUser["role"][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError("Insufficient permissions");
    }
    next();
  };
}
