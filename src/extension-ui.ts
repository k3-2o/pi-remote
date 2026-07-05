/**
 * ExtensionUIBridge — routes Pi's extension UI requests to connected clients.
 *
 * Pi's extensions can call ctx.ui.select(), ctx.ui.confirm(), etc.
 * In RPC mode, these emit extension_ui_request events on stdout.
 * The server needs to:
 * 1. Forward the request to the connected client
 * 2. Wait for the client's response
 * 3. Send the response back to Pi's stdin
 *
 * Pattern stolen from marcfargas/pi-server (MIT license).
 */

const FIRE_AND_FORGET_METHODS = new Set([
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
]);

export interface PendingUIRequest {
  id: string;
  method: string;
  timeoutId: ReturnType<typeof setTimeout>;
  resolve: (response: Record<string, unknown>) => void;
}

export class ExtensionUIBridge {
  private pendingRequests = new Map<string, PendingUIRequest>();
  private timeoutMs: number;

  /** Callback to forward UI request to connected client */
  onUIRequest: ((request: Record<string, unknown>) => void) | null = null;

  constructor(timeoutMs: number = 60_000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Check if a Pi stdout message is an extension UI request.
   */
  isExtensionUIRequest(message: Record<string, unknown>): boolean {
    return message.type === "extension_ui_request";
  }

  /**
   * Check if this is a fire-and-forget method (no response needed).
   */
  isFireAndForget(message: Record<string, unknown>): boolean {
    return FIRE_AND_FORGET_METHODS.has(message.method as string);
  }

  /**
   * Handle an extension UI request from Pi.
   * Returns a promise that resolves when the client responds or timeout fires.
   */
  handleRequest(
    message: Record<string, unknown>,
  ): Promise<Record<string, unknown>> | null {
    if (this.isFireAndForget(message)) {
      // Fire-and-forget: just forward to client, no response needed
      this.onUIRequest?.(message);
      return null;
    }

    // Dialog: register and wait for client response
    const id = message.id as string;
    const method = message.method as string;

    const promise = new Promise<Record<string, unknown>>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(this.getDefaultResponse(id, method));
      }, this.timeoutMs);

      if (timeoutId.unref) timeoutId.unref();

      this.pendingRequests.set(id, { id, method, timeoutId, resolve });
    });

    // Forward to client
    this.onUIRequest?.(message);

    return promise;
  }

  /**
   * Handle a response from the client for a pending UI dialog.
   * Returns true if the response was matched to a pending request.
   */
  handleResponse(
    requestId: string,
    response: Record<string, unknown>,
  ): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(requestId);
    pending.resolve(response);
    return true;
  }

  /**
   * Cancel all pending requests (e.g., on client disconnect).
   */
  cancelAll(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.resolve(this.getDefaultResponse(id, pending.method));
    }
    this.pendingRequests.clear();
  }

  /**
   * Get count of pending requests.
   */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Get the default response for a timed-out or cancelled dialog.
   */
  private getDefaultResponse(
    id: string,
    method: string,
  ): Record<string, unknown> {
    const base = { type: "extension_ui_response", id };
    switch (method) {
      case "select":
        return { ...base, cancelled: true };
      case "confirm":
        return { ...base, confirmed: false };
      case "input":
        return { ...base, cancelled: true };
      case "editor":
        return { ...base, cancelled: true };
      default:
        return { ...base, cancelled: true };
    }
  }
}
