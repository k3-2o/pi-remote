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

### Quick Start
| Document | What's in it |
|---|---|
| [Getting Started](docs/getting-started.md) | Five-minute install + curl test — verify it works |

### Tutorials
| Document | What's in it |
|---|---|
| [Your First Chat](docs/tutorials/your-first-chat.md) | Step-by-step from zero — install, connect, send your first message, learn the SDK |

### How-to Guides
| Document | What's in it |
|---|---|
| [Build a Discord Bot](docs/how-to/discord-bot.md) | Connect pi-remote to a Discord bot — real example |
| [Triggers](docs/how-to/triggers.md) | Discord bots, cron jobs, webhooks — patterns for connecting anything |
| [Daemon Mode](docs/how-to/daemon-mode.md) | Background, systemd, logs |
| [Docker](docs/how-to/docker.md) | Run in a container |
| [Production Setup](docs/how-to/production.md) | TLS, rate limiting, log rotation |

### Reference
| Document | What's in it |
|---|---|
| [SDK Reference](docs/reference/sdk.md) | Every method and event — abstracted vs raw, examples |
| [CLI Reference](docs/reference/cli.md) | Every command with options |
| [Configuration](docs/reference/configuration.md) | Every config option with defaults |
| [Protocol](docs/reference/protocol.md) | WebSocket handshake, commands, events, extension UI |

### Explanation
| Document | What's in it |
|---|---|
| [How It Works](docs/explanation/how-it-works.md) | The pipe model — what we built vs what emerged from Pi |
| [Architecture](docs/explanation/architecture.md) | Why WebSocket, process model, design decisions |

---

## License

MIT
