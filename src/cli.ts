/**
 * pi-remote CLI — remote access for Pi (internally pi-server).
 *
 * Usage:
 *   pi-remote start          Start the server
 *   pi-remote stop           Stop the server
 *   pi-remote restart        Restart the server
 *   pi-remote status         Check server status
 *   pi-remote relay          Direct stdin/stdout relay mode (debugging)
 *   pi-remote --version      Print version
 *   pi-remote --help         Print help
 */

import { PiServer } from "./server.js";
import { PiProcess } from "./pi-process.js";
import { loadConfig } from "./config.js";
import { ConsoleLogger } from "./logger.js";

const VERSION = "0.2.0";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // ── Help ────────────────────────────────────────────────
  if (!command || command === "--help" || command === "-h") {
    console.log(`
pi-remote v${VERSION} — Remote access for Pi Coding Agent

USAGE
  pi-remote start          Start the server (foreground)
  pi-remote stop           Stop the running server
  pi-remote restart        Restart the server
  pi-remote status         Check if the server is running
  pi-remote relay          Direct stdin/stdout relay (debug mode)
  pi-remote install        Install as systemd service (auto-start on boot)
  pi-remote uninstall      Remove systemd service (stop + disable + delete unit)
  pi-remote logs           Tail the event log (~/.pi/pi-remote/events.jsonl)
  pi-remote --version      Print version
  pi-remote --help         Print this help

OPTIONS
  --port, -p <port>        HTTP port (default: 8080, env: PI_SERVER_PORT)
  --host <host>            Bind address (default: 0.0.0.0, env: PI_SERVER_HOST)
  --config <path>          Config file path
  --log-level <level>      Log level: debug, info, warn, error

CONFIG FILE  (~/.config/pi-server/config.json or ~/.pi/pi-server.json)
  sessionReset.mode        "idle" (default) | "daily" | "none"
  sessionReset.idleMinutes Minutes of inactivity before reset (default: 30)
  sessionReset.atHour      Hour for daily reset, 0-23 (default: 4)
  Env: PI_SERVER_SESSION_RESET_MODE, PI_SERVER_SESSION_RESET_IDLE_MINUTES,
       PI_SERVER_SESSION_RESET_AT_HOUR

EXAMPLES
  pi-remote start
  pi-remote start --port 9090
  pi-remote status
  pi-remote relay
  pi-remote install        # installs systemd service, enables auto-start
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
        console.log(`pi-remote is running (PID ${pid})`);
        process.exit(0);
      } catch {
        console.log("pi-remote is not running (stale PID file)");
        process.exit(1);
      }
    } else {
      console.log("pi-remote is not running");
      process.exit(1);
    }
  }

  // ── Stop ────────────────────────────────────────────────
  if (command === "stop") {
    const pid = PiServer.readPidFile();
    if (!pid) {
      console.log("pi-remote is not running");
      process.exit(1);
    }

    try {
      process.kill(pid, "SIGTERM");
      console.log(`Sent SIGTERM to pi-remote (PID ${pid})`);

      // Wait for process to exit
      let waited = 0;
      while (waited < 10) {
        try {
          process.kill(pid, 0);
          await new Promise((r) => setTimeout(r, 500));
          waited += 0.5;
        } catch {
          console.log("pi-remote stopped");
          process.exit(0);
        }
      }

      // Force kill if still running
      try {
        process.kill(pid, "SIGKILL");
        console.log("pi-remote force killed");
      } catch {
        // already dead
      }
      process.exit(0);
    } catch (err) {
      console.error(`Failed to stop pi-remote: ${err}`);
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

  // ── Install (systemd) ──────────────────────────────────
  if (command === "install") {
    await runInstall(args.slice(1));
    return;
  }

  // ── Uninstall (systemd) ────────────────────────────────
  if (command === "uninstall") {
    await runUninstall();
    return;
  }

  // ── Logs (tail events.jsonl) ────────────────────────────
  if (command === "logs") {
    await runLogs();
    return;
  }

  // ── Unknown command ────────────────────────────────────
  console.error(`Unknown command: ${command}`);
  console.error("Run 'pi-remote --help' for usage.");
  process.exit(1);
}

/**
 * Start the pi-server in foreground.
 */
async function startServer(cliArgs: string[]): Promise<void> {
  let configPath: string | undefined;
  let detach = false;

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
      case "--detach":
      case "-d":
        detach = true;
        break;
    }
  }

  const config = loadConfig(configPath);

  // --detach: fork and exit, child runs the server
  if (detach) {
    const { spawn } = await import("node:child_process");
    const args = process.argv
      .slice(1)
      .filter((a) => a !== "--detach" && a !== "-d");
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    console.log(
      `pi-remote detached (PID ${child.pid}). Check status with: pi-remote status`,
    );
    process.exit(0);
  }

  const server = new PiServer(config);

  try {
    await server.start();
    console.error(`pi-remote v${VERSION} started on ${server.url}`);

    // Keep running until SIGINT/SIGTERM
    await new Promise(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("EADDRINUSE")) {
      console.error(
        `Port ${config.port || server.config.port} already in use. Stop the existing server: pi-remote stop`,
      );
    } else {
      console.error(`Failed to start pi-remote: ${msg}`);
    }
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

/**
 * Install pi-remote as a systemd service (Linux only).
 * Writes unit file, runs systemctl enable --now.
 */
async function runInstall(args: string[]): Promise<void> {
  if (process.platform !== "linux") {
    console.error(
      "pi-remote install: systemd is Linux-only. Use pm2 or Docker on other platforms.",
    );
    process.exit(1);
  }

  const { execSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const nodePath = process.execPath;
  const cliPath = process.argv[1];
  const config = loadConfig();

  // Parse optional --port override
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
      config.port = parseInt(args[++i], 10);
    }
  }

  const user = process.env.USER || process.env.LOGNAME || "nobody";
  const unit = `[Unit]
Description=pi-remote — remote access for Pi Coding Agent
After=network.target

[Service]
Type=simple
User=${user}
ExecStart=${nodePath} ${cliPath} start
Restart=on-failure
RestartSec=5
Environment=PI_SERVER_PORT=${config.port}
Environment=PI_SERVER_HOST=${config.host}

[Install]
WantedBy=multi-user.target
`;

  const unitPath = "/etc/systemd/system/pi-remote.service";

  // Write unit file
  try {
    writeFileSync(unitPath, unit, "utf-8");
    console.log(`Wrote ${unitPath}`);
  } catch (err) {
    console.error(`Cannot write ${unitPath} — try: sudo pi-remote install`);
    process.exit(1);
  }

  // Reload and enable
  try {
    execSync("systemctl daemon-reload", { stdio: "inherit" });
    execSync("systemctl enable pi-remote", { stdio: "inherit" });
    execSync("systemctl start pi-remote", { stdio: "inherit" });
    console.log("\npi-remote installed and running.");
    console.log("  Check status:  systemctl status pi-remote");
    console.log("  View logs:     journalctl -u pi-remote -f");
    console.log("  Uninstall:     sudo systemctl disable --now pi-remote");
  } catch (err) {
    console.error(`systemctl failed: ${err}`);
    console.error(`Unit file written to ${unitPath}. Fix permissions and run:`);
    console.error(`  sudo systemctl daemon-reload`);
    console.error(`  sudo systemctl enable --now pi-remote`);
    process.exit(1);
  }
}

/**
 * Tail the event log.
 */
async function runLogs(): Promise<void> {
  const { EventLog } = await import("./event-log.js");
  const { existsSync } = await import("node:fs");

  if (!existsSync(EventLog.path)) {
    console.error("No events yet. Start pi-remote first.");
    process.exit(0);
  }

  // Print last 30 lines
  const lines = EventLog.tail(30);
  for (const line of lines) console.log(line);

  // Poll for new lines every second (cross-platform, no dependencies)
  let lastSize = lines.length;
  setInterval(() => {
    const current = EventLog.tail(0);
    if (current.length > lastSize) {
      for (let i = lastSize; i < current.length; i++) console.log(current[i]);
      lastSize = current.length;
    }
  }, 1000);

  await new Promise(() => {}); // keep alive until Ctrl+C
}

/**
 * Remove pi-remote systemd service.
 */
async function runUninstall(): Promise<void> {
  const { execSync } = await import("node:child_process");
  const { existsSync, unlinkSync } = await import("node:fs");
  const unitPath = "/etc/systemd/system/pi-remote.service";

  if (!existsSync(unitPath)) {
    console.log("pi-remote systemd service not found. Nothing to uninstall.");
    process.exit(0);
  }

  try {
    execSync("systemctl stop pi-remote", { stdio: "inherit" });
    execSync("systemctl disable pi-remote", { stdio: "inherit" });
  } catch {
    /* already stopped or disabled */
  }

  try {
    unlinkSync(unitPath);
    execSync("systemctl daemon-reload", { stdio: "inherit" });
    console.log("pi-remote uninstalled.");
    console.log(`  Removed ${unitPath}`);
    console.log(`  Run 'pi-remote install' to reinstall.`);
  } catch (err) {
    console.error(`Cannot remove ${unitPath} — try: sudo pi-remote uninstall`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
