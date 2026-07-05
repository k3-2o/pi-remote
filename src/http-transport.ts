/**
 * HTTP Transport — exposes pi-server's API over HTTP/1.1 with SSE streaming.
 *
 * Built on Hono (lightweight, fast, TypeScript-native).
 *
 * Endpoints:
 *  POST /v1/chat              → send prompt, stream response (SSE)
 *  POST /v1/sessions          → create session
 *  GET  /v1/sessions          → list sessions
 *  GET  /v1/sessions/:id      → get session info
 *  DELETE /v1/sessions/:id    → delete session
 *  POST /v1/sessions/:id/chat → chat in specific session
 *  POST /v1/sessions/:id/abort → abort running task
 *  GET  /v1/health            → health check
 *  GET  /v1/version           → version info
 *  GET  /v1/logs              → tail logs
 */

import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { SessionManager } from "./session-manager.js";
import { RpcAdapter } from "./rpc-adapter.js";
import type { AuthProvider } from "./auth.js";
import type { Logger } from "./logger.js";

export class HttpTransport {
  private app: Hono;

  constructor(
    private sessionManager: SessionManager,
    private authProvider: AuthProvider,
    private logger: Logger,
  ) {
    this.app = new Hono();

    // Auth middleware
    this.app.use("*", async (c, next) => {
      if (c.req.path === "/v1/health" || c.req.path === "/v1/version") {
        await next();
        return;
      }

      const authHeader = c.req.header("authorization");
      const result = await this.authProvider.authenticate({
        transport: "http",
        authorization: authHeader,
        remoteAddress:
          c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
      });

      if (!result.allowed) {
        return c.json({ error: result.reason }, 401);
      }

      await next();
    });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // ── Health ────────────────────────────────────────────
    this.app.get("/v1/health", (c) => {
      return c.json({
        status: "ok",
        uptime: process.uptime(),
        sessions: this.sessionManager.count,
        version: "0.1.0",
      });
    });

    this.app.get("/v1/version", (c) => {
      return c.json({
        version: "0.1.0",
        protocol: "1.0.0",
      });
    });

    // ── Sessions ──────────────────────────────────────────
    this.app.post("/v1/sessions", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        sessionId?: string;
        cwd?: string;
      };
      try {
        const info = await this.sessionManager.create(body.sessionId, body.cwd);
        return c.json(info, 201);
      } catch (err) {
        return c.json({ error: String(err) }, 400);
      }
    });

    this.app.get("/v1/sessions", (c) => {
      return c.json({ sessions: this.sessionManager.list() });
    });

    this.app.get("/v1/sessions/:id", (c) => {
      const info = this.sessionManager.getInfo(c.req.param("id"));
      if (!info) return c.json({ error: "Session not found" }, 404);
      return c.json(info);
    });

    this.app.delete("/v1/sessions/:id", async (c) => {
      try {
        await this.sessionManager.delete(c.req.param("id"));
        return c.json({ success: true });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("not found")) return c.json({ error: msg }, 404);
        return c.json({ error: msg }, 500);
      }
    });

    // ── Chat ──────────────────────────────────────────────
    this.app.post("/v1/chat", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        message?: string;
        sessionId?: string;
      };

      if (!body.message) {
        return c.json({ error: "message is required" }, 400);
      }

      const { sessionId } = await this.sessionManager.getOrCreate(
        body.sessionId,
      );
      const pi = await this.sessionManager.getProcess(sessionId);

      return streamSSE(c, async (stream) => {
        await this.handleChatStream(stream, pi, body.message!, sessionId);
      });
    });

    this.app.post("/v1/sessions/:id/chat", async (c) => {
      const sessionId = c.req.param("id");
      const body = (await c.req.json().catch(() => ({}))) as {
        message?: string;
      };

      if (!body.message) {
        return c.json({ error: "message is required" }, 400);
      }

      const pi = await this.sessionManager.getProcess(sessionId);

      return streamSSE(c, async (stream) => {
        await this.handleChatStream(stream, pi, body.message!, sessionId);
      });
    });

    this.app.post("/v1/sessions/:id/abort", async (c) => {
      const sessionId = c.req.param("id");
      try {
        const pi = await this.sessionManager.getProcess(sessionId);
        const adapter = new RpcAdapter(pi);
        await adapter.sendCommand({ type: "abort" });
        return c.json({ success: true });
      } catch (err) {
        return c.json({ error: String(err) }, 500);
      }
    });
  }

  /**
   * Send an SSE event. Tries to map Pi events to SSE event types.
   */
  private sendSSEEvent(
    stream: SSEStreamingApi,
    event: Record<string, unknown>,
  ): void {
    const type = event.type as string;

    // Extension UI requests are not forwarded via SSE (WebSocket only)
    if (type === "extension_ui_request") return;

    // Map event types
    if (type === "message_update") {
      const assistantEvent = (event.assistantMessageEvent ?? {}) as Record<
        string,
        unknown
      >;
      const deltaType = assistantEvent.type as string;

      if (deltaType === "text_delta") {
        stream
          .writeSSE({
            event: "token",
            data: JSON.stringify({ text: assistantEvent.delta }),
          })
          .catch(() => {});
      } else if (deltaType === "thinking_delta") {
        stream
          .writeSSE({
            event: "thinking",
            data: JSON.stringify({ thinking: assistantEvent.delta }),
          })
          .catch(() => {});
      } else {
        stream
          .writeSSE({ event: "message", data: JSON.stringify(event) })
          .catch(() => {});
      }
      return;
    }

    if (type === "tool_execution_start") {
      stream
        .writeSSE({
          event: "tool_start",
          data: JSON.stringify({
            tool: event.toolName,
            args: event.args,
            id: event.toolCallId,
          }),
        })
        .catch(() => {});
      return;
    }

    if (type === "tool_execution_update") {
      stream
        .writeSSE({
          event: "tool_output",
          data: JSON.stringify({ output: event.partialResult }),
        })
        .catch(() => {});
      return;
    }

    if (type === "tool_execution_end") {
      stream
        .writeSSE({
          event: "tool_end",
          data: JSON.stringify({
            result: event.result,
            isError: event.isError,
          }),
        })
        .catch(() => {});
      return;
    }

    // Fallback: forward the raw event
    stream
      .writeSSE({ event: type, data: JSON.stringify(event) })
      .catch(() => {});
  }

  /**
   * Shared chat stream logic — waits for agent_end before finishing.
   * Pi's RPC prompt response is just acceptance; events stream after.
   */
  private async handleChatStream(
    stream: SSEStreamingApi,
    pi: any,
    message: string,
    sessionId: string,
  ): Promise<void> {
    this.sessionManager.setStreaming(sessionId, true);
    const adapter = new RpcAdapter(pi);

    try {
      const done = new Promise<void>((resolve) => {
        adapter.onEvent((event) => {
          this.sendSSEEvent(stream, event);
          if (event.type === "agent_end") resolve();
        });
      });

      const timeout = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("Chat timeout")), 120_000);
      });

      await adapter.sendCommand({ type: "prompt", message });
      await Promise.race([done, timeout]);

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({}),
      });
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: String(err) }),
      });
    } finally {
      this.sessionManager.setStreaming(sessionId, false);
      this.sessionManager.incrementMessages(sessionId);
    }
  }

  /**
   * Start the HTTP server.
   */
  start(port: number, host: string): void {
    // For Node.js with Hono, we use serve from @hono/node-server
    // This is set up in server.ts
    this.logger.info("HTTP transport ready", { port, host });
  }

  /**
   * Get the Hono app for external serving.
   */
  getApp(): Hono {
    return this.app;
  }
}
