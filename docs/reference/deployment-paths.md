# Deployment Paths

A companion to the [Deploy to a VPS](../tutorials/deploy-to-vps.md) tutorial. This reference breaks down every deployment option — what each provider handles, what you still need to do, and which shortcuts exist.

---

## The 13-Step Deploy Process

Every deployment of pi-remote follows the same sequence. The differences between providers are in how many of these steps they handle for you.

```
Step   What it does
────   ─────────────────────────────────────────────────────────────
  1    Get a server — rent a VM or use your own hardware
  2    SSH in — connect to the server terminal
  3    Update system — apt update && apt upgrade
  4    Install Node.js 22+ — via NodeSource or package manager
  5    Install Pi + pi-remote — npm install -g both packages
  6    Configure auth — create config.json with API key
  7    Start & verify — pi-remote start, curl test
  8    Set up reverse proxy — nginx forwarding localhost:8080 → :443
  9    Set up TLS — Certbot + Let's Encrypt for HTTPS
 10    Configure WebSocket upgrade — nginx proxy headers for WS
 11    Open firewall — ufw allow OpenSSH, Nginx Full
 12    Install systemd service — auto-start on boot
 13    Final verification — curl from outside, SDK test
```

**The wall is steps 8–11.** That's nginx + TLS + WebSocket config + firewall. Most of the complexity and page count in the deploy guide lives here. Everything above and below is straightforward `apt install` / `npm install` / `curl` work.

---

## VPS Providers

These providers give you a virtual server you SSH into and configure yourself. The deploy guide works for all of them without modification. The only difference is which minor steps come pre-done.

### How to read the table

- ✅ **you run** — you type the command yourself, same as the guide
- ✅ **pre-installed** — the provider includes this in their base image or one-click setup
- ⚠️ **via GUI** — the provider gives you a control panel to do this instead of the terminal
- ❌ — not available or not applicable

### The table

| Step | Hostinger VPS | DO Droplets (1-click Node) | Hetzner | Vultr | Linode | OVHcloud | Contabo |
|---|---|---|---|---|---|---|---|
| **1. Get server** | ✅ VPS from Hostinger | ✅ Droplet from DO | ✅ VPS from Hetzner | ✅ VPS from Vultr | ✅ VPS from Linode | ✅ VPS from OVHcloud | ✅ VPS from Contabo |
| **2. SSH in** | `ssh user@host` | `ssh root@host` | `ssh root@host` | `ssh root@host` | `ssh root@host` | `ssh user@host` | `ssh root@host` |
| **3. apt update** | ✅ you run | ⚠️ pre-done on 1-click images | ✅ you run | ✅ you run | ✅ you run | ✅ you run | ✅ you run |
| **4. Install Node 22+** | ✅ you run NodeSource script | ✅ **pre-installed** on 1-click Node droplet | ✅ you run NodeSource script | ✅ you run NodeSource script | ✅ you run NodeSource script | ✅ you run NodeSource script | ✅ you run NodeSource script |
| **5. Install pi-remote** | ✅ `npm install -g @k3_2o/pi-remote` | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same |
| **6. Config auth** | ✅ create `~/.config/pi-server/config.json` | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same |
| **7. Start & verify** | ✅ `pi-remote start`, curl test | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same |
| **8. nginx reverse proxy** | ⚠️ **CloudPanel UI** — configure nginx through web panel instead of terminal | ✅ you configure `/etc/nginx/sites-available/default` | ✅ you configure nginx manually | ✅ you configure nginx manually | ✅ you configure nginx manually | ✅ you configure nginx manually | ✅ you configure nginx manually |
| **9. TLS (Certbot)** | ⚠️ **CloudPanel UI** — SSL managed through panel, no terminal needed | ✅ `sudo certbot --nginx -d pi.yourdomain.com` | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same |
| **10. WebSocket config** | ⚠️ **CloudPanel** — add proxy headers via GUI | ✅ add `proxy_set_header Upgrade $http_upgrade;` etc. | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same |
| **11. Firewall (ufw)** | ⚠️ **CloudPanel UI** — manage through panel or optional command line | ✅ `sudo ufw allow OpenSSH` + `sudo ufw allow 'Nginx Full'` | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same |
| **12. systemd (auto-start)** | ✅ `sudo pi-remote install` | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same |
| **13. Final verification** | ✅ curl from local machine, SDK test | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same | ✅ same |

### Provider notes

**Hostinger VPS** comes with CloudPanel pre-installed on Ubuntu 24.04. CloudPanel provides a web UI for managing nginx sites, SSL certificates, and firewall rules. Steps 8–11 can be done through the panel instead of the terminal. This makes Hostinger the easiest VPS option for beginners who want a GUI for the hard parts but still need full server access.

**DigitalOcean Droplets** offers a "1-click Node.js" image that has Node.js, NPM, PM2, and nginx pre-installed. This saves you steps 3–4 if you choose that image. The standard Ubuntu droplet requires the full guide. DO also has the best documentation and community tutorials of any VPS provider.

**Hetzner** is the cheapest option for equivalent specs (€4–8/mo for 4–8GB RAM). No hand-holding — you build everything yourself. Best for experienced users who want maximum value. Hetzner also offers the most generous bandwidth (20 TB/month included).

**Vultr** is a direct DigitalOcean competitor with similar pricing and features. Slightly more global regions (30+) and offers "High Frequency" instances with faster single-core CPU performance. Good if you want low latency in a specific region DO doesn't cover well.

**Linode** (now owned by Akamai) offers the same developer experience as DO. Pricing, features, and control panel quality are comparable. Historically known for excellent customer support.

**OVHcloud** is a European provider popular with EU-based users who want data sovereignty. Pricing is competitive with Hetzner. The control panel and API are less polished than DO or Vultr but service is reliable.

**Contabo** offers the most RAM and storage per dollar of any VPS provider. A €5/month VPS comes with 4 vCPUs and 8GB RAM — 2–4x what anyone else offers at the same price. The trade-off is slower CPU performance and less responsive support. Good for RAM-heavy workloads (like running multiple Pi sessions) where CPU isn't the bottleneck.

---

## AWS and Google Cloud

AWS EC2 and Google Cloud Compute Engine follow the same 13-step process, but with **more setup before step 1**:

| Extra AWS step | What it means |
|---|---|
| Create a VPC | Virtual network for your server |
| Configure security group | AWS's equivalent of a firewall (before ufw) |
| Create an IAM role | Permissions for your server to talk to other AWS services |
| Generate a key pair | SSH key (.pem file) — `ssh -i key.pem` instead of password |
| Pick an AMI | Choose the OS image (Ubuntu 24.04 recommended) |

None of these steps exist on Hostinger, DO, Hetzner, or any of the providers above — they give you a server with SSH access in one click. AWS gives you a multi-step configuration flow before you ever see a terminal.

**If you already use AWS and know your way around EC2**, the deploy guide works unchanged from step 2 onward (once you're SSH'd in). But if you're new to this, AWS is not the place to start. Use one of the providers above.

Google Cloud is similar to AWS in complexity. Same warning applies.

---

## Tunnel Tools — Skip Steps 8–11

These tools replace nginx, Certbot, WebSocket configuration, and firewall setup entirely. They work with any VPS provider — you just install them and run one command.

### Tailscale (private mesh — your devices only)

Tailscale creates an encrypted WireGuard mesh between your devices. After installation, your VM and laptop can talk to each other securely as if they were on the same local network — even though they're on different sides of the internet.

| Step | Instead of | With Tailscale |
|---|---|---|
| 8. nginx | Configure nginx reverse proxy | ❌ Not needed — Tailscale encrypts and tunnels raw TCP |
| 9. TLS | Run Certbot, manage certificates | ❌ Not needed — all Tailscale traffic is natively encrypted |
| 10. WebSocket | Add nginx proxy headers | ❌ Not needed — no proxy, direct TCP connection |
| 11. Firewall | `ufw allow` multiple ports | ❌ Not needed — only port 22 (SSH) needs to be open |

**When to use:** You want to access pi-remote from your laptop and phone. Nobody else needs it. You don't want to buy a domain, configure nginx, or think about certificates.

**Setup:**
```bash
# On your VM
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# On your laptop — install Tailscale, log into same account
# Then access pi-remote at:
# http://<tailscale-ip-of-vm>:8080/v1/ui
```

Tailscale is free for personal use (up to 3 users, 100 devices).

### Cloudflare Tunnel (public URL — anyone with the link)

Cloudflare Tunnel creates an encrypted tunnel from your server to Cloudflare's edge network. Instead of exposing your server's IP and setting up nginx, one command gives you a public HTTPS URL.

| Step | Instead of | With Cloudflare Tunnel |
|---|---|---|
| 8. nginx | Configure nginx reverse proxy | ❌ Not needed — Cloudflare's edge handles routing |
| 9. TLS | Run Certbot, manage certificates | ❌ Not needed — automatic HTTPS through Cloudflare |
| 10. WebSocket | Add nginx proxy headers | ❌ Not needed — Cloudflare handles WebSocket upgrade |
| 11. Firewall | `ufw allow` multiple ports | ❌ Not needed — tunnel connects outbound, no inbound ports |

**When to use:** You need pi-remote accessible from anywhere (teammates, webhooks, Discord bots) but don't want to manage nginx, DNS, and certificates yourself. Good for team access or quick sharing.

**Setup:**
```bash
# Install cloudflared
sudo apt install -y cloudflared  # or download from cloudflare.com

# Start a tunnel
cloudflared tunnel --url http://localhost:8080
# → https://random-name.trycloudflare.com
```

The free tier supports unlimited tunnels and traffic. The URL changes each restart unless you configure a named tunnel with a custom domain (paid, or free with your own domain on Cloudflare's DNS).

### Quick decision

| | Tailscale | Cloudflare Tunnel |
|---|---|---|
| **Who can access** | Only your devices (private mesh) | Anyone with the URL (public) |
| **Need a domain?** | No | Optional (they give you `*.trycloudflare.com`) |
| **Data goes through** | Direct peer-to-peer (or Tailscale relay) | Cloudflare's edge network |
| **Free?** | Yes (personal use) | Yes |
| **Best for** | Personal access from laptop/phone | Sharing with others, team access |

### Alternatives

| Tool | Like | Difference |
|---|---|---|
| **ZeroTier** | Tailscale | Open source, more DIY configuration — you host your own controller or use theirs |
| **WireGuard** | Tailscale | The VPN protocol that Tailscale is built on. Pure WireGuard requires manual key exchange and config — no UI, no auto-discovery. Tailscale is WireGuard with the management layer on top. |
| **ngrok** | Cloudflare Tunnel | Older and more established. Free tier is rate-limited (20 connections/minute, 4 tunnels). Paid plans add custom domains, TCP tunnels, and OAuth. |
| **Bore** | Cloudflare Tunnel | Minimal open source alternative. Simple CLI, single binary. No encryption, no auth — use for testing only. |
| **zrok** | Cloudflare Tunnel | Open source fork of ngrok. Self-hostable. Supports private and public shares. |

---

## Bare Metal / Self-Hosted

Running pi-remote on your own hardware — an old laptop, a Raspberry Pi 5, a home server. The guide steps are the same, with these differences:

| Step | Your own machine | What changes |
|---|---|---|
| **1. Get server** | You already have it | No monthly cost. You are the data center. |
| **2. SSH in** | ⚠️ Need to enable SSH server | `sudo systemctl enable ssh`. Then connect from another device on your local network, or set up a tunnel for remote access. |
| **3–7. Setup** | ✅ Same | apt, Node.js, npm, config, verify — identical to the guide |
| **8. nginx** | ⚠️ **Only needed if you open to the internet** | If using Tailscale/Cloudflare, skip nginx entirely. If opening to the web, same nginx config as the guide. |
| **9. TLS** | ⚠️ **Only needed if using a public domain** | Tailscale/Cloudflare handle encryption. Without them, you need Certbot + a domain pointed at your home IP (which may change unless you have a static IP). |
| **10. WebSocket** | ⚠️ Same as nginx — only if you set up a reverse proxy | Same config as the guide, or skipped with a tunnel. |
| **11. Firewall** | ⚠️ `ufw` works, but you also need to configure your **home router** to forward port 443 (or whatever port you use) to your machine's local IP | This is the hardest part for most people. Router UIs vary wildly. You also need a **static IP or dynamic DNS** so your domain always points to the right address. |
| **12. systemd** | ✅ Same | `sudo pi-remote install` works on any Linux distro with systemd. |
| **13. Verify** | ⚠️ Only reachable via tunnel or local network unless you set up port forwarding + dynamic DNS | |

**The three approaches for bare metal:**

| Approach | Effort | Result |
|---|---|---|
| **Tailscale** (recommended) | Install Tailscale on the machine and your laptop. 2 commands. | Secure access from your devices, no open ports, no domain, no router config. |
| **Cloudflare Tunnel** (second best) | Install cloudflared. 1 command. | Public URL, no open ports, no domain needed (optional). |
| **Full production** (hardest) | Static IP or dynamic DNS + router port forward + nginx + certbot. Requires networking knowledge and ISP cooperation. | Standard public internet access with your own domain. Same as the deploy guide, but you're also the ISP's customer. |

**Hardware recommendations:**

| Hardware | Can it run pi-remote? | Notes |
|---|---|---|
| Raspberry Pi 5 (8GB) | ✅ Yes | Pi needs ~100–300MB per session. An 8GB Pi can run pi-remote + 2–3 concurrent Pi sessions. ARM64 compatible. |
| Old laptop (8GB+ RAM) | ✅ Yes | Most laptops from the last 10 years are overkill. Plug it in, close the lid, forget about it. |
| Old desktop / NUC | ✅ Yes | Even better — usually more RAM, disk space, and reliability than a laptop. |
| Raspberry Pi 4 (4GB) | ⚠️ Tight | Pi itself takes ~2GB at boot. Pi sessions need 100–300MB each. You can run 1 session comfortably, maybe 2. |
| Raspberry Pi Zero | ❌ No | Not enough RAM or CPU to run Pi at all. |

---

## Summary: Which path should you pick?

```
You want pi-remote accessible from...
│
├── Just your laptop and phone
│   └── Any VPS provider + Tailscale
│       → Cheapest VPS (Hetzner, Contabo)
│       → tailscale up on both devices
│       → Done. No domain, no nginx, no certbot.
│
├── You and your team (a few people)
│   ├── VPS + Cloudflare Tunnel (no domain needed)
│   │   → cloudflared tunnel --url http://localhost:8080
│   │   → Share the URL. It has HTTPS.
│   │
│   └── VPS + full production guide
│       → Buy a domain, set up nginx + certbot
│       → https://pi.yourdomain.com
│       → Full control, custom domain, no third-party tunnel.
│
├── The public (Discord bot, webhooks, API)
│   └── VPS + full production guide
│       → Domain + nginx + certbot + firewall + systemd
│       → The deploy guide covers this end-to-end.
│
└── You're experimenting, no budget
    └── Bare metal (old laptop) + Tailscale
        → Free hardware, free tunnel, no monthly cost
        → Limited by your home internet and power bill
```
