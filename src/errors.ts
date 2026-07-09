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
