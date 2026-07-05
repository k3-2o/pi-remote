/**
 * Phase 2 Tests: RpcAdapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RpcAdapter } from "../src/rpc-adapter.js";

// ---------------------------------------------------------------------------
// Hand-rolled mock PiProcess (avoids vi.mock hoisting issues)
// ---------------------------------------------------------------------------

let messageHandler: ((msg: Record<string, unknown>) => void) | null = null;
let sentCommands: Record<string, unknown>[] = [];

class MockPiProcess {
  send = vi.fn((cmd: Record<string, unknown>) => {
    sentCommands.push(cmd);
  });
  onMessage = vi.fn((handler: (msg: Record<string, unknown>) => void) => {
    messageHandler = handler;
  });
  start = vi.fn(async () => {});
  stop = vi.fn(async () => {});
  onExit = vi.fn();
  getStderr = vi.fn(() => "");
  isRunning = true;
  state = "running";
}

function setupMockPi(): MockPiProcess {
  messageHandler = null;
  sentCommands = [];
  return new MockPiProcess();
}

function simulateResponse(id: string, type: string, success = true) {
  messageHandler?.({
    type: "response",
    id,
    command: type,
    success,
  });
}

function simulateEvent(data: Record<string, unknown>) {
  messageHandler?.(data);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RpcAdapter", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adapter: RpcAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    const mockPi = setupMockPi();
    adapter = new RpcAdapter(mockPi as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("sendCommand", () => {
    it("should send a command and return the response", async () => {
      const p = adapter.sendCommand({ type: "get_state" });
      await vi.advanceTimersByTimeAsync(10);

      const cmd = sentCommands[0] as { id: string; type: string };
      simulateResponse(cmd.id, "get_state", true);

      const response = await p;
      expect(response.type).toBe("response");
      expect(response.success).toBe(true);
    });

    it("should assign unique IDs per command", async () => {
      adapter.sendCommand({ type: "a" }).catch(() => {});
      adapter.sendCommand({ type: "b" }).catch(() => {});

      const ids = sentCommands.map((c) => (c as { id: string }).id);
      expect(ids[0]).not.toBe(ids[1]);
    });

    it("should match responses by ID", async () => {
      const p1 = adapter.sendCommand({ type: "first" });
      const p2 = adapter.sendCommand({ type: "second" });
      await vi.advanceTimersByTimeAsync(10);

      const cmd1 = sentCommands[0] as { id: string };
      const cmd2 = sentCommands[1] as { id: string };

      simulateResponse(cmd2.id, "second", true);
      const r2 = await p2;
      expect(r2.command).toBe("second");

      simulateResponse(cmd1.id, "first", true);
      const r1 = await p1;
      expect(r1.command).toBe("first");
    });

    it("should timeout after default 120s", async () => {
      const p = adapter.sendCommand({ type: "slow" });
      const caught = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(121_000);
      const result = await caught;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/timed out/);
    });

    it("should support custom timeout", async () => {
      const p = adapter.sendCommand({ type: "fast" }, 1000);
      const caught = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(1001);
      const result = await caught;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/timed out/);
    });
  });

  describe("streaming events", () => {
    it("should dispatch to onEvent handler", async () => {
      const events: Record<string, unknown>[] = [];
      adapter.onEvent((e) => events.push(e));

      simulateEvent({ type: "message_update", delta: "hello" });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "message_update",
        delta: "hello",
      });
    });

    it("should not confuse events with command responses", async () => {
      const events: Record<string, unknown>[] = [];
      adapter.onEvent((e) => events.push(e));

      const p = adapter.sendCommand({ type: "prompt" });
      await vi.advanceTimersByTimeAsync(10);

      simulateEvent({ type: "message_update", delta: "t1" });
      simulateEvent({ type: "message_update", delta: "t2" });

      expect(events).toHaveLength(2);

      const cmd = sentCommands[0] as { id: string };
      simulateResponse(cmd.id, "prompt", true);
      const resp = await p;
      expect(resp.success).toBe(true);
      expect(events).toHaveLength(2);
    });

    it("should route extension_ui_request events", async () => {
      const events: Record<string, unknown>[] = [];
      adapter.onEvent((e) => events.push(e));

      messageHandler?.({
        type: "extension_ui_request",
        id: "ui-1",
        method: "select",
        title: "Choose",
        options: ["A", "B"],
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ method: "select" });
    });
  });

  describe("abortAll", () => {
    it("should reject all pending commands", async () => {
      const p1 = adapter.sendCommand({ type: "a" }).catch((e) => e);
      const p2 = adapter.sendCommand({ type: "b" }).catch((e) => e);

      adapter.abortAll();

      const results = await Promise.all([p1, p2]);
      for (const r of results) {
        expect(r).toBeInstanceOf(Error);
        expect((r as Error).message).toMatch(/aborted|shutting/i);
      }
    });
  });
});
