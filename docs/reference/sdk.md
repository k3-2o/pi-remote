# SDK Reference

Two WebSocket clients (JavaScript and Python). Two HTTP clients (sugar layer). All available from the npm package or as copy-paste examples.

---

## PiRemoteWS (JavaScript)

```js
import { PiRemoteWS } from "@k3_2o/pi-remote/client";
```

### Constructor

```js
new PiRemoteWS(url, apiKey?)
```

- `url` — WebSocket URL. Default: `"ws://localhost:8080"`
- `apiKey` — API key for auth. Default: `null`

### Lifecycle

```js
await client.connect()     // Opens connection, sends hello, waits for welcome. Returns the client.
client.isConnected         // true/false
client.sessionId           // The auto-created session ID
client.close()             // Closes connection. Session deactivated.
```

### Chat

```js
await client.chat(message, options?)
// Returns: { text, toolCalls, sessionId }

// Streaming
client.on("token", (text) => ...)
client.on("tool_start", ({ tool, args, id }) => ...)
client.on("thinking", (text) => ...)
client.on("tool_output", ({ output }) => ...)
client.on("tool_end", ({ result, isError }) => ...)
client.on("agent_end", () => ...)
```

### Events

```js
client.on(event, handler)
client.off(event, handler)
```

| Event | Type | When |
|---|---|---|
| `token` | `string` | Text chunk from Pi |
| `thinking` | `string` | Model reasoning (model-dependent) |
| `tool_start` | `{ tool, args, id }` | Tool execution started |
| `tool_output` | `{ output }` | Partial tool output |
| `tool_end` | `{ result, isError }` | Tool execution finished |
| `agent_end` | object | Prompt complete |
| `extension_ui_request` | `{ id, method, message, options?, default? }` | Pi asks a question |
| `error` | `Error` | Connection or protocol error |
| `close` | — | Connection closed |

### Extension UI

```js
client.on("extension_ui_request", (req) => {
  // req.method: "confirm" | "select" | "input" | "editor"
  // req.message: the question
  // Show dialog to user, then:
  client.sendExtensionUIResponse(req.id, { confirmed: true });
});
```

### Operations

```js
await client.health()          // → { status, uptime, sessions, wsClients, version }
await client.listSessions()    // → [{ sessionId, active, messageCount, ... }]
await client.createSession(id?)  // → session info
await client.switchSession(id) // → { type: "session_switched", ... }
await client.deleteSession(id?)  // → { success: true }
await client.abort()           // → abort current task
```

### Raw Commands

All 27 Pi RPC commands available:

```js
await client.sendCommand({ type: "set_model", provider: "openrouter", modelId: "claude-sonnet" })
await client.sendCommand({ type: "compact" })
await client.sendCommand({ type: "bash", command: "ls" })
await client.sendCommand({ type: "get_tree" })
```

---

## PiRemoteWS (Python)

```python
from pi_remote_ws import PiRemoteWS
```

Requires: `pip install websockets`

### Constructor

```python
client = PiRemoteWS(url="ws://localhost:8080", api_key=None)
```

### Lifecycle

```python
await client.connect()      # → welcome message dict
client.is_connected         # → bool
client.session_id           # → str
await client.close()
```

### Chat

```python
result = await client.chat(message, on_token=None, on_tool=None)
# → { "text": str, "tool_calls": list, "session_id": str }

# Streaming
client.on("token", lambda t: print(t, end="", flush=True))
client.on("tool_start", lambda t: print(f"[{t['tool']}]"))
client.on("agent_end", lambda e: print("Done"))
```

### Events

```python
client.on(event_name, handler)
client.off(event_name, handler)
```

Same event names and shapes as JavaScript — `token`, `thinking`, `tool_start`, `tool_output`, `tool_end`, `agent_end`, `extension_ui_request`, `error`, `close`.

### Operations

```python
await client.health()             # → dict
await client.list_sessions()      # → list
await client.create_session(id)   # → dict
await client.switch_session(id)   # → dict
await client.delete_session(id)   # → dict
await client.abort()              # → dict
await client.send_command({...})  # → dict
await client.send_extension_ui_response(request_id, response)
```

---

## HTTP Clients (Sugar Layer)

For fire-and-forget one-shots. No conversation. No extension UI. No commands beyond `prompt`.

### JavaScript

```js
import { PiRemote } from "./pi_remote.mjs";  // or copy-paste from examples/

const client = new PiRemote("http://localhost:8080", "optional-api-key");
const result = await client.chat("review PR #42");
// → { text: "...", toolCalls: [...], sessionId: "..." }
```

### Python

```python
from pi_remote import PiRemote

client = PiRemote("http://localhost:8080")
result = client.chat("review PR #42")
# → { "text": "...", "tool_calls": [...], "session_id": "..." }
```
