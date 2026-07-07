# How to Build a Discord Bot with pi-remote

A practical guide to connecting your Discord bot to Pi so it can answer questions, review code, and do tasks in your server.

---

## What You'll Build

A Discord bot that responds to `!ask` commands:
```
User: !ask write a haiku
Bot:  Silent keys tapping,
      Bugs hide in the shadows,
      A fix pushes through.
```

---

## Prerequisites

- pi-server **running** either locally or on a remote server (see [Your First Chat](../tutorials/your-first-chat.md))
- A Discord bot token (create one at https://discord.com/developers/applications)
- `discord.js` installed

> **Running pi-remote remotely?** This guide uses `ws://localhost:8080` — the local dev setup.
> If pi-remote is deployed on a VPS behind nginx with TLS (production), the only change
> is the connection URL. Everything else is identical. See
> [Deploy to a VPS](../tutorials/deploy-to-vps.md) for the server setup, then come back here
> and swap the URL to `wss://pi.yourdomain.com`.

---

## Step 1: Set up your project

```bash
mkdir my-discord-bot && cd my-discord-bot
npm init -y
npm install discord.js ws
```

Copy the SDK:
```bash
cp ../pi-server/examples/pi_remote_ws.mjs .
```

---

## Step 2: The basic bot

Create `bot.mjs`:

```js
import { Client, GatewayIntentBits } from "discord.js";
import { PiRemoteWS } from "./pi_remote_ws.mjs";

// Discord setup
const discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Pi setup — connect ONCE when the bot starts
const pi = new PiRemoteWS("ws://localhost:8080");
await pi.connect();
console.log("Connected to pi-server, session:", pi.sessionId);

// When someone says "!ask <message>" in Discord
discord.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!ask")) return;

  const prompt = msg.content.slice(5).trim();
  if (!prompt) return;

  // Send to Pi and wait for the full response
  const result = await pi.chat(prompt);
  
  // Discord renders markdown natively, so send raw text
  msg.channel.send(result.text.slice(0, 2000)); // Discord has a 2000 char limit
});

discord.login("YOUR_DISCORD_BOT_TOKEN");
```

---

## Step 3: Run it

```bash
node bot.mjs
```

Type `!ask write a haiku` in any Discord channel your bot can see. Pi responds.

**Key pattern:** Connect once when the bot starts. Call `chat()` for each message. The WebSocket stays open between conversations. Don't call `close()` between messages.

---

## What the flow looks like

```
Discord                    Your bot                    pi-server              Pi
  │                          │                           │                    │
  ├─ "!ask write a haiku" ──►│                           │                    │
  │                          ├── pi.chat("write a haiku")─►│                    │
  │                          │                           ├── prompt ──────────►│
  │                          │                           │                    ├── thinks
  │                          │                           │◄── tokens ─────────┤
  │                          │◄── result.text ──────────┤                    │
  ├─ "Silent keys tapping"──►│                           │                    │
```

---

## Step 4: Live streaming (optional)

If you want the bot to show Pi typing in real-time instead of waiting for the whole response:

```js
discord.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.content.startsWith("!ask")) return;

  const prompt = msg.content.slice(5).trim();
  if (!prompt) return;

  // Send typing indicator
  msg.channel.sendTyping();

  // Collect tokens as they arrive
  let buffer = "";
  pi.on("token", t => {
    buffer += t;
    // Send every 50 chars to show progress
    if (buffer.length > 50) {
      msg.channel.sendTyping();
      // (In production you'd edit a single message instead)
    }
  });

  // Wait for Pi to finish, then send the full response
  await pi.chat(prompt);
  msg.channel.send(buffer.slice(0, 2000));

  // Clean up the listener we added
  pi.off("token");
});
```

---

## Important notes

### Don't close between messages

```js
// ❌ Wrong — closes after every message
await pi.chat("hello");
client.close();
await pi.chat("again"); // Error: not connected

// ✅ Right — connect once, chat many times, close when bot shuts down
await pi.connect();
await pi.chat("hello");
await pi.chat("again");
await pi.chat("one more");
// close() only when bot exits
```

### You don't need to close at all

The server kills idle Pi processes after 30 minutes of inactivity. If your bot crashes or the connection drops, the server cleans up automatically within 40 seconds via heartbeat. `close()` is politeness, not necessity.

### Error handling

```js
discord.on("messageCreate", async (msg) => {
  if (!msg.content.startsWith("!ask")) return;
  
  try {
    const result = await pi.chat(msg.content.slice(5).trim());
    msg.channel.send(result.text.slice(0, 2000));
  } catch (err) {
    msg.channel.send(`Something went wrong: ${err.message}`);
    // Try reconnecting
    pi.close();
    await pi.connect();
  }
});
```

### Sending follow-ups

Pi doesn't remember previous messages unless you use the same session. Since the bot reuses one connection, the session persists. Each `chat()` continues the same conversation:

```js
await pi.chat("write a poem");        // Pi writes a poem
await pi.chat("make it funnier");     // Pi rewrites it funnier (same conversation)
```

---

## Full example

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write">
<｜｜DSML｜｜parameter name="content" string="true">```js
import { Client, GatewayIntentBits } from "discord.js";
import { PiRemoteWS } from "./pi_remote_ws.mjs";

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const pi = new PiRemoteWS("ws://localhost:8080");
await pi.connect();

discord.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  if (msg.content.startsWith("!ask")) {
    const prompt = msg.content.slice(5).trim();
    if (!prompt) return;

    try {
      msg.channel.sendTyping();
      const result = await pi.chat(prompt);
      msg.channel.send(result.text.slice(0, 2000));
    } catch (err) {
      msg.channel.send(`Error: ${err.message}`);
    }
  }

  if (msg.content === "!ping") {
    const health = await pi.health();
    msg.channel.send(`pi-server is ${health.status}, ${health.sessions} sessions active`);
  }
});

discord.login(process.env.DISCORD_TOKEN);
```

See [examples/discord-bot.mjs](../../examples/discord-bot.mjs) for the complete file.

---

## Going to production

When your bot is ready to run against a production pi-remote on a remote server,
the only code change is the connection URL:

```js
// Local development
const pi = new PiRemoteWS("ws://localhost:8080");

// Remote production (TLS + API key)
const pi = new PiRemoteWS(
  "wss://pi.yourdomain.com",
  "sk-pi-your-secret-key"
);
```

Everything else — `connect()`, `chat()`, `on("token")`, `on("agent_end")` — stays the same.

See the [Deploy to a VPS](../tutorials/deploy-to-vps.md) guide for the full server setup walkthrough.