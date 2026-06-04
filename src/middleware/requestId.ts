import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

// Generate a short request ID per inbound request. Echo as X-Request-Id so
// the frontend can include it in bug reports. Stamped onto every log entry
// via requestLogger.
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const id = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming)
    ? incoming
    : crypto.randomBytes(6).toString("hex");
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
}
