#!/usr/bin/env node
/**
 * pi-remote JavaScript client — minimal SSE parser. Copy-paste into your project.
 *
 *   const client = new PiRemote("http://localhost:8080");
 *   const result = await client.chat("fix the bug");
 *   console.log(result.text);
 *
 * No npm install. Node 18+.
 */

class PiRemote {
  constructor(url = "http://localhost:8080", apiKey = null) {
    this.url = url.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  #headers() {
    const h = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  async health() {
    const r = await fetch(`${this.url}/v1/health`, { headers: this.#headers() });
    return r.json();
  }

  async session() {
    const r = await fetch(`${this.url}/v1/sessions`, { method: "POST", headers: this.#headers() });
    return r.json();
  }

  async chat(message, { sessionId, onToken, onTool } = {}) {
    const body = sessionId ? { message, sessionId } : { message };
    const res = await fetch(`${this.url}/v1/chat`, {
      method: "POST", headers: this.#headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const result = { text: "", toolCalls: [] };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", currentEvent = "", finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7);
        } else if (line.startsWith("data: ") && currentEvent === "token") {
          const data = JSON.parse(line.slice(6));
          const t = data.text ?? "";
          result.text += t;
          process.stdout.write(t);
          onToken?.(t);
        } else if (line.startsWith("data: ") && currentEvent === "tool_start") {
          const data = JSON.parse(line.slice(6));
          result.toolCalls.push({ name: data.tool, args: data.args });
          onTool?.({ name: data.tool, args: data.args });
        } else if (line.startsWith("data: ") && currentEvent === "done") {
          finished = true;
          break;
        }
      }
    }

    process.stdout.write("\n");
    return result;
  }
}

// -- demo --
const args = process.argv.slice(2);
let url = "http://localhost:8080";
let prompt = "say hello";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url" && args[i + 1]) url = args[++i];
  else if (args[i] === "--key" && args[i + 1]) args[++i]; // skip key
  else { prompt = args.slice(i).join(" "); break; }
}

const client = new PiRemote(url);
console.log(`pi-remote ${url} — ${(await client.health()).status}\n`);
await client.chat(prompt);
