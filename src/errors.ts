/**
 * Structured error types for pi-server.
 */

export class PiServerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "PiServerError";
  }
}

export class SessionNotFoundError extends PiServerError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, "SESSION_NOT_FOUND", 404);
    this.name = "SessionNotFoundError";
  }
}

export class PiProcessError extends PiServerError {
  constructor(message: string) {
    super(message, "PI_PROCESS_ERROR", 502);
    this.name = "PiProcessError";
  }
}

export class PiCrashedError extends PiServerError {
  constructor(exitCode: number | null, stderr: string) {
    super(
      `Pi process crashed (exit code: ${exitCode}). Stderr: ${stderr.slice(0, 500)}`,
      "PI_CRASHED",
      502,
    );
    this.name = "PiCrashedError";
  }
}

export class ConfigError extends PiServerError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR", 1);
    this.name = "ConfigError";
  }
}

export class AuthError extends PiServerError {
  constructor(message: string = "Authentication failed") {
    super(message, "AUTH_ERROR", 401);
    this.name = "AuthError";
  }
}

export class RateLimitError extends PiServerError {
  constructor() {
    super("Rate limit exceeded", "RATE_LIMIT", 429);
    this.name = "RateLimitError";
  }
}

export class ValidationError extends PiServerError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationError";
  }
}
