# CLI Reference

Every pi-remote command, its purpose, and options.

---

## Commands

### `start`

Start the server in the foreground. Press `Ctrl+C` to stop.

```bash
pi-remote start
pi-remote start --port 9090
pi-remote start --host 127.0.0.1
pi-remote start --config /path/to/config.json
pi-remote start --log-level debug
pi-remote start --detach          # fork into background
```

Options: `--port` (`-p`), `--host`, `--config`, `--log-level`, `--detach` (`-d`).

### `stop`

Stop a running server. Reads the PID file, sends SIGTERM, waits up to 5 seconds, force-kills if needed.

```bash
pi-remote stop
```

### `restart`

Stop the running server, then start a new one.

```bash
pi-remote restart
pi-remote restart --port 9090
```

### `status`

Check if the server is running. Reads the PID file and checks if the process is alive.

```bash
pi-remote status
# → pi-remote is running (PID 12345)
# → pi-remote is not running
```

### `health`

Show server health: version, uptime, session count. Calls `GET /v1/health` on the running server.

```bash
pi-remote health
# → pi-remote v0.2.1
# →   Status:    ok
# →   Uptime:    2h 15m
# →   Sessions:  3

pi-remote health --port 9090     # different port
pi-remote health --host 10.0.0.5 # remote server
```

### `sessions`

List all sessions with status. Calls `GET /v1/sessions`.

```bash
pi-remote sessions
# → 3 sessions
# → 
# → abc123...         active   12 msgs  2026-07-05 22:00
# → xyz789...         done      5 msgs  2026-07-05 21:30
```

Accepts `--port` and `--host` like `health`.

### `attach`

Open the browser dashboard in your default browser, or print connection instructions on headless servers.

Calls `GET /v1/health` to verify the server is running first.

**Desktop:** Opens `http://host:port/v1/ui` using `open` (macOS), `start` (Windows), or `xdg-open` (Linux).

**Headless** (no `DISPLAY` on Linux, e.g. a VPS accessed via SSH): Prints the dashboard URL and the SSH tunnel command.

```bash
pi-remote attach
# Desktop: opens browser
# Headless:
# → pi-remote dashboard: http://127.0.0.1:8080/v1/ui
# → SSH tunnel: ssh my-server -L 8080:localhost:8080
# → Then open http://localhost:8080/v1/ui

pi-remote attach --port 9090
pi-remote attach --host 10.0.0.5
```

> **PS:** The dashboard is for viewing only. Pi extension dialogs (`confirm`, `select`, `input`) don't appear here — the SSE watch drops `extension_ui_request` events. If you need to handle those, use the WebSocket SDK.

### `relay`

Debug mode. Reads JSON-RPC commands from stdin, forwards to a Pi subprocess, writes responses to stdout. No server. No WebSocket. No HTTP.

```bash
echo '{"type":"prompt","message":"hello"}' | pi-remote relay
```

Useful for testing Pi's RPC protocol directly.

### `install`

Install as a systemd service (Linux only). Writes unit file, runs `systemctl enable --now`.

```bash
sudo pi-remote install
sudo pi-remote install --port 9090
```

### `uninstall`

Remove the systemd service. Stops the service, disables it, deletes the unit file.

```bash
sudo pi-remote uninstall
```

### `logs`

Tail the event log. Prints the last 30 lines, then polls for new entries.

```bash
pi-remote logs
```

Event log location: `~/.pi/pi-remote/events.jsonl`

### `--version`

Print the version and exit.

```bash
pi-remote --version
# → 0.2.1
```

### `--help`

Print usage and exit.

```bash
pi-remote --help
```

---

## Global Options

These work with all commands that need them (`start`, `restart`, `health`, `sessions`, `install`):

| Option | Env var | Default | Description |
|---|---|---|---|
| `--port`, `-p` | `PI_SERVER_PORT` | 8080 | Port to use |
| `--host` | `PI_SERVER_HOST` | 0.0.0.0 | Bind address |
| `--config` | — | — | Path to config file |
| `--log-level` | `PI_SERVER_LOG_LEVEL` | info | debug/info/warn/error |
| `--detach`, `-d` | — | false | Fork into background (start only) |
