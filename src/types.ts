/**
 * Core types for pi-server protocol.
 *
 * These types define the wire protocol between pi-server and its clients,
 * the internal command routing, and the session management model.
 *
 * Stolen and adapted from tryingET/pi-server (MIT license).
 */

// ============================================================================
// SESSION INFO
// ============================================================================

export interface SessionInfo {
  sessionId: string;
  sessionName?: string;
  sessionFile?: string;
  model?: { id: string; provider: string };
  thinkingLevel: string;
  isStreaming: boolean;
  messageCount: number;
  createdAt: string;
  active?: boolean; // false = completed one-shot, record kept for history
}

// ============================================================================
// COMMANDS — Union of all possible commands the server accepts
// ============================================================================

/** Commands that manage the server itself (not a specific session) */
export type ServerCommand =
  | { id?: string; type: "list_sessions" }
  | { id?: string; type: "create_session"; sessionId?: string; cwd?: string }
  | { id?: string; type: "delete_session"; sessionId: string }
  | { id?: string; type: "get_health" }
  | { id?: string; type: "get_version" }
  | { id?: string; type: "get_metrics" };

/** Commands that operate within a specific session */
export type SessionCommand =
  // Core interaction
  | {
      id?: string;
      sessionId: string;
      type: "prompt";
      message: string;
      images?: unknown[];
      streamingBehavior?: "steer" | "followUp";
    }
  | {
      id?: string;
      sessionId: string;
      type: "steer";
      message: string;
      images?: unknown[];
    }
  | {
      id?: string;
      sessionId: string;
      type: "follow_up";
      message: string;
      images?: unknown[];
    }
  | { id?: string; sessionId: string; type: "abort" }
  // State
  | { id?: string; sessionId: string; type: "get_state" }
  | { id?: string; sessionId: string; type: "get_messages" }
  | { id?: string; sessionId: string; type: "get_session_stats" }
  // Model
  | {
      id?: string;
      sessionId: string;
      type: "set_model";
      provider: string;
      modelId: string;
    }
  | { id?: string; sessionId: string; type: "cycle_model" }
  | { id?: string; sessionId: string; type: "get_available_models" }
  // Thinking
  | {
      id?: string;
      sessionId: string;
      type: "set_thinking_level";
      level: string;
    }
  | { id?: string; sessionId: string; type: "cycle_thinking_level" }
  // Compaction
  | {
      id?: string;
      sessionId: string;
      type: "compact";
      customInstructions?: string;
    }
  | {
      id?: string;
      sessionId: string;
      type: "set_auto_compaction";
      enabled: boolean;
    }
  // Bash
  | { id?: string; sessionId: string; type: "bash"; command: string }
  | { id?: string; sessionId: string; type: "abort_bash" }
  // Session control
  | { id?: string; sessionId: string; type: "set_session_name"; name: string }
  | {
      id?: string;
      sessionId: string;
      type: "new_session";
      parentSession?: string;
    }
  | { id?: string; sessionId: string; type: "fork"; entryId: string }
  | { id?: string; sessionId: string; type: "get_fork_messages" }
  | {
      id?: string;
      sessionId: string;
      type: "switch_session_file";
      sessionPath: string;
    }
  // Tree navigation
  | { id?: string; sessionId: string; type: "get_tree" }
  | { id?: string; sessionId: string; type: "get_entries"; since?: string }
  | { id?: string; sessionId: string; type: "get_last_assistant_text" }
  | { id?: string; sessionId: string; type: "get_context_usage" }
  // Discovery
  | { id?: string; sessionId: string; type: "get_commands" }
  // Extension UI response
  | {
      id?: string;
      sessionId: string;
      type: "extension_ui_response";
      requestId: string;
      response: ExtensionUIResponseValue;
    };

export type ExtensionUIResponseValue =
  | { method: "select"; value: string }
  | { method: "confirm"; confirmed: boolean }
  | { method: "input"; value: string }
  | { method: "editor"; value: string }
  | { method: "cancelled" };

export type RpcCommand = (ServerCommand | SessionCommand) & {
  /** Idempotency key for replay-safe retries */
  idempotencyKey?: string;
};

// ============================================================================
// RESPONSES
// ============================================================================

export interface RpcResponseBase {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  error?: string;
  replayed?: boolean;
  timedOut?: boolean;
}

export type RpcResponse = RpcResponseBase & {
  data?: unknown;
};

// ============================================================================
// EVENTS — Streamed from pi-server to clients
// ============================================================================

export interface RpcEvent {
  type: "event";
  sessionId: string;
  event: unknown; // AgentSessionEvent — opaque, relayed as-is
}

export interface ServerEvent {
  type: "server_ready";
  data: {
    serverVersion: string;
    protocolVersion: string;
    transports: string[];
  };
}

export interface ServerShutdownEvent {
  type: "server_shutdown";
  data: { reason: string; timeoutMs: number };
}

export type RpcBroadcast = RpcEvent | ServerEvent | ServerShutdownEvent;

// ============================================================================
// SUBSCRIBER — A client connected to pi-server
// ============================================================================

export interface Subscriber {
  send: (data: string) => void;
  subscribedSessions: Set<string>;
  identity?: string;
}

// ============================================================================
// WEB-SPECIFIC PROTOCOL TYPES
// ============================================================================

export interface HelloMessage {
  type: "hello";
  protocolVersion: number;
  clientId: string;
  lastSeq?: number;
  /** Per-session system prompt passed as --system-prompt to this session's Pi process */
  systemPrompt?: string;
  /** Per-session append system prompt(s) passed as --append-system-prompt to this session's Pi process */
  appendSystemPrompt?: string[];
}

export interface WelcomeMessage {
  type: "welcome";
  protocolVersion: number;
  serverVersion: string;
  sessions: SessionInfo[];
  currentSeq: number;
}

// ============================================================================
// CONFIG
// ============================================================================

export interface ServerConfig {
  port: number;
  host: string;
  maxSessions: number;
  sessionTimeout: number; // seconds, 0 = never
  logLevel: "debug" | "info" | "warn" | "error";
  piCommand: string;
  piArgs: string[];
  auth: {
    enabled: boolean;
    apiKeys: string[];
  };
  /** Session reset policy — prevents context window pileup in long-lived sessions */
  sessionReset: {
    /** "idle" = reset after inactivity, "none" = never reset */
    mode: "idle" | "none";
    /** Minutes of inactivity before idle reset. Ignored when mode != "idle". */
    idleMinutes: number;
  };
  server: {
    heartbeatInterval: number;
    heartbeatTimeout: number;
    backpressureThreshold: number;
    backpressureCritical: number;
    shutdownTimeout: number;
  };
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: 8080,
  host: "0.0.0.0",
  maxSessions: 10,
  sessionTimeout: 1800,
  logLevel: "info",
  piCommand: "pi",
  piArgs: ["--mode", "rpc", "--no-session"],
  auth: {
    enabled: false,
    apiKeys: [],
  },
  sessionReset: {
    mode: "idle",
    idleMinutes: 30,
  },
  server: {
    heartbeatInterval: 30000,
    heartbeatTimeout: 10000,
    backpressureThreshold: 65536,
    backpressureCritical: 1048576,
    shutdownTimeout: 30000,
  },
};

// ============================================================================
// LOG LEVELS
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
