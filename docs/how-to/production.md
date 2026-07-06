# Production Setup

pi-remote doesn't handle TLS, rate limiting, or log rotation. These are external responsibilities. Here's how to set them up.

---

## TLS (HTTPS + WSS)

Use nginx or Caddy as a reverse proxy in front of pi-remote. The proxy terminates TLS and forwards plain HTTP/WS to pi-remote.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name pi.example.com;

    ssl_certificate     /etc/letsencrypt/live/pi.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pi.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;  # long-lived WS connections
    }
}
```

The `Upgrade` and `Connection` headers are essential — they enable WebSocket proxying.

### Caddy

```
pi.example.com {
    reverse_proxy localhost:8080
}
```

Caddy handles TLS automatically (Let's Encrypt). No config needed beyond the reverse_proxy directive.

---

## Rate Limiting

Prevent one client from exhausting the Pi process pool.

### nginx

```nginx
limit_req_zone $binary_remote_addr zone=pi:10m rate=10r/m;

server {
    # ... TLS config ...

    location /v1/chat {
        limit_req zone=pi burst=5 nodelay;
        proxy_pass http://127.0.0.1:8080;
    }
}
```

This limits each IP to 10 requests per minute with a burst of 5.

---

## Log Rotation

### systemd (recommended)

If you installed via `sudo pi-remote install`, systemd handles rotation automatically via journald.

```bash
journalctl -u pi-remote --vacuum-time=7d   # keep 7 days
```

### logrotate (for --detach mode)

```
# /etc/logrotate.d/pi-remote
~/.pi/pi-remote/events.jsonl {
    daily
    rotate 7
    missingok
    notifempty
    copytruncate
}
```

---

## Process Supervision

### systemd

```bash
sudo pi-remote install
```

Writes a unit file with `Restart=on-failure` — auto-restarts on crash, survives reboots. See [Daemon Mode](daemon-mode.md).

### pm2 (non-Linux)

```bash
pm2 start dist/cli.js --name pi-remote -- start
pm2 save
pm2 startup
```

---

## Firewall

Only expose the proxy port (443). pi-remote's port (8080) should be bound to localhost or firewalled.

```bash
# UFW example
sudo ufw allow 443/tcp
sudo ufw deny 8080/tcp
```
