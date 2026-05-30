import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { MulterError } from "multer";
import { AppError } from "../errors.js";
import { logger } from "../config/logger.js";

export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
};

type ErrorPayload = {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
};

function mapMulter(err: MulterError): ErrorPayload {
  const field = err.field;
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return {
        status: 413,
        code: "FILE_TOO_LARGE",
        message: "File is too large.",
        fields: field ? { [field]: "Too large" } : undefined,
      };
    case "LIMIT_FILE_COUNT":
      return {
        status: 400,
        code: "TOO_MANY_FILES",
        message: "Too many files in this upload.",
      };
    case "LIMIT_UNEXPECTED_FILE":
      return {
        status: 400,
        code: "UNEXPECTED_FILE_FIELD",
        message: `Unexpected file field${field ? `: ${field}` : ""}.`,
        fields: field ? { [field]: "Unexpected" } : undefined,
      };
    default:
      return {
        status: 400,
        code: "UPLOAD_ERROR",
        message: err.message || "Upload failed.",
      };
  }
}

function mapBodyParser(err: unknown): ErrorPayload | null {
  if (!(err instanceof SyntaxError)) {
    if (
      typeof err === "object" &&
      err !== null &&
      "type" in err &&
      (err as { type?: unknown }).type === "entity.too.large"
    ) {
      return {
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body is too large.",
      };
    }
    return null;
  }
  const withType = err as SyntaxError & { type?: string; status?: number };
  if (withType.type === "entity.parse.failed" || withType.status === 400) {
    return {
      status: 400,
      code: "INVALID_JSON",
      message: "Request body is not valid JSON.",
    };
  }
  return null;
}

function mapPrisma(err: Prisma.PrismaClientKnownRequestError): ErrorPayload | null {
  switch (err.code) {
    case "P2002":
      return {
        status: 409,
        code: "CONFLICT",
        message: "A record with that value already exists.",
      };
    case "P2025":
      return {
        status: 404,
        code: "NOT_FOUND",
        message: "Resource not found.",
      };
    default:
      return null;
  }
}

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

  if (err instanceof MulterError) {
    const payload = mapMulter(err);
    res.status(payload.status).json({
      error: { code: payload.code, message: payload.message, fields: payload.fields },
    });
    return;
  }

  const bodyParserPayload = mapBodyParser(err);
  if (bodyParserPayload) {
    res.status(bodyParserPayload.status).json({
      error: { code: bodyParserPayload.code, message: bodyParserPayload.message },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const payload = mapPrisma(err);
    if (payload) {
      res.status(payload.status).json({
        error: { code: payload.code, message: payload.message },
      });
      return;
    }
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
