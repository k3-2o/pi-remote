# Daemon Mode

Run pi-remote as a background service. Two approaches — pick based on whether you need it to survive reboots.

---

## Quick Dev: `--detach`

Forks the server into the background. Parent process exits. Server keeps running.

```bash
pi-remote start --detach
# → pi-remote detached (PID 12345). Check status with: pi-remote status

pi-remote status
# → pi-remote is running (PID 12345)

pi-remote stop
# → Sent SIGTERM to pi-remote (PID 12345)
# → pi-remote stopped
```

**How it works:** The parent process spawns a detached child and exits. The child writes its PID to `~/.pi/pi-server.pid`. `pi-remote stop` reads the PID and sends SIGTERM. `pi-remote status` reads the PID and checks if the process is alive.

**Limitations:** Does not survive reboots. No auto-restart on crash. Suitable for quick local dev, not production.

---

## Production: systemd

Installs pi-remote as a systemd service. Survives reboots. Auto-restarts on crash. Logs to journald.

```bash
sudo pi-remote install
```

This writes a unit file to `/etc/systemd/system/pi-remote.service`:

```ini
[Unit]
Description=pi-remote — remote access for Pi Coding Agent
After=network.target

[Service]
Type=simple
User=<your-user>
ExecStart=<node-path> <cli-path> start
Restart=on-failure
RestartSec=5
Environment=PI_SERVER_PORT=8080
Environment=PI_SERVER_HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
```

> **Bind address (`PI_SERVER_HOST`) — pick based on your setup:**
>
> | Value | When to use |
> |---|---|
> | `0.0.0.0` (shown above) | pi-remote is **directly exposed** (no reverse proxy) — e.g. you reach it over Tailscale/Cloudflare Tunnel, or you control the firewall. Listens on all interfaces. |
> | `127.0.0.1` | pi-remote sits **behind a reverse proxy** (nginx/Caddy). Only the proxy on the same machine can reach it — the internet never touches port 8080 directly. Recommended for the [production deploy](../tutorials/deploy-to-vps.md). |
>
> The same applies to the `host` field in your config file, or the `--host` CLI flag. All three set the same thing.

**Managing the service:**

```bash
systemctl status pi-remote      # check status
systemctl stop pi-remote        # stop
systemctl start pi-remote       # start
systemctl restart pi-remote     # restart
journalctl -u pi-remote -f      # tail logs
```

**Uninstall:**

```bash
sudo pi-remote uninstall
# or manually:
sudo systemctl disable --now pi-remote
sudo rm /etc/systemd/system/pi-remote.service
sudo systemctl daemon-reload
```

---

## Custom Port

Both approaches accept `--port`:

```bash
pi-remote start --detach --port 9090
sudo pi-remote install --port 9090
```

For systemd, this sets `Environment=PI_SERVER_PORT=9090` in the unit file.

---

## Logs

**systemd:** `journalctl -u pi-remote -f`

**`--detach`:** The event log at `~/.pi/pi-remote/events.jsonl` is always written. Tail it with:

```bash
pi-remote logs
```

Server logs go to stderr (JSON format) — captured by systemd journal or redirected when using `--detach`.
