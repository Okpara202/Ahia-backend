import type { NextFunction, Request, Response } from "express";
import { redis } from "../integrations/redis.js";
import { AppError } from "../errors.js";
import { logger } from "../config/logger.js";

const TTL_S = 5 * 60; // 5 minutes — long enough to catch double-clicks and
// browser retries; short enough that legitimate later requests with a
// recycled UUID (rare) aren't penalized.

/**
 * Reads `Idempotency-Key` header. If present, checks Redis for a prior use
 * within the TTL — if seen, returns 409 with a structured `duplicate` code.
 * Otherwise marks the key as seen and lets the request through. If Redis is
 * unavailable (or no key sent), the middleware is a no-op.
 *
 * Apply ONLY to mutating endpoints where a duplicate side effect would harm
 * the user — primarily payment-init endpoints.
 */
export async function idempotencyGuard(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const raw = req.header("idempotency-key");
  if (!raw) return next();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(raw)) {
    throw new AppError(
      400,
      "invalid_idempotency_key",
      "Idempotency-Key must be 8-128 chars, alphanumeric / dash / underscore.",
    );
  }
  if (!redis) {
    // Silent no-op — better to let the request through than to gate on infra
    // the consumer didn't know was off.
    return next();
  }
  const key = `idem:${raw}`;
  try {
    // SET key value NX EX seconds — atomic: only sets if key didn't exist.
    // Returns "OK" on success (first request), null if already exists (dup).
    const result = await redis.set(key, "1", "EX", TTL_S, "NX");
    if (result === null) {
      throw new AppError(
        409,
        "duplicate_request",
        "We've already processed a request with this key. If you intended a new action, generate a fresh Idempotency-Key.",
      );
    }
    return next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn("idempotency: redis check failed; allowing request", {
      message: err instanceof Error ? err.message : String(err),
    });
    return next();
  }
}
