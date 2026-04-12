/**
 * Delegation tools for the Meshimize OpenClaw plugin.
 *
 * Registers 8 tools via `api.registerTool()`:
 *   - meshimize_create_delegation
 *   - meshimize_list_delegations
 *   - meshimize_get_delegation
 *   - meshimize_accept_delegation
 *   - meshimize_complete_delegation
 *   - meshimize_cancel_delegation
 *   - meshimize_acknowledge_delegation
 *   - meshimize_extend_delegation
 *
 * Adapted from meshimize-mcp/src/tools/delegations.ts with all MCP-specific
 * state removed. Uses enrichWithBuffer pattern for content fallback.
 */

import { Type } from "@sinclair/typebox";
import type { PluginAPI } from "openclaw/plugin-sdk/types";
import type { MeshimizeAPI } from "../api/client.js";
import type { Delegation, DelegationState, DelegationRoleFilter } from "../types/delegations.js";
import type { DelegationContentBuffer } from "../buffer/delegation-content-buffer.js";
import { successResult, errorResult, formatToolError } from "../errors.js";

// ---------------------------------------------------------------------------
// Dependencies interface
// ---------------------------------------------------------------------------

export interface DelegationToolDeps {
  api: MeshimizeAPI;
  delegationBuffer: DelegationContentBuffer;
}

// ---------------------------------------------------------------------------
// Content enrichment helpers
// ---------------------------------------------------------------------------

/** States where content has been intentionally purged server-side. */
const PURGED_STATES: ReadonlySet<DelegationState> = new Set<DelegationState>([
  "acknowledged",
  "expired",
]);

/**
 * Enriches a delegation with content from the local buffer when the server
 * returns null for content fields. Clears buffer entries for purged states.
 */
export function enrichWithBuffer(
  delegation: Delegation,
  buffer: DelegationContentBuffer,
): Delegation {
  if (PURGED_STATES.has(delegation.state)) {
    buffer.delete(delegation.id);
    return delegation;
  }
  const content = buffer.get(delegation.id);
  if (!content) return delegation;
  return {
    ...delegation,
    description:
      delegation.description === null ? (content.description ?? null) : delegation.description,
    result: delegation.result === null ? (content.result ?? null) : delegation.result,
  };
}

// ---------------------------------------------------------------------------
// Handler functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Creates a new delegation in a group.
 */
export async function createDelegationHandler(
  args: {
    group_id: string;
    description: string;
    target_account_id?: string;
    ttl_seconds?: number;
  },
  deps: DelegationToolDeps,
) {
  const body: {
    group_id: string;
    description: string;
    target_account_id?: string;
    ttl_seconds?: number;
  } = {
    group_id: args.group_id,
    description: args.description,
  };

  if (args.target_account_id !== undefined) {
    body.target_account_id = args.target_account_id;
  }
  if (args.ttl_seconds !== undefined) {
    body.ttl_seconds = args.ttl_seconds;
  }

  const result = await deps.api.createDelegation(body);

  if (result.data.description !== null) {
    deps.delegationBuffer.storeDescription(result.data.id, result.data.description);
  }

  return { delegation: result.data };
}

/**
 * Lists delegations with optional filters.
 * Enriches each delegation with buffer content when server returns null.
 */
export async function listDelegationsHandler(
  args: {
    group_id?: string;
    state?: DelegationState;
    role?: DelegationRoleFilter;
    limit?: number;
    after?: string;
  },
  deps: DelegationToolDeps,
) {
  const result = await deps.api.listDelegations({
    group_id: args.group_id,
    state: args.state,
    role: args.role,
    limit: args.limit,
    after: args.after,
  });

  const enriched = result.data.map((d) => enrichWithBuffer(d, deps.delegationBuffer));

  return { delegations: enriched, meta: result.meta };
}

/**
 * Gets a single delegation by ID.
 * Enriches with buffer content when server returns null.
 */
export async function getDelegationHandler(
  args: { delegation_id: string },
  deps: DelegationToolDeps,
) {
  const result = await deps.api.getDelegation(args.delegation_id);
  const enriched = enrichWithBuffer(result.data, deps.delegationBuffer);
  return { delegation: enriched };
}

/**
 * Accepts a pending delegation.
 */
export async function acceptDelegationHandler(
  args: { delegation_id: string },
  deps: DelegationToolDeps,
) {
  const result = await deps.api.acceptDelegation(args.delegation_id);
  return { delegation: result.data };
}

/**
 * Completes an accepted delegation with a result.
 */
export async function completeDelegationHandler(
  args: { delegation_id: string; result: string },
  deps: DelegationToolDeps,
) {
  const apiResult = await deps.api.completeDelegation(args.delegation_id, {
    result: args.result,
  });

  if (apiResult.data.result !== null) {
    deps.delegationBuffer.storeResult(apiResult.data.id, apiResult.data.result);
  }

  return { delegation: apiResult.data };
}

/**
 * Cancels a delegation. Only the sender can cancel.
 */
export async function cancelDelegationHandler(
  args: { delegation_id: string },
  deps: DelegationToolDeps,
) {
  const result = await deps.api.cancelDelegation(args.delegation_id);
  return { delegation: result.data };
}

/**
 * Acknowledges a completed delegation. Purges content from buffer.
 */
export async function acknowledgeDelegationHandler(
  args: { delegation_id: string },
  deps: DelegationToolDeps,
) {
  const result = await deps.api.acknowledgeDelegation(args.delegation_id);
  deps.delegationBuffer.delete(result.data.id);
  return { delegation: result.data };
}

/**
 * Extends the TTL of a delegation. Optionally provides a custom TTL.
 */
export async function extendDelegationHandler(
  args: { delegation_id: string; ttl_seconds?: number },
  deps: DelegationToolDeps,
) {
  const body = args.ttl_seconds !== undefined ? { ttl_seconds: args.ttl_seconds } : undefined;
  const result = await deps.api.extendDelegation(args.delegation_id, body);
  return { delegation: result.data };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Registers all 8 delegation tools with the OpenClaw Gateway.
 * Tool descriptions copied exactly from architecture §2.4.
 */
export function registerDelegationTools(api: PluginAPI, deps: DelegationToolDeps): void {
  // --- meshimize_create_delegation ---
  api.registerTool({
    name: "meshimize_create_delegation",
    description:
      "Create a new delegation in a group. The sender is automatically set to the authenticated account. The description is persisted server-side with lifecycle-tied cleanup (purged on acknowledge or TTL expiry).",
    parameters: Type.Object({
      group_id: Type.String({
        format: "uuid",
        description: "The UUID of the group",
      }),
      description: Type.String({
        minLength: 1,
        maxLength: 32000,
        description: "Description of the delegated task",
      }),
      target_account_id: Type.Optional(
        Type.String({
          format: "uuid",
          description: "Optional UUID of the target account to assign the delegation to",
        }),
      ),
      ttl_seconds: Type.Optional(
        Type.Integer({
          minimum: 300,
          maximum: 604800,
          description: "Time-to-live in seconds (300\u2013604800). Defaults to server setting.",
        }),
      ),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await createDelegationHandler(
          args as {
            group_id: string;
            description: string;
            target_account_id?: string;
            ttl_seconds?: number;
          },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_list_delegations ---
  api.registerTool({
    name: "meshimize_list_delegations",
    description:
      "List delegations with optional filters. Returns delegations from the server with content included. Local buffer provides fallback enrichment when server returns null for content fields.",
    parameters: Type.Object({
      group_id: Type.Optional(
        Type.String({
          format: "uuid",
          description: "Filter by group UUID",
        }),
      ),
      state: Type.Optional(
        Type.Union(
          [
            Type.Literal("pending"),
            Type.Literal("accepted"),
            Type.Literal("completed"),
            Type.Literal("acknowledged"),
            Type.Literal("cancelled"),
            Type.Literal("expired"),
          ],
          { description: "Filter by delegation state" },
        ),
      ),
      role: Type.Optional(
        Type.Union([Type.Literal("sender"), Type.Literal("assignee"), Type.Literal("available")], {
          description: "Filter by role relative to the authenticated account",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 100,
          default: 50,
          description: "Max delegations to return",
        }),
      ),
      after: Type.Optional(
        Type.String({
          format: "uuid",
          description: "Cursor for pagination",
        }),
      ),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await listDelegationsHandler(
          args as {
            group_id?: string;
            state?: DelegationState;
            role?: DelegationRoleFilter;
            limit?: number;
            after?: string;
          },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_get_delegation ---
  api.registerTool({
    name: "meshimize_get_delegation",
    description:
      "Get a single delegation by ID. Returns delegation from server with content included. Local buffer provides fallback enrichment when server returns null for content fields.",
    parameters: Type.Object({
      delegation_id: Type.String({
        format: "uuid",
        description: "The UUID of the delegation",
      }),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await getDelegationHandler(args as { delegation_id: string }, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_accept_delegation ---
  api.registerTool({
    name: "meshimize_accept_delegation",
    description:
      "Accept a pending delegation. Only the target account (if set) or any group member (if no target) can accept.",
    parameters: Type.Object({
      delegation_id: Type.String({
        format: "uuid",
        description: "The UUID of the delegation to accept",
      }),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await acceptDelegationHandler(args as { delegation_id: string }, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_complete_delegation ---
  api.registerTool({
    name: "meshimize_complete_delegation",
    description:
      "Complete an accepted delegation with a result. The result is persisted server-side with lifecycle-tied cleanup (purged on acknowledge or TTL expiry).",
    parameters: Type.Object({
      delegation_id: Type.String({
        format: "uuid",
        description: "The UUID of the delegation to complete",
      }),
      result: Type.String({
        minLength: 1,
        maxLength: 32000,
        description: "The result of the delegation",
      }),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await completeDelegationHandler(
          args as { delegation_id: string; result: string },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_cancel_delegation ---
  api.registerTool({
    name: "meshimize_cancel_delegation",
    description:
      "Cancel a delegation. Only the sender can cancel a pending or accepted delegation.",
    parameters: Type.Object({
      delegation_id: Type.String({
        format: "uuid",
        description: "The UUID of the delegation to cancel",
      }),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await cancelDelegationHandler(args as { delegation_id: string }, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_acknowledge_delegation ---
  api.registerTool({
    name: "meshimize_acknowledge_delegation",
    description:
      "Acknowledge a completed delegation. Only the sender can call. Transitions to 'acknowledged' state and purges description/result content. Clears the local content buffer for this delegation.",
    parameters: Type.Object({
      delegation_id: Type.String({
        format: "uuid",
        description: "The UUID of the delegation to acknowledge",
      }),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await acknowledgeDelegationHandler(args as { delegation_id: string }, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_extend_delegation ---
  api.registerTool({
    name: "meshimize_extend_delegation",
    description:
      "Extend the TTL of a delegation. Only the sender can call. Works on pending, accepted, or completed delegations. If ttl_seconds is provided, adds that many seconds to the current expires_at. If omitted, resets expires_at to now + original_ttl_seconds.",
    parameters: Type.Object({
      delegation_id: Type.String({
        format: "uuid",
        description: "The UUID of the delegation",
      }),
      ttl_seconds: Type.Optional(
        Type.Integer({
          minimum: 300,
          maximum: 604800,
          description:
            "Seconds to add to current expires_at. If omitted, resets to now + original_ttl_seconds.",
        }),
      ),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await extendDelegationHandler(
          args as { delegation_id: string; ttl_seconds?: number },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });
}
