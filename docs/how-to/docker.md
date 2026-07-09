# Docker

Run pi-remote in a container. Multi-stage Alpine build included.

---

## Build

```bash
docker build -t pi-remote .
```

## Run

```bash
docker run -p 8080:8080 -v ~/.pi:/root/.pi pi-remote
```

The volume mount preserves sessions, config, and the event log across container restarts.

## Custom Config

pi-remote looks for config in two locations (first one wins):

| Priority | Path | Note |
|---|---|---|
| **Primary** | `~/.config/pi-server/config.json` | XDG standard |
| **Fallback** | `~/.pi/pi-server.json` | Legacy / simple |

Either works. Pick one. The examples below mount `~/.pi` since Docker containers already use that directory for sessions and the event log.

**Primary path** (`~/.config/pi-server/config.json`):

```bash
mkdir -p ~/.config/pi-server
cat > ~/.config/pi-server/config.json << 'EOF'
{
  "port": 8080,
  "host": "0.0.0.0",
  "maxSessions": 5,
  "auth": {
    "enabled": true,
    "apiKeys": ["my-secret-key"]
  }
}
EOF

docker run -p 8080:8080 \
  -v ~/.config/pi-server:/root/.config/pi-server \
  -v ~/.pi:/root/.pi \
  pi-remote
```

**Fallback path** (`~/.pi/pi-server.json`):

```bash
mkdir -p ~/.pi
cat > ~/.pi/pi-server.json << 'EOF'
{
  "port": 8080,
  "host": "0.0.0.0",
  "maxSessions": 5,
  "auth": {
    "enabled": true,
    "apiKeys": ["my-secret-key"]
  }
}
EOF

docker run -p 8080:8080 -v ~/.pi:/root/.pi pi-remote
```

See [Configuration](../reference/configuration.md) for all options.

## Docker Compose

```yaml
# docker-compose.yml
services:
  pi-remote:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ~/.pi:/root/.pi
    restart: unless-stopped
```

```bash
docker compose up -d
```

## Image Details

- **Base:** `node:22-alpine`
- **Size:** ~200MB (includes Node + Pi + pi-remote)
- **Exposed port:** 8080
- **No root required** for the container itself (`sudo` only needed for Docker daemon)
