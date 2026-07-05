/**
 * WebSocket Transport — real-time bidirectional communication.
 *
 * Protocol (based on marcfargas/pi-server, MIT license):
 * 1. Client connects → sends HelloMessage { protocolVersion, clientId }
 * 2. Server validates → sends WelcomeMessage { sessions, serverVersion, currentSeq }
 * 3. Steady-state: client sends commands, server streams events
 * 4. Extension UI requests are forwarded to client as events
 * 5. Client sends extension_ui_responses back
 *
 * Heartbeat: ping every 30s, pong timeout 10s.
 * Backpressure: drop non-critical at 64KB, close at 1MB.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { SessionManager } from "./session-manager.js";
import type { ExtensionUIBridge } from "./extension-ui.js";
import type { AuthProvider } from "./auth.js";
import type { Logger } from "./logger.js";
import type { ServerConfig } from "./types.js";

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
    private config: ServerConfig,
  ) {
    // Wire extension UI to forward requests to all connected WS clients
    extensionUI.onUIRequest = (request) => {
      this.broadcast(request);
    };
  }

  /**
   * Start the WebSocket server on the given HTTP server.
   */
  start(server: any): void {
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.logger.info("WebSocket transport ready");
  }

  /**
   * Stop the WebSocket server.
   */
  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
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

    const send = (data: object, critical = false): boolean => {
      if (ws.readyState !== WebSocket.OPEN) return false;

      const str = JSON.stringify(data);

      // Backpressure check
      if (
        !critical &&
        ws.bufferedAmount > this.config.server.backpressureThreshold
      ) {
        return false; // dropped
      }

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
    };

    ws.on("message", async (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(
          { type: "error", code: "INVALID_JSON", message: "Invalid JSON" },
          true,
        );
        return;
      }

      if (!handshakeComplete) {
        // Expect HelloMessage
        if (msg.type !== "hello") {
          send(
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

        const protoVersion = msg.protocolVersion as number;
        if (protoVersion !== PROTOCOL_VERSION) {
          send(
            {
              type: "error",
              code: "INCOMPATIBLE_PROTOCOL",
              message: `Protocol version ${protoVersion} not supported (server: ${PROTOCOL_VERSION})`,
              serverVersion: PROTOCOL_VERSION,
            },
            true,
          );
          ws.close(1002, "Incompatible protocol version");
          return;
        }

        // Auth
        const remoteAddress = req.socket?.remoteAddress;
        const authResult = await this.authProvider.authenticate({
          transport: "websocket",
          remoteAddress,
        });

        if (!authResult.allowed) {
          send(
            { type: "error", code: "AUTH_FAILED", message: authResult.reason },
            true,
          );
          ws.close(1008, "Authentication failed");
          return;
        }

        state.identity = authResult.identity ?? null;
        handshakeComplete = true;

        // Send welcome with full state
        send(
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

      // Steady-state messages
      switch (msg.type) {
        case "command": {
          const payload = msg.payload as Record<string, unknown> | undefined;
          if (!payload) {
            send(
              {
                type: "error",
                code: "INVALID_COMMAND",
                message: "Command payload required",
              },
              true,
            );
            return;
          }
          // TODO: Route command to session's Pi process
          // This requires session context in the command
          break;
        }

        case "extension_ui_response": {
          const requestId = msg.requestId as string;
          const response = msg.response as Record<string, unknown>;
          this.extensionUI.handleResponse(requestId, response ?? {});
          break;
        }

        case "ping": {
          send({ type: "pong" });
          break;
        }

        default: {
          send(
            {
              type: "error",
              code: "UNKNOWN_MESSAGE_TYPE",
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

  /**
   * Send a message to all connected clients (for extension UI broadcasts).
   */
  broadcast(data: object): void {
    if (!this.wss) return;
    const str = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(str);
        } catch {
          // Ignore per-client send failures
        }
      }
    }
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
