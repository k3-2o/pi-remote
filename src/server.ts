/**
 * PiServer — the main server orchestrator.
 *
 * Owns and coordinates all components:
 * - PiProcessManager (pool of Pi subprocesses)
 * - SessionManager (logical session lifecycle)
 * - HttpTransport (REST API)
 * - WsTransport (WebSocket)
 * - ExtensionUIBridge (extension UI protocol)
 * - AuthProvider (connection authentication)
 *
 * Lifecycle:
 *   start() → initialize all components, bind ports
 *   stop()  → graceful shutdown: drain, close, cleanup
 */

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";

import type { ServerConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { ConsoleLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import { PiProcessManager } from "./process-manager.js";
import { SessionManager } from "./session-manager.js";
import { HttpTransport } from "./http-transport.js";
import { WsTransport } from "./ws-transport.js";
import { ExtensionUIBridge } from "./extension-ui.js";
import {
  NoAuthProvider,
  ApiKeyAuthProvider,
  CompositeAuthProvider,
} from "./auth.js";
import type { AuthProvider } from "./auth.js";

const PID_FILE = resolve(homedir(), ".pi", "pi-server.pid");

export class PiServer {
  config: ServerConfig;
  logger: Logger;
  processManager!: PiProcessManager;
  sessionManager!: SessionManager;
  extensionUI!: ExtensionUIBridge;
  httpTransport!: HttpTransport;
  wsTransport!: WsTransport;
  authProvider!: AuthProvider;
  private server: ReturnType<typeof serve> | null = null;
  private startTime = 0;

  constructor(config?: Partial<ServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new ConsoleLogger({
      level: this.config.logLevel,
      component: "pi-server",
    });
  }

  /**
   * Start the server.
   */
  async start(): Promise<void> {
    this.startTime = Date.now();

    // Build auth provider from config
    this.authProvider = this.buildAuthProvider();

    // Initialize components
    this.extensionUI = new ExtensionUIBridge();
    this.processManager = new PiProcessManager({
      logger: this.logger,
      piOptions: {
        piCommand: this.config.piCommand,
        piArgs: this.config.piArgs,
      },
      maxProcesses: this.config.maxSessions,
      idleTimeoutMs:
        this.config.sessionTimeout > 0 ? this.config.sessionTimeout * 1000 : 0,
    });
    this.sessionManager = new SessionManager({
      logger: this.logger,
      processManager: this.processManager,
    });

    // Start idle process cleanup
    if (this.config.sessionTimeout > 0) {
      this.processManager.startIdleCheck();
    }

    // Set up HTTP transport
    this.httpTransport = new HttpTransport(
      this.sessionManager,
      this.authProvider,
      this.logger,
    );

    // Start HTTP server
    const app = this.httpTransport.getApp();

    this.server = serve(
      {
        fetch: app.fetch,
        port: this.config.port,
        hostname: this.config.host,
      },
      (info) => {
        this.logger.info("Server listening", {
          port: info.port,
          address: info.address,
        });
      },
    );

    // Set up WebSocket transport on the same server
    this.wsTransport = new WsTransport(
      this.sessionManager,
      this.extensionUI,
      this.authProvider,
      this.logger,
      this.config,
    );

    // Write PID file
    this.writePidFile();

    // Handle shutdown signals
    process.on("SIGINT", () => void this.handleSignal("SIGINT"));
    process.on("SIGTERM", () => void this.handleSignal("SIGTERM"));
  }

  /**
   * Stop the server gracefully.
   */
  async stop(): Promise<void> {
    this.logger.info("Shutting down...");

    // Stop WebSocket transport
    this.wsTransport.stop();

    // Stop idle checks
    this.processManager.stopIdleCheck();

    // Stop all Pi processes
    await this.processManager.stopAll();

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    // Remove PID file
    this.removePidFile();

    this.logger.info("Shutdown complete", {
      uptime: Date.now() - this.startTime,
    });
  }

  /**
   * Get the URL the server is listening on.
   */
  get url(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  /**
   * Get server uptime in seconds.
   */
  get uptime(): number {
    return this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
  }

  /**
   * Check if server is running.
   */
  get isRunning(): boolean {
    return this.server !== null;
  }

  private buildAuthProvider(): AuthProvider {
    const providers: AuthProvider[] = [];

    if (this.config.auth.enabled && this.config.auth.apiKeys.length > 0) {
      providers.push(new ApiKeyAuthProvider(this.config.auth.apiKeys));
    }

    // Always allow local connections as fallback when auth is disabled
    if (!this.config.auth.enabled) {
      providers.push(new NoAuthProvider());
    }

    return providers.length === 1
      ? providers[0]
      : new CompositeAuthProvider(providers);
  }

  private writePidFile(): void {
    try {
      const dir = resolve(homedir(), ".pi");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(PID_FILE, String(process.pid), "utf-8");
    } catch (err) {
      this.logger.warn("Failed to write PID file", {
        path: PID_FILE,
        error: String(err),
      });
    }
  }

  private removePidFile(): void {
    try {
      if (existsSync(PID_FILE)) {
        unlinkSync(PID_FILE);
      }
    } catch (err) {
      this.logger.warn("Failed to remove PID file", {
        path: PID_FILE,
        error: String(err),
      });
    }
  }

  private async handleSignal(signal: string): Promise<void> {
    this.logger.info(`Received ${signal}`);
    const timeout = this.config.server.shutdownTimeout;
    const timer = setTimeout(() => {
      this.logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, timeout);

    if (timer.unref) timer.unref();

    await this.stop();
    clearTimeout(timer);
    process.exit(0);
  }

  /**
   * Read the PID file to check if the server is running.
   */
  static readPidFile(): number | null {
    try {
      if (existsSync(PID_FILE)) {
        const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (!isNaN(pid) && pid > 0) return pid;
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }
}
