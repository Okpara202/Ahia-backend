import type { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger.js";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const meta = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip,
    };
    if (res.statusCode >= 500) logger.error("request", meta);
    else if (res.statusCode >= 400) logger.warn("request", meta);
    else logger.info("request", meta);
  });
  next();
}
