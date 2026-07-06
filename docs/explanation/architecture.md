# Architecture

Why pi-remote is built the way it is, and what trade-offs were made.

---

## Why WebSocket-First

HTTP one-shots only work when you pre-load the prompt with "don't ask, just do." That's a workaround, not a feature. The agent is a developer — developers ask questions, report back, flag issues.

WebSocket leaves the door open. You can use it like a one-shot (connect → message → disconnect). But when Pi needs to say "PR is up, want me to merge?" or "tests broke, here's the log, what do you want me to do?" — it can. HTTP never could.

The choice isn't about technical details. It's about not artificially restricting what Pi can do.

HTTP still has its place — cron jobs, simple webhooks. Both transports are here. Neither was removed.

> See [Protocol](../reference/protocol.md) for the full WebSocket specification.

---

## Process Model

One pi-remote server manages multiple Pi processes. Each session gets its own fully isolated Pi instance.

```
pi-remote (1 process, ~50MB)
├── Pi #1  ← Discord bot session        (~100–300MB)
├── Pi #2  ← Telegram bot session       (~100–300MB)
├── Pi #3  ← cron job just fired        (~100–300MB)
└── Pi #4  ← idle, waiting              (~100–300MB)
```

When a session disconnects, its Pi process is stopped (SIGTERM → 5s timeout → SIGKILL). The session record is preserved. Memory is freed.

Pool limits: max 10 concurrent Pi processes by default. Configurable via `maxSessions`. When the pool is full, the oldest idle process is evicted. If none are idle, new connections are rejected.

---

## Protocol Layering

pi-remote speaks two protocols. They never mix.

```
Client ←→ pi-remote ←→ Pi
  (our envelope)      (JSON-RPC)
```

The client never sees raw JSON-RPC. Pi's output is wrapped inside a `payload` field in our envelope. The SDK translates the payload into readable events — the server is a transparent pipe, the SDK is the translator.

This means Pi can evolve its RPC protocol independently. pi-remote doesn't need to change unless the subprocess interface changes. New Pi commands flow through automatically.

---

## Emergence — 30+ Commands From 2

The original goal required only two commands: `prompt` and `abort`.

The other 25 Pi RPC commands emerged because the pipe is transparent. One function — `forwardToPi` — dispatches all 27 Pi commands with zero per-command code. If Pi adds a new RPC command, it flows through automatically.

The 6 WS-native commands (`get_health`, `get_version`, `list_sessions`, `create_session`, `delete_session`, `switch_session`) were the only ones deliberately built — for server management and the attach TUI.

Some emerged commands turned out genuinely useful for trigger code:

- `set_model` — per-task model selection. Use Claude for code review, a cheap model for simple questions.
- `set_thinking_level` — per-task depth control. "High" for complex tasks, "low" for quick answers.
- `compact` — summarise old context to free the window.
- `get_context_usage` — check before sending a large prompt.

The rest are Pi internals. They cost nothing and someone might want them someday.

---

## Pi-remote as an Abstraction Layer

A developer building a trigger (Discord bot, webhook handler, cron job) doesn't need to understand:

- JSON-RPC wire format
- Process spawning and lifecycle
- Session multiplexing
- `\n`-delimited JSONL parsing
- Auth middleware
- Heartbeat and backpressure

They run `pi-remote start` anywhere — laptop, VPS, Raspberry Pi — and talk to it through the SDK. pi-remote handles everything below the SDK surface.

This is the real product. Not the pipe. The abstraction.

---

## Dependencies (Deliberately Minimal)

| Dependency | Purpose |
|---|---|
| `hono` | HTTP framework + SSE streaming |
| `ws` | WebSocket server |
| `nanoid` | Session ID generation |
| `@hono/node-server` | Node.js adapter for Hono |
| `esbuild` | Build tool (dev only) |
| `vitest` | Test framework (dev only) |
| `typescript` | Type checking (dev only) |

No framework. No ORM. No database. No runtime dependencies beyond these four packages.

---

## Key Decisions

**TypeScript.** Pi is TypeScript. Using the same language avoids polyglot overhead. esbuild bundles in ~200ms.

**Separate Pi process per session.** Full isolation. Independent models and providers. No serialization of state between processes.

**Raw `\n` splitting for JSON-RPC.** Node's `readline` breaks on Unicode characters that are valid inside JSON strings. We split only on literal newline characters.

**Wait for `agent_end`.** Pi sends an acceptance response immediately when a prompt is queued. Streaming events arrive after. We resolve on `agent_end`, not the acceptance. Same pattern used by both HTTP and WS paths.

**`requestId` for command correlation.** Client generates a request ID, server echoes it. Not coupled to the server's internal event sequence number. Works across reconnect boundaries.

**Client-side orchestration.** pi-remote does not handle webhooks, cron, or messaging platforms. The user writes glue code that translates an event into a prompt. The pipe is dumb on purpose.
