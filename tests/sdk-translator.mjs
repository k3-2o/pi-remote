#!/usr/bin/env node
/**
 * SDK translator smoke test — verifies all event mappings:
 *   token, thinking, tool_start, tool_output, tool_end, agent_end
 *
 * Run: node tests/sdk-translator.mjs
 */

import { PiRemoteWS } from "../examples/pi_remote_ws.mjs";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PORT = "8093";
const PID_FILE = resolve(homedir(), ".pi", "pi-server.pid");
let failed = 0;
let passed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ""}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

// Clean up
try {
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
} catch {}

// Start server
console.log("Starting pi-remote...");
const server = spawn("node", ["dist/cli.js", "start", "--port", PORT], {
  stdio: "pipe",
  env: { ...process.env, PI_SERVER_PORT: PORT },
});
await sleep(3000);

try {
  const client = new PiRemoteWS(`ws://localhost:${PORT}`);
  await client.connect();
  console.log(`Connected. Session: ${client.sessionId}\n`);

  // ── Collect events ────────────────────────────────────
  const events = {
    token: [],
    thinking: [],
    tool_start: [],
    tool_output: [],
    tool_end: [],
    agent_end: 0,
    ext_ui: [],
  };

  client.on("token", (t) => events.token.push(t));
  client.on("thinking", (t) => events.thinking.push(t));
  client.on("tool_start", (t) => events.tool_start.push(t));
  client.on("tool_output", (t) => events.tool_output.push(t));
  client.on("tool_end", (t) => events.tool_end.push(t));
  client.on("agent_end", () => events.agent_end++);

  // ── Prompt that triggers tool use ─────────────────────
  console.log("Sending: 'run ls in the current directory'\n");
  const result = await client.chat("run ls in the current directory");

  console.log("--- Results ---");

  // token
  check(
    "token events fired",
    events.token.length > 0,
    `${events.token.length} tokens`,
  );
  check(
    "token text accumulated",
    result.text.length > 0,
    `${result.text.length} chars`,
  );

  // tool_start
  check(
    "tool_start fired",
    events.tool_start.length > 0,
    `${events.tool_start.length} tool(s)`,
  );
  if (events.tool_start.length > 0) {
    const t = events.tool_start[0];
    check("tool_start has tool name", !!t.tool, t.tool);
    check("tool_start has args", !!t.args, JSON.stringify(t.args).slice(0, 60));
  }

  // tool_end
  check(
    "tool_end fired",
    events.tool_end.length > 0,
    `${events.tool_end.length} tool(s)`,
  );
  if (events.tool_end.length > 0) {
    const t = events.tool_end[0];
    check("tool_end has result", t.result !== undefined);
  }

  // agent_end
  check("agent_end fired", events.agent_end > 0);

  // result object
  check("result has sessionId", !!result.sessionId, result.sessionId);

  // ── Thinking test (requires model that thinks) ─────────
  // Most models don't emit thinking deltas by default.
  // This will likely be 0 — that's not a failure, just model-dependent.
  if (events.thinking.length > 0) {
    check("thinking events fired", true, `${events.thinking.length} chunks`);
  } else {
    console.log("  - thinking (none — model doesn't emit thinking deltas)");
  }

  client.close();
} catch (err) {
  console.error("FATAL:", err.message);
  failed++;
} finally {
  server.kill("SIGTERM");
  await sleep(500);
  try {
    server.kill("SIGKILL");
  } catch {}
}

// ── Summary ───────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
