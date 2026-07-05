/**
 * PiProcess — manages a single `pi --mode rpc` subprocess.
 *
 * KEY DESIGN DECISIONS:
 * - Uses raw `\n` splitting with StringDecoder (NOT Node readline)
 *   Pi's RPC docs explicitly warn: readline splits on U+2028 and U+2029
 *   which are valid inside JSON strings. We split only on \n.
 * - Detects startup failure within 200ms
 * - State machine: stopped → starting → running → stopping → stopped
 *
 * Stolen patterns from marcfargas/pi-server (MIT), fixed the readline issue.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export type PiMessageHandler = (message: Record<string, unknown>) => void;
export type PiExitHandler = (
  code: number | null,
  signal: string | null,
) => void;

export type PiProcessState =
  "stopped" | "starting" | "running" | "stopping" | "crashed";

export interface PiProcessOptions {
  /** Path to pi CLI */
  piCommand?: string;
  /** Additional args for pi (--provider, --model, etc.) */
  piArgs?: string[];
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

export class PiProcess {
  private proc: ChildProcess | null = null;
  private _state: PiProcessState = "stopped";
  private messageHandler: PiMessageHandler | null = null;
  private exitHandler: PiExitHandler | null = null;
  private stderrChunks: string[] = [];
  private buffer = "";
  private decoder = new StringDecoder("utf8");
  private options: PiProcessOptions;

  constructor(options: PiProcessOptions = {}) {
    this.options = options;
  }

  get state(): PiProcessState {
    return this._state;
  }

  get isRunning(): boolean {
    return this._state === "running";
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  onMessage(handler: PiMessageHandler): void {
    this.messageHandler = handler;
  }

  onExit(handler: PiExitHandler): void {
    this.exitHandler = handler;
  }

  /**
   * Start the Pi subprocess.
   * Throws if Pi exits within 200ms (startup failure detection).
   */
  async start(): Promise<void> {
    if (this._state !== "stopped") {
      throw new Error(`PiProcess: cannot start from state ${this._state}`);
    }

    this._state = "starting";
    this.stderrChunks = [];
    this.buffer = "";

    const piCmd = this.options.piCommand ?? "pi";
    const piArgs = this.options.piArgs ?? ["--mode", "rpc", "--no-session"];

    this.proc = spawn(piCmd, piArgs, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Read stdout as JSON lines (raw \n splitting)
    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += this.decoder.write(chunk);
      this.processBuffer();
    });

    this.proc.stdout!.on("end", () => {
      this.buffer += this.decoder.end();
      this.processBuffer();
    });

    // Collect stderr
    this.proc.stderr!.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString());
      // Keep last 100 chunks to limit memory
      if (this.stderrChunks.length > 100) {
        this.stderrChunks.shift();
      }
    });

    // Handle exit
    this.proc.on("exit", (code, signal) => {
      this.proc = null;
      this._state = code === 0 || signal === "SIGTERM" ? "stopped" : "crashed";
      this.exitHandler?.(code, signal);
    });

    // Detect startup failure: if Pi exits within 200ms, it's a startup error
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._state = "running";
        resolve();
      }, 200);

      this.proc!.on("error", (err) => {
        clearTimeout(timeout);
        this._state = "crashed";
        reject(new Error(`Failed to spawn pi: ${err.message}`));
      });

      this.proc!.on("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          this._state = "crashed";
          reject(
            new Error(
              `Pi exited immediately with code ${code}. Stderr: ${this.getStderr()}`,
            ),
          );
        }
      });
    });
  }

  /**
   * Send a JSON command to Pi's stdin.
   */
  send(command: Record<string, unknown>): void {
    if (!this.proc?.stdin?.writable) {
      throw new Error("Pi process not running or stdin not writable");
    }
    this.proc.stdin.write(JSON.stringify(command) + "\n");
  }

  /**
   * Stop the Pi process gracefully.
   * Sends SIGTERM, then SIGKILL after 5s timeout.
   */
  async stop(): Promise<void> {
    if (!this.proc || this._state === "stopped") return;

    this._state = "stopping";
    const proc = this.proc;

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, 5000);

      proc.on("exit", () => {
        clearTimeout(timeout);
        this._state = "stopped";
        resolve();
      });

      try {
        proc.kill("SIGTERM");
      } catch {
        clearTimeout(timeout);
        this._state = "stopped";
        resolve();
      }
    });
  }

  /**
   * Get collected stderr output (for diagnostics).
   */
  getStderr(): string {
    return this.stderrChunks.join("");
  }

  /**
   * Process the accumulation buffer, splitting on \n.
   * Pi uses strict JSONL with LF (\n) as the only record delimiter.
   * Strips optional trailing \r (Windows line endings).
   */
  private processBuffer(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      // Strip optional trailing \r (Windows compatibility)
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (line.length === 0) continue;

      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        this.messageHandler?.(message);
      } catch {
        // Non-JSON lines from Pi (rare during startup). Ignore.
      }
    }
  }
}
