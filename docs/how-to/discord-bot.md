# How to Build a Discord Bot with pi-remote

A practical guide to connecting your Discord bot to Pi so it can answer questions, review code, and do tasks in your server.

---

## What You'll Build

A Discord bot that responds to `!ask`, streams replies live, and can switch Pi models on the fly:
```
User: !ask write a haiku
Bot:  Silent keys tapping,      (streamed word-by-word)
      Bugs hide in the shadows,
      A fix pushes through.

User: !models
Bot:  Available models: claude-sonnet-4-20250514, gemini-2.5-pro, ...

User: !model claude-sonnet-4-20250514
Bot:  Switched to claude-sonnet-4-20250514
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

const TOKEN = process.env.DISCORD_TOKEN;
const PI_URL = process.env.PI_URL || "ws://localhost:8080";
const PI_KEY = process.env.PI_KEY || null;

async function main() {
  const discord = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const pi = new PiRemoteWS(PI_URL, PI_KEY);

  // Wait for Discord to be ready, then connect to Pi
  discord.once("ready", () => {
    console.log(`Logged in as ${discord.user.tag}`);
    pi.connect().then(() => {
      console.log("Connected to pi-server, session:", pi.sessionId);
    });
  });

  discord.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (!msg.content.startsWith("!ask")) return;

    const prompt = msg.content.slice(5).trim();
    if (!prompt) return;

    try {
      const result = await pi.chat(prompt);
      // Split into 2000-char chunks if needed
      for (let i = 0; i < result.text.length; i += 2000) {
        await msg.channel.send(result.text.slice(i, i + 2000));
      }
    } catch (err) {
      msg.channel.send(`Something went wrong: ${err.message}`);
    }
  });

  await discord.login(TOKEN);
}

main().catch(console.error);
```

> **Important:** The `MessageContent` intent must be enabled in your [Discord Developer Portal](https://discord.com/developers/applications) under Bot → Privileged Gateway Intents. Without it, your bot won't see message content.

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

Instead of waiting for the full response and sending it in one shot, you can edit a single message progressively as Pi types — just like how Pi streams in the terminal.

```js
discord.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.content.startsWith("!ask")) return;

  const prompt = msg.content.slice(5).trim();
  if (!prompt) return;

  // Send a placeholder we'll edit as Pi types
  const botMsg = await msg.channel.send("⏳ Thinking...");

  // Buffer to accumulate and send edits periodically
  let buffer = "";
  let lastEdit = 0;

  try {
    await pi.chat(prompt, {
      onToken: async (t) => {
        buffer += t;
        // Edit the message every ~100 chars or ~1.5s (to avoid rate limits)
        const now = Date.now();
        if (buffer.length >= 100 || now - lastEdit > 1500) {
          lastEdit = now;
          // Truncate for Discord's 2000-char limit, add "..." if incomplete
          const display = buffer.length > 1990
            ? buffer.slice(-1990) + "…"
            : buffer;
          await botMsg.edit(display).catch(() => {});
        }
      },
    });

    // Final edit with the complete response
    await botMsg.edit(buffer.slice(0, 2000));
  } catch (err) {
    await botMsg.edit(`❌ ${err.message}`);
  }
});
```

**What's happening:**
- `chat()` accepts an `onToken` callback — it fires on every token Pi sends
- We buffer tokens and edit the same message periodically (debounced)
- Discord's rate limit for message edits is generous, but we still throttle to avoid unnecessary calls
- Once Pi finishes (`chat()` resolves), we do a final edit with the complete text

> **Why `onToken` instead of `pi.on("token", ...)`?** Using the callback built into `chat()` avoids a race condition — if you attach a raw event listener and call `chat()` separately, both your handler and `chat()`'s internal handler listen to the same event, which is fragile and harder to clean up. The `onToken` callback is the intended API for streaming.

---

## Step 5: Switching models

You can change the model Pi uses mid-session with `sendCommand`. This lets you use a cheap/fast model for simple questions and a powerful model for complex tasks — all without restarting the server.

Add a `!model` command to switch models, and `!models` to list available ones:

```js
discord.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // Show available models
  if (msg.content === "!models") {
    try {
      const result = await pi.sendCommand({ type: "get_available_models" });
      const models = result.models || result;
      const formatted = Array.isArray(models)
        ? models.map(m => `\`${m.provider}/${m.modelId}\``).join("\n")
        : JSON.stringify(models, null, 2);
      msg.channel.send(`**Available models:**\n${formatted}`);
    } catch (err) {
      msg.channel.send(`Couldn't fetch models: ${err.message}`);
    }
    return;
  }

  // Switch to a specific model: !model <provider/modelId>
  // Example: !model openrouter/anthropic/claude-sonnet-4-20250514
  if (msg.content.startsWith("!model ")) {
    const modelArg = msg.content.slice(7).trim();
    const parts = modelArg.split("/");
    // Accept both "provider/modelId" and shorthand
    let provider, modelId;
    if (parts.length >= 2) {
      provider = parts[0];
      modelId = parts.slice(1).join("/");
    } else {
      provider = "openrouter";
      modelId = modelArg;
    }

    try {
      await pi.sendCommand({ type: "set_model", provider, modelId });
      msg.channel.send(`✅ Switched to \`${provider}/${modelId}\``);
    } catch (err) {
      msg.channel.send(`❌ Couldn't switch model: ${err.message}`);
    }
    return;
  }

  // ... rest of your commands (!ask, !ping, etc.)
});
```

> **How `sendCommand` works:** It sends any Pi RPC command through the WebSocket and waits for the response. There are 31 Pi commands total. `set_model` and `get_available_models` are just two of them — you use the same pattern for `compact`, `set_thinking_level`, `fork`, `bash`, or any other command. See the [SDK reference](../reference/sdk.md) for the full list.

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

Here's a complete bot that ties everything together — `!ask` with streaming, `!models`/`!model` for model switching, and `!ping` for health checks.

Create `bot.mjs`:

```js
import { Client, GatewayIntentBits } from "discord.js";
import { PiRemoteWS } from "./pi_remote_ws.mjs";

const TOKEN = process.env.DISCORD_TOKEN;
const PI_URL = process.env.PI_URL || "ws://localhost:8080";
const PI_KEY = process.env.PI_KEY || null;

async function main() {
  const discord = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const pi = new PiRemoteWS(PI_URL, PI_KEY);

  discord.once("ready", () => {
    console.log(`🤖 Logged in as ${discord.user.tag}`);
    pi.connect().then(() => {
      console.log(`🔗 Connected to pi-server — session ${pi.sessionId}`);
    });
  });

  discord.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    // ── !ask <prompt> — streamed response ──
    if (msg.content.startsWith("!ask ")) {
      const prompt = msg.content.slice(5).trim();

      const botMsg = await msg.channel.send("⏳");
      let buffer = "";
      let lastEdit = 0;

      try {
        await pi.chat(prompt, {
          onToken: async (t) => {
            buffer += t;
            const now = Date.now();
            if (buffer.length >= 100 || now - lastEdit > 1500) {
              lastEdit = now;
              const display = buffer.length > 1990
                ? buffer.slice(-1990) + "…"
                : buffer;
              await botMsg.edit(display).catch(() => {});
            }
          },
        });
        await botMsg.edit(buffer.slice(0, 2000));
      } catch (err) {
        await botMsg.edit(`❌ ${err.message}`);
      }
      return;
    }

    // ── !models — list available models ──
    if (msg.content === "!models") {
      try {
        const result = await pi.sendCommand({ type: "get_available_models" });
        const models = result.models || result;
        const formatted = Array.isArray(models)
          ? models.map(m => `• \`${m.provider || "?"}/${m.modelId || m}\\``).join("\n")
          : JSON.stringify(models, null, 2);
        await msg.channel.send(`**Available models:**\n${formatted}`);
      } catch (err) {
        await msg.channel.send(`Couldn't fetch models: ${err.message}`);
      }
      return;
    }

    // ── !model <provider/modelId> — switch model ──
    if (msg.content.startsWith("!model ")) {
      const arg = msg.content.slice(7).trim();
      const parts = arg.split("/");
      const provider = parts.length >= 2 ? parts[0] : "openrouter";
      const modelId = parts.length >= 2 ? parts.slice(1).join("/") : arg;

      try {
        await pi.sendCommand({ type: "set_model", provider, modelId });
        await msg.channel.send(`✅ Switched to \`${provider}/${modelId}\``);
      } catch (err) {
        await msg.channel.send(`❌ ${err.message}`);
      }
      return;
    }

    // ── !ping — server health check ──
    if (msg.content === "!ping") {
      try {
        const health = await pi.health();
        await msg.channel.send(
          `pong — server is **${health.status}**, ` +
          `${health.sessions} session(s) active`
        );
      } catch (err) {
        await msg.channel.send(`Couldn't reach pi-server: ${err.message}`);
      }
      return;
    }
  });

  await discord.login(TOKEN);
}

main().catch(console.error);
```

Run it:

```bash
DISCORD_TOKEN=your_token_here node bot.mjs
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