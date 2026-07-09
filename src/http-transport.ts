/**
 * HTTP Transport — SUGAR LAYER over pi-remote's WebSocket-first protocol.
 *
 * AI is a conversation, not a transaction. WebSocket is the real protocol.
 * HTTP exists for curl, webhooks, cron, CI — the 10% of tasks that are fire-and-forget.
 *
 * Limitation: extension_ui_request events are DROPPED here (HTTP can't do bidirectional).
 * Use WebSocket if your agent needs to ask questions back (select, confirm, input dialogs).
 *
 * Built on Hono (lightweight, fast, TypeScript-native).
 *
 * Endpoints (SUGAR ONLY — use WebSocket for the full protocol):
 *  GET  /v1/health            → health check
 *  GET  /v1/version           → version info
 *  POST /v1/chat              → fire-and-forget prompt, SSE stream back
 *  POST /v1/sessions          → create session (convenience)
 *  GET  /v1/sessions          → list sessions (dashboard/monitoring)
 *  GET  /v1/sessions/:id      → get session info
 *  DELETE /v1/sessions/:id    → delete session
 *  GET  /v1/sessions/:id/watch → passive SSE — watch a session's live output
 *  GET  /v1/sessions/:id/log  → recent events from event log for a session
 *  GET  /v1/ui                → browser attach dashboard (static HTML)
 *
 * Removed from HTTP (use WebSocket for these):
 *  POST /v1/sessions/:id/chat  → WS: send command { type: "prompt" }
 *  POST /v1/sessions/:id/abort → WS: send command { type: "abort" }
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { SessionManager } from "./session-manager.js";
import { RpcAdapter } from "./rpc-adapter.js";
import type { AuthProvider } from "./auth.js";
import type { Logger } from "./logger.js";
import { EventLog } from "./event-log.js";
import { MessageAccumulator } from "./message-accumulator.js";

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

      let authHeader = c.req.header("authorization");
      // EventSource can't send custom headers, so support ?apikey= query param
      if (!authHeader) {
        const apikey = c.req.query("apikey");
        if (apikey) authHeader = `Bearer ${apikey}`;
      }
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
        version: "0.2.1",
      });
    });

    this.app.get("/v1/version", (c) => {
      return c.json({
        version: "0.2.1",
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

    // ── UI (static dashboard) ────────────────────────────
    this.app.get("/v1/ui", (c) => {
      const html = this.loadUI();
      if (!html) {
        return c.text("UI not found. Run `node build.mjs` first.", 404);
      }
      return c.html(html);
    });

    // ── Session Watch (passive SSE) ───────────────────────
    this.app.get("/v1/sessions/:id/watch", async (c) => {
      const sessionId = c.req.param("id");
      const info = this.sessionManager.getInfo(sessionId);
      if (!info) return c.json({ error: "Session not found" }, 404);

      const pi = this.sessionManager.getProcessIfExists(sessionId);
      if (!pi) {
        return streamSSE(c, async (stream) => {
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ reason: "no_active_process", sessionId }),
          });
        });
      }

      return streamSSE(c, async (stream) => {
        const unsubscribe = pi.addMessageListener((message) => {
          const type = message.type as string;

          if (type === "extension_ui_request") return;
          if (type === "response") return;

          // Pi emits events in two formats:
          //   1. Unwrapped (most common): { type: "message_update", ... }
          //   2. Wrapped: { type: "event", event: { type: "message_update", ... } }
          // Resolve the actual event payload regardless of format.
          const raw =
            type === "event"
              ? (message.event as Record<string, unknown> | undefined)
              : message;

          if (!raw) return;
          const rawType = raw.type as string;

          if (rawType === "message_update") {
            const ae = (raw.assistantMessageEvent ?? {}) as Record<
              string,
              unknown
            >;
            const dt = ae.type as string;
            if (dt === "text_delta") {
              stream
                .writeSSE({
                  event: "token",
                  data: JSON.stringify({ text: ae.delta }),
                })
                .catch(() => {});
            } else if (dt === "thinking_delta") {
              stream
                .writeSSE({
                  event: "thinking",
                  data: JSON.stringify({ thinking: ae.delta }),
                })
                .catch(() => {});
            } else {
              stream
                .writeSSE({ event: "message", data: JSON.stringify(raw) })
                .catch(() => {});
            }
          } else if (rawType === "tool_execution_start") {
            stream
              .writeSSE({
                event: "tool_start",
                data: JSON.stringify({
                  tool: raw.toolName,
                  args: raw.args,
                  id: raw.toolCallId,
                }),
              })
              .catch(() => {});
          } else if (rawType === "tool_execution_update") {
            stream
              .writeSSE({
                event: "tool_output",
                data: JSON.stringify({ output: raw.partialResult }),
              })
              .catch(() => {});
          } else if (rawType === "tool_execution_end") {
            stream
              .writeSSE({
                event: "tool_end",
                data: JSON.stringify({
                  result: raw.result,
                  isError: raw.isError,
                }),
              })
              .catch(() => {});
          } else if (rawType === "agent_end") {
            stream
              .writeSSE({ event: "done", data: JSON.stringify({ sessionId }) })
              .catch(() => {});
          } else {
            // Forward lifecycle events (agent_start, turn_start, message_start, etc.) as-is
            stream
              .writeSSE({ event: rawType, data: JSON.stringify(raw) })
              .catch(() => {});
          }
        });

        stream.onAbort(() => {
          unsubscribe();
        });
        await new Promise(() => {});
      });
    });

    // ── Session Log (historical events from JSONL) ────────
    this.app.get("/v1/sessions/:id/log", (c) => {
      const sessionId = c.req.param("id");
      const info = this.sessionManager.getInfo(sessionId);
      if (!info) return c.json({ error: "Session not found" }, 404);

      const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

      try {
        const lines = EventLog.tail(5000);
        const filtered = lines
          .map((l) => {
            try {
              return JSON.parse(l) as Record<string, unknown>;
            } catch {
              return null;
            }
          })
          .filter(
            (e): e is Record<string, unknown> =>
              e !== null && e.sessionId === sessionId,
          )
          .slice(-limit);

        return c.json({ sessionId, events: filtered });
      } catch {
        return c.json({ sessionId, events: [] });
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

      // If sessionId provided, reuse it. Otherwise one-shot: temp session, clean up after.
      const hasExplicitSession = !!body.sessionId;
      const { sessionId } = await this.sessionManager.getOrCreate(
        body.sessionId,
      );
      const pi = await this.sessionManager.getProcess(sessionId);

      return streamSSE(c, async (stream) => {
        await this.handleChatStream(
          stream,
          pi,
          body.message!,
          sessionId,
          !hasExplicitSession,
        );
      });
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
    temporary = false,
  ): Promise<void> {
    this.sessionManager.setStreaming(sessionId, true);
    const adapter = new RpcAdapter(pi);

    EventLog.append({
      event: "chat_start",
      sessionId,
      message: message.slice(0, 200),
    });

    try {
      const acc = new MessageAccumulator(sessionId);
      const done = new Promise<void>((resolve) => {
        adapter.onEvent((event) => {
          this.sendSSEEvent(stream, event);
          acc.feed(event);
          if (event.type === "agent_end") {
            acc.flush();
            resolve();
          }
        });
      });

      const timeout = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("Chat timeout")), 120_000);
      });

      await adapter.sendCommand({ type: "prompt", message });
      await Promise.race([done, timeout]);

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ sessionId }),
      });
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: String(err) }),
      });
    } finally {
      adapter.dispose();
      this.sessionManager.setStreaming(sessionId, false);
      this.sessionManager.incrementMessages(sessionId);

      // One-shot chat: free Pi process but keep session record
      if (temporary) {
        this.sessionManager.deactivate(sessionId).catch((err) => {
          this.logger.error("Failed to deactivate temp session", {
            sessionId,
            error: String(err),
          });
        });
      }
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

  /**
   * Load the UI HTML file.
   * Resolves relative to the current module's location so it works
   * both in dev (src/http-transport.ts → src/ui/index.html) and
   * in production (dist/cli.js → dist/ui/index.html after build copy).
   */
  private loadUI(): string | null {
    if (this._uiHtml) return this._uiHtml;

    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(moduleDir, "ui", "index.html"),
      resolve(moduleDir, "..", "src", "ui", "index.html"),
    ];

    for (const path of candidates) {
      if (existsSync(path)) {
        this._uiHtml = readFileSync(path, "utf-8");
        this.logger.info("UI loaded", { path });
        return this._uiHtml;
      }
    }

    this.logger.warn("UI file not found", { candidates });
    return null;
  }
  private _uiHtml: string | null = null;
}
