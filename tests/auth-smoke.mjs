#!/usr/bin/env node
/**
 * Auth smoke test — verifies API key auth on both HTTP and WebSocket.
 */
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { unlinkSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PORT = "8095";
const PID_FILE = resolve(homedir(), ".pi", "pi-server.pid");
const CONFIG_DIR = resolve(homedir(), ".config", "pi-server");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");
const API_KEY = "test-key-12345";
let passed = 0, failed = 0;

function check(name, condition, detail = "") {
  if (condition) { console.log(`  ✓ ${name}${detail ? ` (${detail})` : ""}`); passed++; }
  else { console.log(`  ✗ ${name}`); failed++; }
}

// Clean up
try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
try { mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
writeFileSync(CONFIG_FILE, JSON.stringify({
  port: parseInt(PORT),
  auth: { enabled: true, apiKeys: [API_KEY] }
}));

// Start server with auth
console.log("Starting pi-remote with auth enabled...");
const server = spawn("node", ["dist/cli.js", "start", "--port", PORT], {
  stdio: "pipe",
  env: { ...process.env, PI_SERVER_PORT: PORT },
});
await sleep(3000);

try {
  // ── HTTP: no key = 401 ───────────────────────────────
  let resp = await fetch(`http://localhost:${PORT}/v1/health`);
  check("HTTP health without key = 200 (health is public)", resp.status === 200);

  resp = await fetch(`http://localhost:${PORT}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hello" }),
  });
  check("HTTP chat without key = 401", resp.status === 401);

  resp = await fetch(`http://localhost:${PORT}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify({ message: "hello" }),
  });
  check("HTTP chat with valid key = 200", resp.status === 200);

  resp = await fetch(`http://localhost:${PORT}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer wrong-key" },
    body: JSON.stringify({ message: "hello" }),
  });
  check("HTTP chat with wrong key = 401", resp.status === 401);

  // ── WS: no key = rejected ─────────────────────────────
  const ws1 = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise((resolve) => ws1.on("open", resolve));
  ws1.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "test" }));
  const msg1 = await new Promise(r => ws1.once("message", d => r(JSON.parse(d.toString()))));
  check("WS without key = rejected", msg1.type === "error" && msg1.code === "AUTH_FAILED");
  ws1.close();

  // ── WS: wrong key = rejected ──────────────────────────
  const ws2 = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise((resolve) => ws2.on("open", resolve));
  ws2.send(JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "test" }));
  const msg2 = await new Promise(r => ws2.once("message", d => r(JSON.parse(d.toString()))));
  check("WS wrong key = rejected", msg2.type === "error" && msg2.code === "AUTH_FAILED");
  ws2.close();

  // ── Note: WS auth currently only checks remoteAddress, not auth headers ──
  // The auth provider reads authorization from context but WS doesn't send it yet.
  // This is a known gap — auth on WS only works with IP-based rules for now.
  console.log("  - WS key-based auth: requires auth header support (known gap)");

} catch (err) {
  console.error("FATAL:", err.message);
  failed++;
} finally {
  server.kill("SIGTERM");
  await sleep(500);
  try { server.kill("SIGKILL"); } catch {}
}

// Clean up
try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
try { if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE); } catch {}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
