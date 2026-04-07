/**
 * Shared error utilities for the Meshimize OpenClaw plugin.
 *
 * Consolidates successResult/errorResult helpers (previously duplicated in
 * groups.ts, messages.ts, direct-messages.ts, delegations.ts) and provides
 * formatToolError for consistent "Meshimize:"-prefixed user-facing errors.
 */

import { MeshimizeAPIError } from "./api/client.js";

// Import ToolResult type for use in return types
import type { ToolResult } from "openclaw/plugin-sdk/types";

/**
 * Consolidated success result helper.
 * Previously duplicated in groups.ts, messages.ts, direct-messages.ts, delegations.ts.
 */
export function successResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Consolidated error result helper.
 */
export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/**
 * Checks whether an error represents a network/transport failure.
 *
 * Matches known network error patterns in the error message, and for
 * TypeErrors (thrown by Node.js fetch), also inspects the `.cause` property
 * where the real network error is wrapped.
 *
 * A plain TypeError like "Cannot read properties of undefined" does NOT match.
 */
function isNetworkError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  const networkPatterns = [
    "econnrefused",
    "enotfound",
    "econnreset",
    "etimedout",
    "fetch failed",
    "network",
  ];

  if (networkPatterns.some((p) => msg.includes(p))) return true;

  // Node fetch() throws TypeError with cause containing the real network error
  if (error instanceof TypeError && error.cause instanceof Error) {
    const causeMsg = error.cause.message.toLowerCase();
    if (networkPatterns.some((p) => causeMsg.includes(p))) return true;
  }

  return false;
}

/**
 * Maps any error thrown during tool execution to a "Meshimize:"-prefixed
 * user-friendly error message.
 *
 * @param error - The caught error (MeshimizeAPIError, Error, or unknown)
 * @param baseUrl - The configured base URL, used for network error messages
 * @returns A formatted error string suitable for errorResult()
 */
export function formatToolError(error: unknown, baseUrl: string): string {
  // 1. MeshimizeAPIError — map by HTTP status
  if (error instanceof MeshimizeAPIError) {
    const status = error.status;

    if (status === 401) {
      return "Meshimize: Invalid or expired API key";
    }

    if (status === 429) {
      return "Meshimize: Rate limit exceeded. Try again later.";
    }

    if (status >= 500) {
      return "Meshimize: Server error";
    }

    // 403, 404, 409, 422 — use server's extracted message
    // MeshimizeAPIError.message already extracts from response body
    return `Meshimize: ${error.message}`;
  }

  // 2. Regular Error — could be network failure or business logic
  if (error instanceof Error) {
    if (isNetworkError(error)) {
      return `Meshimize: Unable to reach server at ${baseUrl}`;
    }

    // Business logic errors from handlers (e.g., "Group not found or is not public.")
    return `Meshimize: ${error.message}`;
  }

  // 3. Unknown thrown value
  return "Meshimize: Unknown error";
}
