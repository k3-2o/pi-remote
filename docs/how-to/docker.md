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
