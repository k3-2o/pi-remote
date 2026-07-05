/**
 * Command Router — maps Pi RPC command types to handler functions.
 *
 * Pattern stolen from tryingET/pi-server (MIT license).
 * Each handler is a pure function: (adapter, command) => Response
 *
 * This replaces a giant switch statement with O(1) dispatch.
 * Adding a new command = write handler + register in the map.
 */

import type { RpcAdapter } from "./rpc-adapter.js";
import type { SessionCommand, RpcResponse } from "./types.js";

// ============================================================================
// HANDLER TYPE
// ============================================================================

export type CommandHandler = (
  adapter: RpcAdapter,
  command: SessionCommand & { id?: string },
) => Promise<RpcResponse> | RpcResponse;

// ============================================================================
// GENERIC HANDLER: forward command to Pi, return response
// ============================================================================

/**
 * Sends a command to Pi's RPC and returns the response as-is.
 * Used for commands that Pi handles directly (most of them).
 */
function forwardToPi(
  adapter: RpcAdapter,
  command: SessionCommand & { id?: string },
): Promise<RpcResponse> {
  return adapter.sendCommand(
    command as Record<string, unknown>,
  ) as unknown as Promise<RpcResponse>;
}

// ============================================================================
// HANDLER MAP
// ============================================================================

export const sessionCommandHandlers: Record<string, CommandHandler> = {
  // Core interaction — forward directly to Pi
  prompt: forwardToPi,
  steer: forwardToPi,
  follow_up: forwardToPi,
  abort: forwardToPi,

  // State
  get_state: forwardToPi,
  get_messages: forwardToPi,
  get_session_stats: forwardToPi,

  // Model
  set_model: forwardToPi,
  cycle_model: forwardToPi,
  get_available_models: forwardToPi,

  // Thinking
  set_thinking_level: forwardToPi,
  cycle_thinking_level: forwardToPi,

  // Compaction
  compact: forwardToPi,
  set_auto_compaction: forwardToPi,

  // Bash
  bash: forwardToPi,
  abort_bash: forwardToPi,

  // Session control
  set_session_name: forwardToPi,
  new_session: forwardToPi,
  fork: forwardToPi,
  get_fork_messages: forwardToPi,
  switch_session_file: forwardToPi,

  // Tree navigation
  get_tree: forwardToPi,
  get_entries: forwardToPi,
  get_last_assistant_text: forwardToPi,
  get_context_usage: forwardToPi,

  // Discovery
  get_commands: forwardToPi,

  // Extension UI responses are handled by the ExtensionUIBridge, not forwarded to Pi
  extension_ui_response: async () => ({
    type: "response",
    command: "extension_ui_response",
    success: true,
  }),
};

// ============================================================================
// ROUTING FUNCTION
// ============================================================================

/**
 * Route a session command to the appropriate handler.
 * Returns the response or throws if no handler exists.
 */
export async function routeSessionCommand(
  adapter: RpcAdapter,
  command: SessionCommand & { id?: string },
): Promise<RpcResponse> {
  const handler = sessionCommandHandlers[command.type];
  if (!handler) {
    return {
      id: command.id,
      type: "response",
      command: command.type,
      success: false,
      error: `Unknown command type: ${command.type}`,
    };
  }
  return handler(adapter, command);
}
