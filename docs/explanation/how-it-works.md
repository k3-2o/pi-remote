# How pi-remote Works — The Pipe Model

What happens when you call `client.chat("hello")`, and why the SDK is the way it is.

---

## The Core Idea

pi-remote is a **transparent pipe** between you and Pi.

```
You → SDK → pi-server → Pi
You ← SDK ← pi-server ← Pi
```

Everything flows through this pipe. The server doesn't interpret your commands — it forwards them. The server doesn't invent events — it forwards Pi's responses. The pipe is dumb by design.

---

## What the Pipe Does for You

Without the pipe, talking to Pi looks like this:

```
1. Spawn pi --mode rpc as a subprocess
2. Write JSON commands to stdin, one line at a time
3. Read JSON responses from stdout, split on \n only (not readline)
4. Match each response to the command that triggered it
5. Parse streaming events from Pi's nested JSON format
6. Handle subprocess crashes, timeouts, cleanup
7. Send SIGTERM, wait, SIGKILL if it doesn't die
```

With the pipe, you write:

```js
const result = await client.chat("write a haiku");
console.log(result.text);
```

The server handles steps 1, 4, 6, 7. The SDK handles steps 2, 3, 5. You write one line.

---

## What the Pipe Doesn't Do

The pipe is **unfiltered**. It forwards any command you send to Pi, even if the server doesn't know what it means. It forwards any event Pi emits, even if the SDK doesn't have a name for it.

This means:

- **Any command Pi knows, works.** You don't need to wait for us to add SDK support. `sendCommand({ type: "compact" })` works even though there's no `client.compact()` method. Pi understands `compact`, so the pipe passes it through.

- **Any event Pi emits, arrives.** If Pi fires an event the SDK hasn't named, it comes through `client.on("event", raw)`. You parse it yourself.

---

## What We Built vs What Emerged

### We built (on the server side)

| Component | What it does |
|---|---|
| Process manager | Spawns Pi, kills Pi, pools up to 10, idle timeout |
| Session manager | Tracks session metadata, creates/deletes records |
| WebSocket transport | Handshake, heartbeat, command routing, event forwarding |
| HTTP transport | REST endpoints for curl users (health, sessions, chat) |
| Auth | API key checking |
| CLI | start, stop, status, health, sessions |
| Config | Defaults, config file, env vars |
| PID file | So `stop` can find the server process |
| 6 server commands | `get_health`, `get_version`, `list_sessions`, `create_session`, `delete_session`, `switch_session` |

### We built (on the SDK side)

| Component | What it does |
|---|---|
| WebSocket connection | Opens, sends hello, waits for welcome, heartbeat |
| Command wrapping | Wraps your payload in the protocol envelope, tracks request IDs |
| Event translation | Renames Pi's raw events to clean names (token, thinking, tool_start) |
| 9 convenience methods | Shortcuts for common commands |
| Chat orchestrator | Sends prompt, collects tokens, waits for agent_end, returns clean result |

### Emerged (from Pi's RPC protocol — we didn't build these)

**31 commands** that flow through the pipe automatically. Pi knows them, we don't touch them:

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

**16 events** that Pi can emit at any time:

```
agent_start, agent_end,
turn_start, turn_end,
message_start, message_update, message_end,
tool_execution_start, tool_execution_update, tool_execution_end,
queue_update,
compaction_start, compaction_end,
auto_retry_start, auto_retry_end,
extension_error
```

---

## The Numbers

| Category | Count | What |
|---|---|---|
| Pi RPC commands | 31 | Forwarded through `sendCommand()` |
| Our server commands | 6 | Handled by pi-server, never touch Pi |
| SDK convenience methods | 9 | Wrappers for common commands |
| SDK lifecycle methods | 2 | `connect()`, `close()` — WebSocket actions, not commands |
| Pi RPC events | 16 | All events Pi can emit |
| SDK named events | 7 | The ones we translated (token, thinking, tool_start, etc.) |
| SDK catch-all | 2 | `"message"` for unknown message_update types, `"event"` for everything else |

---

## What the User Sees

For a typical user (e.g., building a Discord bot), the relevant surface is much smaller:

```
You use:  connect(), chat(), on("token"), on("agent_end")
You ignore: everything else
``` 

The 31 commands, 16 events, 6 server commands, all the plumbing — they exist if you need them, but they don't get in your way if you don't. That's the point of the abstraction layer.
