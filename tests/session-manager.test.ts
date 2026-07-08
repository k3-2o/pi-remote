/**
 * Phase 5 Tests: SessionManager
 *
 * Unit tests for session lifecycle management.
 *
 * Key areas:
 * - create: new sessions, duplicate IDs, auto-generated IDs
 * - get/list/info: retrieval of active sessions
 * - delete: removal and cleanup
 * - edge cases: unknown sessions, re-create after delete
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionManager } from "../src/session-manager.js";
import type { PiProcessManager } from "../src/process-manager.js";
import { ConsoleLogger } from "../src/logger.js";

// ---------------------------------------------------------------------------
// Mock PiProcessManager
// ---------------------------------------------------------------------------

function createMockProcessManager() {
  return {
    getOrCreate: vi.fn(async (_id: string) => ({
      isRunning: true,
      state: "running",
      send: vi.fn(),
      onMessage: vi.fn(),
      onExit: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      getStderr: vi.fn(() => ""),
    })),
    remove: vi.fn(async () => {}),
    count: 0,
    get: vi.fn(),
    recordActivity: vi.fn(),
    stopAll: vi.fn(async () => {}),
    startIdleCheck: vi.fn(),
    stopIdleCheck: vi.fn(),
  } as unknown as PiProcessManager;
}

function createSessionManager() {
  const processManager = createMockProcessManager();
  const logger = new ConsoleLogger({ level: "error" });
  return {
    manager: new SessionManager({ logger, processManager }),
    processManager,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionManager", () => {
  describe("create", () => {
    it("should create a session with auto-generated ID", async () => {
      const { manager } = createSessionManager();
      const info = await manager.create();
      expect(info.sessionId).toBeTruthy();
      expect(info.sessionId.length).toBeGreaterThan(0);
      expect(info.isStreaming).toBe(false);
      expect(info.messageCount).toBe(0);
      expect(info.createdAt).toBeTruthy();
    });

    it("should create a session with custom ID", async () => {
      const { manager } = createSessionManager();
      const info = await manager.create("my-custom-id");
      expect(info.sessionId).toBe("my-custom-id");
    });

    it("should reject duplicate session IDs", async () => {
      const { manager } = createSessionManager();
      await manager.create("dup");

      await expect(manager.create("dup")).rejects.toThrow(/already exists/);
    });

    it("should start a Pi process on creation", async () => {
      const { manager, processManager } = createSessionManager();
      await manager.create("s1");

      expect(processManager.getOrCreate).toHaveBeenCalledWith(
        "s1",
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it("should assign unique auto-IDs across multiple creates", async () => {
      const { manager } = createSessionManager();
      const a = await manager.create();
      const b = await manager.create();
      const c = await manager.create();

      expect(a.sessionId).not.toBe(b.sessionId);
      expect(a.sessionId).not.toBe(c.sessionId);
      expect(b.sessionId).not.toBe(c.sessionId);
    });
  });

  describe("get", () => {
    it("should retrieve an existing session", async () => {
      const { manager } = createSessionManager();
      await manager.create("s1");

      const record = manager.get("s1");
      expect(record).toBeDefined();
      expect(record!.sessionId).toBe("s1");
    });

    it("should return undefined for unknown session", () => {
      const { manager } = createSessionManager();
      expect(manager.get("nope")).toBeUndefined();
    });
  });

  describe("getOrCreate", () => {
    it("should return existing session if found", async () => {
      const { manager } = createSessionManager();
      await manager.create("s1");

      const result = await manager.getOrCreate("s1");
      expect(result.sessionId).toBe("s1");
      expect(result.created).toBe(false);
    });

    it("should create new session if not found", async () => {
      const { manager } = createSessionManager();
      const result = await manager.getOrCreate("new-session");
      expect(result.sessionId).toBe("new-session");
      expect(result.created).toBe(true);
    });

    it("should auto-generate ID if none provided", async () => {
      const { manager } = createSessionManager();
      const result = await manager.getOrCreate();
      expect(result.sessionId).toBeTruthy();
      expect(result.created).toBe(true);
    });
  });

  describe("getInfo", () => {
    it("should return SessionInfo for existing session", async () => {
      const { manager } = createSessionManager();
      await manager.create("s1");

      const info = manager.getInfo("s1");
      expect(info).toMatchObject({
        sessionId: "s1",
        isStreaming: false,
        messageCount: 0,
      });
    });

    it("should return undefined for unknown session", () => {
      const { manager } = createSessionManager();
      expect(manager.getInfo("nope")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("should return empty array when no sessions exist", () => {
      const { manager } = createSessionManager();
      expect(manager.list()).toHaveLength(0);
    });

    it("should list all created sessions", async () => {
      const { manager } = createSessionManager();
      await manager.create("a");
      await manager.create("b");
      await manager.create("c");

      const list = manager.list();
      expect(list).toHaveLength(3);
      const ids = list.map((s) => s.sessionId).sort();
      expect(ids).toEqual(["a", "b", "c"]);
    });
  });

  describe("delete", () => {
    it("should delete an existing session", async () => {
      const { manager, processManager } = createSessionManager();
      await manager.create("to-delete");
      expect(manager.list()).toHaveLength(1);

      await manager.delete("to-delete");
      expect(manager.list()).toHaveLength(0);
      expect(processManager.remove).toHaveBeenCalledWith("to-delete");
    });

    it("should throw for unknown session", async () => {
      const { manager } = createSessionManager();
      await expect(manager.delete("nope")).rejects.toThrow(/not found/);
    });

    it("should allow re-creating a deleted session", async () => {
      const { manager } = createSessionManager();
      await manager.create("reuse");
      await manager.delete("reuse");
      await manager.create("reuse");

      expect(manager.list()).toHaveLength(1);
    });
  });

  describe("count", () => {
    it("should track session count correctly", async () => {
      const { manager } = createSessionManager();
      expect(manager.count).toBe(0);

      await manager.create("a");
      await manager.create("b");
      expect(manager.count).toBe(2);

      await manager.delete("a");
      expect(manager.count).toBe(1);
    });
  });

  describe("streaming state", () => {
    it("should track streaming status per session", async () => {
      const { manager } = createSessionManager();
      await manager.create("s1");

      manager.setStreaming("s1", true);
      expect(manager.getInfo("s1")!.isStreaming).toBe(true);

      manager.setStreaming("s1", false);
      expect(manager.getInfo("s1")!.isStreaming).toBe(false);
    });
  });
});
