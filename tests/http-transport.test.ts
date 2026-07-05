/**
 * Phase 3 Tests: HTTP Transport
 *
 * Integration tests for the Hono-based HTTP layer.
 * Tests endpoints with mocked SessionManager and dependencies.
 *
 * Endpoints tested:
 * - POST /v1/chat          (send prompt, get response)
 * - POST /v1/sessions      (create session)
 * - GET  /v1/sessions      (list sessions)
 * - GET  /v1/sessions/:id  (get session)
 * - DELETE /v1/sessions/:id
 * - GET  /v1/health
 * - GET  /v1/version
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpTransport } from "../src/http-transport.js";
import type { SessionManager } from "../src/session-manager.js";
import type { SessionInfo } from "../src/types.js";
import { NoAuthProvider } from "../src/auth.js";
import { ConsoleLogger } from "../src/logger.js";

// ---------------------------------------------------------------------------
// Mock SessionManager
// ---------------------------------------------------------------------------

function createMockSessionManager(sessions: SessionInfo[] = []) {
  let idCounter = 0;
  const sessionMap = new Map<string, SessionInfo>();
  for (const s of sessions) sessionMap.set(s.sessionId, s);

  return {
    create: vi.fn(async (id?: string) => {
      const sessionId = id ?? `session-${++idCounter}`;
      const info: SessionInfo = {
        sessionId,
        isStreaming: false,
        messageCount: 0,
        createdAt: new Date().toISOString(),
        thinkingLevel: "medium",
      };
      sessionMap.set(sessionId, info);
      return info;
    }),
    delete: vi.fn(async (id: string) => {
      if (!sessionMap.has(id)) throw new Error("not found");
      sessionMap.delete(id);
    }),
    list: vi.fn(() => [...sessionMap.values()]),
    getInfo: vi.fn((id: string) => sessionMap.get(id)),
    count: 0,
    getOrCreate: vi.fn(async (id?: string) => {
      const existing = id ? sessionMap.get(id) : undefined;
      if (existing) return { sessionId: id!, created: false };
      const info: SessionInfo = {
        sessionId: id ?? `session-${++idCounter}`,
        isStreaming: false,
        messageCount: 0,
        createdAt: new Date().toISOString(),
        thinkingLevel: "medium",
      };
      sessionMap.set(info.sessionId, info);
      return { sessionId: info.sessionId, created: true };
    }),
    get: vi.fn((id: string) => sessionMap.get(id)),
    getProcess: vi.fn(async () => {
      throw new Error("no process in test");
    }),
    setStreaming: vi.fn(),
    incrementMessages: vi.fn(),
  } as unknown as SessionManager;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTransport(sessions: SessionInfo[] = []) {
  const sessionManager = createMockSessionManager(sessions);
  const auth = new NoAuthProvider();
  const logger = new ConsoleLogger({ level: "error" });

  return {
    transport: new HttpTransport(sessionManager, auth, logger),
    sessionManager,
  };
}

/** Send a request to the Hono app and get the raw Response */
async function request(
  transport: HttpTransport,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const app = transport.getApp();
  const url = new URL(path, "http://localhost");
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await app.request(url.toString(), init);
  let responseBody: unknown;
  try {
    responseBody = await res.json();
  } catch {
    responseBody = null;
  }
  return { status: res.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HttpTransport", () => {
  describe("Health & Version", () => {
    it("should return health status", async () => {
      const { transport } = createTransport();
      const { status, body } = await request(transport, "GET", "/v1/health");
      expect(status).toBe(200);
      expect(body).toMatchObject({ status: "ok" });
    });

    it("should return version info", async () => {
      const { transport } = createTransport();
      const { status, body } = await request(transport, "GET", "/v1/version");
      expect(status).toBe(200);
      expect(body).toMatchObject({
        version: expect.any(String),
        protocol: expect.any(String),
      });
    });
  });

  describe("Sessions", () => {
    it("should create a session", async () => {
      const { transport } = createTransport();
      const { status, body } = await request(transport, "POST", "/v1/sessions");
      expect(status).toBe(201);
      expect(body).toMatchObject({
        sessionId: expect.any(String),
        isStreaming: false,
      });
    });

    it("should create a session with custom ID", async () => {
      const { transport } = createTransport();
      const { status, body } = await request(
        transport,
        "POST",
        "/v1/sessions",
        {
          sessionId: "my-session",
        },
      );
      expect(status).toBe(201);
      expect(body).toMatchObject({ sessionId: "my-session" });
    });

    it("should list sessions", async () => {
      const { transport } = createTransport([
        {
          sessionId: "a",
          isStreaming: false,
          messageCount: 0,
          createdAt: "2026-01-01",
          thinkingLevel: "low",
        },
      ]);
      const { status, body } = await request(transport, "GET", "/v1/sessions");
      expect(status).toBe(200);
      const data = body as { sessions: SessionInfo[] };
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].sessionId).toBe("a");
    });

    it("should get session by ID", async () => {
      const { transport, sessionManager } = createTransport();
      await (
        sessionManager as ReturnType<typeof createMockSessionManager>
      ).create("s1");
      const { status, body } = await request(
        transport,
        "GET",
        "/v1/sessions/s1",
      );
      expect(status).toBe(200);
      expect(body).toMatchObject({ sessionId: "s1" });
    });

    it("should return 404 for unknown session", async () => {
      const { transport } = createTransport();
      const { status, body } = await request(
        transport,
        "GET",
        "/v1/sessions/nope",
      );
      expect(status).toBe(404);
      expect(body).toMatchObject({ error: expect.any(String) });
    });

    it("should delete a session", async () => {
      const { transport, sessionManager } = createTransport();
      await (
        sessionManager as ReturnType<typeof createMockSessionManager>
      ).create("to-delete");
      const { status } = await request(
        transport,
        "DELETE",
        "/v1/sessions/to-delete",
      );
      expect(status).toBe(200);
      const after = (
        sessionManager as ReturnType<typeof createMockSessionManager>
      ).list();
      expect(after).toHaveLength(0);
    });
  });

  describe("Chat", () => {
    it("should return 400 if message is missing", async () => {
      const { transport } = createTransport();
      const { status, body } = await request(transport, "POST", "/v1/chat", {
        not_a_message: true,
      });
      expect(status).toBe(400);
      expect(body).toMatchObject({ error: expect.stringContaining("message") });
    });

    it("should return 400 if body is not JSON", async () => {
      const { transport } = createTransport();
      const app = transport.getApp();
      const res = await app.request("http://localhost/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Auth", () => {
    it("should allow health check without auth", async () => {
      const { transport } = createTransport();
      const { status } = await request(transport, "GET", "/v1/health");
      expect(status).toBe(200);
    });

    it("should allow version check without auth", async () => {
      const { transport } = createTransport();
      const { status } = await request(transport, "GET", "/v1/version");
      expect(status).toBe(200);
    });
  });
});
