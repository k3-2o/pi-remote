# Triggers

pi-remote is a server that listens. It doesn't originate actions, pull events, or manage webhooks. External triggers are handled by your glue code. The pattern is always the same: something happens somewhere → your code translates it into a prompt → pi-remote → Pi does the work.

---

## Discord Bot

```js
// bot.js — run alongside pi-remote
import { PiRemoteWS } from "pi-remote/client";

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
import { PiRemoteWS } from "pi-remote/client";

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
