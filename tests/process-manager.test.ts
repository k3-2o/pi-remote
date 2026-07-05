/**
 * Phase 5 Tests: PiProcessManager
 *
 * Tests the Pi process pool manager.
 *
 * Key areas:
 * - Lazy creation: processes started on first request
 * - Reuse: same session gets same process
 * - Limits: max processes enforced
 * - Eviction: oldest idle process evicted when limit reached
 * - Cleanup: stopAll, remove
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock PiProcess (hoisting-safe via inline factory)
vi.mock("../src/pi-process.js", () => ({
  PiProcess: class {
    isRunning = true;
    state = "running";
    send = vi.fn();
    onMessage = vi.fn();
    onExit = vi.fn();
    start = vi.fn(async () => {
      this.isRunning = true;
      this.state = "running";
    });
    stop = vi.fn(async () => {
      this.isRunning = false;
      this.state = "stopped";
    });
    getStderr = vi.fn(() => "");
  },
}));

// Lazy import so vi.mock applies first
const { PiProcessManager } = await import("../src/process-manager.js");
const { ConsoleLogger } = await import("../src/logger.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createManager(maxProcesses = 5, idleTimeoutMs = 0): PiProcessManager {
  return new PiProcessManager({
    logger: new ConsoleLogger({ level: "error" }),
    maxProcesses,
    idleTimeoutMs,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PiProcessManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("getOrCreate", () => {
    it("should create a new process on first request", async () => {
      const mgr = createManager();
      const proc = await mgr.getOrCreate("s1");
      expect(proc.isRunning).toBe(true);
      expect(mgr.count).toBe(1);
    });

    it("should reuse existing process for same session", async () => {
      const mgr = createManager();
      const p1 = await mgr.getOrCreate("s1");
      const p2 = await mgr.getOrCreate("s1");
      expect(p1).toBe(p2);
      expect(mgr.count).toBe(1);
    });

    it("should create separate processes for different sessions", async () => {
      const mgr = createManager();
      const p1 = await mgr.getOrCreate("s1");
      const p2 = await mgr.getOrCreate("s2");
      expect(p1).not.toBe(p2);
      expect(mgr.count).toBe(2);
    });
  });

  describe("limits", () => {
    it("should evict oldest when max reached", async () => {
      const mgr = createManager(2);
      await mgr.getOrCreate("s1");
      await mgr.getOrCreate("s2");

      // s3 evicts oldest (s1) and creates s3
      await mgr.getOrCreate("s3");
      expect(mgr.count).toBe(2);
      expect(mgr.get("s1")).toBeUndefined();
      expect(mgr.get("s3")).toBeDefined();
    });

    it("should free slots after remove", async () => {
      const mgr = createManager(2);
      await mgr.getOrCreate("s1");
      await mgr.getOrCreate("s2");

      await mgr.remove("s1");

      // Should now accept new process
      await mgr.getOrCreate("s3");
      expect(mgr.count).toBe(2);
    });
  });

  describe("idle timeout", () => {
    it("should start and stop idle timer without error", () => {
      const mgr = createManager();
      mgr.startIdleCheck(100);
      mgr.stopIdleCheck();
      // Timer lifecycle works without leaks
      expect(mgr).toBeDefined();
    });

    it("should track activity per process", async () => {
      const mgr = createManager();
      await mgr.getOrCreate("s1");

      // recordActivity should not throw
      mgr.recordActivity("s1");
    });
  });

  describe("get", () => {
    it("should return existing process without creating", async () => {
      const mgr = createManager();
      await mgr.getOrCreate("s1");

      const proc = mgr.get("s1");
      expect(proc).toBeDefined();
    });

    it("should return undefined for unknown session", () => {
      const mgr = createManager();
      expect(mgr.get("nope")).toBeUndefined();
    });
  });

  describe("remove", () => {
    it("should stop and remove a process", async () => {
      const mgr = createManager();
      const proc = await mgr.getOrCreate("s1");
      expect(proc.isRunning).toBe(true);

      await mgr.remove("s1");
      expect(mgr.count).toBe(0);
    });

    it("should handle removing non-existent process gracefully", async () => {
      const mgr = createManager();
      await mgr.remove("nope"); // no-op, no throw
      expect(mgr.count).toBe(0);
    });
  });

  describe("stopAll", () => {
    it("should stop all managed processes", async () => {
      const mgr = createManager();
      await mgr.getOrCreate("s1");
      await mgr.getOrCreate("s2");
      expect(mgr.count).toBe(2);

      await mgr.stopAll();
      expect(mgr.count).toBe(0);
    });
  });
});
