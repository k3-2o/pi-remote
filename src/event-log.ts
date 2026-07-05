/**
 * EventLog — append-only JSONL log of every significant server event.
 *
 * Lives at ~/.pi/pi-remote/events.jsonl
 * One JSON object per line. Human-readable with jq. Machine-replayable.
 *
 * Purpose:
 *   - pi-remote logs → tail -f equivalent
 *   - attach TUI → reconstruct session history on connect
 *   - future chrollo-lite → memory layer from past conversations
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const LOG_DIR = resolve(homedir(), ".pi", "pi-remote");
const LOG_FILE = resolve(LOG_DIR, "events.jsonl");

export class EventLog {
  private static ensured = false;

  /** Ensure the log directory and file exist. */
  static ensure(): void {
    if (this.ensured) return;
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    this.ensured = true;
  }

  /** Get the log file path. */
  static get path(): string {
    return LOG_FILE;
  }

  /** Append an event to the log. Best-effort — failures are silent. */
  static append(event: Record<string, unknown>): void {
    this.ensure();
    try {
      const entry = {
        ts: new Date().toISOString(),
        ...event,
      };
      appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // Best-effort. Don't crash the server for a log write failure.
    }
  }

  /** Read the last N lines from the log. */
  static tail(n = 50): string[] {
    this.ensure();
    try {
      if (!existsSync(LOG_FILE)) return [];
      const content = readFileSync(LOG_FILE, "utf-8");
      const lines = content.trim().split("\n");
      return lines.slice(-n);
    } catch {
      return [];
    }
  }
}
