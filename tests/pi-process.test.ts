/**
 * Phase 1 Tests: PiProcess
 *
 * Tests the Pi subprocess manager with mocked child_process.spawn.
 *
 * Key areas covered:
 * - Startup: spawn with correct args, startup window detection
 * - JSONL parsing: byte splitting on \n, \r stripping
 * - Messaging: send JSON to stdin, receive parsed JSON from stdout
 * - Lifecycle: stop (SIGTERM → SIGKILL after 5s)
 * - Crash: exit event, stderr collection, state transitions
 * - Unicode: U+2028/U+2029 do NOT split lines (readline bug avoidance)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { PiProcess, type PiProcessState } from "../src/pi-process.js";

// Mock child_process.spawn (must use vi.hoisted for hoisting safety)
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
}

function createMockChild(overrides: Partial<MockChild> = {}): MockChild {
  const child = new EventEmitter() as EventEmitter & MockChild;
  child.stdin = overrides.stdin ?? new PassThrough();
  child.stdout = overrides.stdout ?? new PassThrough();
  child.stderr = overrides.stderr ?? new PassThrough();
  child.pid = overrides.pid ?? 12345;
  child.kill = overrides.kill ?? vi.fn();
  return child;
}

function writeJsonLine(
  stream: PassThrough,
  obj: Record<string, unknown>,
): void {
  stream.write(JSON.stringify(obj) + "\n", "utf8");
}

function writeRaw(stream: PassThrough, data: string): void {
  stream.write(data, "utf8");
}

const TICK = 20;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PiProcess", () => {
  let child: MockChild;

  beforeEach(() => {
    vi.useFakeTimers();
    child = createMockChild();
    mockSpawn.mockReturnValue(child);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Startup ────────────────────────────────────────────────

  describe("startup", () => {
    it("should spawn pi with --mode rpc by default", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();

      // Fast-forward past startup window (200ms)
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "pi",
        ["--mode", "rpc", "--no-session"],
        expect.objectContaining({
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
      expect(proc.isRunning).toBe(true);
      expect(proc.state).toBe("running");
    });

    it("should handle custom pi command and args", async () => {
      const proc = new PiProcess({
        piCommand: "/usr/local/bin/pi",
        piArgs: ["--mode", "rpc", "--provider", "anthropic"],
      });
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "/usr/local/bin/pi",
        ["--mode", "rpc", "--provider", "anthropic"],
        expect.any(Object),
      );
    });

    it("should handle custom cwd and env", async () => {
      const proc = new PiProcess({
        cwd: "/tmp/test-project",
        env: { MY_VAR: "test" },
      });
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cwd: "/tmp/test-project",
          env: expect.objectContaining({ MY_VAR: "test" }),
        }),
      );
    });

    it("should fail fast if process exits with non-zero within startup window", async () => {
      const proc = new PiProcess();
      mockSpawn.mockImplementation(() => {
        // Simulate immediate crash
        const ch = new EventEmitter() as any;
        ch.stdin = new PassThrough();
        ch.stdout = new PassThrough();
        ch.stderr = new PassThrough();
        ch.pid = 12345;
        process.nextTick(() => {
          ch.stderr.write("Error: API key not found\n", "utf8");
          ch.emit("exit", 1, null);
        });
        return ch;
      });

      await expect(proc.start()).rejects.toThrow(/exit/i);
      expect(proc.state).toBe("crashed");
    });

    it("should not reject if process exits AFTER startup window", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();

      // Pass startup window
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;
      expect(proc.isRunning).toBe(true);

      // Now crash
      child.emit("exit", 1, null);
      expect(proc.state).toBe("crashed");
    });

    it("should return pid when running", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;
      expect(proc.pid).toBe(12345);
    });
  });

  // ── JSONL Parsing ──────────────────────────────────────────

  describe("JSON line parsing", () => {
    it("should parse single JSON line from stdout", async () => {
      const proc = new PiProcess();
      const messages: Record<string, unknown>[] = [];

      proc.onMessage((msg) => messages.push(msg));

      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      writeJsonLine(child.stdout, { type: "agent_start" });

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "agent_start" });
    });

    it("should parse multiple JSON lines", async () => {
      const proc = new PiProcess();
      const messages: Record<string, unknown>[] = [];
      proc.onMessage((msg) => messages.push(msg));

      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      writeJsonLine(child.stdout, { type: "agent_start" });
      writeJsonLine(child.stdout, { type: "message_update", delta: "hello" });
      writeJsonLine(child.stdout, { type: "agent_end" });

      expect(messages).toHaveLength(3);
    });

    it("should ignore non-JSON lines gracefully", async () => {
      const proc = new PiProcess();
      const messages: Record<string, unknown>[] = [];
      proc.onMessage((msg) => messages.push(msg));

      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      writeRaw(child.stdout, "Pi is starting up...\n");
      writeRaw(child.stdout, "Loading extensions...\n");
      writeJsonLine(child.stdout, { type: "agent_start" });

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "agent_start" });
    });

    it("should handle partial lines — assemble across chunks", async () => {
      const proc = new PiProcess();
      const messages: Record<string, unknown>[] = [];
      proc.onMessage((msg) => messages.push(msg));

      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      // Send a JSON line split across two chunks
      writeRaw(child.stdout, '{"type": "mess');
      writeRaw(child.stdout, 'age_update"}\n');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "message_update" });
    });

    it("should strip trailing \\r (Windows line endings)", async () => {
      const proc = new PiProcess();
      const messages: Record<string, unknown>[] = [];
      proc.onMessage((msg) => messages.push(msg));

      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      child.stdout.write('{"type":"test"}\r\n', "utf8");

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: "test" });
    });

    it("should NOT split on unicode separators U+2028 (critial)", async () => {
      const proc = new PiProcess();
      const messages: Record<string, unknown>[] = [];
      proc.onMessage((msg) => messages.push(msg));

      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      // U+2028 is a line separator but should NOT cause a line break
      writeRaw(child.stdout, '{"text":"before\u2028after"}\n');

      expect(messages).toHaveLength(1);
      const msg = messages[0] as { text: string };
      expect(msg.text).toBe("before\u2028after");
    });

    it("should NOT split on unicode separators U+2029 (critial)", async () => {
      const proc = new PiProcess();
      const messages: Record<string, unknown>[] = [];
      proc.onMessage((msg) => messages.push(msg));

      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      writeRaw(child.stdout, '{"text":"before\u2029after"}\n');

      expect(messages).toHaveLength(1);
      const msg = messages[0] as { text: string };
      expect(msg.text).toBe("before\u2029after");
    });

    it("should handle JSON with unicode separators correctly", async () => {
      // This test proves we don't have the Node readline bug
      const proc = new PiProcess();
      const messages: Record<string, unknown>[] = [];
      proc.onMessage((msg) => messages.push(msg));

      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      // Valid JSON containing both unicode line/paragraph separators
      const complexJson =
        '{"name":"test","data":"x\u2028y\u2029z","arr":[1,2,3]}\n';
      writeRaw(child.stdout, complexJson);

      expect(messages).toHaveLength(1);
      const msg = messages[0] as Record<string, unknown>;
      expect(msg.name).toBe("test");
      expect(msg.data).toBe("x\u2028y\u2029z");
      expect((msg.arr as number[]).length).toBe(3);
    });
  });

  // ── Sending commands ───────────────────────────────────────

  describe("send", () => {
    it("should write JSON command + newline to stdin", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      const stdinData = new Promise<string>((resolve) => {
        child.stdin.once("data", (chunk: Buffer) => resolve(chunk.toString()));
      });

      proc.send({ type: "prompt", message: "hello" });
      const written = await stdinData;

      expect(written).toBe('{"type":"prompt","message":"hello"}\n');
    });

    it("should throw if process is not running", () => {
      const proc = new PiProcess();
      expect(proc.state).toBe("stopped");
      expect(() => proc.send({ type: "prompt", message: "hi" })).toThrow(
        /not running/,
      );
    });
  });

  // ── Stopping ───────────────────────────────────────────────

  describe("stopping", () => {
    it("should send SIGTERM and transition to stopping", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      const stopPromise = proc.stop();
      await vi.advanceTimersByTimeAsync(100);

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(proc.state).toBe("stopping");
    });

    it("should send SIGKILL after 5s timeout", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      const stopPromise = proc.stop();

      // Process doesn't exit — SIGKILL should fire after 5s
      await vi.advanceTimersByTimeAsync(5001);

      // After SIGKILL, simulate exit to resolve the stop promise
      child.emit("exit", null, "SIGKILL");
      await stopPromise;

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    }, 10_000);

    it("should resolve when process exits on SIGTERM", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      const stopPromise = proc.stop();
      await vi.advanceTimersByTimeAsync(50);

      // Simulate exit
      child.emit("exit", 0, "SIGTERM");
      await stopPromise;

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
      expect(proc.state).toBe("stopped");
    });

    it("should be a no-op if already stopped", async () => {
      const proc = new PiProcess();
      await proc.stop(); // already stopped
      expect(proc.state).toBe("stopped");
    });
  });

  // ── Exit / Crash ───────────────────────────────────────────

  describe("exit handlers", () => {
    it("should call onExit callback with exit code and signal", async () => {
      const proc = new PiProcess();
      const onExit = vi.fn();
      proc.onExit(onExit);

      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      child.emit("exit", 1, null);
      expect(onExit).toHaveBeenCalledWith(1, null);
    });

    it("should set state to crashed on non-zero exit", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      child.emit("exit", 1, null);
      expect(proc.state).toBe("crashed");
    });

    it("should set state to stopped on SIGTERM exit", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      child.emit("exit", 0, "SIGTERM");
      expect(proc.state).toBe("stopped");
    });
  });

  // ── Stderr collection ─────────────────────────────────────

  describe("stderr", () => {
    it("should collect stderr output", async () => {
      const proc = new PiProcess();
      const startPromise = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await startPromise;

      child.stderr.write("Error: API key invalid\n", "utf8");
      child.stderr.write("Warning: using fallback\n", "utf8");

      const stderr = proc.getStderr();
      expect(stderr).toContain("API key invalid");
      expect(stderr).toContain("using fallback");
    });
  });

  // ── State machine ──────────────────────────────────────────

  describe("state machine", () => {
    it("should start in stopped state", () => {
      const proc = new PiProcess();
      expect(proc.state).toBe("stopped");
      expect(proc.isRunning).toBe(false);
    });

    it("should refuse to start twice", async () => {
      const proc = new PiProcess();
      const p1 = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await p1;

      await expect(proc.start()).rejects.toThrow(/cannot start/);
    });

    it("should refuse to start from stopping state", async () => {
      const proc = new PiProcess();
      const p1 = proc.start();
      await vi.advanceTimersByTimeAsync(201);
      await p1;

      // Start stop (don't await)
      proc.stop().catch(() => {});
      await vi.advanceTimersByTimeAsync(10);

      expect(proc.state).toBe("stopping");
      await expect(proc.start()).rejects.toThrow(/cannot start/);
    });
  });
});
