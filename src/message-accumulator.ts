/**
 * MessageAccumulator — collects streaming Pi events into structured messages.
 *
 * Used by both HTTP and WebSocket transports to persist conversation content
 * to EventLog on agent_end. The dashboard then reads these back via /log.
 *
 * Usage:
 *   const acc = new MessageAccumulator(sessionId);
 *   adapter.onEvent((event) => {
 *     acc.feed(event);
 *     if (event.type === "agent_end") acc.flush();  // writes to EventLog
 *   });
 */

import { EventLog } from "./event-log.js";

export interface AccumulatedMessage {
  type: "thinking" | "text" | "tool_call";
  text?: string;
  name?: string;
  args?: unknown;
  output?: string;
  isError?: boolean;
}

export class MessageAccumulator {
  private parts: AccumulatedMessage[] = [];
  private textBuf = "";
  private thinkBuf = "";
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /** Feed a raw Pi event. */
  feed(event: Record<string, unknown>): void {
    const evType = event.type as string;

    if (evType === "message_update") {
      const ae = (event.assistantMessageEvent ?? {}) as Record<
        string,
        unknown
      >;
      const dt = ae.type as string;
      if (dt === "text_delta") {
        this.textBuf += (ae.delta as string) || "";
      } else if (dt === "thinking_delta") {
        this.thinkBuf += (ae.delta as string) || "";
      }
      // text_start / thinking_start reset handled naturally by delta accumulation
      return;
    }

    if (evType === "tool_execution_start") {
      this.flushBuffers();
      this.parts.push({
        type: "tool_call",
        name: event.toolName as string,
        args: event.args,
        output: "",
        isError: false,
      });
      return;
    }

    if (evType === "tool_execution_update") {
      const last = this.parts[this.parts.length - 1];
      if (last?.type === "tool_call") {
        last.output = (last.output || "") + ((event.partialResult as string) || "");
      }
      return;
    }

    if (evType === "tool_execution_end") {
      const last = this.parts[this.parts.length - 1];
      if (last?.type === "tool_call") {
        if (event.result !== undefined && event.result !== null) {
          last.output =
            typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
        }
        last.isError = (event.isError as boolean) || false;
      }
      return;
    }

    // Other event types (agent_start, turn_start, etc.) are ignored
  }

  /** Flush buffers and write the complete message to EventLog. */
  flush(): void {
    this.flushBuffers();
    if (this.parts.length === 0) return;

    EventLog.append({
      event: "message_complete",
      sessionId: this.sessionId,
      role: "assistant",
      content: this.parts,
      timestamp: new Date().toISOString(),
    });

    this.parts = [];
  }

  private flushBuffers(): void {
    if (this.thinkBuf) {
      this.parts.push({ type: "thinking", text: this.thinkBuf });
      this.thinkBuf = "";
    }
    if (this.textBuf) {
      this.parts.push({ type: "text", text: this.textBuf });
      this.textBuf = "";
    }
  }
}
