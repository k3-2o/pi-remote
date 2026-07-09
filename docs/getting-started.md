# Getting Started

A step-by-step guide from zero to your first Pi chat over the network.

---

## Prerequisites

- **Node.js 22** or later
- **Pi Coding Agent** installed: `npm install -g @earendil-works/pi-coding-agent`
- Verify Pi works: `pi --version`

---

## 1. Install pi-remote

```bash
npm install -g @k3_2o/pi-remote
```

Verify it installed:

```bash
pi-remote --version
# → 0.5.0
```

---

## 2. Start the Server

```bash
pi-remote start
```

You should see:

```
pi-remote v0.5.0 started on http://0.0.0.0:8080
```

The server runs in the foreground. Press `Ctrl+C` to stop.

To run in the background:

```bash
pi-remote start --detach
```

---

## 3. Verify It's Alive

```bash
pi-remote health
```

```
pi-remote v0.5.0
  Status:    ok
  Uptime:    0m 12s
  Sessions:  0
```

Or with curl:

```bash
curl http://localhost:8080/v1/health
# → {"status":"ok","uptime":12.4,"sessions":0,"version":"0.5.0"}
```

---

## 4. Open the Dashboard

pi-remote serves a browser dashboard at `/v1/ui` with live session monitoring, history, and session management.

```bash
pi-remote attach
```

**On your local machine** (has a display): Opens the dashboard in your browser automatically.

**On a headless server** (VPS, RasPi — no display): Prints the URL and SSH tunnel command so you can reach it from your laptop.

```
pi-remote dashboard: http://127.0.0.1:8080/v1/ui
SSH tunnel: ssh my-server -L 8080:localhost:8080
Then open http://localhost:8080/v1/ui
```

---

## 5. Send Your First Prompt

**Quick test with curl:**

```bash
curl -N -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"say hello in one sentence"}'
```

You'll see SSE events stream by — `token` events with text chunks, then a `done` event when complete.

**With the JavaScript SDK:**

```bash
npm install @k3_2o/pi-remote
```

```js
import { PiRemoteWS } from "@k3_2o/pi-remote/client";

const client = new PiRemoteWS("ws://localhost:8080");
await client.connect();

client.on("token", (t) => process.stdout.write(t));
await client.chat("say hello");
client.close();
```

**With the Python SDK:**

```python
from pi_remote_ws import PiRemoteWS
import asyncio

async def main():
    client = PiRemoteWS("ws://localhost:8080")
    await client.connect()
    client.on("token", lambda t: print(t, end="", flush=True))
    await client.chat("say hello")
    await client.close()

asyncio.run(main())
```

---

## 6. Background & Production

**Quick dev:** `pi-remote start --detach` forks into the background.

**Production (Linux):** Install as a systemd service — survives reboots, auto-restarts on crash.

```bash
sudo pi-remote install
systemctl status pi-remote
journalctl -u pi-remote -f
```

**Stop:**

```bash
pi-remote stop           # graceful
sudo pi-remote uninstall  # remove systemd service
```

---

## Next Steps

- [Follow the full tutorial](tutorials/your-first-chat.md) — step by step, from zero to your first message
- [Deploy to a VPS](tutorials/deploy-to-vps.md) — bare Ubuntu server to production with TLS
- [Build a Discord bot](how-to/discord-bot.md) — real example using the SDK
- [Configure](reference/configuration.md) port, auth, session limits, reset policies
- [Connect triggers](how-to/triggers.md) — Discord bots, cron jobs, GitHub webhooks
- [Run as a daemon](how-to/daemon-mode.md) — background, systemd, logs
- [Run in Docker](how-to/docker.md) — containerised deployment
- [Production setup](how-to/production.md) — TLS, rate limiting, log rotation
- [Deployment paths](reference/deployment-paths.md) — VPS providers, tunnels, bare metal compared
- [Read the protocol](reference/protocol.md) — WebSocket commands, events, extension UI
- [Explore the SDK](reference/sdk.md) — all methods, events, patterns
- [All CLI commands](reference/cli.md) — every subcommand with options
- [How it works](explanation/how-it-works.md) — the pipe model under the hood
- [Architecture](explanation/architecture.md) — why WebSocket, process model, design decisions
