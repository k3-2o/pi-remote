import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const server = spawn("node", ["dist/cli.js", "start"], {
  stdio: "ignore",
  env: { ...process.env, PI_SERVER_PORT: "8085" },
});
await sleep(4000);

// Test WebSocket connect + handshake
const ws = new WebSocket("ws://localhost:8085");

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  ws.on("open", () => {
    clearTimeout(timer);
    resolve();
  });
  ws.on("error", (e) => {
    clearTimeout(timer);
    reject(e);
  });
});
console.log("✓ WebSocket connected");

// Send hello
ws.send(
  JSON.stringify({ type: "hello", protocolVersion: 1, clientId: "test" }),
);

// Wait for welcome
const welcome = await new Promise((resolve) => {
  ws.once("message", (data) => resolve(JSON.parse(data.toString())));
});
console.log(
  "✓ Welcome received:",
  welcome.type,
  "sessions:",
  welcome.sessions ? welcome.sessions.length : 0,
);

// Create session via HTTP
const s = await fetch("http://localhost:8085/v1/sessions", { method: "POST" });
const sn = await s.json();
console.log("✓ Session created:", sn.sessionId);

// Send a command via WebSocket
ws.send(
  JSON.stringify({
    type: "command",
    sessionId: sn.sessionId,
    payload: { type: "get_state" },
  }),
);

// Wait for response
const resp = await new Promise((resolve) => {
  ws.once("message", (data) => resolve(JSON.parse(data.toString())));
});
console.log("✓ WS command response:", resp.type);

// Send ping
ws.send(JSON.stringify({ type: "ping" }));
const pong = await new Promise((resolve) => {
  ws.once("message", (data) => resolve(JSON.parse(data.toString())));
});
console.log("✓ Ping/pong:", pong.type);

ws.close();
server.kill();
await sleep(1000);
console.log("✓ WebSocket end-to-end works");
process.exit(0);
