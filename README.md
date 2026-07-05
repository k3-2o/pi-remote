# pi-remote

> Remote access for Pi Coding Agent — one command, one port, any client.

Pi-remote wraps Pi's RPC mode behind an HTTP + WebSocket server. Start it once, talk to Pi from anything — curl, Python, JavaScript, Discord bots, CI pipelines, VS Code.

```bash
pi-remote start          # server on :8080
curl -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"explain src/auth.ts"}'
```

No Pi modifications. No AI changes. Just a pipe.

---

## Quick Start

```bash
# 1. Make sure Pi is installed
npm install -g @earendil-works/pi-coding-agent

# 2. Clone and build pi-remote
git clone https://github.com/k3-2o/pi-remote.git
cd pi-remote
npm install
just build

# 3. Start the server
node dist/cli.js start

# 4. Chat (in another terminal)
curl -N -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"what files are here?"}'
```

---

## Features

- **HTTP REST + SSE streaming** — `/v1/chat` streams tokens as they're generated
- **WebSocket** — same port, real-time bidirectional, extension UI dialogs
- **Session management** — one Pi process per session, auto-cleanup for one-shots
- **Auth** — optional API key middleware (HTTP + WS)
- **Daemon mode** — `--detach` for quick dev, `sudo pi-remote install` for systemd
- **Event log** — JSONL at `~/.pi/pi-remote/events.jsonl`, `pi-remote logs` to tail
- **Graceful shutdown** — SIGTERM drains in-flight commands, kills Pi processes cleanly
- **CLI** — `start | stop | status | restart | relay | install | logs`
- **SDKs** — Python + JS clients included (copy-paste into your project)
- **Config** — `~/.config/pi-remote/config.json` + environment variables

---

## API Reference

All endpoints return JSON unless otherwise noted. Auth: `Authorization: Bearer <key>` header (when enabled).

### Chat

```http
POST /v1/chat
Content-Type: application/json

{
  "message": "explain this code",    // required
  "sessionId": "abc123"              // optional — reuse for multi-turn
}
```

Response: `text/event-stream` (SSE). Events:
- `event: token` — text chunks as they're generated
- `event: thinking` — model reasoning (when thinking is enabled)
- `event: tool_start` / `event: tool_end` — tool calls (bash, read, edit, etc.)
- `event: done` — response complete, includes `sessionId` for reuse

Without `sessionId`, the chat is one-shot — Pi process is freed after response, record kept for history.
With `sessionId`, the conversation persists between messages.

```bash
# One-shot
curl -N -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"say hello"}'

# Multi-turn
curl -N -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"remember: the password is hunter2","sessionId":"my-bot"}'

curl -N -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"what did I just tell you?","sessionId":"my-bot"}'
```

### Sessions

```http
POST   /v1/sessions              # create a session
GET    /v1/sessions              # list all sessions
GET    /v1/sessions/:id          # get session info
DELETE /v1/sessions/:id          # delete session permanently
POST   /v1/sessions/:id/chat     # chat in a specific session
POST   /v1/sessions/:id/abort    # abort running task
```

```bash
# Create a session for long-running work
curl -X POST http://localhost:8080/v1/sessions

# Chat in it
curl -N -X POST http://localhost:8080/v1/sessions/UgjhfiYr/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"review this entire codebase"}'
```

### Health & Info

```http
GET /v1/health     →  { status: "ok", uptime: 3600, sessions: 3, version: "0.2.0" }
GET /v1/version    →  { version: "0.2.0", protocol: "1.0.0" }
```

---

## WebSocket

Connect to `ws://localhost:8080`. Protocol:

```
1. Client →  { type: "hello", protocolVersion: 1, clientId: "my-app" }
2. Server → { type: "welcome", serverVersion: "0.2.0", sessions: [...], currentSeq: 0 }
3. Steady-state:
   Client → { type: "command", sessionId: "abc", payload: { type: "prompt", message: "hello" } }
   Server → { type: "event", seq: 1, sessionId: "abc", payload: { type: "message_update", ... } }
   Client → { type: "ping" }
   Server → { type: "pong" }
```

Extension UI dialogs (select, confirm, input) are forwarded:
```
Server → { type: "extension_ui_request", id: "u1", method: "select", options: ["Allow", "Block"] }
Client → { type: "extension_ui_response", requestId: "u1", response: { method: "select", value: "Allow" } }
```

---

## CLI

```
pi-remote start                  # Start in foreground
pi-remote start --detach         # Fork into background
pi-remote start --port 9090      # Custom port
pi-remote stop                   # Graceful shutdown
pi-remote restart                # Stop + start
pi-remote status                 # Check if running
pi-remote relay                  # Debug: stdin JSON → Pi → stdout
pi-remote logs                   # Tail events.jsonl
sudo pi-remote install           # Install as systemd service (auto-start on boot)
pi-remote --version              # Print version
```

---

## Daemon Mode

**Quick dev:** `pi-remote start --detach` — forks, parent exits, PID file tracks child.

**Production (Linux):** `sudo pi-remote install` — writes systemd unit, enables auto-start on boot. Survives reboots and crashes.

```bash
sudo pi-remote install
systemctl status pi-remote
journalctl -u pi-remote -f
```

**Uninstall:**
```bash
sudo systemctl disable --now pi-remote
sudo rm /etc/systemd/system/pi-remote.service
```

---

## Configuration

`~/.config/pi-remote/config.json`:

```json
{
  "port": 8080,
  "host": "0.0.0.0",
  "maxSessions": 10,
  "sessionTimeout": 1800,
  "logLevel": "info",
  "auth": {
    "enabled": true,
    "apiKeys": ["sk-your-secret-key"]
  },
  "piCommand": "pi",
  "piArgs": ["--mode", "rpc", "--no-session"]
}
```

Environment variable overrides: `PI_SERVER_PORT`, `PI_SERVER_HOST`, `PI_SERVER_LOG_LEVEL`, `PI_SERVER_MAX_SESSIONS`, `PI_SERVER_PI_COMMAND`.

All values have sensible defaults — zero-config startup works.

---

## SDKs

Copy-paste these into your project. No npm/pip install beyond the standard library.

### Python

```python
from pi_remote import PiRemote

client = PiRemote("http://localhost:8080")
result = client.chat("review src/auth.ts")
print(result["text"])

# Multi-turn
result = client.chat("explain this", session_id="my-bot")
followup = client.chat("what about X?", session_id=result["session_id"])
```

### JavaScript

```javascript
import { PiRemote } from "./pi_remote.mjs";

const client = new PiRemote("http://localhost:8080");
const result = await client.chat("review src/auth.ts");
console.log(result.text);

// Multi-turn
const r1 = await client.chat("explain this", { sessionId: "my-bot" });
const r2 = await client.chat("what about X?", { sessionId: r1.sessionId });
```

---

## Architecture

```
Client (curl/Python/JS/Discord/VS Code)
         │
    HTTP / WebSocket
         │
    pi-remote (Node.js)
         │
    stdin/stdout JSON-RPC
         │
    Pi Coding Agent (pi --mode rpc)
         │
    tools: read, bash, edit, write, composio, ...
```

Pi-remote is a **transparent pipe**. It does not modify Pi, add AI capabilities, or interpret responses. It handles transport, lifecycle, and session management. Pi does the thinking.

---

## Development

```bash
git clone https://github.com/k3-2o/pi-remote.git
cd pi-remote
npm install

just build       # compile
just test        # run tests (117)
just fmt         # format
just types       # type-check
just check       # all static analysis
```

---

## License

MIT
