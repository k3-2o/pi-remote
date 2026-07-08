"""
pi-remote WebSocket client — THE PRIMARY SDK.

Copy this file into your project. Requires: pip install websockets

    from pi_remote_ws import PiRemoteWS
    import asyncio

    async def main():
        client = PiRemoteWS("ws://localhost:8080")
        # Connect with per-session config (optional — omit for defaults)
        await client.connect(
            systemPrompt="You are a Discord bot that talks like a pirate.",
            appendSystemPrompt=["Keep responses under 100 chars."],
            noTools=True,  # disable all tools (public bot safety)
            # or restrict to specific tools:
            # tools=["read", "bash"]
        )

        # Simple chat (auto-creates session on connect)
        result = await client.chat("fix the bug")
        print(result["text"])

        # Interactive with event streaming
        client.on("token", lambda t: print(t, end="", flush=True))
        await client.chat("review PR #42")

        await client.close()

    asyncio.run(main())
"""

import asyncio, json, time

try:
    import websockets
except ImportError:
    print("pip install websockets", flush=True)
    raise

PROTOCOL_VERSION = 1


class PiRemoteWS:
    def __init__(self, url="ws://localhost:8080", api_key=None):
        self.url = url
        self.api_key = api_key
        self.ws = None
        self.session_id = None
        self._connected = False
        self._handlers = {}
        self._pending = {}
        self._request_id = 0
        self._message_task = None

    # ── Lifecycle ──────────────────────────────────────────

    async def connect(self, systemPrompt=None, appendSystemPrompt=None, noTools=None, tools=None):
        if self._connected:
            return self

        self.ws = await websockets.connect(self.url)

        # Send hello handshake with optional per-session config
        hello = {
            "type": "hello",
            "protocolVersion": PROTOCOL_VERSION,
            "clientId": f"pi-remote-py-{int(time.time() * 1000)}",
        }
        if systemPrompt is not None:
            hello["systemPrompt"] = systemPrompt
        if appendSystemPrompt is not None:
            hello["appendSystemPrompt"] = appendSystemPrompt
        if noTools is not None:
            hello["noTools"] = noTools
        if tools is not None:
            hello["tools"] = tools
        await self.ws.send(json.dumps(hello))

        # Wait for welcome or error
        raw = await asyncio.wait_for(self.ws.recv(), timeout=10)
        msg = json.loads(raw)

        if msg["type"] == "welcome":
            self.session_id = msg["sessionId"]
            self._connected = True
            # Start background message reader
            self._message_task = asyncio.create_task(self._read_messages())
            return msg

        if msg["type"] == "error":
            raise Exception(msg["message"])

        raise Exception(f"Unexpected handshake response: {msg['type']}")

    async def _read_messages(self):
        """Background task: read messages and dispatch."""
        try:
            async for raw in self.ws:
                try:
                    msg = json.loads(raw)
                    self._handle_message(msg)
                except json.JSONDecodeError:
                    pass
        except websockets.exceptions.ConnectionClosed:
            self._connected = False
            self.session_id = None
            # Reject all pending commands
            for request_id, pending in list(self._pending.items()):
                if not pending["future"].done():
                    pending["future"].set_exception(
                        Exception("Connection closed")
                    )
                del self._pending[request_id]
            self._emit("close")

    async def close(self):
        if self._message_task:
            self._message_task.cancel()
            try:
                await self._message_task
            except asyncio.CancelledError:
                pass
        if self.ws:
            await self.ws.close()
            self.ws = None
        self._connected = False

    @property
    def is_connected(self):
        return self._connected

    # ── Events ─────────────────────────────────────────────

    def on(self, event, handler):
        if event not in self._handlers:
            self._handlers[event] = []
        self._handlers[event].append(handler)
        return self

    def off(self, event, handler):
        if event in self._handlers:
            try:
                self._handlers[event].remove(handler)
            except ValueError:
                pass
        return self

    def _emit(self, event, *args):
        for h in self._handlers.get(event, []):
            try:
                h(*args)
            except Exception:
                pass

    def _handle_message(self, msg):
        msg_type = msg.get("type")

        if msg_type == "event":
            event = msg.get("payload", {})
            if not event:
                return

            event_type = event.get("type")

            if event_type == "message_update":
                ae = event.get("assistantMessageEvent", {})
                if ae.get("type") == "text_delta":
                    self._emit("token", ae.get("delta", ""))
                elif ae.get("type") == "thinking_delta":
                    self._emit("thinking", ae.get("delta", ""))
                else:
                    self._emit("message", event)

            elif event_type == "tool_execution_start":
                self._emit("tool_start", {
                    "tool": event.get("toolName"),
                    "args": event.get("args"),
                    "id": event.get("toolCallId"),
                })

            elif event_type == "tool_execution_update":
                self._emit("tool_output", {"output": event.get("partialResult")})

            elif event_type == "tool_execution_end":
                self._emit("tool_end", {
                    "result": event.get("result"),
                    "isError": event.get("isError"),
                })

            elif event_type == "agent_end":
                self._emit("agent_end", event)

            else:
                self._emit("event", event)

        elif msg_type == "response":
            request_id = msg.get("requestId")
            if request_id is not None and request_id in self._pending:
                pending = self._pending.pop(request_id)
                if not pending["future"].done():
                    pending["future"].set_result(msg.get("payload", msg))

        elif msg_type == "extension_ui_request":
            self._emit("extension_ui_request", {
                "id": msg.get("id"),
                "method": msg.get("method"),
                "message": msg.get("message"),
                "options": msg.get("options"),
                "default": msg.get("default"),
            })

        elif msg_type == "error":
            self._emit("error", Exception(msg.get("message", "Unknown error")))

    # ── Commands ───────────────────────────────────────────

    async def send_command(self, payload, timeout=120):
        if not self._connected:
            raise Exception("Not connected")
        if not self.ws:
            raise Exception("WebSocket closed")

        self._request_id += 1
        request_id = f"req_{self._request_id}"

        future = asyncio.get_event_loop().create_future()
        self._pending[request_id] = {"future": future}

        try:
            await self.ws.send(json.dumps({
                "type": "command",
                "payload": payload,
                "requestId": request_id,
            }))
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(request_id, None)
            raise Exception(f"Command {payload.get('type')} timed out")

    # ── Convenience methods ────────────────────────────────

    async def health(self):
        return await self.send_command({"type": "get_health"})

    async def version(self):
        return await self.send_command({"type": "get_version"})

    async def list_sessions(self):
        resp = await self.send_command({"type": "list_sessions"})
        return resp.get("sessions", [])

    async def create_session(self, session_id=None, cwd=None):
        payload = {"type": "create_session"}
        if session_id:
            payload["sessionId"] = session_id
        if cwd:
            payload["cwd"] = cwd
        return await self.send_command(payload)

    async def switch_session(self, session_id):
        resp = await self.send_command({
            "type": "switch_session",
            "sessionId": session_id,
        })
        self.session_id = session_id
        return resp

    async def delete_session(self, session_id=None):
        resp = await self.send_command({
            "type": "delete_session",
            "sessionId": session_id or self.session_id,
        })
        if (session_id or self.session_id) == self.session_id:
            self.session_id = None
        return resp

    async def chat(self, message, on_token=None, on_tool=None):
        """
        Send a prompt and stream results back.
        Returns { "text": str, "tool_calls": list, "session_id": str }
        """
        result = {"text": "", "tool_calls": [], "session_id": self.session_id}
        done_event = asyncio.get_event_loop().create_future()

        def token_handler(t):
            result["text"] += t
            if on_token:
                on_token(t)

        def tool_handler(t):
            result["tool_calls"].append(t)
            if on_tool:
                on_tool(t)

        def done_handler(_event):
            if not done_event.done():
                done_event.set_result(None)

        self.on("token", token_handler)
        self.on("tool_start", tool_handler)
        self.on("agent_end", done_handler)

        try:
            await self.send_command({"type": "prompt", "message": message})
            await asyncio.wait_for(done_event, timeout=120)
        finally:
            self.off("token", token_handler)
            self.off("tool_start", tool_handler)
            self.off("agent_end", done_handler)

        return result

    async def send_extension_ui_response(self, request_id, response):
        """Send response to an extension UI dialog."""
        if not self.ws:
            return
        await self.ws.send(json.dumps({
            "type": "extension_ui_response",
            "requestId": request_id,
            "response": response,
        }))

    async def abort(self):
        return await self.send_command({"type": "abort"})


# ── Demo ──────────────────────────────────────────────────
async def _demo():
    import sys

    args = sys.argv[1:]
    url = "ws://localhost:8080"
    message = "say hello in one sentence"

    i = 0
    while i < len(args):
        if args[i] == "--url" and i + 1 < len(args):
            url = args[i + 1]
            i += 2
        elif args[i] == "--key":
            i += 2
        else:
            message = " ".join(args[i:])
            break

    client = PiRemoteWS(url)

    print(f"Connecting to {url}...")
    welcome = await client.connect()
    print(
        f"Connected! Session: {welcome['sessionId']}, "
        f"Server: {welcome['serverVersion']}\n"
    )

    # Health check
    health = await client.health()
    print(
        f"Health: {health['status']}, {health['sessions']} sessions, "
        f"{health['wsClients']} WS clients\n"
    )

    # Chat with streaming
    print(f"> {message}\n")
    client.on("token", lambda t: print(t, end="", flush=True))
    client.on("tool_start", lambda t: print(f"\n[Tool: {t['tool']}]"))

    result = await client.chat(message)
    print(f"\n\nDone. {len(result['tool_calls'])} tool calls.")

    await client.close()


if __name__ == "__main__":
    asyncio.run(_demo())
