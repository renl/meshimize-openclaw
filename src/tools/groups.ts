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

import { Type } from "@sinclair/typebox";
import type { PluginAPI } from "openclaw/plugin-sdk/types";
import { MeshimizeAPIError } from "../api/client.js";
import type { MeshimizeAPI } from "../api/client.js";
import type { PendingJoinMap } from "../state/pending-joins.js";
import type { GroupType, PendingJoinRequest } from "../types/pending-joins.js";
import type { WsService } from "../services/ws-manager.js";
import type { GroupJoinResponse, GroupResponse } from "../types/groups.js";
import { successResult, errorResult, formatToolError, JoinWriteError } from "../errors.js";

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
 * Paginates through the authenticated identity's groups to find one by ID.
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
 * Operator-facing view of a pending request.
 *
 * Unknown metadata stays explicitly null: no name, type, owner, verification
 * badge, or visibility label is ever invented for an unverified ID-only request.
 */
function toPendingJoinGroup(pending: PendingJoinRequest) {
  return {
    id: pending.group_id,
    metadata_source: pending.metadata_source,
    name: pending.group_name,
    description: pending.group_description,
    type: pending.group_type,
    owner_name: pending.owner_display_name,
    owner_verified: pending.owner_verified,
  };
}

/**
 * Raised when an operator-supplied Group ID misses both configured-identity
 * memberships and bounded public discovery. Absence proves neither private
 * visibility nor nonexistence, so the registered `meshimize_join_group` tool turns
 * this miss into an explicitly unverified ID-only pending request rather than a
 * private/not-found claim. Direct handler callers keep the historical error.
 */
export class UnknownGroupIdError extends Error {
  constructor(readonly groupId: string) {
    super("Group not found or is not public.");
    this.name = "UnknownGroupIdError";
  }
}

const GROUP_TYPES: readonly GroupType[] = ["open_discussion", "qa", "announcement"];

/**
 * True only for complete, correctly typed public-discovery metadata. Incomplete or
 * malformed records are lookup failures, never evidence that an ID is unverified.
 */
function isDescribablePublicGroup(group: GroupResponse): boolean {
  return (
    typeof group.name === "string" &&
    (group.description === null || typeof group.description === "string") &&
    GROUP_TYPES.includes(group.type) &&
    typeof group.member_count === "number" &&
    typeof group.owner === "object" &&
    group.owner !== null &&
    typeof group.owner.id === "string" &&
    typeof group.owner.display_name === "string" &&
    typeof group.owner.verified === "boolean"
  );
}

/**
 * Operator notice for an ID Meshimize did not confirm through public discovery:
 * states what is unverified and how to check it, never existence or visibility.
 */
const UNKNOWN_GROUP_NOTICE =
  "No public details does not verify existence or eligibility. " +
  "Compare the ID with your trusted source before approving.";

function unknownPendingJoinMessage(groupId: string, expiresIn: number): string {
  return (
    `Join request created for group ID ${groupId}. ` +
    "Meshimize returned no verified public metadata for this ID, so its details and your " +
    `eligibility are unverified. ${UNKNOWN_GROUP_NOTICE} ` +
    "Approval only attempts the join and may be denied. " +
    `This request expires in ${expiresIn} minute${expiresIn !== 1 ? "s" : ""}.`
  );
}

const minutesUntil = (isoTimestamp: string): number =>
  Math.round((new Date(isoTimestamp).getTime() - Date.now()) / 60000);

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
    if (existing.metadata_source === "unknown") {
      return {
        status: "already_pending",
        pending_request_id: existing.id,
        group: toPendingJoinGroup(existing),
        message:
          `A join request for group ID ${existing.group_id} is already pending operator approval. ` +
          "Meshimize returned no verified public metadata for this ID, so its details and your " +
          `eligibility are unverified. ${UNKNOWN_GROUP_NOTICE} ` +
          "Approval only attempts the join and may be denied. " +
          `The request ${existing.id} expires at ${existing.expires_at}.`,
      };
    }

    return {
      status: "already_pending",
      pending_request_id: existing.id,
      group: toPendingJoinGroup(existing),
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
  if (!Array.isArray(groupsResult?.data)) {
    throw new Error(
      "Meshimize returned a malformed group discovery response; no join request was created.",
    );
  }

  const group = groupsResult.data.find((candidate) => candidate?.id === args.group_id);
  if (!group) {
    // The registered tool turns this miss into an unverified ID-only request so an
    // operator can compare a trusted UUID; private visibility is never inferred.
    throw new UnknownGroupIdError(args.group_id);
  }
  if (!isDescribablePublicGroup(group)) {
    throw new Error("Meshimize returned incomplete group metadata; no join request was created.");
  }

  const pending = deps.pendingJoins.add({
    id: group.id,
    name: group.name,
    description: group.description,
    type: group.type,
    owner: group.owner,
  });

  const expiresIn = minutesUntil(pending.expires_at);

  return {
    status: "pending_operator_approval",
    pending_request_id: pending.id,
    group: toPendingJoinGroup(pending),
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
 * Creates the explicitly unverified pending request for an operator-supplied Group
 * ID that public discovery did not confirm.
 *
 * It obeys the same bounded capacity, TTL, single-write, and explicit-approval
 * rules as a public request; only the operator-visible metadata differs.
 */
async function createUnknownPendingJoin(groupId: string, deps: GroupToolDeps) {
  const pending = deps.pendingJoins.add({ id: groupId, metadataSource: "unknown" });
  const expiresIn = minutesUntil(pending.expires_at);

  return {
    status: "pending_operator_approval",
    pending_request_id: pending.id,
    group: toPendingJoinGroup(pending),
    message: unknownPendingJoinMessage(pending.group_id, expiresIn),
  };
}

// ---------------------------------------------------------------------------
// Single-write attempt ownership and join outcome guidance (OpenClaw §4.4.1)
// ---------------------------------------------------------------------------

/**
 * Group IDs with a join write currently in flight, keyed by the pending-join
 * store that owns the request. One identity's in-flight attempt therefore never
 * blocks another identity's store, and concurrent approvals of the same pending
 * request share a single physical POST.
 */
const joinWritesInFlight = new WeakMap<object, Set<string>>();

function claimJoinWrite(store: object, groupId: string): boolean {
  const active = joinWritesInFlight.get(store) ?? new Set<string>();
  joinWritesInFlight.set(store, active);
  if (active.has(groupId)) return false;
  active.add(groupId);
  return true;
}

function releaseJoinWrite(store: object, groupId: string): void {
  joinWritesInFlight.get(store)?.delete(groupId);
}

function describeJoinTarget(pending: PendingJoinRequest): string {
  if (pending.group_name === null) {
    return `group ID ${pending.group_id}`;
  }
  return `group "${pending.group_name}" (${pending.group_id})`;
}

function describeJoinFailure(error: unknown): string {
  if (error instanceof MeshimizeAPIError) return `HTTP ${error.status}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "unrecognized failure";
}

/** 4xx responses (except a request timeout) prove the write was not applied. */
function isDefinitiveRefusal(error: unknown): error is MeshimizeAPIError {
  return (
    error instanceof MeshimizeAPIError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408
  );
}

/**
 * Refusal guidance: the identity-scoped write definitely did not happen, so the
 * operator-approved request is retained untouched for a fresh explicit approval.
 */
function refusalError(pending: PendingJoinRequest, error: unknown): JoinWriteError {
  return new JoinWriteError(
    `Join write for ${describeJoinTarget(pending)} was refused (${describeJoinFailure(error)}). ` +
      `The pending request ${pending.id} is unchanged and still expires at ${pending.expires_at}. ` +
      "Ask your operator for fresh explicit approval before calling `meshimize_approve_join` again — " +
      "there is no automatic retry, and this tool will not replay the write.",
  );
}

/**
 * Uncertainty guidance: the write may have been applied, so the replayable
 * pending request is cleared and the agent is pointed at a read-only check.
 */
function uncertainError(pending: PendingJoinRequest, detail: string): JoinWriteError {
  return new JoinWriteError(
    `Join write for ${describeJoinTarget(pending)} has an uncertain outcome; you might already be a ` +
      `member (${detail}). The pending request was cleared and will not be replayed. ` +
      "Do not retry the write — call `meshimize_list_my_groups` to check whether the membership now " +
      "exists, then ask your operator again only if it does not.",
  );
}

/**
 * Bounded receiver-readiness window measured from the successful join write.
 * The accepted membership is already durable; this only bounds how long the
 * caller waits before it is told the truth about delivery.
 */
const RECEIVER_READY_WINDOW_MS = 10_000;

type ReceiverProbe = {
  isReceiverReady: (groupId: string) => boolean;
  awaitReceiverReady: (
    groupId: string,
    timeoutMs: number,
  ) => Promise<{ ready: boolean; reason?: string }>;
};

/**
 * Returns the service's explicit readiness gate, when the wired service exposes
 * one. Older best-effort wirings (unit-level callers) are reported ready, which
 * is exactly the pre-§4.4.1 behaviour; the plugin always wires the gate.
 */
function receiverProbe(wsService: WsService): ReceiverProbe | null {
  const candidate = wsService as Partial<ReceiverProbe>;
  return typeof candidate.awaitReceiverReady === "function" &&
    typeof candidate.isReceiverReady === "function"
    ? (candidate as ReceiverProbe)
    : null;
}

/** Waits for truthful delivery readiness within the bounded window. */
async function awaitReceiver(
  deps: GroupToolDeps,
  groupId: string,
): Promise<{ ready: boolean; reason?: string }> {
  const probe = receiverProbe(deps.wsService);
  if (!probe) {
    await deps.wsService.subscribeToGroup(groupId);
    return { ready: true };
  }
  return probe.awaitReceiverReady(groupId, RECEIVER_READY_WINDOW_MS);
}

/**
 * Emits the one approved join write and applies the outcome partition.
 */
async function performJoinWrite(deps: GroupToolDeps, pending: PendingJoinRequest) {
  let joined: { data: GroupJoinResponse };

  try {
    joined = await deps.api.joinGroup(pending.group_id);
  } catch (error) {
    if (isDefinitiveRefusal(error)) {
      // Pending state (including ID and expiry) is retained verbatim.
      throw refusalError(pending, error);
    }
    // Server error, request timeout, transport loss: membership may exist.
    deps.pendingJoins.remove(pending.group_id);
    throw uncertainError(pending, describeJoinFailure(error));
  }

  const data = joined?.data;

  if (!data || typeof data.group_id !== "string" || data.group_id.length === 0) {
    // An unusable 2xx cannot prove membership, so it is not treated as success.
    deps.pendingJoins.remove(pending.group_id);
    throw uncertainError(pending, "the server reply carried no usable membership");
  }

  deps.pendingJoins.remove(pending.group_id);

  // OpenClaw-specific: the accepted membership is not a delivery claim. Only an
  // acknowledged group channel on the live socket, with its shared-buffer
  // handler attached, may be reported ready (architecture §4.4.1 step 3a).
  const readiness = await awaitReceiver(deps, pending.group_id);

  if (!readiness.ready) {
    return {
      group_id: data.group_id,
      joined: true,
      role: data.role,
      membership_path_ready: null,
      receiver: { ready: false, reason: readiness.reason },
      message:
        `You are a confirmed ${data.role} of ${describeJoinTarget(pending)}, but this client has ` +
        `no acknowledged receiver for this group (${readiness.reason}). A question posted now could ` +
        "not be answered here. Do not retry or replay `meshimize_approve_join` — the membership " +
        "write already succeeded. Call `meshimize_list_my_groups` to confirm the membership, and " +
        "ask your operator to restart/reconnect this client before asking a question.",
    };
  }

  return {
    group_id: data.group_id,
    joined: true,
    membership_path_ready: "post_approval_first_ask",
    role: data.role,
    receiver: { ready: true },
  };
}

/**
 * Completes a pending join after operator approval.
 * Calls POST /groups/:group_id/join at most once and subscribes to the WS
 * channel only after a confirmed membership.
 */
export async function approveJoinHandler(args: { group_id: string }, deps: GroupToolDeps) {
  const pending = deps.pendingJoins.getByGroupId(args.group_id);

  if (!pending) {
    throw new Error(
      "No pending join request found for this group. " +
        "Call `meshimize_join_group` first to create a request, then get operator approval.",
    );
  }

  if (!claimJoinWrite(deps.pendingJoins, pending.group_id)) {
    throw new JoinWriteError(
      `A join write for ${describeJoinTarget(pending)} is already in progress. ` +
        "Do not retry it; wait for that attempt to finish, then check " +
        "`meshimize_list_pending_joins` and `meshimize_list_my_groups` before acting again.",
    );
  }

  try {
    return await performJoinWrite(deps, pending);
  } finally {
    releaseJoinWrite(deps.pendingJoins, pending.group_id);
  }
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

  const target =
    pending.group_name === null
      ? `group ID ${args.group_id}`
      : `group "${pending.group_name}" (${args.group_id})`;

  return {
    status: "rejected",
    group_id: args.group_id,
    message: `Join request for ${target} has been cancelled.`,
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
      metadata_source: p.metadata_source,
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
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description:
            "Keyword to search in group names and descriptions. Omit to browse all public groups.",
        }),
      ),
      type: Type.Optional(
        Type.Union(
          [Type.Literal("open_discussion"), Type.Literal("qa"), Type.Literal("announcement")],
          { description: "Filter by group type" },
        ),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 100,
          default: 50,
          description: "Max results to return",
        }),
      ),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
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
    parameters: Type.Object({}),
    execute: async (_id: string, args: Record<string, unknown>) => {
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
      "Request to join a group on the Meshimize network by its Group ID. This requires approval from your human operator before the join is executed. A public group is described for the operator; an ID with no public match is shown as an unverified ID-only request, so the operator must compare it with a trusted source. Approval only attempts the join and may be denied. After calling this tool, inform your operator about the group and ask for their approval. Once approved, call `meshimize_approve_join` with the group_id to complete the join.",
    parameters: Type.Object({
      group_id: Type.String({
        format: "uuid",
        description: "The UUID of the group to join",
      }),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      const groupArgs = args as { group_id: string };
      try {
        return successResult(await joinGroupHandler(groupArgs, deps));
      } catch (error) {
        if (!(error instanceof UnknownGroupIdError)) {
          return errorResult(formatToolError(error, deps.api.configBaseUrl));
        }

        // An operator-supplied ID that public discovery did not confirm becomes an
        // explicitly unverified pending request, never a visibility/existence claim.
        try {
          return successResult(await createUnknownPendingJoin(groupArgs.group_id, deps));
        } catch (pendingError) {
          return errorResult(formatToolError(pendingError, deps.api.configBaseUrl));
        }
      }
    },
  });

  // --- meshimize_approve_join ---
  api.registerTool({
    name: "meshimize_approve_join",
    description:
      "Complete a pending group join after your operator has approved it. You must call `meshimize_join_group` first to create the pending request. Only call this after your operator has explicitly approved the join. On success, ask the same group immediately with `meshimize_ask_question` \u2014 the next ask is treated as the post-approval first ask and should not re-run discovery.",
    parameters: Type.Object({
      group_id: Type.String({
        format: "uuid",
        description: "The UUID of the group to join (must have a pending request)",
      }),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
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
    parameters: Type.Object({
      group_id: Type.String({
        format: "uuid",
        description: "The UUID of the group with a pending join request",
      }),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
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
    parameters: Type.Object({}),
    execute: async (_id: string, args: Record<string, unknown>) => {
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
    parameters: Type.Object({
      group_id: Type.String({
        format: "uuid",
        description: "The UUID of the group to leave",
      }),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await leaveGroupHandler(args as { group_id: string }, deps);
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });
}
