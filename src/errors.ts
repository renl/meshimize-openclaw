/**
 * Shared error utilities for the Meshimize OpenClaw plugin.
 *
 * Consolidates successResult/errorResult helpers (previously duplicated in
 * groups.ts, messages.ts, direct-messages.ts, delegations.ts) and provides
 * formatToolError for consistent "Meshimize:"-prefixed user-facing errors.
 */

import { MeshimizeAPIError } from "./api/client.js";

// Re-export ToolResult type for convenience
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
    // Network errors: TypeError from fetch (DNS failure, connection refused, etc.)
    // Also catch ECONNREFUSED-style errors
    if (
      error instanceof TypeError ||
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("ENOTFOUND") ||
      error.message.includes("fetch failed") ||
      error.message.includes("network")
    ) {
      return `Meshimize: Unable to reach server at ${baseUrl}`;
    }

    // Business logic errors from handlers (e.g., "Group not found or is not public.")
    return `Meshimize: ${error.message}`;
  }

  // 3. Unknown thrown value
  return "Meshimize: Unknown error";
}
