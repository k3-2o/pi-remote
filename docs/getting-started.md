# Getting Started

A step-by-step guide from zero to your first Pi chat over the network.

---

## Prerequisites

- **Node.js 18** or later
- **Pi Coding Agent** installed: `npm install -g @earendil-works/pi-coding-agent`
- Verify Pi works: `pi --version`

---

## 1. Install pi-remote

```bash
npm install -g pi-remote
```

Verify it installed:

```bash
pi-remote --version
# → 0.2.0
```

---

## 2. Start the Server

```bash
pi-remote start
```

You should see:

```
pi-remote v0.2.0 started on http://0.0.0.0:8080
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
pi-remote v0.1.0
  Status:    ok
  Uptime:    0m 12s
  Sessions:  0
```

Or with curl:

```bash
curl http://localhost:8080/v1/health
# → {"status":"ok","uptime":12.4,"sessions":0,"version":"0.1.0"}
```

---

## 4. Send Your First Prompt

**Quick test with curl:**

```bash
curl -N -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"say hello in one sentence"}'
```

You'll see SSE events stream by — `token` events with text chunks, then a `done` event when complete.

**With the JavaScript SDK:**

```bash
npm install pi-remote
```

```js
import { PiRemoteWS } from "pi-remote/client";

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

## 5. Background & Production

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

- [Configure](configuration.md) port, auth, session limits, reset policies
- [Connect triggers](triggers.md) — Discord bots, cron jobs, GitHub webhooks
- [Read the protocol](protocol.md) — full WebSocket command and event reference
- [Explore the SDK](sdk.md) — all methods, events, and patterns
