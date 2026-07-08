#!/usr/bin/env node
/**
 * pi-remote WebSocket client — THE PRIMARY SDK.
 *
 * Copy this file into your project. Requires: npm install ws
 *
 *   import { PiRemoteWS } from "./pi_remote_ws.mjs";
 *   const client = new PiRemoteWS("ws://localhost:8080");
 *   // Connect with per-session system prompt (optional — omit for default)
 *   await client.connect({
 *     systemPrompt: "You are a Discord bot that talks like a pirate.",
 *     appendSystemPrompt: ["Keep responses under 100 chars."],
 *   });
 *
 *   // Simple chat (auto-creates session on connect)
 *   const result = await client.chat("fix the bug");
 *   console.log(result.text);
 *
 *   // Interactive with event streaming
 *   client.on("token", (text) => process.stdout.write(text));
 *   client.on("tool_start", ({ tool, args }) => console.log("Tool:", tool));
 *   await client.chat("review PR #42");
 *
 *   // Extension UI (Pi asks questions back)
 *   client.on("extension_ui_request", async (req) => {
 *     // Show dialog to user, get response
 *     client.sendExtensionUIResponse(req.id, { confirmed: true });
 *   });
 *
 *   client.close();
 */

import { WebSocket } from "ws";

const PROTOCOL_VERSION = 1;

export class PiRemoteWS {
  #ws = null;
  #url;
  #apiKey;
  #sessionId = null;
  #requestId = 0;
  #eventHandlers = {};
  #pendingCommands = new Map();
  #connected = false;

  constructor(url = "ws://localhost:8080", apiKey = null) {
    this.#url = url;
    this.#apiKey = apiKey;
  }

  // ── Lifecycle ──────────────────────────────────────────

  async connect({ systemPrompt, appendSystemPrompt } = {}) {
    if (this.#connected) return;

    const ws = new WebSocket(this.#url);
    this.#ws = ws;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Connection timeout")),
        10_000,
      );
      ws.on("open", () => {
        clearTimeout(timer);
        // Send hello handshake with optional per-session system prompt
        const hello = {
          type: "hello",
          protocolVersion: PROTOCOL_VERSION,
          clientId: `pi-remote-js-${Date.now()}`,
        };
        if (systemPrompt) hello.systemPrompt = systemPrompt;
        if (appendSystemPrompt) hello.appendSystemPrompt = appendSystemPrompt;
        ws.send(JSON.stringify(hello));
      });
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "welcome") {
          this.#sessionId = msg.sessionId;
          this.#connected = true;
          resolve(msg);
          return;
        }
        if (msg.type === "error" && !this.#connected) {
          reject(new Error(msg.message));
        }
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Start message handler loop after handshake
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      this.#handleMessage(msg);
    });

    ws.on("close", () => {
      this.#connected = false;
      this.#sessionId = null;
      // Reject all pending commands
      for (const [, pending] of this.#pendingCommands) {
        pending.reject(new Error("Connection closed"));
      }
      this.#pendingCommands.clear();
      this.#emit("close");
    });

    ws.on("error", (err) => {
      this.#emit("error", err);
    });

    return this;
  }

  close() {
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  get sessionId() {
    return this.#sessionId;
  }
  get isConnected() {
    return this.#connected;
  }

  // ── Events ─────────────────────────────────────────────

  on(event, handler) {
    if (!this.#eventHandlers[event]) this.#eventHandlers[event] = [];
    this.#eventHandlers[event].push(handler);
    return this;
  }

  #emit(event, ...args) {
    const handlers = this.#eventHandlers[event];
    if (handlers) {
      for (const h of handlers) h(...args);
    }
  }

  #handleMessage(msg) {
    switch (msg.type) {
      case "event": {
        const event = msg.payload;
        if (!event) return;

        // Map Pi events to client-friendly ones
        if (event.type === "message_update") {
          const ae = event.assistantMessageEvent ?? {};
          if (ae.type === "text_delta") {
            this.#emit("token", ae.delta ?? "");
          } else if (ae.type === "thinking_delta") {
            this.#emit("thinking", ae.delta ?? "");
          } else {
            this.#emit("message", event);
          }
        } else if (event.type === "tool_execution_start") {
          this.#emit("tool_start", {
            tool: event.toolName,
            args: event.args,
            id: event.toolCallId,
          });
        } else if (event.type === "tool_execution_update") {
          this.#emit("tool_output", { output: event.partialResult });
        } else if (event.type === "tool_execution_end") {
          this.#emit("tool_end", {
            result: event.result,
            isError: event.isError,
          });
        } else if (event.type === "agent_end") {
          this.#emit("agent_end", event);
        } else {
          this.#emit("event", event);
        }
        break;
      }

      case "response": {
        // Match by requestId (client-generated, server-echoed)
        if (
          msg.requestId !== undefined &&
          this.#pendingCommands.has(msg.requestId)
        ) {
          const pending = this.#pendingCommands.get(msg.requestId);
          this.#pendingCommands.delete(msg.requestId);
          clearTimeout(pending.timer);
          pending.resolve(msg.payload ?? msg);
        }
        break;
      }

      case "extension_ui_request": {
        this.#emit("extension_ui_request", {
          id: msg.id,
          method: msg.method,
          message: msg.message,
          options: msg.options,
          default: msg.default,
        });
        break;
      }

      case "error": {
        this.#emit("error", new Error(msg.message));
        break;
      }
    }
  }

  // ── Commands ───────────────────────────────────────────

  async sendCommand(payload, timeoutMs = 120_000) {
    if (!this.#connected) throw new Error("Not connected");
    if (!this.#ws) throw new Error("WebSocket closed");

    const requestId = `req_${++this.#requestId}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingCommands.delete(requestId);
        reject(new Error(`Command ${payload.type} timed out`));
      }, timeoutMs);

      this.#pendingCommands.set(requestId, { resolve, reject, timer });

      this.#ws.send(
        JSON.stringify({ type: "command", payload, requestId }),
      );
    });
  }

  // ── Convenience methods ────────────────────────────────

  async health() {
    const resp = await this.sendCommand({ type: "get_health" });
    return resp;
  }

  async version() {
    const resp = await this.sendCommand({ type: "get_version" });
    return resp;
  }

  async listSessions() {
    const resp = await this.sendCommand({ type: "list_sessions" });
    return resp.sessions ?? [];
  }

  async createSession(sessionId, cwd) {
    const resp = await this.sendCommand({
      type: "create_session",
      sessionId,
      cwd,
    });
    return resp;
  }

  async switchSession(sessionId) {
    const resp = await this.sendCommand({
      type: "switch_session",
      sessionId,
    });
    this.#sessionId = sessionId;
    return resp;
  }

  async deleteSession(sessionId) {
    const resp = await this.sendCommand({
      type: "delete_session",
      sessionId: sessionId ?? this.#sessionId,
    });
    if ((sessionId ?? this.#sessionId) === this.#sessionId) {
      this.#sessionId = null;
    }
    return resp;
  }

  /**
   * Send a prompt and stream results back.
   * Returns { text, toolCalls, sessionId } when agent_end fires.
   *
   * If onToken/onTool callbacks are provided, they fire during streaming.
   * Otherwise events go through the .on() handlers.
   */
  async chat(message, { onToken, onTool } = {}) {
    const result = { text: "", toolCalls: [], sessionId: this.#sessionId };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Chat timeout")),
        120_000,
      );

      const tokenHandler = (t) => {
        result.text += t;
        onToken?.(t);
      };

      const toolHandler = (t) => {
        result.toolCalls.push(t);
        onTool?.(t);
      };

      const doneHandler = () => {
        clearTimeout(timer);
        this.off("token", tokenHandler);
        this.off("tool_start", toolHandler);
        this.off("agent_end", doneHandler);
        resolve(result);
      };

      this.on("token", tokenHandler);
      this.on("tool_start", toolHandler);
      this.on("agent_end", doneHandler);

      this.sendCommand({ type: "prompt", message }).catch((err) => {
        clearTimeout(timer);
        this.off("token", tokenHandler);
        this.off("tool_start", toolHandler);
        this.off("agent_end", doneHandler);
        reject(err);
      });
    });
  }

  /**
   * Send a response to an extension UI dialog (select, confirm, input, editor).
   */
  sendExtensionUIResponse(requestId, response) {
    if (!this.#ws) return;
    this.#ws.send(
      JSON.stringify({
        type: "extension_ui_response",
        requestId,
        response,
      }),
    );
  }

  /**
   * Abort the current running task.
   */
  async abort() {
    return this.sendCommand({ type: "abort" });
  }

  off(event, handler) {
    const handlers = this.#eventHandlers[event];
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
    return this;
  }
}

// ── Demo — only runs when executed directly ──────────────
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop())
) {
  const args = process.argv.slice(2);
  let url = "ws://localhost:8080";
  let message = "say hello in one sentence";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) url = args[++i];
    else if (args[i] === "--key" && args[i + 1]) args[++i];
    else {
      message = args.slice(i).join(" ");
      break;
    }
  }

  const client = new PiRemoteWS(url);

  console.log(`Connecting to ${url}...`);
  await client.connect();
  console.log(
    `Connected! Session: ${client.sessionId}, Server: v0.2.0`,
  );

  // Health check
  const health = await client.health();
  console.log(
    `Health: ${health.status}, ${health.sessions} sessions, ${health.wsClients} WS clients\n`,
  );

  // Chat with streaming
  console.log(`> ${message}\n`);
  client.on("token", (t) => process.stdout.write(t));
  client.on("tool_start", ({ tool, args }) =>
    console.log(`\n[Tool: ${tool}]`),
  );

  const result = await client.chat(message);
  console.log(`\n\nDone. ${result.toolCalls.length} tool calls.`);

  client.close();
}
