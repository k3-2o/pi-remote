/**
 * SessionManager — manages logical session lifecycle.
 *
 * Each session maps to one PiProcess (managed by PiProcessManager).
 * Sessions have metadata (createdAt, messageCount, etc.) kept in-memory.
 * Session IDs are nanoid-based, URL-safe, collision-resistant.
 */

import { nanoid } from "nanoid";
import type { PiProcessManager } from "./process-manager.js";
import type { PiProcess } from "./pi-process.js";
import type { Logger } from "./logger.js";
import type { SessionInfo } from "./types.js";
import { SessionNotFoundError } from "./errors.js";
import { EventLog } from "./event-log.js";

export interface SessionRecord {
  sessionId: string;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  isStreaming: boolean;
  sessionName?: string;
  active: boolean; // false = Pi process freed, record kept for history
}

export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private processManager: PiProcessManager;
  private logger: Logger;

  constructor(options: { logger: Logger; processManager: PiProcessManager }) {
    this.logger = options.logger;
    this.processManager = options.processManager;
  }

  /**
   * Create a new session.
   */
  async create(sessionId?: string, _cwd?: string): Promise<SessionInfo> {
    const id = sessionId ?? nanoid();

    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} already exists`);
    }

    // Create the Pi process (starts Pi in RPC mode)
    await this.processManager.getOrCreate(id);

    const record: SessionRecord = {
      sessionId: id,
      createdAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
      isStreaming: false,
      active: true,
    };

    this.sessions.set(id, record);

    EventLog.append({
      event: "session_created",
      sessionId: id,
      messageCount: 0,
    });

    this.logger.info("Session created", { sessionId: id });

    return this.toSessionInfo(record);
  }

  /**
   * Get a session by ID.
   */
  get(sessionId: string): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
    return session;
  }

  /**
   * Get or create a session. If no sessionId provided, creates a new one.
   * If sessionId provided and doesn't exist, creates it.
   */
  async getOrCreate(
    sessionId?: string,
  ): Promise<{ sessionId: string; created: boolean }> {
    if (sessionId && this.sessions.has(sessionId)) {
      this.sessions.get(sessionId)!.lastActivity = new Date();
      return { sessionId, created: false };
    }

    const id = sessionId ?? nanoid();
    await this.create(id);
    return { sessionId: id, created: true };
  }

  /**
   * Get the Pi process for a session.
   */
  async getProcess(sessionId: string): Promise<PiProcess> {
    if (!this.sessions.has(sessionId)) {
      throw new SessionNotFoundError(sessionId);
    }
    return this.processManager.getOrCreate(sessionId);
  }

  /**
   * Create a session on WebSocket connect. No explicit POST needed.
   * Connection IS the session. Returns sessionId for the welcome message.
   */
  async createOnConnect(): Promise<SessionInfo> {
    return this.create();
  }

  /**
   * Handle WebSocket disconnect — deactivate session, free Pi process, keep record.
   */
  async onDisconnect(sessionId: string): Promise<void> {
    await this.deactivate(sessionId);
  }

  /**
   * Deactivate a session — stop its Pi process but keep the record.
   * Used for one-shot chats and WS disconnects: free resources, preserve history.
   */
  async deactivate(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) return;

    // Mark as not streaming, stop Pi process
    const record = this.sessions.get(sessionId)!;
    record.isStreaming = false;
    record.active = false;
    await this.processManager.remove(sessionId);
    EventLog.append({ event: "session_deactivated", sessionId });
    this.logger.info("Session deactivated (process freed, record kept)", {
      sessionId,
    });
  }

  /**
   * Delete a session — stops process AND removes record.
   */
  async delete(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      throw new SessionNotFoundError(sessionId);
    }

    this.sessions.delete(sessionId);
    await this.processManager.remove(sessionId);

    EventLog.append({ event: "session_deleted", sessionId });

    this.logger.info("Session deleted", { sessionId });
  }

  /**
   * List all sessions.
   */
  list(): SessionInfo[] {
    return [...this.sessions.values()].map((r) => this.toSessionInfo(r));
  }

  /**
   * Get session info by ID.
   */
  getInfo(sessionId: string): SessionInfo | undefined {
    const record = this.sessions.get(sessionId);
    return record ? this.toSessionInfo(record) : undefined;
  }

  /**
   * Update streaming status.
   */
  setStreaming(sessionId: string, isStreaming: boolean): void {
    const record = this.sessions.get(sessionId);
    if (record) {
      record.isStreaming = isStreaming;
    }
  }

  /**
   * Increment message count.
   */
  incrementMessages(sessionId: string, count: number = 1): void {
    const record = this.sessions.get(sessionId);
    if (record) {
      record.messageCount += count;
    }
  }

  /**
   * Get total number of running sessions.
   */
  get count(): number {
    return this.sessions.size;
  }

  /**
   * Convert internal record to SessionInfo.
   */
  private toSessionInfo(record: SessionRecord): SessionInfo {
    return {
      sessionId: record.sessionId,
      sessionName: record.sessionName,
      isStreaming: record.isStreaming,
      messageCount: record.messageCount,
      createdAt: record.createdAt.toISOString(),
      active: record.active,
      thinkingLevel: "medium",
    };
  }
}
