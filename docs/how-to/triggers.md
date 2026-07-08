# Triggers

pi-remote is a server that listens. It doesn't originate actions, pull events, or manage webhooks. External triggers are handled by your glue code. The pattern is always the same: something happens somewhere → your code translates it into a prompt → pi-remote → Pi does the work.

---

## Discord Bot

The shape: a Discord message arrives → your glue strips the prefix and sends the text as a prompt → Pi does the work → you reply with the result.

```js
// The pattern only — see the full bot guide for a working implementation
discordBot.on("message", async (msg) => {
  if (!msg.content.startsWith("@pi")) return;
  const result = await client.chat(msg.content.replace("@pi", "").trim());
  msg.reply(result.text);
});
```

The full implementation — connect once, stream tokens live, switch models mid-session, handle errors — is in [Build a Discord Bot](discord-bot.md). That guide owns the bot lifecycle. This doc owns the trigger pattern.

---

## Telegram Bot

Identical shape. Different platform.

```python
# The pattern only
@bot.message_handler(func=lambda m: m.text.startswith("/pi"))
async def handle_pi(message):
    result = await client.chat(message.text.replace("/pi", "").strip())
    await bot.reply_to(message, result["text"])
```

Connect once when the bot starts. Don't connect/close per message — same lifecycle rule as the Discord bot.

---

## Cron Job

```bash
#!/bin/bash
# /etc/cron.hourly/pi-tests

curl -X POST http://localhost:8080/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"run npm test and report failures. if tests pass, do nothing."}'
```

HTTP is fine for one-shots. The response is SSE — pipe it to a log file or notification system.

---

## GitHub Webhook

```js
// webhook-handler.js — connect once, handle many webhooks
import { PiRemoteWS } from "@k3_2o/pi-remote/client";

const pi = new PiRemoteWS("ws://localhost:8080");
await pi.connect({
  systemPrompt: "You are a focused task-runner. Do the work, report back concisely.",
});

app.post("/webhook/github", async (req, res) => {
  const { action, pull_request } = req.body;
  if (action !== "opened") return res.status(200).end();

  res.status(200).end(); // acknowledge immediately

  await pi.sendCommand({ type: "set_model", provider: "openrouter", modelId: "claude-sonnet" });
  await pi.chat(`review this PR: ${pull_request.html_url}`);
});
```

---

## The Pattern

1. Something happens (message, webhook, timer)
2. Your code extracts relevant info
3. Your code sends a prompt to pi-remote (HTTP or WebSocket)
4. Pi uses whatever tools it has (`gh`, `curl`, `git`, MCP servers, Composio) to carry out the task
5. Your code delivers the response back (Discord reply, email, log file)

pi-remote never knows Discord, Telegram, cron, or GitHub exist. It just receives a prompt and forwards it to Pi. The translation from external event to `{ message: "..." }` is the only code you write.

---

## Automation Platforms (n8n, Composio, Zapier)

Every example above runs a custom daemon — a webhook server, a long-running bot process, or a cron entry. The developer manages subscriptions, retries, reconnection, and uptime themselves. The next step is offloading that entirely to an automation platform.

**The same pipeline, but the platform owns the receiver side:**

```
Trigger (GitHub PR, Discord webhook, email, cron, etc.)
       │
       ▼
Automation platform ─── receives the event, parses it
  (n8n / Zapier /      ─── you write glue code (in the platform)
   Composio SDK)           that converts the payload into a prompt
       │
       ▼
pi-remote ─── HTTP or WebSocket, your choice
       │
       ▼
Result back through the platform (post comment, send email, log)
```

**What the platform handles:**
- Webhook receiver (no custom server)
- Retry logic if pi-remote is busy
- Credential storage (API keys, tokens)
- Scheduling (cron built in)
- Multi-step workflows (trigger → transform → call → respond)

**What you write:**

Glue that extracts a reference from the trigger payload and hands it to Pi as a task. For a GitHub PR webhook, the n8n Function node takes the raw body and returns `{ message: "review this PR: <html_url>" }` — same pattern as the GitHub webhook example above. That's it. Pi does the rest: it uses `gh` to fetch the diff, reads the changes, reasons about them, and returns the review. The glue doesn't parse the diff, fetch files, or understand the codebase — Pi does all of that with the tools it has on the server (`gh`, `git`, `curl`, MCP servers, Composio).

**The result:**

The platform owns the trigger side. Pi owns the work. The glue in between is a few lines that turn an event into a prompt — the same `{ message: "..." }` shape used everywhere else in this doc. No webhook server to run, no subscriptions to manage, no boilerplate for parsing GitHub events. Use an existing n8n instance, a Zapier subscription, or the Composio SDK. Wire the trigger to `POST /v1/chat` (or a WebSocket), hand Pi the task, and let it carry out the work with the tools available on the server.

---

## Build your integration with Pi

You have the architecture. You know the pattern: trigger → prompt → Pi → response. But you don't have to write the glue code by hand. Pi has read this doc. Show it a target and it'll scaffold the whole thing:

```bash
pi "Build a Slack bot for pi-remote using the triggers doc."
```

Pi knows the SDK, the protocol, and the connect-once lifecycle. Discord, Telegram, Slack, webhooks, cron — any platform, any language. The doc is as much for Pi as it is for you.
