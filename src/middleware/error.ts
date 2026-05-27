import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors.js";
import { logger } from "../config/logger.js";

export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next: NextFunction) => {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".");
      if (key && !fields[key]) fields[key] = issue.message;
    }
    res.status(400).json({
      error: { code: "VALIDATION_FAILED", message: "Invalid request", fields },
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error(err.message, {
        code: err.code,
        path: req.originalUrl,
        stack: err.stack,
      });
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, fields: err.fields },
    });
    return;
  }

  logger.error("Unhandled error", {
    path: req.originalUrl,
    method: req.method,
    err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
  });
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
  });
};
