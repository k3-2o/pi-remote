"""
pi-remote Python client — minimal SSE parser. Copy-paste into your project.

    client = PiRemote("http://localhost:8080")
    result = client.chat("fix the bug in auth.ts")
    print(result["text"])

No pip install beyond `requests`.
"""

import sys, json

try:
    import requests
except ImportError:
    print("pip install requests", file=sys.stderr); sys.exit(1)

class PiRemote:
    def __init__(self, url="http://localhost:8080", api_key=None):
        self.url = url.rstrip("/")
        self.api_key = api_key

    def _headers(self):
        h = {"Content-Type": "application/json"}
        if self.api_key: h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def health(self):
        return requests.get(f"{self.url}/v1/health", headers=self._headers()).json()

    def session(self):
        return requests.post(f"{self.url}/v1/sessions", json={}, headers=self._headers()).json()

    def chat(self, message, session_id=None, on_token=None, on_tool=None):
        """Send a prompt, stream SSE, return dict with text + tool_calls."""
        body = {"message": message}
        if session_id: body["sessionId"] = session_id

        r = requests.post(f"{self.url}/v1/chat", json=body, headers=self._headers(), stream=True)

        result = {"text": "", "tool_calls": []}
        current_event = None

        for line in r.iter_lines(decode_unicode=True):
            if not line: continue
            if line.startswith("event: "):
                current_event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if current_event == "token":
                    t = data.get("text", ""); result["text"] += t
                    sys.stdout.write(t); sys.stdout.flush()
                    if on_token: on_token(t)
                elif current_event == "tool_start":
                    call = {"name": data.get("tool"), "args": data.get("args")}
                    result["tool_calls"].append(call)
                    if on_tool: on_tool(call)
                elif current_event == "done":
                    result["session_id"] = data.get("sessionId")
                    break

        sys.stdout.write("\n"); sys.stdout.flush()
        return result


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="pi-remote chat")
    p.add_argument("prompt", nargs="?", default="say hello")
    p.add_argument("--url", default="http://localhost:8080")
    p.add_argument("--key", default=None)
    args = p.parse_args()
    client = PiRemote(args.url, args.key)
    print(f"pi-remote {args.url} — {client.health()['status']}\n")
    client.chat(args.prompt)
