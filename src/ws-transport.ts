/**
 * WebSocket Transport — THE PRIMARY INTERFACE for pi-remote.
 *
 * This is where Pi lives. AI is a conversation, not a transaction.
 * HTTP /v1/chat is sugar — this is the real protocol.
 *
 * Protocol:
 * 1. Client connects → sends HelloMessage { protocolVersion, clientId }
 * 2. Server validates + authenticates → creates session → sends WelcomeMessage
 * 3. Client sends commands → routed to session's Pi process
 * 4. Pi events stream back to client (tokens, thinking, tool calls, agent_end)
 * 5. Extension UI requests flow bidirectionally (select, confirm, input, editor)
 * 6. Session lives until disconnect → Pi process freed, record kept
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import type { SessionManager } from "./session-manager.js";
import type { ExtensionUIBridge } from "./extension-ui.js";
import type { AuthProvider } from "./auth.js";
import type { Logger } from "./logger.js";
import { RpcAdapter } from "./rpc-adapter.js";
import { EventLog } from "./event-log.js";
import type { SessionInfo } from "./types.js";

const PROTOCOL_VERSION = 1;

interface WSState {
  waitingForPong: boolean;
  lastPongAt: number;
  heartbeatTimer: NodeJS.Timeout | null;
  pongTimeoutTimer: NodeJS.Timeout | null;
  cleanedUp: boolean;
  sessionId: string | null;
  identity: string | null;
}

export class WsTransport {
  private wss: WebSocketServer | null = null;
  private states = new WeakMap<WebSocket, WSState>();
  private seq = 0;
  private sessionCreatedAt = new Map<string, number>();

  constructor(
    private sessionManager: SessionManager,
    private extensionUI: ExtensionUIBridge,
    private authProvider: AuthProvider,
    private logger: Logger,
    private config: {
      server: {
        heartbeatInterval: number;
        heartbeatTimeout: number;
        backpressureThreshold: number;
        backpressureCritical: number;
      };
      port: number;
      host: string;
    },
  ) {
    // Extension UI forwarding: when Pi emits a dialog, broadcast to all WS clients
    // The actual routing (matching requestId to client) happens per-connection
    extensionUI.onUIRequest = (request) => {
      this.broadcast({ type: "extension_ui_request", ...request });
    };
  }

  start(server: Server): void {
    this.wss = new WebSocketServer({ server });

    this.wss.on("error", (err) => {
      // EADDRINUSE is handled by the HTTP server
      this.logger.error("WebSocket server error", { error: String(err) });
    });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req).catch((err) => {
        this.logger.error("Unhandled WS connection error", {
          error: String(err),
        });
      });
    });

    this.logger.info("WebSocket transport ready (primary interface)", {
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  stop(): void {
    if (this.wss) {
      // Disconnect all clients
      for (const client of this.wss.clients) {
        this.cleanupClient(client);
      }
      this.wss.close();
      this.wss = null;
    }
  }

  get connectedClients(): number {
    return this.wss?.clients.size ?? 0;
  }

  get activeSessions(): SessionInfo[] {
    return this.sessionManager.list().filter((s) => s.active);
  }

  // ── Low-level send ────────────────────────────────────

  private send(ws: WebSocket, data: object, critical = false): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    const str = JSON.stringify(data);

    if (
      !critical &&
      ws.bufferedAmount > this.config.server.backpressureThreshold
    )
      return false;
    if (ws.bufferedAmount > this.config.server.backpressureCritical) {
      ws.close(1011, "Backpressure critical");
      return false;
    }

    try {
      ws.send(str);
      return true;
    } catch {
      return false;
    }
  }

  private broadcast(data: object): void {
    if (!this.wss) return;
    const str = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(str);
        } catch {
          // ignore per-client errors
        }
      }
    }
  }

  // ── Connection lifecycle ───────────────────────────────

  private async handleConnection(
    ws: WebSocket,
    req: IncomingMessage,
  ): Promise<void> {
    const state: WSState = {
      waitingForPong: false,
      lastPongAt: Date.now(),
      heartbeatTimer: null,
      pongTimeoutTimer: null,
      cleanedUp: false,
      sessionId: null,
      identity: null,
    };
    this.states.set(ws, state);

    let handshakeComplete = false;

    ws.on("message", async (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        this.send(
          ws,
          { type: "error", code: "INVALID_JSON", message: "Invalid JSON" },
          true,
        );
        return;
      }

      // ── Handshake ───────────────────────────────────────
      if (!handshakeComplete) {
        if (msg.type !== "hello") {
          this.send(
            ws,
            {
              type: "error",
              code: "INVALID_HELLO",
              message: "First message must be hello",
            },
            true,
          );
          ws.close(1002, "Invalid handshake");
          return;
        }

        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          this.send(
            ws,
            {
              type: "error",
              code: "INCOMPATIBLE_PROTOCOL",
              message: `Protocol ${msg.protocolVersion} unsupported`,
              serverVersion: PROTOCOL_VERSION,
            },
            true,
          );
          ws.close(1002, "Incompatible protocol");
          return;
        }

        // Authenticate
        const remoteAddress = req.socket?.remoteAddress;
        const authResult = await this.authProvider.authenticate({
          transport: "websocket",
          remoteAddress,
        });

        if (!authResult.allowed) {
          this.send(
            ws,
            { type: "error", code: "AUTH_FAILED", message: authResult.reason },
            true,
          );
          ws.close(1008, "Authentication failed");
          return;
        }

        state.identity = authResult.identity ?? null;
        handshakeComplete = true;

        // Auto-create session — connection IS the session
        const session = await this.sessionManager.createOnConnect();
        state.sessionId = session.sessionId;
        this.sessionCreatedAt.set(session.sessionId, Date.now());

        EventLog.append({
          event: "ws_client_connected",
          sessionId: session.sessionId,
          identity: state.identity,
          remoteAddress,
        });

        this.send(
          ws,
          {
            type: "welcome",
            protocolVersion: PROTOCOL_VERSION,
            serverVersion: "0.2.0",
            sessionId: session.sessionId,
            sessions: this.sessionManager.list(),
            currentSeq: this.seq,
          },
          true,
        );

        this.startHeartbeat(ws, state);
        this.logger.info("WS client connected", {
          sessionId: session.sessionId,
          identity: state.identity,
        });
        return;
      }

      // ── Steady-state: commands ───────────────────────────
      await this.handleCommand(ws, state, msg);
    });

    ws.on("close", () => {
      this.cleanupClient(ws);
    });

    ws.on("error", () => {
      this.cleanupClient(ws);
    });

    ws.on("pong", () => {
      state.waitingForPong = false;
      state.lastPongAt = Date.now();
      if (state.pongTimeoutTimer) {
        clearTimeout(state.pongTimeoutTimer);
        state.pongTimeoutTimer = null;
      }
    });
  }

  private cleanupClient(ws: WebSocket): void {
    const state = this.states.get(ws);
    if (!state) return;

    this.stopHeartbeat(state);
    this.extensionUI.cancelAll();

    if (state.sessionId) {
      const sid = state.sessionId;
      this.sessionCreatedAt.delete(sid);
      this.sessionManager
        .onDisconnect(sid)
        .then(() => {
          this.logger.info("WS client disconnected — session deactivated", {
            sessionId: sid,
          });
          EventLog.append({
            event: "ws_client_disconnected",
            sessionId: sid,
          });
        })
        .catch((err) => {
          this.logger.error("Error deactivating session on disconnect", {
            sessionId: sid,
            error: String(err),
          });
        });
    }
  }

  // ── Command routing ────────────────────────────────────

  private async handleCommand(
    ws: WebSocket,
    state: WSState,
    msg: Record<string, unknown>,
  ): Promise<void> {
    switch (msg.type) {
      case "command": {
        const payload = msg.payload as Record<string, unknown> | undefined;
        const requestId = msg.requestId as string | undefined;
        if (!payload) {
          this.send(
            ws,
            {
              type: "error",
              requestId,
              code: "INVALID_COMMAND",
              message: "payload required",
            },
            true,
          );
          return;
        }

        const commandType = payload.type as string;
        if (!commandType) {
          this.send(
            ws,
            {
              type: "error",
              requestId,
              code: "INVALID_COMMAND",
              message: "payload.type required",
            },
            true,
          );
          return;
        }

        // ── WS-native commands (no Pi process needed) ─────
        if (commandType === "list_sessions") {
          this.send(ws, {
            type: "response",
            requestId,
            seq: this.seq++,
            payload: { sessions: this.sessionManager.list() },
          });
          return;
        }

        if (commandType === "get_health") {
          this.send(ws, {
            type: "response",
            requestId,
            seq: this.seq++,
            payload: {
              status: "ok",
              uptime: process.uptime(),
              sessions: this.sessionManager.count,
              wsClients: this.connectedClients,
              version: "0.2.0",
            },
          });
          return;
        }

        if (commandType === "get_version") {
          this.send(ws, {
            type: "response",
            requestId,
            seq: this.seq++,
            payload: { version: "0.2.0", protocol: `${PROTOCOL_VERSION}.0.0` },
          });
          return;
        }

        if (commandType === "create_session") {
          const sid = (payload.sessionId as string) || undefined;
          const cwd = (payload.cwd as string) || undefined;
          try {
            const info = await this.sessionManager.create(sid, cwd);
            this.send(ws, {
              type: "response",
              requestId,
              seq: this.seq++,
              payload: info,
            });
          } catch (err) {
            this.send(
              ws,
              {
                type: "error",
                requestId,
                code: "SESSION_CREATE_FAILED",
                message: String(err),
              },
              true,
            );
          }
          return;
        }

        if (commandType === "delete_session") {
          const targetSid = (payload.sessionId as string) || state.sessionId;
          if (!targetSid) {
            this.send(
              ws,
              {
                type: "error",
                requestId,
                code: "NO_SESSION",
                message: "No session to delete",
              },
              true,
            );
            return;
          }
          try {
            await this.sessionManager.delete(targetSid);
            if (targetSid === state.sessionId) state.sessionId = null;
            this.send(ws, {
              type: "response",
              requestId,
              seq: this.seq++,
              payload: { success: true },
            });
          } catch (err) {
            this.send(
              ws,
              {
                type: "error",
                requestId,
                code: "SESSION_DELETE_FAILED",
                message: String(err),
              },
              true,
            );
          }
          return;
        }

        if (commandType === "switch_session") {
          const targetSid = payload.sessionId as string;
          if (!targetSid) {
            this.send(
              ws,
              {
                type: "error",
                requestId,
                code: "INVALID_SESSION",
                message: "sessionId required for switch_session",
              },
              true,
            );
            return;
          }
          const session = this.sessionManager.get(targetSid);
          if (!session) {
            this.send(
              ws,
              {
                type: "error",
                requestId,
                code: "SESSION_NOT_FOUND",
                message: `Session ${targetSid} not found`,
              },
              true,
            );
            return;
          }
          state.sessionId = targetSid;
          this.send(ws, {
            type: "response",
            requestId,
            seq: this.seq++,
            payload: {
              type: "session_switched",
              sessionId: targetSid,
              session: this.sessionManager.getInfo(targetSid),
            },
          });
          return;
        }

        // ── Session-scoped commands (need Pi process) ─────
        const sid = state.sessionId;
        if (!sid) {
          this.send(
            ws,
            {
              type: "error",
              requestId,
              code: "NO_SESSION",
              message:
                "No active session. Connect to create one, or use create_session.",
            },
            true,
          );
          return;
        }

        try {
          const pi = await this.sessionManager.getProcess(sid);

          // Create adapter and subscribe events to this client
          const adapter = new RpcAdapter(pi);
          adapter.onEvent((event) => {
            // Route extension UI requests through the bridge
            if (event.type === "extension_ui_request") {
              const promise = this.extensionUI.handleRequest(event);
              if (promise) {
                promise.then((response) => {
                  // Send response back to Pi's stdin
                  try {
                    pi.send(response);
                  } catch (err) {
                    this.logger.error("Failed to send ext UI response to Pi", {
                      error: String(err),
                    });
                  }
                });
              }
              // Forward to the requesting client
              this.send(ws, {
                type: "extension_ui_request",
                seq: this.seq++,
                sessionId: sid,
                ...event,
              });
              return;
            }

            // Forward all other events to client
            this.send(ws, {
              type: "event",
              seq: this.seq++,
              sessionId: sid,
              payload: event,
            });

            // Track agent_end for session message count
            if (event.type === "agent_end") {
              this.sessionManager.incrementMessages(sid);
            }
          });

          // If prompt, log it
          if (commandType === "prompt") {
            EventLog.append({
              event: "chat_start",
              sessionId: sid,
              message: String((payload.message as string) || "").slice(0, 200),
            });
          }

          const response = await adapter.sendCommand(payload);

          // Forward the Pi response to client
          this.send(ws, {
            type: "response",
            requestId,
            seq: this.seq++,
            sessionId: sid,
            payload: response,
          });
        } catch (err) {
          this.send(
            ws,
            {
              type: "error",
              requestId,
              code: "COMMAND_FAILED",
              message: String(err),
            },
            true,
          );
        }
        break;
      }

      case "extension_ui_response": {
        const requestId = msg.requestId as string;
        const response = msg.response as Record<string, unknown>;
        this.extensionUI.handleResponse(requestId, response ?? {});
        break;
      }

      case "ping": {
        this.send(ws, { type: "pong" });
        break;
      }

      default: {
        this.send(
          ws,
          {
            type: "error",
            code: "UNKNOWN_MESSAGE",
            message: `Unknown message type: ${msg.type}`,
          },
          true,
        );
      }
    }
  }

  // ── Heartbeat ──────────────────────────────────────────

  private startHeartbeat(ws: WebSocket, state: WSState): void {
    state.lastPongAt = Date.now();
    state.waitingForPong = false;
    state.cleanedUp = false;

    const interval = this.config.server.heartbeatInterval;
    const timeout = this.config.server.heartbeatTimeout;

    state.heartbeatTimer = setInterval(() => {
      if (state.cleanedUp || ws.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat(state);
        return;
      }
      if (state.waitingForPong) {
        this.stopHeartbeat(state);
        ws.close(1001, "Heartbeat timeout");
        return;
      }
      state.waitingForPong = true;
      try {
        ws.ping();
      } catch {
        this.stopHeartbeat(state);
      }
      state.pongTimeoutTimer = setTimeout(() => {
        if (state.cleanedUp) return;
        if (state.waitingForPong && ws.readyState === WebSocket.OPEN) {
          this.stopHeartbeat(state);
          ws.close(1001, "Heartbeat timeout");
        }
      }, timeout);
      if (state.pongTimeoutTimer.unref) state.pongTimeoutTimer.unref();
    }, interval);
    if (state.heartbeatTimer.unref) state.heartbeatTimer.unref();
  }

  private stopHeartbeat(state: WSState): void {
    state.cleanedUp = true;
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (state.pongTimeoutTimer) {
      clearTimeout(state.pongTimeoutTimer);
      state.pongTimeoutTimer = null;
    }
    state.waitingForPong = false;
  }
}
