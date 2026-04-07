/**
 * Group & membership tools for the Meshimize OpenClaw plugin.
 *
 * Registers 7 tools via `api.registerTool()`:
 *   - meshimize_search_groups
 *   - meshimize_list_my_groups
 *   - meshimize_join_group
 *   - meshimize_approve_join
 *   - meshimize_reject_join
 *   - meshimize_list_pending_joins
 *   - meshimize_leave_group
 *
 * Adapted from meshimize-mcp/src/tools/groups.ts with all MCP-specific
 * state removed (authority lookups, membership paths, workflow recorder,
 * authority session context).
 */

import type { PluginAPI } from "openclaw/plugin-sdk/types";
import type { MeshimizeAPI } from "../api/client.js";
import type { PendingJoinMap } from "../state/pending-joins.js";
import type { WsService } from "../services/ws-manager.js";
import type { GroupResponse } from "../types/groups.js";
import { successResult, errorResult, formatToolError } from "../errors.js";

// ---------------------------------------------------------------------------
// Dependencies interface
// ---------------------------------------------------------------------------

export interface GroupToolDeps {
  api: MeshimizeAPI;
  pendingJoins: PendingJoinMap;
  wsService: WsService;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Paginates through the authenticated account's groups to find one by ID.
 * Ported from meshimize-mcp/src/tools/my-groups.ts.
 */
export async function findMyGroupById(
  api: Pick<MeshimizeAPI, "getMyGroups">,
  groupId: string,
): Promise<GroupResponse | null> {
  let after: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await api.getMyGroups({ limit: 100, after });
    const group = page.data.find((candidate) => candidate.id === groupId);

    if (group) {
      return group;
    }

    hasMore = page.meta.has_more && page.meta.next_cursor !== null;
    after = page.meta.next_cursor ?? undefined;
  }

  return null;
}

/**
 * Builds the minimal group object stored in pending join responses.
 * Ported from meshimize-mcp/src/tools/groups.ts lines 9-25.
 */
function buildPendingJoinGroup(group: {
  id: string;
  name: string;
  description: string | null;
  type: "open_discussion" | "qa" | "announcement";
  owner_name: string;
  owner_verified: boolean;
}) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    type: group.type,
    owner_name: group.owner_name,
    owner_verified: group.owner_verified,
  };
}

// ---------------------------------------------------------------------------
// Handler functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Searches public groups with optional keyword and type filters.
 * Enriches results with membership info via parallel REST call.
 */
export async function searchGroupsHandler(
  args: { query?: string; type?: "open_discussion" | "qa" | "announcement"; limit?: number },
  deps: GroupToolDeps,
) {
  const [searchResult, myGroupsResult] = await Promise.all([
    deps.api.searchGroups({
      q: args.query,
      type: args.type,
      limit: args.limit,
    }),
    deps.api.getMyGroups({ limit: 100 }).catch(() => null),
  ]);

  const myGroups = myGroupsResult?.data ?? [];
  const memberIdSet = new Set<string>(myGroups.map((g) => g.id));
  const roleMap = new Map<string, string | null>(myGroups.map((g) => [g.id, g.my_role]));

  return {
    groups: searchResult.data.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      type: g.type,
      owner: g.owner.display_name,
      owner_verified: g.owner.verified,
      member_count: g.member_count,
      is_member: memberIdSet.has(g.id),
      my_role: roleMap.get(g.id) ?? null,
    })),
    has_more: searchResult.meta.has_more,
  };
}

/**
 * Lists all groups the current account is a member of.
 */
export async function listMyGroupsHandler(_args: Record<string, never>, deps: GroupToolDeps) {
  const result = await deps.api.getMyGroups({ limit: 100 });
  return {
    groups: result.data.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      type: g.type,
      my_role: g.my_role,
      member_count: g.member_count,
    })),
  };
}

/**
 * Creates a pending join request for operator approval.
 * Does NOT call the server join endpoint — that happens in approveJoinHandler.
 */
export async function joinGroupHandler(args: { group_id: string }, deps: GroupToolDeps) {
  const existing = deps.pendingJoins.getByGroupId(args.group_id);
  if (existing) {
    return {
      status: "already_pending",
      pending_request_id: existing.id,
      group: buildPendingJoinGroup({
        id: existing.group_id,
        name: existing.group_name,
        description: existing.group_description,
        type: existing.group_type,
        owner_name: existing.owner_display_name,
        owner_verified: existing.owner_verified,
      }),
      message:
        "A join request for this group is already pending operator approval. " +
        "Ask your operator to approve it, then call `meshimize_approve_join`.",
    };
  }

  const membership = await findMyGroupById(deps.api, args.group_id);
  if (membership) {
    const resolvedRole = membership.my_role ?? "member";
    return {
      status: "already_member",
      group_id: membership.id,
      role: resolvedRole,
      message: `You are already a ${resolvedRole} of group "${membership.name}".`,
    };
  }

  const groupsResult = await deps.api.searchGroups({ limit: 100 });
  const group = groupsResult.data.find((g) => g.id === args.group_id);
  if (!group) {
    throw new Error("Group not found or is not public.");
  }

  const pending = deps.pendingJoins.add({
    id: group.id,
    name: group.name,
    description: group.description,
    type: group.type,
    owner: group.owner,
  });

  const expiresIn = Math.round((new Date(pending.expires_at).getTime() - Date.now()) / 60000);

  return {
    status: "pending_operator_approval",
    pending_request_id: pending.id,
    group: buildPendingJoinGroup({
      id: group.id,
      name: group.name,
      description: group.description,
      type: group.type,
      owner_name: group.owner.display_name,
      owner_verified: group.owner.verified,
    }),
    message:
      `Join request created for group "${group.name}" (${group.type}, ` +
      `${group.member_count} members, owned by ${group.owner.display_name}` +
      `${group.owner.verified ? " \u2713" : ""}). ` +
      "Please ask your operator for approval. " +
      "Once they approve, call `meshimize_approve_join` with this group_id to complete the join. " +
      `This request expires in ${expiresIn} minute${expiresIn !== 1 ? "s" : ""}.`,
  };
}

/**
 * Completes a pending join after operator approval.
 * Calls POST /groups/:group_id/join and subscribes to the WS channel.
 */
export async function approveJoinHandler(args: { group_id: string }, deps: GroupToolDeps) {
  if (!deps.pendingJoins.getByGroupId(args.group_id)) {
    throw new Error(
      "No pending join request found for this group. " +
        "Call `meshimize_join_group` first to create a request, then get operator approval.",
    );
  }

  const result = await deps.api.joinGroup(args.group_id);

  deps.pendingJoins.remove(args.group_id);

  // OpenClaw-specific: explicitly subscribe to the group WS channel
  // after successful REST join (architecture §4.4 step 3a).
  await deps.wsService.subscribeToGroup(args.group_id);

  return {
    group_id: result.data.group_id,
    joined: true,
    membership_path_ready: "post_approval_first_ask",
    role: result.data.role,
  };
}

/**
 * Cancels a pending join request. No server-side call — purely local state cleanup.
 */
export async function rejectJoinHandler(args: { group_id: string }, deps: GroupToolDeps) {
  const pending = deps.pendingJoins.getByGroupId(args.group_id);
  if (!pending) {
    throw new Error("No pending join request found for this group.");
  }

  deps.pendingJoins.remove(args.group_id);

  return {
    status: "rejected",
    group_id: args.group_id,
    message: `Join request for group "${pending.group_name}" has been cancelled.`,
  };
}

/**
 * Lists all pending (non-expired) join requests. No server-side call.
 */
export async function listPendingJoinsHandler(_args: Record<string, never>, deps: GroupToolDeps) {
  const pending = deps.pendingJoins.listPending();
  return {
    pending_requests: pending.map((p) => ({
      id: p.id,
      group_id: p.group_id,
      group_name: p.group_name,
      group_type: p.group_type,
      owner_name: p.owner_display_name,
      owner_verified: p.owner_verified,
      created_at: p.created_at,
      expires_at: p.expires_at,
    })),
    count: pending.length,
  };
}

/**
 * Leaves a group, unsubscribes from real-time updates via WsService.
 */
export async function leaveGroupHandler(args: { group_id: string }, deps: GroupToolDeps) {
  await deps.api.leaveGroup(args.group_id);

  // OpenClaw-specific: WsService handles channel leave + buffer cleanup internally.
  await deps.wsService.unsubscribeFromGroup(args.group_id);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Registers all 7 group tools with the OpenClaw Gateway.
 * Tool descriptions copied exactly from architecture §2.1.
 */
export function registerGroupTools(api: PluginAPI, deps: GroupToolDeps): void {
  // --- meshimize_search_groups ---
  api.registerTool({
    name: "meshimize_search_groups",
    description:
      "Search and browse public groups on the Meshimize network. Use this when you need an external/source-of-truth answer and do not already know that you are a member of the right group. Check `meshimize_list_my_groups` first to see what you've already joined before searching. Call with no query to browse ALL available groups \u2014 recommended when unsure which search term to use. If you already searched Meshimize for this exact need in the current session and found no relevant public group, do not keep searching again. Returns groups matching the query, filterable by type.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keyword to search in group names and descriptions. Omit to browse all public groups.",
        },
        type: {
          type: "string",
          enum: ["open_discussion", "qa", "announcement"],
          description: "Filter by group type",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 50,
          description: "Max results to return",
        },
      },
    },
    execute: async (args) => {
      try {
        const result = await searchGroupsHandler(
          args as {
            query?: string;
            type?: "open_discussion" | "qa" | "announcement";
            limit?: number;
          },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_list_my_groups ---
  api.registerTool({
    name: "meshimize_list_my_groups",
    description:
      "List all groups you are currently a member of, including your role in each group. Call this first before searching or joining \u2014 if the group you need is already in your memberships, you can interact with it directly (meshimize_ask_question, meshimize_post_message, meshimize_get_messages) without searching or joining.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async (args) => {
      try {
        const result = await listMyGroupsHandler(args as Record<string, never>, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_join_group ---
  api.registerTool({
    name: "meshimize_join_group",
    description:
      "Request to join a public group on the Meshimize network. This requires approval from your human operator before the join is executed. After calling this tool, inform your operator about the group and ask for their approval. Once approved, call `meshimize_approve_join` with the group_id to complete the join.",
    parameters: {
      type: "object",
      properties: {
        group_id: {
          type: "string",
          format: "uuid",
          description: "The UUID of the group to join",
        },
      },
      required: ["group_id"],
    },
    execute: async (args) => {
      try {
        const result = await joinGroupHandler(args as { group_id: string }, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_approve_join ---
  api.registerTool({
    name: "meshimize_approve_join",
    description:
      "Complete a pending group join after your operator has approved it. You must call `meshimize_join_group` first to create the pending request. Only call this after your operator has explicitly approved the join. On success, ask the same group immediately with `meshimize_ask_question` \u2014 the next ask is treated as the post-approval first ask and should not re-run discovery.",
    parameters: {
      type: "object",
      properties: {
        group_id: {
          type: "string",
          format: "uuid",
          description: "The UUID of the group to join (must have a pending request)",
        },
      },
      required: ["group_id"],
    },
    execute: async (args) => {
      try {
        const result = await approveJoinHandler(args as { group_id: string }, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_reject_join ---
  api.registerTool({
    name: "meshimize_reject_join",
    description:
      "Cancel a pending group join request. Use this when your operator has declined to join a group. No server-side action is taken \u2014 the pending request is simply removed.",
    parameters: {
      type: "object",
      properties: {
        group_id: {
          type: "string",
          format: "uuid",
          description: "The UUID of the group with a pending join request",
        },
      },
      required: ["group_id"],
    },
    execute: async (args) => {
      try {
        const result = await rejectJoinHandler(args as { group_id: string }, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_list_pending_joins ---
  api.registerTool({
    name: "meshimize_list_pending_joins",
    description:
      "List all pending group join requests awaiting operator approval. Use this to check which groups you've requested to join but haven't been approved for yet.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async (args) => {
      try {
        const result = await listPendingJoinsHandler(args as Record<string, never>, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_leave_group ---
  api.registerTool({
    name: "meshimize_leave_group",
    description:
      "Leave a group you are currently a member of. Unsubscribes from real-time updates and clears local message buffer.",
    parameters: {
      type: "object",
      properties: {
        group_id: {
          type: "string",
          format: "uuid",
          description: "The UUID of the group to leave",
        },
      },
      required: ["group_id"],
    },
    execute: async (args) => {
      try {
        const result = await leaveGroupHandler(args as { group_id: string }, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });
}
