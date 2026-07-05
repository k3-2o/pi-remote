/**
 * PiServer — HTTP + WebSocket on same port, with extension UI relay.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

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
  private httpServer: Server | null = null;
  private startTime = 0;

  constructor(config?: Partial<ServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new ConsoleLogger({
      level: this.config.logLevel,
      component: "pi-server",
    });
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.authProvider = this.buildAuthProvider();
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
    if (this.config.sessionTimeout > 0) this.processManager.startIdleCheck();

    // Check Pi version compatibility
    await this.checkPiVersion();

    this.httpTransport = new HttpTransport(
      this.sessionManager,
      this.authProvider,
      this.logger,
    );

    // Create raw Node http.Server — WS-compatible
    this.httpServer = createServer(async (req, res) => {
      const app = this.httpTransport.getApp();
      // Build a Web Request from the Node request
      const url = `http://${req.headers.host ?? "localhost"}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) {
          if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
          else headers.set(k, String(v));
        }
      }
      const method = req.method ?? "GET";
      let body: Uint8Array | null = null;
      if (method !== "GET" && method !== "HEAD") {
        body = (await new Promise<Buffer>((resolve) => {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => resolve(Buffer.concat(chunks)));
        })) as Uint8Array;
      }
      const webReq = new Request(url, {
        method,
        headers,
        body: body as unknown as BodyInit,
      });
      const webRes = await app.fetch(webReq);
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              return;
            }
            res.write(value);
          }
        };
        pump();
      } else {
        res.end();
      }
    });

    // WebSocket on same server
    this.wsTransport = new WsTransport(
      this.sessionManager,
      this.extensionUI,
      this.authProvider,
      this.logger,
      this.config,
    );
    this.wsTransport.start(this.httpServer);

    // Listen
    this.httpServer.listen(this.config.port, this.config.host);
    this.logger.info("Server listening", {
      port: this.config.port,
      host: this.config.host,
    });

    this.writePidFile();
    process.on("SIGINT", () => void this.handleSignal("SIGINT"));
    process.on("SIGTERM", () => void this.handleSignal("SIGTERM"));
  }

  async stop(): Promise<void> {
    this.logger.info("Shutting down...");
    this.wsTransport.stop();
    this.processManager.stopIdleCheck();
    await this.processManager.stopAll();
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }
    this.removePidFile();
    this.logger.info("Shutdown complete", {
      uptime: Date.now() - this.startTime,
    });
  }

  get url(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }
  get uptime(): number {
    return this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
  }
  get isRunning(): boolean {
    return this.httpServer !== null;
  }

  private buildAuthProvider(): AuthProvider {
    const providers: AuthProvider[] = [];
    if (this.config.auth.enabled && this.config.auth.apiKeys.length > 0)
      providers.push(new ApiKeyAuthProvider(this.config.auth.apiKeys));
    if (!this.config.auth.enabled) providers.push(new NoAuthProvider());
    return providers.length === 1
      ? providers[0]
      : new CompositeAuthProvider(providers);
  }

  private writePidFile(): void {
    try {
      const dir = resolve(homedir(), ".pi");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(PID_FILE, String(process.pid), "utf-8");
    } catch (err) {
      this.logger.warn("Failed to write PID file", { error: String(err) });
    }
  }

  private removePidFile(): void {
    try {
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    } catch (err) {
      this.logger.warn("Failed to remove PID file", { error: String(err) });
    }
  }

  private async handleSignal(signal: string): Promise<void> {
    this.logger.info(`Received ${signal}`);
    const timer = setTimeout(() => {
      this.logger.error("Forced shutdown");
      process.exit(1);
    }, this.config.server.shutdownTimeout);
    if (timer.unref) timer.unref();
    await this.stop();
    clearTimeout(timer);
    process.exit(0);
  }

  /**
   * Check Pi version against last known good version.
   * Warns if changed — Pi RPC protocol may have changed.
   */
  private async checkPiVersion(): Promise<void> {
    try {
      const { execSync } = await import("node:child_process");
      const { readFileSync, writeFileSync, existsSync, mkdirSync } =
        await import("node:fs");
      const { homedir } = await import("node:os");
      const { resolve } = await import("node:path");

      const current = execSync(`${this.config.piCommand} --version`, {
        encoding: "utf8",
        timeout: 5000,
      }).trim();

      const versionDir = resolve(homedir(), ".pi", "pi-remote");
      const versionFile = resolve(versionDir, "pi-version");

      if (!existsSync(versionDir)) mkdirSync(versionDir, { recursive: true });

      if (existsSync(versionFile)) {
        const last = readFileSync(versionFile, "utf8").trim();
        if (last !== current) {
          this.logger.warn("Pi version changed", { lastKnown: last, current });
          this.logger.warn(
            "pi-remote was tested with the previous version. If something breaks, this may be why.",
          );
        }
      }

      writeFileSync(versionFile, current, "utf8");
      this.logger.info("Pi version", { version: current });
    } catch (err) {
      this.logger.warn("Could not check Pi version", { error: String(err) });
    }
  }

  static readPidFile(): number | null {
    try {
      if (existsSync(PID_FILE)) {
        const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (!isNaN(pid) && pid > 0) return pid;
      }
    } catch {}
    return null;
  }
}
