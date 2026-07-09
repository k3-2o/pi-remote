# Deploy pi-remote to a VPS

A step-by-step guide from a bare Ubuntu server to a production pi-remote behind nginx with TLS, auto-start, and API key auth.

By the end, you'll have pi-remote accessible at `wss://pi.yourdomain.com` — ready for Discord bots, webhooks, cron jobs, or anything else that needs to talk to Pi over the network.

> **Not sure which host to pick?** See [Deployment Paths](../reference/deployment-paths.md) for a comparison of VPS providers, tunnel alternatives (Tailscale / Cloudflare Tunnel), and bare metal options — with a full breakdown of what each handles so you can choose the right path before starting.

---

## What you're building

```
                         Internet                          your VPS
Discord bot / curl ───────► wss://pi.yourdomain.com:443 ───► nginx ──► pi-remote:8080
                              │                            │
                          encrypted (TLS)              reverse proxy,
                                                       WebSocket upgrade
```

Everything is encrypted (`wss://` / `https://`). pi-remote is locked to localhost — only nginx can reach it. Auth via API key. Auto-starts on reboot.

---

## Prerequisites

| Item | Why |
|---|---|
| **A VPS** running Ubuntu 24.04+ (22.04 also works) | Any provider — AWS EC2, Hostinger, DigitalOcean, Hetzner, Linode |
| **A domain** with DNS pointing to your server's IP | TLS certs require a domain. Create an **A record** for `pi.yourdomain.com` → your server IP |
| **SSH access** to the server | You need `root` or a user with `sudo` |
| **Node.js ≥ 22** (we'll install it) | pi-remote requires Node 22+ |
| **Pi Coding Agent license** | You need an active license to run Pi |

> **DNS tip:** Set the A record before starting. Certbot needs the domain to resolve to your server during TLS setup. A records typically propagate within minutes.

---

## Step 1 — SSH into your server

```bash
ssh root@pi.yourdomain.com
```

Or if you use a non-root sudo user:

```bash
ssh your-user@pi.yourdomain.com
sudo -i   # or prefix commands with sudo
```

Check the OS:

```bash
cat /etc/os-release | grep PRETTY_NAME
# → PRETTY_NAME="Ubuntu 24.04.1 LTS"
```

---

## Step 2 — Update the system

```bash
sudo apt update && sudo apt upgrade -y
```

Install essential tools:

```bash
sudo apt install -y curl wget git
```

---

## Step 3 — Install Node.js

pi-remote requires **Node.js 22 or later**. The recommended way is the NodeSource repository.

```bash
# Download the NodeSource setup script for Node.js 22.x LTS
curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh

# Inspect the script (optional — verify it's safe)
less nodesource_setup.sh

# Run the setup script
sudo bash nodesource_setup.sh
```

This adds the NodeSource APT repository to your system. Now install Node.js:

```bash
sudo apt install -y nodejs
```

Verify:

```bash
node -v   # → v22.x (or later)
npm -v    # → comes bundled with Node
```

> **Alternative method (manual key):** If the setup script approach doesn't work on your distro version:
> ```bash
> sudo mkdir -p /etc/apt/keyrings
> curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
> NODE_MAJOR=22
> echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
> sudo apt update && sudo apt install -y nodejs
> ```

---

## Step 4 — Install Pi Coding Agent and pi-remote

```bash
# Install Pi (the coding agent itself)
sudo npm install -g @earendil-works/pi-coding-agent

# Verify Pi works
pi --version

# Install pi-remote (the network server)
sudo npm install -g @k3_2o/pi-remote

# Verify pi-remote works
pi-remote --version   # → 0.5.0
```

> **Why `sudo npm install -g`?** Global npm packages are installed to `/usr/lib/node_modules/` which requires root. This makes `pi` and `pi-remote` available system-wide for all users, including systemd.

---

## Step 5 — Configure authentication

Create a config file to enable API key auth. By default, auth is disabled — anyone who reaches pi-remote's port can talk to Pi. On a public server, you must enable it.

```bash
mkdir -p ~/.config/pi-server
```

Create `~/.config/pi-server/config.json`:

```bash
cat > ~/.config/pi-server/config.json << 'EOF'
{
  "port": 8080,
  "host": "127.0.0.1",
  "maxSessions": 10,
  "auth": {
    "enabled": true,
    "apiKeys": ["sk-pi-your-secret-key-here"]
  }
}
EOF
```

Replace `sk-pi-your-secret-key-here` with a strong random key. Generate one:

```bash
openssl rand -hex 24
# → 7f3a... (use this as your API key)
```

> **Two things happening here:**
> - `"host": "127.0.0.1"` — binds pi-remote to localhost only. Only processes on the same machine (like nginx) can reach it. This is a defense-in-depth measure even with the firewall.
> - `"auth"` — requires clients to pass `Authorization: Bearer <key>` on every request (except `/v1/health` and `/v1/version`).

---

## Step 6 — Start pi-remote and verify

Start the server in the foreground first to confirm it works:

```bash
pi-remote start
```

You should see:

```
pi-remote v0.5.0 started on http://127.0.0.1:8080
```

> **Note `127.0.0.1`** — not `0.0.0.0`. The config we created binds it to localhost. Only nginx (or curl from the same machine) can reach it.

Open a **second SSH session** to the server and run a quick test:

```bash
# Health check (no auth required)
curl http://127.0.0.1:8080/v1/health
# → {"status":"ok","uptime":12.4,"sessions":0,"version":"0.5.0"}

# Send a chat (auth required)
curl -N -X POST http://127.0.0.1:8080/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-pi-your-secret-key-here" \
  -d '{"message":"say hello in one sentence"}'
# → You'll see SSE events (token, done)
```

If the chat request fails with `401`, double-check your API key in the config file.

**Bonus — open the dashboard:** Run `pi-remote attach` on the server. On this headless VPS it won't open a browser, but it'll print the dashboard URL and the SSH tunnel command you need to reach it from your laptop.

```bash
pi-remote attach
# → pi-remote dashboard: http://127.0.0.1:8080/v1/ui
# → SSH tunnel: ssh my-server -L 8080:localhost:8080
# → Then open http://localhost:8080/v1/ui
```

Press `Ctrl+C` in the first SSH session to stop the foreground server.

> **Troubleshooting:** If the server won't start, check for errors:
> - `EADDRINUSE` — port 8080 is already in use. Run `pi-remote stop` first.
> - Config parse error — check `~/.config/pi-server/config.json` for valid JSON.

---

## Step 7 — Install nginx

```bash
sudo apt install -y nginx
```

Verify:

```bash
nginx -v
# → nginx version: nginx/1.24.x (or later)

sudo systemctl status nginx
# → active (running)
```

---

## Step 8 — Set up TLS with Let's Encrypt (Certbot)

### 8a — Install Certbot

**Recommended (snap):**

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

**Alternative (APT):**

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 8b — Configure a basic nginx server block first

Certbot needs a `server_name` in nginx to match your domain. Create or edit the default site config:

```bash
sudo nano /etc/nginx/sites-available/default
```

Replace the `server` block with:

```nginx
server {
    listen 80;
    server_name pi.yourdomain.com;
}
```

Save, then test and reload:

```bash
sudo nginx -t
# → syntax is ok

sudo systemctl reload nginx
```

### 8c — Obtain the certificate

```bash
sudo certbot --nginx -d pi.yourdomain.com
```

Certbot will:
1. Verify domain ownership (hit port 80 from the internet)
2. Request a certificate from Let's Encrypt
3. Automatically update your nginx config with TLS directives
4. Set up auto-renewal (systemd timer runs twice daily)

You'll be prompted for:
- An email address (for renewal notices)
- Whether to redirect HTTP to HTTPS (say **Yes**)

Verify the cert:

```bash
sudo certbot certificates
# → Found certificate for pi.yourdomain.com
# → Expiry: 2026-10-05 (90 days)
# → Auto-renewal: active
```

### 8d — Verify auto-renewal works

```bash
sudo certbot renew --dry-run
# → Congratulations, all renewals succeeded.
```

> Let's Encrypt certificates are valid for 90 days. Certbot automatically renews when the cert is within 30 days of expiry. The snap package installs a systemd timer (`snap.certbot.renew.timer`) that checks twice daily.

---

## Step 9 — Configure nginx reverse proxy with WebSocket support

Now we need to tell nginx to forward requests to pi-remote, including the WebSocket Upgrade headers.

Edit the nginx site config that Certbot modified:

```bash
sudo nano /etc/nginx/sites-available/default
```

You'll see Certbot added TLS directives (`ssl_certificate`, `ssl_certificate_key`) and a redirect from port 80. Add the `location /` block inside the **port 443 server block**:

```nginx
server {
    listen 443 ssl;
    server_name pi.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/pi.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pi.yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;   # 24 hours — keeps WebSocket alive during long conversations
    }
}

# HTTP → HTTPS redirect (Certbot usually adds this)
server {
    listen 80;
    server_name pi.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

> **Why these headers?**
> - `Upgrade $http_upgrade` and `Connection "upgrade"` — tell nginx to pass the WebSocket handshake through. Without these, the browser or SDK can't upgrade from HTTP to WebSocket, and `wss://` connections fail. This is the standard pattern from the [nginx WebSocket documentation](https://nginx.org/en/docs/http/websocket.html).
> - `proxy_read_timeout 86400` — the default nginx timeout is 60 seconds. WebSocket connections can idle for much longer (e.g., waiting for Pi to finish thinking). This keeps the connection open.

Test the config:

```bash
sudo nginx -t
# → syntax is ok
# → test is successful
```

Reload nginx:

```bash
sudo systemctl reload nginx
```

---

## Step 10 — Open firewall ports

### UFW (Ubuntu's built-in firewall)

```bash
# Check current status
sudo ufw status

# Allow SSH (if not already allowed)
sudo ufw allow OpenSSH

# Allow HTTP and HTTPS for nginx
sudo ufw allow 'Nginx Full'

# Remove the redundant HTTP-only rule (Nginx Full includes both 80 and 443)
sudo ufw delete allow 'Nginx HTTP'

# Enable the firewall
sudo ufw --force enable

# Verify
sudo ufw status
# → Status: active
# → OpenSSH      ALLOW
# → Nginx Full   ALLOW
```

### AWS Security Group (if using EC2)

If your VPS is an AWS EC2 instance, UFW alone isn't enough — you also need to add inbound rules in the AWS Console:

1. Open the **EC2 Dashboard** → **Security Groups**
2. Select your instance's security group
3. **Edit inbound rules** → Add rule:
   - Type: **HTTPS (443)**
   - Source: **0.0.0.0/0** (or your specific IP range)
4. Make sure **SSH (22)** is also open so you don't lock yourself out

> **No need to open port 8080.** pi-remote is bound to `127.0.0.1` (localhost). Nginx reaches it via the loopback interface. No external traffic ever touches port 8080 directly.

---

## Step 11 — Install systemd service (auto-start on boot)

Now that everything is configured, install pi-remote as a systemd service so it:
- Starts automatically when the server boots
- Restarts automatically if it crashes
- Logs to the system journal

```bash
sudo pi-remote install
```

This writes the unit file, reloads systemd, enables the service, and starts it. You should see:

```
Wrote /etc/systemd/system/pi-remote.service

pi-remote installed and running.
  Check status:  systemctl status pi-remote
  View logs:     journalctl -u pi-remote -f
  Uninstall:     sudo systemctl disable --now pi-remote
```

> **Important:** The `pi-remote install` command reads your config file at `~/.config/pi-server/config.json` (the one we created in Step 5). Since it runs as your user (not root), the config is picked up automatically.

Verify the service:

```bash
sudo systemctl status pi-remote
# → ● pi-remote.service — pi-remote — remote access for Pi Coding Agent
# →    Loaded: loaded (/etc/systemd/system/pi-remote.service; enabled; preset: enabled)
# →    Active: active (running)

# View live logs
journalctl -u pi-remote -f
# → [INFO] pi-remote v0.5.0 started on http://127.0.0.1:8080
```

Press `Ctrl+C` to stop following logs.

---

## Step 12 — Final verification

### Health check (external)

From your **local machine** (not the VPS):

```bash
curl https://pi.yourdomain.com/v1/health
# → {"status":"ok","uptime":35.2,"sessions":0,"version":"0.5.0"}
```

If this fails, check:
- DNS propagation (`dig pi.yourdomain.com` — does it resolve to your server IP?)
- Firewall (is port 443 open?)
- nginx status (`sudo systemctl status nginx`)
- pi-remote status (`sudo systemctl status pi-remote`)
- nginx error logs (`sudo tail -20 /var/log/nginx/error.log`)

### Chat test (external)

```bash
curl -N -X POST https://pi.yourdomain.com/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-pi-your-secret-key-here" \
  -d '{"message":"say hello in one sentence"}'
```

You should receive SSE events:
```
data: {"type":"token","text":"Hello! "}
data: {"type":"token","text":"How can I help you today?"}
data: {"type":"done"}
```

### WebSocket test (via the SDK)

On your local machine, create a test script:

```js
import { PiRemoteWS } from "@k3_2o/pi-remote/client";

const client = new PiRemoteWS(
  "wss://pi.yourdomain.com",
  "sk-pi-your-secret-key-here"
);

await client.connect();
console.log("Connected! Session:", client.sessionId);

client.on("token", t => process.stdout.write(t));

const result = await client.chat("write a haiku about deployment");
console.log("\n\n" + result.text);

client.close();
```

Run it:

```bash
node test.mjs
# → Connected! Session: abc123
# → (Pi's haiku appears here)
```

If the WebSocket connects, TLS is working, the proxy is forwarding correctly, and auth is accepted. You're live.

---

## What changes for your Discord bot or webhook

### Before (local development)

```js
// Connecting from the same machine
const pi = new PiRemoteWS("ws://localhost:8080");
```

```bash
curl http://localhost:8080/v1/chat \
  -d '{"message":"hello"}'
```

### After (production deployment)

```js
// Connecting from anywhere on the internet
const pi = new PiRemoteWS(
  "wss://pi.yourdomain.com",
  "sk-pi-your-secret-key-here"
);
```

```bash
curl https://pi.yourdomain.com/v1/chat \
  -H "Authorization: Bearer sk-pi-your-secret-key-here" \
  -d '{"message":"hello"}'
```

### What changes and what stays the same

| Aspect | Local | Production | Change? |
|---|---|---|---|
| URL scheme | `ws://` | `wss://` | **Yes** — encrypted WebSocket |
| Port | `:8080` | `:443` (default, inferred) | **Yes** — standard HTTPS port |
| API key | Not needed | Required | **Yes** — auth is now enforced |
| Domain | `localhost` | `pi.yourdomain.com` | **Yes** — your server |
| All SDK methods | Same | Same | **No** |
| Event handling | Same | Same | **No** |
| Bot code logic | Same | Same | **No** |

**The only things that change in your bot code are the URL and the API key.** Everything else — `connect()`, `chat()`, `on("token")`, `on("agent_end")` — works identically.

### For webhook handlers (GitHub, cron, etc.)

Same pattern — just different protocol:

```bash
# Local (dev)
curl http://localhost:8080/v1/chat \
  -d '{"message":"deploy the app"}' \

# Production
curl https://pi.yourdomain.com/v1/chat \
  -H "Authorization: Bearer sk-pi-your-secret-key-here" \
  -d '{"message":"deploy the app"}'
```

---

## Managing your deployment

### Everyday commands

```bash
sudo systemctl status pi-remote     # check if running
sudo systemctl restart pi-remote    # restart after config change
sudo systemctl stop pi-remote       # stop the server
sudo systemctl start pi-remote      # start it again
journalctl -u pi-remote -f          # tail live logs
journalctl -u pi-remote --since "1 hour ago"  # recent logs
```

### Certificate renewal

```bash
sudo certbot renew                   # renew if due
sudo certbot renew --dry-run         # test renewal process
```

Let's Encrypt auto-renews, but you can check expiry:

```bash
sudo certbot certificates
```

### Updating pi-remote

```bash
sudo npm update -g @k3_2o/pi-remote
sudo systemctl restart pi-remote
```

### Updating Pi

```bash
sudo npm update -g @earendil-works/pi-coding-agent
sudo systemctl restart pi-remote   # pi-remote will use the new Pi binary
```

### Uninstalling

```bash
sudo pi-remote uninstall   # removes systemd service
sudo apt remove nginx certbot  # if you want to remove the proxy too
```

---

## Troubleshooting

### Problem: "Connection refused" when hitting the domain

```
curl: (7) Failed to connect to pi.yourdomain.com port 443: Connection refused
```

**Check:**
1. Is nginx running? `sudo systemctl status nginx`
2. Is port 443 open in the firewall? `sudo ufw status`
3. Is the DNS A record correct? `dig pi.yourdomain.com`
4. On AWS: is the security group allowing HTTPS (443)?

### Problem: nginx syntax test fails

```
sudo nginx -t
# → nginx: [emerg] unknown directive "ssl_certificate"
```

**Fix:** Install nginx with SSL support. The Ubuntu `nginx` package includes it, but if you compiled from source, you need `--with-http_ssl_module`.

### Problem: WebSocket connection fails (handshake error)

```
Error: Unexpected server response: 426
```

**Fix:** The nginx config is missing the `Upgrade` headers. Double-check Step 9 — specifically:
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

After fixing: `sudo nginx -t && sudo systemctl reload nginx`

### Problem: "401 Unauthorized" on chat requests

**Fix:** Check the API key in your request matches what's in `~/.config/pi-server/config.json`. Re-run the health check first (no auth required) to confirm the server is reachable.

### Problem: Server can't start — "port already in use"

```bash
sudo lsof -i :8080   # find what's using port 8080
# Then either stop that process, or change pi-remote's port in the config
```

### Problem: certbot fails — "No valid A records found"

**Fix:** Your domain doesn't resolve to this server. Add/update the A record at your DNS provider and wait for propagation (usually 1-10 minutes, can be up to 48 hours). Verify with `dig pi.yourdomain.com +short`.

---

## Reference links

- [Production Setup](../how-to/production.md) — TLS, rate limiting, log rotation (existing docs)
- [Daemon Mode](../how-to/daemon-mode.md) — systemd, detach mode, logs
- [Configuration Reference](../reference/configuration.md) — all config options
- [Your First Chat](your-first-chat.md) — start here if you haven't used pi-remote yet
- [Build a Discord Bot](../how-to/discord-bot.md) — connect your bot to pi-remote
- [SDK Reference](../reference/sdk.md) — every method and event
- [How It Works](../explanation/how-it-works.md) — the pipe model explained
- [ngrok alternative](https://ngrok.com) — if you don't want a domain, ngrok can expose localhost with TLS (not recommended for production)
