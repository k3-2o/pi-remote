# Configuration

Every setting has a default. No config file is required. pi-remote starts with sensible defaults and works immediately.

---

## How Config Is Loaded

Three layers, applied in order. Later layers override earlier ones.

```
1. Hardcoded defaults    (src/types.ts → DEFAULT_CONFIG)
2. Config file           (~/.config/pi-server/config.json)
   Fallback:             (~/.pi/pi-server.json)
3. Environment variables (PI_SERVER_*)
```

The loader in `src/config.ts` starts with defaults, overlays the config file if it exists, then overlays any env vars that are set.

---

## Config File Location

Create one of these files:

```
~/.config/pi-server/config.json    ← primary (XDG standard)
~/.pi/pi-server.json               ← fallback
```

`~` means your home directory (`/home/username`).

```bash
mkdir -p ~/.config/pi-server
```

---

## Full Schema

All values shown with their defaults:

```json
{
  "port": 8080,
  "host": "0.0.0.0",
  "maxSessions": 10,
  "sessionTimeout": 1800,
  "logLevel": "info",
  "piCommand": "pi",
  "piArgs": ["--mode", "rpc", "--no-session"],
  "auth": {
    "enabled": false,
    "apiKeys": []
  },
  "sessionReset": {
    "mode": "idle",
    "idleMinutes": 30,
    "atHour": 4
  },
  "server": {
    "heartbeatInterval": 30000,
    "heartbeatTimeout": 10000,
    "backpressureThreshold": 65536,
    "backpressureCritical": 1048576,
    "shutdownTimeout": 30000
  }
}
```

---

## Options Reference

### Core

| Key | Type | Default | Description |
|---|---|---|---|
| `port` | number | 8080 | HTTP + WebSocket port |
| `host` | string | 0.0.0.0 | Bind address |
| `maxSessions` | number | 10 | Max concurrent Pi processes |
| `sessionTimeout` | number | 1800 | Idle timeout in seconds. `0` = never |
| `logLevel` | string | info | `debug`, `info`, `warn`, `error` |
| `piCommand` | string | pi | Path to Pi binary |
| `piArgs` | string[] | ["--mode","rpc","--no-session"] | Arguments passed to Pi |

### Auth

| Key | Type | Default | Description |
|---|---|---|---|
| `auth.enabled` | boolean | false | Require API key on all endpoints (except `/v1/health` and `/v1/version`) |
| `auth.apiKeys` | string[] | [] | Valid API keys. Clients pass via `Authorization: Bearer <key>` |

### Session Reset

Prevents Pi context windows from piling up in long-lived connections. When a session is idle beyond the configured threshold, the Pi process is killed. The session record is kept. The next message spawns a fresh Pi.

| Key | Type | Default | Description |
|---|---|---|---|
| `sessionReset.mode` | string | idle | `idle` (reset after silence), `daily` (reset at fixed hour), `none` (never) |
| `sessionReset.idleMinutes` | number | 30 | Minutes of inactivity before reset |
| `sessionReset.atHour` | number | 4 | Hour (0–23) for daily reset |

### Server Internals

WebSocket heartbeat, backpressure, and shutdown tuning. Rarely needs adjustment.

| Key | Type | Default | Description |
|---|---|---|---|
| `server.heartbeatInterval` | number | 30000 | Ping interval in milliseconds |
| `server.heartbeatTimeout` | number | 10000 | Close connection if no pong within this |
| `server.backpressureThreshold` | number | 65536 | Drop non-critical messages above this buffer size (bytes) |
| `server.backpressureCritical` | number | 1048576 | Close connection above this buffer size |
| `server.shutdownTimeout` | number | 30000 | Max wait for graceful shutdown (ms) |

---

## Environment Variables

All config keys can be overridden via environment variables. Useful for Docker, systemd, or one-off runs.

| Variable | Overrides |
|---|---|
| `PI_SERVER_PORT` | `port` |
| `PI_SERVER_HOST` | `host` |
| `PI_SERVER_LOG_LEVEL` | `logLevel` |
| `PI_SERVER_MAX_SESSIONS` | `maxSessions` |
| `PI_SERVER_PI_COMMAND` | `piCommand` |
| `PI_SERVER_SESSION_RESET_MODE` | `sessionReset.mode` |
| `PI_SERVER_SESSION_RESET_IDLE_MINUTES` | `sessionReset.idleMinutes` |
| `PI_SERVER_SESSION_RESET_AT_HOUR` | `sessionReset.atHour` |

Example:

```bash
PI_SERVER_PORT=9090 PI_SERVER_MAX_SESSIONS=5 pi-remote start
```

---

## Runtime Files

pi-remote creates these at runtime. All under `~/.pi/`.

| Path | Purpose |
|---|---|
| `~/.pi/pi-server.pid` | Process ID of the running server. Written on start, removed on stop. |
| `~/.pi/pi-remote/events.jsonl` | Append-only event log. One JSON object per line. |
| `~/.pi/pi-remote/pi-version` | Cached Pi version. Compared on startup — warns if Pi was upgraded. |
