# Triggers

pi-remote is a server that listens. It doesn't originate actions, pull events, or manage webhooks. External triggers are handled by your glue code. The pattern is always the same: something happens somewhere → your code translates it into a prompt → pi-remote → Pi does the work.

---

## Discord Bot

```js
// bot.js — run alongside pi-remote
import { PiRemoteWS } from "@k3_2o/pi-remote/client";

const client = new PiRemoteWS("ws://localhost:8080");

discordBot.on("message", async (msg) => {
  if (!msg.content.startsWith("@pi")) return;

  await client.connect();
  client.on("token", (t) => {/* stream tokens to Discord channel */});
  const result = await client.chat(msg.content.replace("@pi", "").trim());
  msg.reply(result.text);
  client.close();
});
```

**With per-task customization** (model switching from emerged commands):

```js
discordBot.on("message", async (msg) => {
  await client.connect();

  // PR review → use Claude, think harder
  if (msg.content.includes("review")) {
    await client.sendCommand({ type: "set_model", provider: "openrouter", modelId: "claude-sonnet" });
    await client.sendCommand({ type: "set_thinking_level", level: "high" });
  }

  const result = await client.chat(msg.content.replace("@pi", "").trim());
  msg.reply(result.text);
  client.close();
});
```

**Conversation mode** — Pi can ask questions back:

```js
client.on("extension_ui_request", (req) => {
  msg.reply(`Pi asks: ${req.message}`);
  // Wait for user response, then:
  client.sendExtensionUIResponse(req.id, { confirmed: true });
});
```

---

## Telegram Bot

Same pattern. HTTP or WebSocket — your choice.

```python
from pi_remote_ws import PiRemoteWS

client = PiRemoteWS("ws://localhost:8080")

@bot.message_handler(func=lambda m: m.text.startswith("/pi"))
async def handle_pi(message):
    await client.connect()
    result = await client.chat(message.text.replace("/pi", "").strip())
    await bot.reply_to(message, result["text"])
    await client.close()
```

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
// webhook-handler.js
import { PiRemoteWS } from "@k3_2o/pi-remote/client";

app.post("/webhook", async (req, res) => {
  const { action, pull_request } = req.body;
  if (action !== "opened") return res.status(200).end();

  res.status(200).end(); // acknowledge immediately

  const client = new PiRemoteWS("ws://localhost:8080");
  await client.connect();
  await client.sendCommand({ type: "set_model", provider: "openrouter", modelId: "claude-sonnet" });
  await client.sendCommand({ type: "set_thinking_level", level: "high" });
  await client.chat(`review this PR: ${pull_request.html_url}`);
  client.close();
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

Every example above runs a custom daemon — a webhook server, a long-running bot process, or a cron entry. I have to manage subscriptions, retries, reconnection, and uptime myself. The next step is offloading that entirely to an automation platform.

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

The glue that converts the trigger payload into a prompt. For example, in n8n you'd have a Function node that takes the raw GitHub PR webhook body and returns `{ message: "Review PR #42 in org/repo for bugs" }`. That's the same `{ message: "..." }` pattern from everywhere else — just formatted inside the platform instead of in your own daemon.

**The result:**

Don't want to run a webhook server, manage subscriptions, or write boilerplate for GitHub event parsing? Don't. Use an existing n8n instance, a Zapier subscription, or the Composio SDK. Wire the trigger to `POST /v1/chat`, feed it your prompt, and pipe the response wherever it needs to go. The platform abstracts the infrastructure. Your code stays focused on the prompt.
