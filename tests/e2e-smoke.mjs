import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const SERVER = spawn("node", ["dist/cli.js", "start"], {
  stdio: "inherit",
  env: { ...process.env, PI_SERVER_PORT: "8082" },
});

// Wait for server to be ready
await sleep(4000);

try {
  // Health check
  const h = await fetch("http://localhost:8082/v1/health");
  console.log("health:", h.status, await h.json());

  // Create session
  const s = await fetch("http://localhost:8082/v1/sessions", {
    method: "POST",
  });
  const sn = await s.json();
  console.log("session:", sn.sessionId);

  // Chat
  const c = await fetch("http://localhost:8082/v1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "say exactly: hello",
      sessionId: sn.sessionId,
    }),
  });

  const text = await c.text();
  console.log("chat status:", c.status);
  console.log("chat body:", text.slice(0, 500));
  console.log("events:", (text.match(/event: /g) || []).length);
} catch (e) {
  console.error("FAIL:", e.message);
} finally {
  SERVER.kill();
  await sleep(1000);
  process.exit(0);
}
