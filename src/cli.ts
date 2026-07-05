/**
 * pi-server CLI — entry point.
 *
 * Usage:
 *   pi-server start          Start the server
 *   pi-server stop           Stop the server
 *   pi-server restart        Restart the server
 *   pi-server status         Check server status
 *   pi-server relay          Direct stdin/stdout relay mode (debugging)
 *   pi-server --version      Print version
 *   pi-server --help         Print help
 */

import { PiServer } from "./server.js";
import { PiProcess } from "./pi-process.js";
import { loadConfig } from "./config.js";
import { ConsoleLogger } from "./logger.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // ── Help ────────────────────────────────────────────────
  if (!command || command === "--help" || command === "-h") {
    console.log(`
pi-server v${VERSION} — A thin server runtime for Pi Coding Agent

USAGE
  pi-server start          Start the server (foreground)
  pi-server stop           Stop the running server
  pi-server restart        Restart the server
  pi-server status         Check if the server is running
  pi-server relay          Direct stdin/stdout relay (debug mode)
  pi-server --version      Print version
  pi-server --help         Print this help

OPTIONS
  --port, -p <port>        HTTP port (default: 8080, env: PI_SERVER_PORT)
  --host <host>            Bind address (default: 0.0.0.0, env: PI_SERVER_HOST)
  --config <path>          Config file path
  --log-level <level>      Log level: debug, info, warn, error

EXAMPLES
  pi-server start
  pi-server start --port 9090
  pi-server status
  pi-server relay
`);
    process.exit(0);
  }

  // ── Version ─────────────────────────────────────────────
  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    process.exit(0);
  }

  // ── Status ──────────────────────────────────────────────
  if (command === "status") {
    const pid = PiServer.readPidFile();
    if (pid) {
      try {
        // Check if process is alive
        process.kill(pid, 0);
        console.log(`pi-server is running (PID ${pid})`);
        process.exit(0);
      } catch {
        console.log("pi-server is not running (stale PID file)");
        process.exit(1);
      }
    } else {
      console.log("pi-server is not running");
      process.exit(1);
    }
  }

  // ── Stop ────────────────────────────────────────────────
  if (command === "stop") {
    const pid = PiServer.readPidFile();
    if (!pid) {
      console.log("pi-server is not running");
      process.exit(1);
    }

    try {
      process.kill(pid, "SIGTERM");
      console.log(`Sent SIGTERM to pi-server (PID ${pid})`);

      // Wait for process to exit
      let waited = 0;
      while (waited < 10) {
        try {
          process.kill(pid, 0);
          await new Promise((r) => setTimeout(r, 500));
          waited += 0.5;
        } catch {
          console.log("pi-server stopped");
          process.exit(0);
        }
      }

      // Force kill if still running
      try {
        process.kill(pid, "SIGKILL");
        console.log("pi-server force killed");
      } catch {
        // already dead
      }
      process.exit(0);
    } catch (err) {
      console.error(`Failed to stop pi-server: ${err}`);
      process.exit(1);
    }
  }

  // ── Restart ─────────────────────────────────────────────
  if (command === "restart") {
    // Stop existing
    const pid = PiServer.readPidFile();
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
        console.log("Stopped existing server");
        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        // Not running, proceed to start
      }
    }

    // Start new
    await startServer(args.slice(1));
    return;
  }

  // ── Start ───────────────────────────────────────────────
  if (command === "start") {
    await startServer(args.slice(1));
    return;
  }

  // ── Relay (debug mode) ─────────────────────────────────
  if (command === "relay") {
    await runRelayMode();
    return;
  }

  // ── Unknown command ────────────────────────────────────
  console.error(`Unknown command: ${command}`);
  console.error("Run 'pi-server --help' for usage.");
  process.exit(1);
}

/**
 * Start the pi-server in foreground.
 */
async function startServer(cliArgs: string[]): Promise<void> {
  // Parse CLI args
  let configPath: string | undefined;

  for (let i = 0; i < cliArgs.length; i++) {
    switch (cliArgs[i]) {
      case "--port":
      case "-p":
        process.env.PI_SERVER_PORT = cliArgs[++i];
        break;
      case "--host":
        process.env.PI_SERVER_HOST = cliArgs[++i];
        break;
      case "--config":
        configPath = cliArgs[++i];
        break;
      case "--log-level":
        process.env.PI_SERVER_LOG_LEVEL = cliArgs[++i];
        break;
    }
  }

  const config = loadConfig(configPath);
  const server = new PiServer(config);

  try {
    await server.start();
    console.error(`pi-server v${VERSION} started on ${server.url}`);

    // Keep running until SIGINT/SIGTERM
    await new Promise(() => {});
  } catch (err) {
    console.error(`Failed to start pi-server: ${err}`);
    process.exit(1);
  }
}

/**
 * Direct relay mode: read JSON commands from stdin, forward to Pi,
 * print events to stdout. Useful for debugging.
 */
async function runRelayMode(): Promise<void> {
  const logger = new ConsoleLogger({ level: "info", component: "relay" });
  const pi = new PiProcess();
  const readline = await import("node:readline");

  pi.onExit((code, signal) => {
    logger.info("Pi process exited", { code, signal });
    process.exit(code ?? 1);
  });

  await pi.start();
  logger.info("Pi RPC process started, reading commands from stdin...");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Handle messages from Pi
  pi.onMessage((message) => {
    process.stdout.write(JSON.stringify(message) + "\n");
  });

  // Forward stdin lines to Pi
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const cmd = JSON.parse(line);
      pi.send(cmd);
    } catch (err) {
      const errorResponse = {
        type: "response",
        command: "parse",
        success: false,
        error: `Failed to parse command: ${err}`,
      };
      process.stdout.write(JSON.stringify(errorResponse) + "\n");
    }
  });

  rl.on("close", () => {
    pi.stop().catch(() => {});
  });
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
