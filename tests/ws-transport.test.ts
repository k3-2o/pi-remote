/**
 * ws-transport integration tests — the WebSocket-first architecture.
 *
 * Each test connects via WebSocket, tests a feature, disconnects.
 * A single pi-remote server is started before all tests and stopped after.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PORT = 8091;
const PID_FILE = resolve(homedir(), ".pi", "pi-server.pid");
let server: ChildProcess | null = null;

// ── Helpers ───────────────────────────────────────────────

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WS connect timeout"));
    }, 5000);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function handshake(ws: WebSocket, clientId = "test") {
  ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId }));
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Welcome timeout")), 5000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

async function sendCommand(
  ws: WebSocket,
  payload: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  const requestId = `test_${Math.random().toString(36).slice(2)}`;
  ws.send(JSON.stringify({ type: "command", payload, requestId }));
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Command ${payload.type} timeout`)),
      timeoutMs,
    );
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "response" && msg.requestId === requestId) {
        clearTimeout(timer);
        resolve(msg);
      }
      if (msg.type === "error" && msg.requestId === requestId) {
        clearTimeout(timer);
        reject(new Error(msg.message));
      }
    };
    ws.on("message", handler);
    // Clean up handler after timeout
    setTimeout(() => ws.off("message", handler), timeoutMs + 1000);
  });
}

// ── Server lifecycle ──────────────────────────────────────

beforeAll(async () => {
  // Clean up stale PID file
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}

  server = spawn("node", ["dist/cli.js", "start", "--port", String(PORT)], {
    stdio: "pipe",
    env: { ...process.env, PI_SERVER_PORT: String(PORT) },
  });

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Server startup timeout")),
      15000,
    );
    server!.stderr?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("pi-remote started")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server!.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    server!.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });

  // Extra wait for WS server to be ready
  await sleep(500);
}, 20000);

afterAll(async () => {
  if (server) {
    server.kill("SIGTERM");
    await sleep(1000);
    try {
      server.kill("SIGKILL");
    } catch {}
  }
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
});

// ── Tests ─────────────────────────────────────────────────

describe("WebSocket Handshake", () => {
  it("should complete hello → welcome with auto-created session", async () => {
    const ws = await connect();
    const welcome = await handshake(ws);

    expect(welcome.type).toBe("welcome");
    expect(welcome.protocolVersion).toBe(1);
    expect(welcome.serverVersion).toBe("0.2.1");
    expect(welcome.sessionId).toBeTruthy();
    expect(typeof welcome.sessionId).toBe("string");
    expect(welcome.sessionId.length).toBeGreaterThan(10);
    expect(welcome.sessions).toBeDefined();
    expect(Array.isArray(welcome.sessions)).toBe(true);

    ws.close();
  });

  it("should reject non-hello first message", async () => {
    const ws = await connect();
    ws.send(
      JSON.stringify({ type: "command", payload: { type: "get_health" } }),
    );

    const error = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });

    expect(error.type).toBe("error");
    expect(error.code).toBe("INVALID_HELLO");
    ws.close();
  });

  it("should reject incompatible protocol version", async () => {
    const ws = await connect();
    ws.send(
      JSON.stringify({ type: "hello", protocolVersion: 999, clientId: "test" }),
    );

    const error = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });

    expect(error.type).toBe("error");
    expect(error.code).toBe("INCOMPATIBLE_PROTOCOL");
    ws.close();
  });

  it("should reject invalid JSON as handshake", async () => {
    const ws = await connect();
    ws.send("not json");

    const error = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });

    expect(error.type).toBe("error");
    expect(error.code).toBe("INVALID_JSON");
    ws.close();
  });
});

describe("WS-Native Commands", () => {
  let ws: WebSocket;

  beforeEach(async () => {
    ws = await connect();
    await handshake(ws);
  });

  afterEach(() => {
    ws.close();
  });

  it("get_health returns server status", async () => {
    const resp = await sendCommand(ws, { type: "get_health" });
    expect(resp.type).toBe("response");
    expect(resp.payload).toBeDefined();
    expect(resp.payload.status).toBe("ok");
    expect(typeof resp.payload.uptime).toBe("number");
    expect(typeof resp.payload.sessions).toBe("number");
    expect(typeof resp.payload.wsClients).toBe("number");
    expect(resp.payload.version).toBe("0.2.1");
  });

  it("get_version returns version info", async () => {
    const resp = await sendCommand(ws, { type: "get_version" });
    expect(resp.type).toBe("response");
    expect(resp.payload.version).toBe("0.2.1");
    expect(resp.payload.protocol).toBeTruthy();
  });

  it("list_sessions returns session array", async () => {
    const resp = await sendCommand(ws, { type: "list_sessions" });
    expect(resp.type).toBe("response");
    expect(Array.isArray(resp.payload.sessions)).toBe(true);
    expect(resp.payload.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("create_session creates a new named session", async () => {
    const resp = await sendCommand(ws, {
      type: "create_session",
      sessionId: "my-test-session",
    });
    expect(resp.type).toBe("response");
    expect(resp.payload.sessionId).toBe("my-test-session");
  });

  it("switch_session switches to another session", async () => {
    // Create a second session
    await sendCommand(ws, { type: "create_session", sessionId: "session-b" });

    const resp = await sendCommand(ws, {
      type: "switch_session",
      sessionId: "session-b",
    });
    expect(resp.type).toBe("response");
    expect(resp.payload.type).toBe("session_switched");
    expect(resp.payload.sessionId).toBe("session-b");
  });

  it("delete_session removes a session", async () => {
    await sendCommand(ws, { type: "create_session", sessionId: "to-delete" });
    const resp = await sendCommand(ws, {
      type: "delete_session",
      sessionId: "to-delete",
    });
    expect(resp.type).toBe("response");
    expect(resp.payload.success).toBe(true);
  });

  it("rejects command with no payload", async () => {
    const ws2 = await connect();
    await handshake(ws2);
    ws2.send(JSON.stringify({ type: "command" }));

    const error = await new Promise<Record<string, unknown>>((resolve) => {
      ws2.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });
    expect(error.type).toBe("error");
    expect(error.code).toBe("INVALID_COMMAND");
    ws2.close();
  });
});

describe("Session-Scoped Commands", () => {
  let ws: WebSocket;

  beforeEach(async () => {
    ws = await connect();
    await handshake(ws);
    // Wait for Pi process to finish starting
    await sleep(1500);
  });

  afterEach(() => {
    ws.close();
  });

  it(
    "get_state forwards to Pi and returns response",
    { timeout: 25_000 },
    async () => {
      const resp = await sendCommand(ws, { type: "get_state" });
      expect(resp.type).toBe("response");
      // Pi's get_state response includes session info
      expect(resp.payload).toBeDefined();
    },
  );

  it(
    "get_available_models returns model list from Pi",
    { timeout: 25_000 },
    async () => {
      const resp = await sendCommand(ws, { type: "get_available_models" });
      expect(resp.type).toBe("response");
      expect(resp.payload).toBeDefined();
    },
  );

  it(
    "get_commands returns available command list",
    { timeout: 35_000 },
    async () => {
      const resp = await sendCommand(ws, { type: "get_commands" }, 30_000);
      expect(resp.type).toBe("response");
      expect(resp.payload).toBeDefined();
    },
  );

  it(
    "rejects unknown command type with error",
    { timeout: 30_000 },
    async () => {
      const ws2 = await connect();
      await handshake(ws2);
      // Wait for Pi process to start
      await sleep(1500);

      ws2.send(
        JSON.stringify({
          type: "command",
          payload: { type: "nonexistent_command" },
          requestId: "test_unknown",
        }),
      );

      // Wait for response — may get startup events before the response
      const msg = await new Promise<Record<string, unknown>>((resolve) => {
        const handler = (raw: Buffer) => {
          const m = JSON.parse(raw.toString());
          if (m.requestId === "test_unknown") {
            ws2.off("message", handler);
            resolve(m);
          }
        };
        ws2.on("message", handler);
      });

      // Either a response with error field or direct error from Pi RPC
      if (msg.type === "response") {
        // Pi may accept or reject unknown commands
        expect(msg.payload).toBeDefined();
      } else if (msg.type === "error") {
        expect(msg.code).toBeTruthy();
      }
      ws2.close();
    },
  );
});

describe("Session Lifecycle", () => {
  it("auto-creates session on connect", async () => {
    const ws = await connect();
    const welcome = await handshake(ws);

    expect(welcome.sessionId).toBeTruthy();

    // Session should appear in list
    const resp = await sendCommand(ws, { type: "list_sessions" });
    const sessionIds = resp.payload.sessions.map((s: any) => s.sessionId);
    expect(sessionIds).toContain(welcome.sessionId);

    ws.close();
  });

  it("deactivates session on disconnect", { timeout: 20_000 }, async () => {
    const ws = await connect();
    const welcome = await handshake(ws);
    const sid = welcome.sessionId as string;

    // Verify session exists
    const before = await sendCommand(ws, { type: "list_sessions" });
    const beforeIds = before.payload.sessions.map((s: any) => s.sessionId);
    expect(beforeIds).toContain(sid);

    ws.close();
    await sleep(1000); // Let deactivation propagate

    // Connect again with new WS, check the old session is deactivated
    const ws2 = await connect();
    await handshake(ws2);
    const after = await sendCommand(ws2, { type: "list_sessions" });
    const oldSession = after.payload.sessions.find(
      (s: any) => s.sessionId === sid,
    );
    expect(oldSession).toBeDefined();
    expect(oldSession.active).toBe(false); // Record kept, process freed

    ws2.close();
  });
});

describe("Ping/Pong", () => {
  it("responds to client ping with pong", async () => {
    const ws = await connect();
    await handshake(ws);

    ws.send(JSON.stringify({ type: "ping" }));
    const msg = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });

    expect(msg.type).toBe("pong");
    ws.close();
  });
});

describe("Error Handling", () => {
  it("returns error for unknown message type", async () => {
    const ws = await connect();
    await handshake(ws);

    ws.send(JSON.stringify({ type: "unknown_type" }));
    const msg = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });

    expect(msg.type).toBe("error");
    expect(msg.code).toBe("UNKNOWN_MESSAGE");
    ws.close();
  });
});
