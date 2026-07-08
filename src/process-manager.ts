/**
 * PiProcessManager — manages a pool of Pi processes, one per session.
 *
 * Responsibilities:
 * - Lazy creation: Pi processes are started on first request for a session
 * - Auto-restart: crashed processes are restarted with exponential backoff
 * - Idle timeout: processes are cleaned up after configurable inactivity
 * - Resource limits: enforces max concurrent processes
 *
 * Key decisions:
 * - Backoff: 1s, 2s, 4s, 8s... cap at 30s
 * - Processes are fully isolated (one Pi process = one session)
 * - Idle check runs every 60s
 */

import { PiProcess, type PiProcessOptions } from "./pi-process.js";
import type { Logger } from "./logger.js";

interface ManagedProcess {
  process: PiProcess;
  sessionId: string;
  lastActivity: number;
  restartAttempts: number;
  createdAt: number;
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  noTools?: boolean;
  noExtensions?: boolean;
  tools?: string[];
}

export class PiProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;
  private piOptions: PiProcessOptions;
  private maxProcesses: number;
  private idleTimeoutMs: number;

  constructor(options: {
    logger: Logger;
    piOptions?: PiProcessOptions;
    maxProcesses?: number;
    idleTimeoutMs?: number;
  }) {
    this.logger = options.logger;
    this.piOptions = options.piOptions ?? {};
    this.maxProcesses = options.maxProcesses ?? 10;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000; // 30 min
  }

  /**
   * Get or create a Pi process for a session.
   */
  async getOrCreate(
    sessionId: string,
    systemPrompt?: string,
    appendSystemPrompt?: string[],
    noTools?: boolean,
    noExtensions?: boolean,
    tools?: string[],
  ): Promise<PiProcess> {
    const existing = this.processes.get(sessionId);
    if (
      existing &&
      (existing.process.isRunning || existing.process.state === "starting")
    ) {
      existing.lastActivity = Date.now();
      return existing.process;
    }

    // Check limit
    if (this.processes.size >= this.maxProcesses) {
      // Try to evict the oldest process (panic-eviction)
      this.evictOldest();
    }

    if (this.processes.size >= this.maxProcesses) {
      throw new Error(
        `Max processes reached (${this.maxProcesses}). Cannot create process for session ${sessionId}.`,
      );
    }

    // Remove stale entry if exists
    this.processes.delete(sessionId);

    // Store per-session options for crash auto-restart
    const storedSystemPrompt = existing?.systemPrompt ?? systemPrompt;
    const storedAppend = existing?.appendSystemPrompt ?? appendSystemPrompt;
    const storedNoTools = existing?.noTools ?? noTools;
    const storedNoExtensions = existing?.noExtensions ?? noExtensions;
    const storedTools = existing?.tools ?? tools;

    // Build process options with per-session flags
    const piArgs = [
      ...(this.piOptions.piArgs ?? []),
      ...(storedSystemPrompt ? ["--system-prompt", storedSystemPrompt] : []),
      ...(storedAppend
        ? storedAppend.flatMap((a) => ["--append-system-prompt", a])
        : []),
      ...(storedNoTools ? ["--no-tools"] : []),
      ...(storedNoExtensions ? ["--no-extensions"] : []),
      ...(storedTools && storedTools.length > 0
        ? ["--tools", storedTools.join(",")]
        : []),
    ];

    const processOpts: PiProcessOptions = {
      ...this.piOptions,
      piArgs,
    };

    const process = new PiProcess(processOpts);
    const managed: ManagedProcess = {
      process,
      sessionId,
      lastActivity: Date.now(),
      restartAttempts: 0,
      createdAt: Date.now(),
      systemPrompt: storedSystemPrompt,
      appendSystemPrompt: storedAppend,
      noTools: storedNoTools,
      noExtensions: storedNoExtensions,
      tools: storedTools,
    };

    // Wire crash handler for auto-restart
    process.onExit((code, signal) => {
      this.logger.warn("Pi process exited", {
        sessionId,
        exitCode: code,
        signal,
        restartAttempts: managed.restartAttempts,
      });

      // Auto-restart with backoff (only if not a graceful stop)
      if (signal !== "SIGTERM" && signal !== "SIGKILL") {
        const delay = Math.min(
          1000 * Math.pow(2, managed.restartAttempts),
          30000,
        );
        managed.restartAttempts++;
        setTimeout(() => {
          this.getOrCreate(sessionId).catch((err) => {
            this.logger.error("Auto-restart failed", {
              sessionId,
              error: String(err),
            });
          });
        }, delay);
      }
    });

    try {
      await process.start();
      managed.restartAttempts = 0;
      this.processes.set(sessionId, managed);
      this.logger.info("Pi process started", { sessionId, pid: process.pid });
      return process;
    } catch (err) {
      this.logger.error("Failed to start Pi process", {
        sessionId,
        error: String(err),
      });
      throw err;
    }
  }

  /**
   * Get an existing process without creating one.
   */
  get(sessionId: string): PiProcess | undefined {
    const managed = this.processes.get(sessionId);
    if (
      managed &&
      (managed.process.isRunning || managed.process.state === "starting")
    ) {
      managed.lastActivity = Date.now();
      return managed.process;
    }
    return undefined;
  }

  /**
   * Record activity on a process (keepalive).
   */
  recordActivity(sessionId: string): void {
    const managed = this.processes.get(sessionId);
    if (managed) {
      managed.lastActivity = Date.now();
    }
  }

  /**
   * Stop and remove a process.
   */
  async remove(sessionId: string): Promise<void> {
    const managed = this.processes.get(sessionId);
    if (!managed) return;

    this.processes.delete(sessionId);
    try {
      await managed.process.stop();
      this.logger.info("Pi process stopped", { sessionId });
    } catch (err) {
      this.logger.error("Error stopping Pi process", {
        sessionId,
        error: String(err),
      });
    }
  }

  /**
   * Stop all processes.
   */
  async stopAll(): Promise<void> {
    const ids = [...this.processes.keys()];
    await Promise.allSettled(ids.map((id) => this.remove(id)));
  }

  /**
   * Get count of running processes.
   */
  get count(): number {
    return this.processes.size;
  }

  /**
   * Start idle timeout checks.
   */
  startIdleCheck(intervalMs: number = 60_000): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => this.checkIdle(), intervalMs);
    if (this.idleTimer.unref) {
      this.idleTimer.unref();
    }
  }

  /**
   * Stop idle timeout checks.
   */
  stopIdleCheck(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Check for and evict idle processes.
   */
  private checkIdle(): void {
    const now = Date.now();
    for (const [sessionId, managed] of this.processes) {
      const idle = now - managed.lastActivity;
      if (idle > this.idleTimeoutMs) {
        this.logger.info("Evicting idle Pi process", {
          sessionId,
          idleMs: idle,
        });
        this.remove(sessionId).catch((err) => {
          this.logger.error("Error evicting idle process", {
            sessionId,
            error: String(err),
          });
        });
      }
    }
  }

  /**
   * Evict the oldest process to free a slot when the pool is full.
   * Picks the process with the oldest lastActivity — panic-eviction, not idle-specific.
   * The idle check (checkIdle) handles timeout-based cleanup separately.
   */
  private evictOldest(): void {
    let oldest: { sessionId: string; lastActivity: number } | null = null;

    for (const [sessionId, managed] of this.processes) {
      if (!oldest || managed.lastActivity < oldest.lastActivity) {
        oldest = { sessionId, lastActivity: managed.lastActivity };
      }
    }

    if (oldest) {
      this.logger.info("Evicting oldest process to free slot", {
        sessionId: oldest.sessionId,
      });
      this.remove(oldest.sessionId).catch((err) => {
        this.logger.error("Error evicting oldest process", {
          sessionId: oldest!.sessionId,
          error: String(err),
        });
      });
    }
  }
}
