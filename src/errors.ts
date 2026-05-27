export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", fields?: Record<string, string>) {
    super(400, "BAD_REQUEST", message, fields);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid request", fields?: Record<string, string>) {
    super(400, "VALIDATION_FAILED", message, fields);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in required", code = "UNAUTHORIZED") {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, "NOT_FOUND", `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, fields?: Record<string, string>) {
    super(409, code, message, fields);
  }
}

export class UnprocessableError extends AppError {
  constructor(code: string, message: string, fields?: Record<string, string>) {
    super(422, code, message, fields);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests") {
    super(429, "RATE_LIMITED", message);
  }
}

export class NotImplementedError extends AppError {
  constructor(message = "Not implemented yet") {
    super(501, "NOT_IMPLEMENTED", message);
  }
}

export class InternalError extends AppError {
  constructor(message = "Something went wrong") {
    super(500, "INTERNAL_ERROR", message);
  }
}
