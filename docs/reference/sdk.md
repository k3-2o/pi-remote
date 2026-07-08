# SDK Reference

How to use the pi-remote SDK. Covers every method, every event, and explains what's a convenience wrapper vs raw protocol.

---

## Before you start

The SDK is one file: `pi_remote_ws.mjs`. Copy it into your project, import it, and use it.

```js
import { PiRemoteWS } from "@k3_2o/pi-remote/client";
// or copy the file and:
import { PiRemoteWS } from "./pi_remote_ws.mjs";
```

---

## Lifecycle — Opening and Closing the Pipe

These are not commands. They're WebSocket actions — making the connection exist and destroying it.

| Method | What it does |
|---|---|
| `connect({ systemPrompt?, appendSystemPrompt? })` | Opens WebSocket, sends hello, waits for welcome. Creates a session automatically. Optional fields set the session's system prompt — equivalent of `--system-prompt` / `--append-system-prompt` on the Pi CLI. |
| `close()` | Closes WebSocket. Server cleans up Pi process. You don't need to call this — server auto-cleans idle sessions. |
| `isConnected` | Returns `true/false` |
| `sessionId` | Your session's ID (set after connect) |

### The pattern

```js
const client = new PiRemoteWS("ws://localhost:8080");
await client.connect();   // ← open the pipe
// ... do stuff ...
client.close();           // ← close the pipe (optional, server cleans up)
```

### You don't need to close()

If you never call `close()`:
- The WebSocket stays open as long as both sides are alive
- If idle for 30 minutes, the server kills the **Pi process** (not the connection). Next message spawns a fresh Pi.
- If your app crashes, the server detects the dead connection within ~40 seconds via heartbeat and cleans up

Call `close()` when you want to end the session explicitly — bot shutdown, cleanup, or switching to a new connection. If you never call it, the server handles cleanup automatically: idle Pi processes are killed after 30 minutes, and dead connections are detected within ~40 seconds via heartbeat.

---

## Chat — The Main Thing

### Convenience method (recommended for most cases)

```js
const result = await client.chat("write a haiku");
console.log(result.text);        // → "Silent keys tapping..."
console.log(result.toolCalls);   // → [{ tool: "bash", args: {...}, ... }]
console.log(result.sessionId);   // → "abc123"
```

**What `chat()` does for you automatically:**
1. Sends `{ type: "prompt", message: "write a haiku" }` to Pi
2. Listens for `token` events and appends them to `result.text`
3. Listens for `tool_start` events and pushes them to `result.toolCalls`
4. Waits for `agent_end` to know Pi is done
5. Returns `{ text, toolCalls, sessionId }`
6. Cleans up all internal event listeners (no memory leaks)
7. Handles 120-second timeout

### Raw equivalent (if you need more control)

```js
// You send the prompt yourself
await client.sendCommand({ type: "prompt", message: "write a haiku" });

// You handle events yourself
let text = "";
client.on("token", t => text += t);
client.on("tool_start", ({ tool }) => console.log("Tool:", tool));
client.on("agent_end", () => {
  console.log("Done:", text);
  // You must clean up yourself:
  client.off("token");
  client.off("tool_start");
  client.off("agent_end");
});
```

**When to use raw instead of `chat()`:**
- You want to stream tokens to Discord in real-time (word by word) instead of collecting and sending at the end
- You need to handle events differently (e.g., cancel mid-stream)
- You want to integrate with your own progress indicators

### Streaming with `chat()` (incremental)

`chat()` also accepts callbacks that fire during streaming:

```js
const result = await client.chat("write a haiku", {
  onToken: t => process.stdout.write(t),        // fires as Pi types
  onTool: ({ tool, args }) => console.log(`\n[${tool}]`),  // fires on tool use
});
// result.text is still the full accumulated text
```

---

## Events — What Pi Tells You

### Named events (SDK translates Pi's raw JSON for you)

```js
client.on("token", t => ...)              // just the string, e.g. "Hello"
client.on("thinking", t => ...)            // just the string
client.on("tool_start", ({tool,args}) => ...)  // clean object
client.on("tool_output", ({output}) => ...)     // partial result
client.on("tool_end", ({result, isError}) => ...)
client.on("agent_end", event => ...)
client.on("extension_ui_request", req => ...)   // Pi asks a question
client.on("error", err => ...)
client.on("close", () => ...)
```

**What the SDK does for named events:**

| SDK event | Pi's raw RPC event | What you get |
|---|---|---|
| `token` | `message_update` with `text_delta` | Just the string: `"Hello"` |
| `thinking` | `message_update` with `thinking_delta` | Just the string |
| `message` | `message_update` with other deltas | Raw event object |
| `tool_start` | `tool_execution_start` | `{ tool, args, id }` |
| `tool_output` | `tool_execution_update` | `{ output }` |
| `tool_end` | `tool_execution_end` | `{ result, isError }` |
| `agent_end` | `agent_end` | Raw event object |
| `extension_ui_request` | `extension_ui_request` | `{ id, method, message, ... }` |

### Catch-all event (for everything else)

Any Pi event the SDK doesn't have a name for comes through here:

```js
client.on("event", raw => {
  // raw is the exact JSON Pi emitted
  if (raw.type === "turn_start") {
    console.log("New turn");
  }
  if (raw.type === "compaction_start") {
    console.log("Compacting...");
  }
});
```

Pi events that fall through to `"event"`: `agent_start`, `turn_start`, `turn_end`, `message_start`, `message_end`, `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end`, `extension_error`.

### on() and off()

```js
const handler = (t) => console.log(t);

client.on("token", handler);    // add listener
client.off("token", handler);   // remove it
```

**Why `off()` matters:** Every `on()` adds a listener permanently. If you call `chat()` 100 times without cleaning up, you'd have 300 stale listeners. They'd keep firing for old conversations.

`chat()` calls `off()` automatically for its internal listeners. But if you add your own listeners with `on()`, you must remove them with `off()` when you're done, or they pile up.

### Extension UI — Pi asks you a question

Pi extensions like **guardrails** or a custom **ask-user-question** command can call `ctx.ui.confirm()`, `ctx.ui.select()`, `ctx.ui.input()`, or `ctx.ui.editor()`. When that happens, Pi **pauses** and waits for your answer over the network. If nothing responds, it hangs until the server times it out (60 seconds) and auto-replies with a default — `{ confirmed: false }` for confirm, `{ cancelled: true }` for everything else.

```js
client.on("extension_ui_request", (req) => {
  // Pi is frozen, waiting for your answer
  // req.method: "confirm" | "select" | "input" | "editor"
  // req.message: the question or prompt
  
  // Send your answer back — Pi unblocks and continues
  if (req.method === "confirm") {
    client.sendExtensionUIResponse(req.id, { confirmed: true });
  } else if (req.method === "select") {
    client.sendExtensionUIResponse(req.id, { selected: "option_2" });
  } else if (req.method === "input") {
    client.sendExtensionUIResponse(req.id, { value: "user typed this" });
  }
});
```

**If you don't handle this in your code:** Pi waits 60 seconds, the server auto-replies with a safe default, and Pi continues with the assumption the answer was "no" or "cancelled." The task may fail or take a different path as a result.

You will likely never need this unless you run Pi extensions that require user confirmation (guardrails, deploy prompts, destructive operations). Normal `chat()` flows never trigger it. The dashboard's SSE watch also drops these events — it's for viewing only.

---

## Operations — Server Management

These are convenience methods for common server tasks. Each one wraps a `sendCommand()` call and returns cleaned-up data.

| Method | Instead of writing | Returns |
|---|---|---|
| `health()` | `sendCommand({ type: "get_health" })` | `{ status, uptime, sessions, ... }` |
| `version()` | `sendCommand({ type: "get_version" })` | `{ version, protocol }` |
| `listSessions()` | `sendCommand({ type: "list_sessions" })` | `[{ sessionId, active, ... }]` (extracts `.sessions` for you) |
| `createSession(id?)` | `sendCommand({ type: "create_session" })` | `{ sessionId, ... }` |
| `switchSession(id)` | `sendCommand({ type: "switch_session", sessionId: id })` | `{ type: "session_switched", ... }` |
| `deleteSession(id?)` | `sendCommand({ type: "delete_session", sessionId: id })` | `{ success: true }` |
| `abort()` | `sendCommand({ type: "abort" })` | Response object |

---

## Raw Commands — Everything Else

Pi has **31 RPC commands** total. The SDK gives convenience shortcuts for only 2 of them — `chat()` wraps `prompt`, `abort()` wraps `abort`. The other 29 you send through `sendCommand()`. (The remaining SDK methods — `health`, `version`, `listSessions`, `createSession`, `switchSession`, `deleteSession` — wrap the 6 server-native commands, not Pi commands.)

```js
await client.sendCommand({ type: "get_tree" });
await client.sendCommand({ type: "bash", command: "ls" });
await client.sendCommand({ type: "set_model", provider: "anthropic", modelId: "..." });
await client.sendCommand({ type: "compact" });
await client.sendCommand({ type: "fork", entryId: "abc123" });
await client.sendCommand({ type: "get_messages" });
// ... any of the 31
```

You need to know the command name and its parameters from [Pi's RPC docs](https://github.com/earendil-works/pi-coding-agent/docs/rpc.md). The server forwards them blindly — it never needs to know what each command means.

### The 31 Pi RPC commands

```
prompt, steer, follow_up, abort, new_session,
get_state, get_messages, set_model, cycle_model, get_available_models,
set_thinking_level, cycle_thinking_level, set_steering_mode, set_follow_up_mode,
compact, set_auto_compaction, set_auto_retry, abort_retry,
bash, abort_bash, get_session_stats, export_html,
switch_session, fork, clone, get_fork_messages,
get_entries, get_tree, get_last_assistant_text, set_session_name,
get_commands
```

### The 6 server commands (not Pi commands — pi-server handles these)

```
get_health, get_version, list_sessions, create_session, delete_session, switch_session
```

---

## sendCommand() vs sendExtensionUIResponse()

These both send data, but differently:

| Method | What it does | Request matching | Timeout | Returns |
|---|---|---|---|---|
| `sendCommand(payload)` | Wraps, sends, tracks request ID, matches response | ✅ Yes | ✅ 120s | Resolves with response |
| `sendExtensionUIResponse(id, response)` | Raw WebSocket send | ❌ No | ❌ No | Nothing |

`sendExtensionUIResponse()` is essentially raw — it just does `JSON.stringify()` and sends. It exists because you need to answer Pi's extension UI questions, and those don't follow the normal request/response pattern.

---

## Summary: What's abstracted vs what's raw

### Commands

| You want to... | Use this | Instead of writing |
|---|---|---|
| Send a message, get full response | `chat("hi")` | `sendCommand({ type: "prompt" })` + handle token/agent_end events |
| Check server health | `health()` | `sendCommand({ type: "get_health" })` |
| List sessions | `listSessions()` | `sendCommand({ type: "list_sessions" })` + extract `.sessions` |
| Send any other command | `sendCommand({ type, ... })` | Raw protocol |
| Answer Pi's question | `sendExtensionUIResponse(id, resp)` | Raw WebSocket send |

### Events

| Pi fires this... | SDK fires this | What you get |
|---|---|---|
| `message_update` + `text_delta` | `"token"` | Just the string |
| `message_update` + `thinking_delta` | `"thinking"` | Just the string |
| `tool_execution_start` | `"tool_start"` | `{ tool, args, id }` |
| `tool_execution_update` | `"tool_output"` | `{ output }` |
| `tool_execution_end` | `"tool_end"` | `{ result, isError }` |
| `agent_end` | `"agent_end"` | Raw event |
| `extension_ui_request` | `"extension_ui_request"` | `{ id, method, message }` |
| Everything else | `"event"` | Raw Pi JSON |

---

## Python SDK

The Python SDK (`pi_remote_ws.py`) has the same methods and events:

```python
from pi_remote_ws import PiRemoteWS
import asyncio

async def main():
    client = PiRemoteWS("ws://localhost:8080")
    await client.connect()

    client.on("token", lambda t: print(t, end="", flush=True))
    result = await client.chat("write a haiku")
    print(result["text"])

    await client.close()

asyncio.run(main())
```

All operations, events, and patterns are identical to the JavaScript version.

---

## HTTP clients (alternative)

For simple one-shot prompts without WebSocket:

```js
import { PiRemote } from "./pi_remote.mjs";
const client = new PiRemote("http://localhost:8080");
const result = await client.chat("write a haiku");
console.log(result.text);
```

Limitations: No streaming events. No extension UI. No session reuse. No commands beyond `prompt`.
