# pi-remote

> WebSocket-first server runtime for Pi Coding Agent. Start it once, talk to Pi from anywhere.

```bash
npm install -g @k3_2o/pi-remote
pi-remote start
curl -X POST http://localhost:8080/v1/chat -H "Content-Type: application/json" -d '{"message":"say hello"}'
```

pi-remote is a thin server that turns Pi's RPC mode into a network service. It handles process management, session multiplexing, and transport. Pi does the thinking. The pipe is dumb.

---

## Features

- **WebSocket** — the real protocol. Connection = session. All Pi commands available. Extension UI flows bidirectionally.
- **HTTP** — sugar layer for curl, cron, webhooks. `/v1/chat` streams SSE.
- **Session management** — one Pi process per session. Auto-cleanup. Pool with eviction. Idle reset policies.
- **Auth** — optional API key middleware on both transports.
- **Daemon mode** — `--detach` for quick dev, `systemd` for production.
- **CLI** — `start`, `stop`, `status`, `health`, `sessions`, `logs`, `relay`.
- **SDKs** — JavaScript and Python clients. Import from npm or copy-paste.
- **Zero config** — sensible defaults for everything. Config file optional.

---

## Quick Start

```bash
npm install -g @k3_2o/pi-remote       # you also need Pi: npm install -g @earendil-works/pi-coding-agent
pi-remote start                # server on :8080
pi-remote health               # check it's alive
pi-remote sessions             # list sessions
```

---

## Documentation

| Document | What's in it |
|---|---|
| [Getting Started](docs/getting-started.md) | Install, first chat, daemon mode |
| [Configuration](docs/reference/configuration.md) | Every config option with defaults |
| [CLI Reference](docs/reference/cli.md) | Every command with options |
| [Protocol](docs/reference/protocol.md) | WebSocket handshake, commands, events, extension UI |
| [SDK Reference](docs/reference/sdk.md) | JavaScript and Python client API |
| [Triggers](docs/how-to/triggers.md) | Discord bots, cron jobs, webhooks — patterns for connecting anything |
| [Daemon Mode](docs/how-to/daemon-mode.md) | Background, systemd, logs |
| [Docker](docs/how-to/docker.md) | Run in a container |
| [Production Setup](docs/how-to/production.md) | TLS, rate limiting, log rotation |
| [Architecture](docs/explanation/architecture.md) | Why WebSocket, process model |
| [Emergence](docs/explanation/emergence.md) | How 30+ commands emerged from 2 |

---

## License

MIT
