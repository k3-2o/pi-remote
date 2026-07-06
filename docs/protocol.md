# Protocol

pi-remote speaks two protocols. Internally, it talks to Pi over raw JSON-RPC. Externally, it talks to clients over its own envelope protocol. The two never mix.

```
Client ←→ pi-remote ←→ Pi
  (our protocol)    (JSON-RPC)
```

The client never sees JSON-RPC. Pi's output is wrapped inside a `payload` field in our envelope. The SDK translates that payload into readable events.

---

## Handshake

```
Client → Server:  { type: "hello", protocolVersion: 1, clientId: "my-bot" }

Server → Client:  { type: "welcome", protocolVersion: 1, serverVersion: "0.2.0",
                    sessionId: "abc123", sessions: [...], currentSeq: 0 }
```

A session is auto-created on successful handshake. The `sessionId` is in the welcome message. No explicit session creation step.

Errors during handshake:

| Error code | When |
|---|---|
| `INVALID_JSON` | Message is not valid JSON |
| `INVALID_HELLO` | First message is not a `hello` |
| `INCOMPATIBLE_PROTOCOL` | `protocolVersion` doesn't match |
| `AUTH_FAILED` | API key missing or invalid (when auth is enabled) |

---

## Commands

All commands include a client-generated `requestId`. The server echoes it in the response for correlation.

```
Client → Server:  { type: "command", requestId: "req_1",
                    payload: { type: "prompt", message: "fix the bug" } }

Server → Client:  { type: "response", requestId: "req_1",
                    payload: { success: true } }
```

### Session-Scoped Commands

Forwarded to Pi. The pipe is transparent — these 27 commands all use the same `forwardToPi` dispatch with zero per-command code.

| Command | What it does |
|---|---|
| `prompt` | Send a message to Pi |
| `abort` | Stop a running task |
| `set_model` | Switch model/provider |
| `get_available_models` | List available models |
| `set_thinking_level` | Control thinking depth |
| `compact` | Summarise old context to free space |
| `bash` | Run a shell command through Pi |
| `get_context_usage` | Context window fill level |
| `get_state` | Session state (model, thinking level) |
| `get_tree` | Conversation tree structure |
| `fork` | Branch from a specific message |
| `get_entries` | Message history entries |
| `get_messages` | Raw message list |
| `set_session_name` | Name a session |
| `set_auto_compaction` | Toggle auto context compaction |
| `steer` | Steer Pi mid-response |
| `follow_up` | Follow-up without full prompt |
| `abort_bash` | Abort running bash command |
| `cycle_model` | Cycle to next configured model |
| `cycle_thinking_level` | Cycle thinking levels |
| `get_session_stats` | Session statistics |
| `get_fork_messages` | Fork message list |
| `switch_session_file` | Switch session file path |
| `get_commands` | List available commands |
| `new_session` | Start a new session |
| `get_last_assistant_text` | Last response text |
| `extension_ui_response` | Response to UI dialog |

### WS-Native Commands

Handled by pi-remote directly — no Pi process needed.

| Command | Payload | Response |
|---|---|---|
| `get_health` | `{}` | `{ status, uptime, sessions, wsClients, version }` |
| `get_version` | `{}` | `{ version, protocol }` |
| `list_sessions` | `{}` | `{ sessions: [...] }` |
| `create_session` | `{ sessionId?, cwd? }` | session info |
| `delete_session` | `{ sessionId? }` | `{ success: true }` |
| `switch_session` | `{ sessionId }` | `{ type: "session_switched", sessionId, session }` |

---

## Events

Streaming events from Pi are forwarded wrapped in our envelope. The `payload` field contains raw Pi output — the SDK translates it.

```
Server → Client:  { type: "event", seq: 1, sessionId: "abc",
                    payload: { type: "message_update",
                               assistantMessageEvent: { type: "text_delta", delta: "I" } } }

Server → Client:  { type: "event", seq: 2, sessionId: "abc",
                    payload: { type: "tool_execution_start", toolName: "bash", args: {...} } }

Server → Client:  { type: "event", seq: N, sessionId: "abc",
                    payload: { type: "agent_end" } }
```

### Event Types in `payload`

| Pi event | SDK maps to |
|---|---|
| `message_update` with `text_delta` | `"token"` event — text chunk |
| `message_update` with `thinking_delta` | `"thinking"` event — model reasoning |
| `tool_execution_start` | `"tool_start"` — `{ tool, args, id }` |
| `tool_execution_update` | `"tool_output"` — `{ output }` |
| `tool_execution_end` | `"tool_end"` — `{ result, isError }` |
| `agent_end` | `"agent_end"` — prompt complete |

---

## Extension UI

Pi's dialogs flow bidirectionally through WebSocket. The server routes requests to the connected client, waits for a response, and forwards it back to Pi's stdin.

```
Server → Client:  { type: "extension_ui_request", id: "ui_1",
                    method: "confirm", message: "Delete the file?" }

Client → Server:  { type: "extension_ui_response", requestId: "ui_1",
                    response: { confirmed: true } }
```

Supported dialogs: `select`, `confirm`, `input`, `editor`. Fire-and-forget methods (`notify`, `setStatus`, `setWidget`, `setTitle`) don't wait for responses. Dialogs time out after 60 seconds with a default cancelled response.

---

## Heartbeat & Backpressure

- Server pings every 30 seconds. Client must pong within 10 seconds or connection is closed.
- Messages dropped when client buffer exceeds 64KB.
- Connection closed when buffer exceeds 1MB.

All configurable via `server.heartbeatInterval`, `server.heartbeatTimeout`, `server.backpressureThreshold`, `server.backpressureCritical`.
