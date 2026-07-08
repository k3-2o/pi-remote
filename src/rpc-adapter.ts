/**
 * RpcAdapter — translates between pi-server's internal command format and
 * Pi's JSON-RPC protocol.
 *
 * Pi's RPC is JSON lines over stdin/stdout:
 * - Write one JSON command per line to stdin
 * - Read one JSON event/response per line from stdout
 *
 * All commands support an optional `id` field for request/response correlation.
 * Events are streamed asynchronously during agent operation.
 */

import type { PiProcess } from "./pi-process.js";

export interface RpcEventCallback {
  (event: Record<string, unknown>): void;
}

export class RpcAdapter {
  private pi: PiProcess;
  private commandId = 0;
  private pendingResponses = new Map<
    string,
    {
      resolve: (data: Record<string, unknown>) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private eventHandler: RpcEventCallback | null = null;
  private unsubscribe: () => void;

  constructor(pi: PiProcess) {
    this.pi = pi;

    // Wire Pi's message stream — store unsubscribe for cleanup
    this.unsubscribe = pi.onMessage((message) => {
      this.handleMessage(message);
    });
  }

  /**
   * Remove the message listener from PiProcess.
   * Call when done to prevent stale listeners from accumulating.
   */
  dispose(): void {
    this.unsubscribe();
    this.eventHandler = null;
  }

  /**
   * Register a handler for streaming events (not responses).
   */
  onEvent(handler: RpcEventCallback): void {
    this.eventHandler = handler;
  }

  /**
   * Send a command to Pi and wait for the response.
   */
  async sendCommand(
    cmd: Record<string, unknown>,
    timeoutMs = 120_000,
  ): Promise<Record<string, unknown>> {
    const id = `pi_${++this.commandId}`;
    const command = { ...cmd, id };

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error(`Command ${cmd.type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      if (timer.unref) timer.unref();

      this.pendingResponses.set(id, { resolve, reject, timer });

      try {
        this.pi.send(command);
      } catch (err) {
        clearTimeout(timer);
        this.pendingResponses.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Handle an incoming message from Pi's stdout.
   */
  private handleMessage(message: Record<string, unknown>): void {
    const type = message.type;

    if (type === "response") {
      // This is a response to a command we sent
      const id = message.id as string | undefined;
      if (id && this.pendingResponses.has(id)) {
        const pending = this.pendingResponses.get(id)!;
        clearTimeout(pending.timer);
        this.pendingResponses.delete(id);
        pending.resolve(message);
      }
      return;
    }

    if (type === "event") {
      // Streaming event — forward to event handler
      this.eventHandler?.(message);
      return;
    }

    // Extension UI requests are events too
    if (type === "extension_ui_request") {
      this.eventHandler?.(message);
      return;
    }

    // Unknown message type — forward anyway
    this.eventHandler?.(message);
  }

  /**
   * Abort all pending commands (e.g., on shutdown).
   */
  abortAll(): void {
    for (const [id, pending] of this.pendingResponses) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Command aborted: server shutting down"));
      this.pendingResponses.delete(id);
    }
  }
}
