/**
 * Config loader for pi-remote.
 *
 * Loads from:
 * 1. ~/.config/pi-remote/config.json
 * 2. ~/.pi/pi-remote.json (fallback)
 * 3. Environment variable overrides
 *
 * All config has sensible defaults (zero-config startup).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ServerConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { ConfigError } from "./errors.js";

const CONFIG_PATHS = [
  resolve(homedir(), ".config", "pi-server", "config.json"),
  resolve(homedir(), ".pi", "pi-server.json"),
];

export function loadConfig(configPath?: string): ServerConfig {
  // Start with defaults
  const config: ServerConfig = structuredClone(DEFAULT_CONFIG);

  // Try to load from file
  const paths = configPath ? [configPath, ...CONFIG_PATHS] : CONFIG_PATHS;
  let loaded = false;

  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8");
        const parsed = JSON.parse(raw);
        Object.assign(config, parsed);
        loaded = true;
        break;
      } catch (err) {
        throw new ConfigError(
          `Failed to load config from ${path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (!loaded && !configPath) {
    // No config file found, use defaults. Not an error.
    // Log at debug level (caller should handle this)
  }

  // Environment variable overrides
  if (process.env.PI_SERVER_PORT) {
    config.port = parseInt(process.env.PI_SERVER_PORT, 10);
    if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
      throw new ConfigError(
        `Invalid PI_SERVER_PORT: "${process.env.PI_SERVER_PORT}". Must be 1-65535.`,
      );
    }
  }
  if (process.env.PI_SERVER_HOST) {
    config.host = process.env.PI_SERVER_HOST;
  }
  if (process.env.PI_SERVER_LOG_LEVEL) {
    const level = process.env.PI_SERVER_LOG_LEVEL;
    if (!["debug", "info", "warn", "error"].includes(level)) {
      throw new ConfigError(
        `Invalid PI_SERVER_LOG_LEVEL: "${level}". Must be debug, info, warn, or error.`,
      );
    }
    config.logLevel = level as ServerConfig["logLevel"];
  }
  if (process.env.PI_SERVER_MAX_SESSIONS) {
    config.maxSessions = parseInt(process.env.PI_SERVER_MAX_SESSIONS, 10);
    if (isNaN(config.maxSessions) || config.maxSessions < 1) {
      throw new ConfigError(
        `Invalid PI_SERVER_MAX_SESSIONS: "${process.env.PI_SERVER_MAX_SESSIONS}". Must be >= 1.`,
      );
    }
  }
  if (process.env.PI_SERVER_PI_COMMAND) {
    config.piCommand = process.env.PI_SERVER_PI_COMMAND;
  }

  // Session reset policy overrides
  if (process.env.PI_SERVER_SESSION_RESET_MODE) {
    const mode = process.env.PI_SERVER_SESSION_RESET_MODE;
    if (!["idle", "daily", "none"].includes(mode)) {
      throw new ConfigError(
        `Invalid PI_SERVER_SESSION_RESET_MODE: "${mode}". Must be idle, daily, or none.`,
      );
    }
    config.sessionReset.mode = mode as "idle" | "daily" | "none";
  }
  if (process.env.PI_SERVER_SESSION_RESET_IDLE_MINUTES) {
    const mins = parseInt(process.env.PI_SERVER_SESSION_RESET_IDLE_MINUTES, 10);
    if (isNaN(mins) || mins < 1) {
      throw new ConfigError(
        `Invalid PI_SERVER_SESSION_RESET_IDLE_MINUTES: "${process.env.PI_SERVER_SESSION_RESET_IDLE_MINUTES}". Must be >= 1.`,
      );
    }
    config.sessionReset.idleMinutes = mins;
  }
  if (process.env.PI_SERVER_SESSION_RESET_AT_HOUR) {
    const hour = parseInt(process.env.PI_SERVER_SESSION_RESET_AT_HOUR, 10);
    if (isNaN(hour) || hour < 0 || hour > 23) {
      throw new ConfigError(
        `Invalid PI_SERVER_SESSION_RESET_AT_HOUR: "${process.env.PI_SERVER_SESSION_RESET_AT_HOUR}". Must be 0-23.`,
      );
    }
    config.sessionReset.atHour = hour;
  }

  return config;
}
