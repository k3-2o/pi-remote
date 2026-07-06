# Emergence — 30+ Commands From 2

The original goal required only two commands: `prompt` and `abort`. The other 31 came through for free because the pipe is transparent.

---

## The Two We Deliberately Built

```
prompt  → "review PR #42"  — the core command. Everything starts here.
abort   → stop a running task mid-stream
```

These were the only two the vision needed. Message in, response out. Stop if needed.

---

## The Six We Built for Operations

```
get_health       → server status, uptime, session count
get_version      → server and protocol version
list_sessions    → all sessions with active/inactive status
create_session   → named session setup
delete_session   → cleanup
switch_session   → session navigation (for the attach TUI)
```

Deliberately built. Not Pi commands — pi-remote server management.

---

## The 25 That Emerged

One function — `forwardToPi` — dispatches them all. Zero per-command code. If Pi adds a new RPC command, it flows through automatically.

### Useful for Trigger Code

These add genuine capability to simple prompt-based workflows:

| Command | Use in a trigger |
|---|---|
| `set_model` | PR review needs Claude. Quick task needs a cheap model. Switch per-task without restarting. |
| `get_available_models` | Validate model names before switching. |
| `set_thinking_level` | "High" for complex code review. "Low" for simple questions. Per-task depth control. |
| `compact` | Long session getting full? Compact before the next prompt. |
| `bash` | Run a shell command through Pi. |
| `get_context_usage` | Check context window fill before sending a large prompt. |

### Quality of Life

Useful for longer sessions but not essential for trigger code:

```
set_session_name, get_state, get_tree, fork,
get_entries, get_last_assistant_text, set_auto_compaction
```

### Pi Internals

Available but rarely needed. They exist because Pi has them:

```
steer, follow_up, get_messages, get_session_stats,
cycle_model, cycle_thinking_level, abort_bash,
get_fork_messages, switch_session_file, get_commands,
new_session, extension_ui_response
```

---

## The Abstraction Layer

This is pi-remote's real value. Before pi-remote:

```
You → spawn pi --mode rpc as subprocess
    → hand-write JSON-RPC messages to stdin
    → parse JSONL from stdout (careful: \n only, not readline)
    → correlate request IDs with responses
    → handle streaming events
    → manage process lifecycle
    → handle extension UI dialogs yourself
```

After pi-remote:

```js
const client = new PiRemoteWS("ws://localhost:8080");
await client.connect();
await client.chat("do something");
await client.sendCommand({ type: "set_model", provider: "openrouter", modelId: "claude-sonnet" });
```

The SDK hides the RPC protocol. The server hides process management. Together they turn Pi's internal JSON-RPC into a clean API surface. Devs build Discord bots, web dashboards, custom CLIs — they never see a raw RPC message or a subprocess.

The 30+ commands weren't built. They emerged. The pipe is unfiltered. What the dev ignores, they never see. What they need, is already there.
