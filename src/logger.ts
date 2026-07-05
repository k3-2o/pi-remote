/**
 * Logger abstraction for pi-server.
 *
 * MVP: thin wrapper around console.error with structured context.
 * v1: replace with Pino (same interface).
 */

import type { LogLevel } from "./types.js";
import { LOG_LEVELS } from "./types.js";

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  dispose?(): void;
}

export class ConsoleLogger implements Logger {
  private level: LogLevel;
  private component: string;

  constructor(options: { level?: LogLevel; component?: string } = {}) {
    this.level = options.level ?? "info";
    this.component = options.component ?? "pi-server";
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;

    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg: message,
      ...context,
    };

    // Use stderr for all logging (stdout is reserved for protocol)
    console.error(JSON.stringify(entry));
  }
}
