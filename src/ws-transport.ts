/**
 * WebSocket Transport — real-time bidirectional communication with Pi events.
 *
 * Protocol:
 * 1. Client connects → sends HelloMessage { protocolVersion, clientId }
 * 2. Server validates → sends WelcomeMessage { sessions, serverVersion, seq }
 * 3. Client sends commands → routed to session's Pi process
 * 4. Pi events stream back to client
 * 5. Extension UI requests relayed through ExtensionUIBridge
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import type { SessionManager } from "./session-manager.js";
import type { ExtensionUIBridge } from "./extension-ui.js";
import type { AuthProvider } from "./auth.js";
import type { Logger } from "./logger.js";
import { RpcAdapter } from "./rpc-adapter.js";

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
    },
  ) {
    // Wire extension UI forwarding to all WS clients
    extensionUI.onUIRequest = (request) => {
      this.broadcast({ type: "extension_ui_request", ...request });
    };
  }

  start(server: Server): void {
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.logger.info("WebSocket transport ready");
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

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

        this.send(
          ws,
          {
            type: "welcome",
            protocolVersion: PROTOCOL_VERSION,
            serverVersion: "0.1.0",
            sessions: this.sessionManager.list(),
            currentSeq: this.seq,
          },
          true,
        );

        this.startHeartbeat(ws, state);
        return;
      }

      // ── Steady-state: commands ───────────────────────────
      switch (msg.type) {
        case "command": {
          const payload = msg.payload as Record<string, unknown> | undefined;
          if (!payload) {
            this.send(
              ws,
              {
                type: "error",
                code: "INVALID_COMMAND",
                message: "payload required",
              },
              true,
            );
            return;
          }

          // Resolve session
          const sid = (msg.sessionId as string) || state.sessionId;
          if (!sid) {
            this.send(
              ws,
              {
                type: "error",
                code: "NO_SESSION",
                message:
                  "No session selected. Send a command with sessionId or switch_session first.",
              },
              true,
            );
            return;
          }

          try {
            const pi = await this.sessionManager.getProcess(sid);
            state.sessionId = sid;

            // Create adapter and subscribe events to this client
            const adapter = new RpcAdapter(pi as any);
            adapter.onEvent((event) => {
              // Route extension UI requests through the bridge
              if (event.type === "extension_ui_request") {
                const promise = this.extensionUI.handleRequest(event);
                if (promise) {
                  promise.then((response) => {
                    (pi as any).send(response);
                  });
                }
                // Fire-and-forget or dialog — both broadcast to client
                this.send(ws, { type: "extension_ui_request", ...event });
                return;
              }

              // Forward all other events to client
              this.send(ws, {
                type: "event",
                seq: this.seq++,
                sessionId: sid,
                payload: event,
              });
            });

            const response = await adapter.sendCommand(payload);

            // Forward the actual Pi response to client
            this.send(ws, {
              type: "response",
              seq: this.seq++,
              sessionId: sid,
              payload: response,
            });
          } catch (err) {
            this.send(
              ws,
              {
                type: "error",
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
    });

    ws.on("close", () => {
      this.stopHeartbeat(state);
      this.extensionUI.cancelAll();
    });

    ws.on("error", () => {
      this.stopHeartbeat(state);
      this.extensionUI.cancelAll();
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
