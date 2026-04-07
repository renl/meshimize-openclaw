/**
 * Direct message tools for the Meshimize OpenClaw plugin.
 *
 * Registers 2 tools via `api.registerTool()`:
 *   - meshimize_send_direct_message
 *   - meshimize_get_direct_messages
 *
 * Adapted from meshimize-mcp/src/tools/direct-messages.ts with all MCP-specific
 * state removed.
 */

import type { PluginAPI } from "openclaw/plugin-sdk/types";
import type { MeshimizeAPI } from "../api/client.js";
import type { MessageBuffer } from "../buffer/message-buffer.js";
import { successResult, errorResult, formatToolError } from "../errors.js";

// ---------------------------------------------------------------------------
// Dependencies interface
// ---------------------------------------------------------------------------

export interface DirectMessageToolDeps {
  api: MeshimizeAPI;
  messageBuffer: MessageBuffer;
}

// ---------------------------------------------------------------------------
// Handler functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Sends a private direct message to another account.
 */
export async function sendDirectMessageHandler(
  args: { recipient_account_id: string; content: string },
  deps: DirectMessageToolDeps,
) {
  const result = await deps.api.sendDirectMessage({
    recipient_account_id: args.recipient_account_id,
    content: args.content,
  });

  return { message: result.data };
}

/**
 * Retrieves direct messages sent to you.
 * Checks buffer first (full content), falls back to REST API (metadata only).
 */
export async function getDirectMessagesHandler(
  args: { after_message_id?: string; limit?: number },
  deps: DirectMessageToolDeps,
) {
  const buffered = deps.messageBuffer.getDirectMessages({
    afterMessageId: args.after_message_id,
    limit: args.limit,
  });

  if (buffered.length > 0) {
    return { messages: buffered, source: "buffer", has_more: false };
  }

  const result = await deps.api.getDirectMessages({
    after: args.after_message_id,
    limit: args.limit,
  });

  return { messages: result.data, source: "api", has_more: result.meta.has_more };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Registers all 2 direct message tools with the OpenClaw Gateway.
 * Tool descriptions copied exactly from architecture §2.3.
 */
export function registerDirectMessageTools(api: PluginAPI, deps: DirectMessageToolDeps): void {
  // --- meshimize_send_direct_message ---
  api.registerTool({
    name: "meshimize_send_direct_message",
    description: "Send a private direct message to another account.",
    parameters: {
      type: "object",
      properties: {
        recipient_account_id: {
          type: "string",
          format: "uuid",
          description: "The UUID of the account to message",
        },
        content: {
          type: "string",
          minLength: 1,
          maxLength: 32000,
          description: "The message content",
        },
      },
      required: ["recipient_account_id", "content"],
    },
    execute: async (args) => {
      try {
        const result = await sendDirectMessageHandler(
          args as { recipient_account_id: string; content: string },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_get_direct_messages ---
  api.registerTool({
    name: "meshimize_get_direct_messages",
    description:
      "Retrieve direct messages sent to you. Reads from local buffer first (includes full content). Falls back to server API (metadata only).",
    parameters: {
      type: "object",
      properties: {
        after_message_id: {
          type: "string",
          format: "uuid",
          description: "Return messages after this message ID",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 50,
          description: "Max messages to return",
        },
      },
    },
    execute: async (args) => {
      try {
        const result = await getDirectMessagesHandler(
          args as { after_message_id?: string; limit?: number },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });
}
