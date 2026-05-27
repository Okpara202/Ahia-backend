import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ForbiddenError, UnauthorizedError } from "../errors.js";

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

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.session as string | undefined;
  if (!token) throw new UnauthorizedError();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as SessionUser;
    req.user = payload;
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired session");
  }
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
