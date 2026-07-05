/**
 * Phase 4 Tests: SSE Event Mapping
 *
 * Tests the SSE event format and Pi-to-SSE event type mapping.
 * The actual streaming is tested via end-to-end tests (Phase 12).
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// SSE Event Mapper — extracted from http-transport.ts for testability
// ---------------------------------------------------------------------------

interface SSEMappedEvent {
  event: string;
  data: string;
}

/**
 * Maps a Pi RPC event to an SSE event type.
 * Returns null for events that should be skipped in SSE (e.g., extension_ui_request).
 */
function mapEventToSSE(event: Record<string, unknown>): SSEMappedEvent | null {
  const type = event.type as string;

  // Extension UI is WebSocket-only, not SSE
  if (type === "extension_ui_request") return null;

  if (type === "message_update") {
    const assistantEvent = (event.assistantMessageEvent ?? {}) as Record<
      string,
      unknown
    >;
    const deltaType = assistantEvent.type as string;

    if (deltaType === "text_delta") {
      return {
        event: "token",
        data: JSON.stringify({ text: assistantEvent.delta }),
      };
    }
    if (deltaType === "thinking_delta") {
      return {
        event: "thinking",
        data: JSON.stringify({ thinking: assistantEvent.delta }),
      };
    }
    // Other message updates: forward raw
    return {
      event: "message",
      data: JSON.stringify(event),
    };
  }

  if (type === "tool_execution_start") {
    return {
      event: "tool_start",
      data: JSON.stringify({
        tool: event.toolName,
        args: event.args,
        id: event.toolCallId,
      }),
    };
  }

  if (type === "tool_execution_update") {
    return {
      event: "tool_output",
      data: JSON.stringify({ output: event.partialResult }),
    };
  }

  if (type === "tool_execution_end") {
    return {
      event: "tool_end",
      data: JSON.stringify({
        result: event.result,
        isError: event.isError,
      }),
    };
  }

  if (type === "agent_end") {
    return {
      event: "done",
      data: JSON.stringify(event),
    };
  }

  // Fallback: forward raw event
  return {
    event: type,
    data: JSON.stringify(event),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSE Event Mapping", () => {
  describe("text_delta → token", () => {
    it("should map text_delta to event:token", () => {
      const result = mapEventToSSE({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "Hello",
          contentIndex: 0,
        },
      });
      expect(result).not.toBeNull();
      expect(result!.event).toBe("token");
      expect(result!.data).toContain("Hello");
    });

    it("should include text in the data field", () => {
      const result = mapEventToSSE({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "def foo():",
        },
      });
      expect(result!.data).toContain("def foo():");
    });
  });

  describe("thinking_delta → thinking", () => {
    it("should map thinking_delta to event:thinking", () => {
      const result = mapEventToSSE({
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: "Hmm, let me reason...",
        },
      });
      expect(result!.event).toBe("thinking");
      expect(result!.data).toContain("Hmm, let me reason");
    });
  });

  describe("tool_execution → tool_start/tool_output/tool_end", () => {
    it("should map tool_execution_start to event:tool_start", () => {
      const result = mapEventToSSE({
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "call_abc",
        args: { command: "ls -la" },
      });
      expect(result!.event).toBe("tool_start");
      expect(result!.data).toContain("bash");
      expect(result!.data).toContain("call_abc");
      expect(result!.data).toContain("ls -la");
    });

    it("should map tool_execution_end to event:tool_end", () => {
      const result = mapEventToSSE({
        type: "tool_execution_end",
        toolCallId: "call_1",
        toolName: "read",
        result: { content: [{ type: "text", text: "file contents" }] },
        isError: false,
      });
      expect(result!.event).toBe("tool_end");
      expect(result!.data).toContain("file contents");
      expect(result!.data).toContain("false"); // isError
    });

    it("should include error flag in tool_end", () => {
      const result = mapEventToSSE({
        type: "tool_execution_end",
        toolCallId: "call_err",
        toolName: "bash",
        result: { content: [{ type: "text", text: "permission denied" }] },
        isError: true,
      });
      expect(result!.event).toBe("tool_end");
      expect(result!.data).toContain("true");
    });

    it("should map tool_execution_update to event:tool_output", () => {
      const result = mapEventToSSE({
        type: "tool_execution_update",
        toolCallId: "call_x",
        toolName: "bash",
        partialResult: { content: [{ type: "text", text: "partial..." }] },
      });
      expect(result!.event).toBe("tool_output");
      expect(result!.data).toContain("partial...");
    });
  });

  describe("agent_end → done", () => {
    it("should map agent_end to event:done", () => {
      const result = mapEventToSSE({
        type: "agent_end",
        messages: [{ role: "assistant", content: "done" }],
      });
      expect(result!.event).toBe("done");
    });
  });

  describe("extension_ui_request → skipped", () => {
    it("should skip extension_ui_request events", () => {
      const result = mapEventToSSE({
        type: "extension_ui_request",
        id: "ui-1",
        method: "select",
        title: "Choose",
        options: ["A", "B"],
      });
      expect(result).toBeNull();
    });

    it("should skip fire-and-forget extension UI events", () => {
      const result = mapEventToSSE({
        type: "extension_ui_request",
        id: "ui-2",
        method: "notify",
        message: "hi",
      });
      expect(result).toBeNull();
    });
  });

  describe("unknown events → fallback", () => {
    it("should forward unknown event types as-is", () => {
      const result = mapEventToSSE({
        type: "compaction_start",
        reason: "threshold",
      });
      expect(result!.event).toBe("compaction_start");
      expect(result!.data).toContain("threshold");
    });

    it("should forward queue_update events", () => {
      const result = mapEventToSSE({
        type: "queue_update",
        steering: [],
        followUp: [],
      });
      expect(result!.event).toBe("queue_update");
    });
  });

  describe("SSE format validation", () => {
    it("should produce valid JSON data fields", () => {
      const result = mapEventToSSE({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: '"quotes" and \\backslashes',
        },
      });

      // Verify it's parseable JSON
      const parsed = JSON.parse(result!.data);
      expect(parsed).toHaveProperty("text");
    });

    it("should handle empty deltas", () => {
      const result = mapEventToSSE({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "" },
      });
      expect(result).not.toBeNull();
      expect(result!.event).toBe("token");
    });
  });
});
