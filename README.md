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

### Documentation Index

| Document | Type | What's in it |
|---|---|---|
| [Getting Started](docs/getting-started.md) | Quick Start | Five-minute install + curl test — verify it works |
| [Your First Chat](docs/tutorials/your-first-chat.md) | Tutorial | Step-by-step from zero — install, connect, send your first message, learn the SDK |
| [Deploy to a VPS](docs/tutorials/deploy-to-vps.md) | Tutorial | Bare Ubuntu server to production pi-remote behind nginx with TLS, auto-start, and API key auth |
| [Build a Discord Bot](docs/how-to/discord-bot.md) | How-to | Connect pi-remote to a Discord bot — real example |
| [Triggers](docs/how-to/triggers.md) | How-to | Discord bots, cron jobs, webhooks — patterns for connecting anything |
| [Daemon Mode](docs/how-to/daemon-mode.md) | How-to | Background, systemd, logs |
| [Docker](docs/how-to/docker.md) | How-to | Run in a container |
| [Production Setup](docs/how-to/production.md) | How-to | TLS, rate limiting, log rotation |
| [SDK Reference](docs/reference/sdk.md) | Reference | Every method and event — abstracted vs raw, examples |
| [CLI Reference](docs/reference/cli.md) | Reference | Every command with options |
| [Configuration](docs/reference/configuration.md) | Reference | Every config option with defaults |
| [Protocol](docs/reference/protocol.md) | Reference | WebSocket handshake, commands, events, extension UI |
| [Deployment Paths](docs/reference/deployment-paths.md) | Reference | VPS providers, tunnel alternatives, bare metal — comparison and trade-offs |
| [How It Works](docs/explanation/how-it-works.md) | Explanation | The pipe model — what we built vs what emerged from Pi |
| [Architecture](docs/explanation/architecture.md) | Explanation | Why WebSocket, process model, design decisions |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
