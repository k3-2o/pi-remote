#!/usr/bin/env node
/**
 * WebSocket smoke test — verifies the WS-first architecture end-to-end.
 *
 * Tests:
 *  1. Connect + handshake → welcome with sessionId (auto-created)
 *  2. WS-native commands: get_health, get_version, list_sessions
 *  3. Session-scoped command: get_state (via Pi process)
 *  4. Ping/pong
 *
 * Run: node tests/ws-smoke.mjs
 */

import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = "8085";
let failed = false;

function fail(msg) {
  console.error("✗ FAIL:", msg);
  failed = true;
}

// ── Start server ──────────────────────────────────────────
console.log("Starting pi-remote on port", PORT, "...");
const server = spawn("node", ["dist/cli.js", "start", "--port", PORT], {
  stdio: "ignore",
  env: { ...process.env, PI_SERVER_PORT: PORT },
});
await sleep(3000);

try {
  // ── 1. Connect + handshake ──────────────────────────────
  const ws = new WebSocket(`ws://localhost:${PORT}`);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("WS connect timeout")),
      5000,
    );
    ws.on("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  console.log("✓ 1. WebSocket connected");

  // Send hello handshake
  ws.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      clientId: "smoke-test",
    }),
  );

  // Expect welcome with sessionId (auto-created)
  const welcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Welcome timeout")), 5000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });

  if (welcome.type !== "welcome") fail(`Expected welcome, got ${welcome.type}`);
  else if (!welcome.sessionId) fail("welcome missing sessionId");
  else
    console.log(
      `✓ 2. Welcome received — session auto-created: ${welcome.sessionId}`,
    );

  // ── 2. WS-native command: get_health ────────────────────
  ws.send(JSON.stringify({ type: "command", payload: { type: "get_health" } }));
  const health = await new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
  if (health.type === "response" && health.payload?.status === "ok") {
    console.log(
      `✓ 3. get_health: ${health.payload.status}, sessions: ${health.payload.sessions}, WS clients: ${health.payload.wsClients}`,
    );
  } else {
    fail(
      `get_health: unexpected response ${JSON.stringify(health).slice(0, 100)}`,
    );
  }

  // ── 3. WS-native command: get_version ───────────────────
  ws.send(
    JSON.stringify({ type: "command", payload: { type: "get_version" } }),
  );
  const version = await new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
  if (version.type === "response" && version.payload?.version) {
    console.log(`✓ 4. get_version: ${version.payload.version}`);
  } else {
    fail(
      `get_version: unexpected response ${JSON.stringify(version).slice(0, 100)}`,
    );
  }

  // ── 4. WS-native command: list_sessions ─────────────────
  ws.send(
    JSON.stringify({ type: "command", payload: { type: "list_sessions" } }),
  );
  const sessions = await new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
  if (sessions.type === "response" && sessions.payload?.sessions?.length >= 1) {
    console.log(
      `✓ 5. list_sessions: ${sessions.payload.sessions.length} session(s)`,
    );
  } else {
    fail(`list_sessions: unexpected ${JSON.stringify(sessions).slice(0, 100)}`);
  }

  // ── 5. Ping/pong ────────────────────────────────────────
  ws.send(JSON.stringify({ type: "ping" }));
  const pong = await new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
  if (pong.type === "pong") {
    console.log("✓ 6. Ping/pong works");
  } else {
    fail(`Ping/pong: expected pong, got ${pong.type}`);
  }

  // ── 6. Session-scoped command: get_state ─────────────────
  // Uses the auto-created session from handshake (state.sessionId)
  ws.send(JSON.stringify({ type: "command", payload: { type: "get_state" } }));
  const stateResp = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("get_state timeout")),
      10000,
    );
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "response" || msg.type === "error") {
        clearTimeout(timer);
        resolve(msg);
      }
      // Events (like agent_end) may fire — keep listening for response
    };
    ws.on("message", handler);
  });
  if (stateResp.type === "response") {
    console.log("✓ 7. get_state: Pi process responded");
  } else {
    fail(`get_state: ${stateResp.code}: ${stateResp.message}`);
  }

  ws.close();

  console.log("\n✓ WebSocket smoke test PASSED");
} catch (err) {
  fail(err.message);
} finally {
  server.kill("SIGTERM");
  await sleep(500);
  // Force kill if still alive
  try {
    server.kill("SIGKILL");
  } catch {}
}

process.exit(failed ? 1 : 0);
