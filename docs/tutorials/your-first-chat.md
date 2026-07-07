# Your First Chat with Pi Over the Network

A step-by-step guide from zero to sending your first message and getting a response. No assumptions. No jargon.

---

## What You're Building

By the end of this tutorial, you'll have a working script that:
1. Connects to pi-server (the box that holds Pi)
2. Sends Pi a message
3. Gets the full response back
4. Prints it

---

## Prerequisites

Check these before you start:

```bash
node --version    # Need 18 or higher
pi --version      # Need Pi installed: npm install -g @earendil-works/pi-coding-agent
```

If `pi --version` fails, run this first:
```bash
npm install -g @earendil-works/pi-coding-agent
```

---

## Step 1: Install pi-server

```bash
npm install -g @k3_2o/pi-remote
```

Verify it installed:
```bash
pi-remote --version
# Should print something like 0.2.1
```

---

## Step 2: Start the server

```bash
pi-remote start
```

You should see:
```
pi-remote v0.2.1 started on http://0.0.0.0:8080
```

The server is now running in this terminal window. Open a **new terminal** for the next steps.

If you want to run it in the background instead:
```bash
pi-remote start --detach
```

---

## Step 3: Check it's alive

```bash
curl http://localhost:8080/v1/health
```

You should get back:
```json
{"status":"ok","uptime":5.2,"sessions":0,"version":"0.2.1"}
```

If this fails, the server isn't running. Go back to Step 2.

---

## Step 4: Write your first script

Create a new file called `first-chat.mjs`:

```js
import { PiRemoteWS } from "./pi_remote_ws.mjs";

async function main() {
  // 1. Open the connection
  const client = new PiRemoteWS("ws://localhost:8080");
  await client.connect();
  console.log("Connected! Session:", client.sessionId);

  // 2. Send a message and wait for the full response
  const result = await client.chat("write a haiku about coding");
  
  // 3. Print the response
  console.log("\nPi says:");
  console.log(result.text);
  
  // 4. Close the connection
  client.close();
}

main().catch(console.error);
```

Now copy the SDK file next to your script:
```bash
cp node_modules/@k3_2o/pi-remote/examples/pi_remote_ws.mjs .
```

---

## Step 5: Run it

```bash
node first-chat.mjs
```

You should see something like:
```
Connected! Session: abc123

Pi says:
Silent keys tapping,
Bugs hide in the shadows,
A fix pushes through.
```

That's it. You just talked to Pi over the network.

---

## What just happened?

```
Your script                pi-server                Pi
    │                         │                    │
    ├── connect() ───────────►│                    │
    │                         ├── spawns Pi ──────►│
    │◄──── welcome ───────────┤                    │
    │                         │                    │
    ├── chat("write a haiku")─►│                    │
    │                         ├── prompt ─────────►│
    │                         │                    ├── thinks
    │                         │◄── text_delta ─────┤
    │◄── "token" events ──────┤                    │
    │                         │◄── agent_end ──────┤
    │◄── result.text ────────┤                    │
    │                         │                    │
    ├── close() ─────────────►│                    │
    │                         ├── stops Pi ───────►│
```

`connect()` opens the pipe. `chat()` sends the message and waits for Pi to finish typing. `close()` hangs up.

---

## Step 6: See Pi typing in real-time

If you want to watch Pi type word by word instead of waiting for the whole response:

```js
import { PiRemoteWS } from "./pi_remote_ws.mjs";

async function main() {
  const client = new PiRemoteWS("ws://localhost:8080");
  await client.connect();

  // Listen for each word as Pi types it
  client.on("token", t => process.stdout.write(t));
  
  // Know when Pi is done
  client.on("agent_end", () => console.log("\n\n[Done]"));

  await client.chat("write a short poem about coding");
  
  // Don't close — the server cleans up idle sessions after 30 minutes
  // Or close if you know you're done:
  // client.close();
}

main().catch(console.error);
```

Run it:
```bash
node first-chat.mjs
```

Now you'll see each word appear as Pi writes it, like watching someone type in real-time.

---

## What you've learned

| Concept | What it means |
|---|---|
| `connect()` | Opens the WebSocket. Creates a session. Pi starts. |
| `chat("message")` | Sends a prompt, waits for Pi to finish, returns `{ text, toolCalls, sessionId }` |
| `on("token", handler)` | Fires each word as Pi types it (for live streaming) |
| `close()` | Hangs up the WebSocket. Explicit end — server also cleans up idle sessions on its own after 30 min. |

---

## Next steps

- [Build a Discord bot](../how-to/discord-bot.md) — put this to real use
- [SDK Reference](../reference/sdk.md) — every method and event, abstracted vs raw
- [How It Works](../explanation/how-it-works.md) — what's happening under the hood
- [How triggers work](../how-to/triggers.md) — Discord, cron, webhooks
