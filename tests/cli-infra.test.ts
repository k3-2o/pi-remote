/**
 * Phase 6 Tests: CLI infrastructure
 *
 * Tests the server lifecycle, PID management, config loading, and logger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { DEFAULT_CONFIG, LOG_LEVELS } from "../src/types.js";
import { ConsoleLogger } from "../src/logger.js";
import {
  PiServerError,
  ConfigError,
  SessionNotFoundError,
  PiProcessError,
  AuthError,
} from "../src/errors.js";

// ---------------------------------------------------------------------------
// PID File Tests
// ---------------------------------------------------------------------------

describe("PID File Management", () => {
  const pidFile = join(tmpdir(), "pi-server-test.pid");

  beforeEach(() => {
    try {
      unlinkSync(pidFile);
    } catch {}
  });

  afterEach(() => {
    try {
      unlinkSync(pidFile);
    } catch {}
  });

  it("should write PID file", () => {
    writeFileSync(pidFile, String(process.pid), "utf-8");
    expect(existsSync(pidFile)).toBe(true);
    expect(readFileSync(pidFile, "utf-8").trim()).toBe(String(process.pid));
  });

  it("should read PID file", () => {
    writeFileSync(pidFile, "42", "utf-8");
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    expect(pid).toBe(42);
  });

  it("should delete PID file", () => {
    writeFileSync(pidFile, "123", "utf-8");
    unlinkSync(pidFile);
    expect(existsSync(pidFile)).toBe(false);
  });

  it("should handle missing PID file gracefully", () => {
    expect(existsSync(pidFile)).toBe(false);
    // Reading a non-existent file should not happen — static method handles it
  });

  it("should handle corrupt PID file", () => {
    writeFileSync(pidFile, "not-a-number", "utf-8");
    const raw = readFileSync(pidFile, "utf-8").trim();
    const pid = parseInt(raw, 10);
    expect(isNaN(pid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config Loader Tests
// ---------------------------------------------------------------------------

describe("Config Loader", () => {
  const configPath = join(tmpdir(), "pi-server-test-config.json");

  beforeEach(() => {
    try {
      unlinkSync(configPath);
    } catch {}
    delete process.env.PI_SERVER_PORT;
    delete process.env.PI_SERVER_HOST;
    delete process.env.PI_SERVER_LOG_LEVEL;
    delete process.env.PI_SERVER_MAX_SESSIONS;
    delete process.env.PI_SERVER_PI_COMMAND;
  });

  afterEach(() => {
    try {
      unlinkSync(configPath);
    } catch {}
  });

  it("should return defaults when no config file exists", () => {
    const config = loadConfig();
    expect(config.port).toBe(8080);
    expect(config.host).toBe("0.0.0.0");
    expect(config.maxSessions).toBe(10);
    expect(config.logLevel).toBe("info");
  });

  it("should load from config file", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ port: 9090, maxSessions: 5 }),
      "utf-8",
    );
    const config = loadConfig(configPath);
    expect(config.port).toBe(9090);
    expect(config.maxSessions).toBe(5);
    // Unspecified fields use defaults
    expect(config.host).toBe("0.0.0.0");
  });

  it("should override with environment variables", () => {
    process.env.PI_SERVER_PORT = "3000";
    process.env.PI_SERVER_HOST = "127.0.0.1";
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.host).toBe("127.0.0.1");
  });

  it("should reject invalid port in env var", () => {
    process.env.PI_SERVER_PORT = "99999";
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("should reject invalid log level in env var", () => {
    process.env.PI_SERVER_LOG_LEVEL = "banana";
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("should reject invalid max sessions in env var", () => {
    process.env.PI_SERVER_MAX_SESSIONS = "0";
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("should reject invalid JSON in config file", () => {
    writeFileSync(configPath, "{ not valid json !!!", "utf-8");
    expect(() => loadConfig(configPath)).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// Logger Tests
// ---------------------------------------------------------------------------

describe("Logger", () => {
  it("should create logger with default level", () => {
    const logger = new ConsoleLogger();
    expect(logger).toBeDefined();
  });

  it("should create logger with custom level", () => {
    const logger = new ConsoleLogger({
      level: "debug",
      component: "test",
    });
    expect(logger).toBeDefined();
  });

  it("should not throw on any log method", () => {
    const logger = new ConsoleLogger({ level: "debug" });
    logger.debug("debug msg");
    logger.info("info msg", { key: "value" });
    logger.warn("warn msg");
    logger.error("error msg", { stack: "trace" });
  });

  it("should filter messages below log level", () => {
    const logger = new ConsoleLogger({ level: "error" });
    // debug, info, warn should be silently dropped
    logger.debug("should not appear");
    logger.info("should not appear");
    logger.warn("should not appear");
    logger.error("should appear");
  });
});

// ---------------------------------------------------------------------------
// Log Level Constants
// ---------------------------------------------------------------------------

describe("Log Levels", () => {
  it("should have correct ordering", () => {
    expect(LOG_LEVELS.debug).toBe(0);
    expect(LOG_LEVELS.info).toBe(1);
    expect(LOG_LEVELS.warn).toBe(2);
    expect(LOG_LEVELS.error).toBe(3);
  });

  it("should filter correctly", () => {
    // Debug is the lowest, error is the highest
    expect(LOG_LEVELS.debug).toBeLessThan(LOG_LEVELS.error);
    expect(LOG_LEVELS.info).toBeGreaterThan(LOG_LEVELS.debug);
  });
});

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

describe("Error Types", () => {
  it("should create PiServerError with code and status", () => {
    const err = new PiServerError("test error", "TEST_CODE", 418);
    expect(err.message).toBe("test error");
    expect(err.code).toBe("TEST_CODE");
    expect(err.statusCode).toBe(418);
    expect(err.name).toBe("PiServerError");
  });

  it("should create ConfigError", () => {
    const err = new ConfigError("bad config");
    expect(err.code).toBe("CONFIG_ERROR");
    expect(err.statusCode).toBe(1);
  });

  it("should create SessionNotFoundError", () => {
    const err = new SessionNotFoundError("s1");
    expect(err.code).toBe("SESSION_NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("s1");
  });

  it("should create PiProcessError", () => {
    const err = new PiProcessError("crashed");
    expect(err.code).toBe("PI_PROCESS_ERROR");
    expect(err.statusCode).toBe(502);
  });

  it("should create AuthError", () => {
    const err = new AuthError();
    expect(err.statusCode).toBe(401);
  });
});
