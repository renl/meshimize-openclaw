import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MeshimizeAPI } from "../../src/api/client.js";
import type { PendingJoinMap } from "../../src/state/pending-joins.js";
import type { WsService } from "../../src/services/ws-manager.js";
import type { GroupResponse } from "../../src/types/groups.js";
import type { PendingJoinRequest } from "../../src/types/pending-joins.js";
import type { PaginatedResponse } from "../../src/types/api.js";
import {
  searchGroupsHandler,
  listMyGroupsHandler,
  joinGroupHandler,
  approveJoinHandler,
  rejectJoinHandler,
  listPendingJoinsHandler,
  leaveGroupHandler,
  findMyGroupById,
  registerGroupTools,
} from "../../src/tools/groups.js";
import { createMockPluginAPI } from "../__mocks__/openclaw-plugin-sdk/api.js";
import pluginEntry from "../../src/index.js";
import { resetSharedState } from "../../src/plugin.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeGroupResponse(overrides: Partial<GroupResponse> = {}): GroupResponse {
  return {
    id: "g-111-222-333",
    name: "Test Group",
    description: "A test group",
    type: "qa",
    visibility: "public",
    my_role: null,
    owner: { id: "owner-1", display_name: "Owner One", verified: true },
    member_count: 5,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePaginatedResponse<T>(
  data: T[],
  hasMore = false,
  nextCursor: string | null = null,
): PaginatedResponse<T> {
  return {
    data,
    meta: { has_more: hasMore, next_cursor: nextCursor, count: data.length },
  };
}

function makePendingJoinRequest(overrides: Partial<PendingJoinRequest> = {}): PendingJoinRequest {
  return {
    id: "pjr-1",
    group_id: "g-111-222-333",
    group_name: "Test Group",
    group_type: "qa",
    group_description: "A test group",
    owner_account_id: "owner-1",
    owner_display_name: "Owner One",
    owner_verified: true,
    created_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-01-01T00:10:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockApi(): {
  [K in keyof MeshimizeAPI]: K extends "invalidKey" | "configBaseUrl" | "runtimeIdentity"
    ? MeshimizeAPI[K]
    : ReturnType<typeof vi.fn>;
} {
  return {
    invalidKey: false,
    configBaseUrl: "https://api.meshimize.com",
    runtimeIdentity: null,
    getAccount: vi.fn(),
    resolveRuntimeIdentity: vi.fn(),
    searchGroups: vi.fn(),
    getMyGroups: vi.fn(),
    joinGroup: vi.fn(),
    leaveGroup: vi.fn(),
    getMessages: vi.fn(),
    postMessage: vi.fn(),
    getDirectMessages: vi.fn(),
    sendDirectMessage: vi.fn(),
    createDelegation: vi.fn(),
    listDelegations: vi.fn(),
    getDelegation: vi.fn(),
    acceptDelegation: vi.fn(),
    completeDelegation: vi.fn(),
    cancelDelegation: vi.fn(),
    acknowledgeDelegation: vi.fn(),
    extendDelegation: vi.fn(),
  };
}

function createMockPendingJoins(): {
  [K in keyof PendingJoinMap]: ReturnType<typeof vi.fn>;
} {
  return {
    add: vi.fn(),
    getByGroupId: vi.fn(),
    getById: vi.fn(),
    remove: vi.fn(),
    listPending: vi.fn(),
    pruneExpired: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockWsService(): {
  [K in keyof WsService]: ReturnType<typeof vi.fn> | string;
} {
  return {
    id: "meshimize-ws",
    start: vi.fn(),
    stop: vi.fn(),
    subscribeToGroup: vi.fn(),
    unsubscribeFromGroup: vi.fn(),
    getSocket: vi.fn(),
  };
}

function createDeps() {
  const api = createMockApi();
  const pendingJoins = createMockPendingJoins();
  const wsService = createMockWsService();
  return {
    api: api as unknown as MeshimizeAPI,
    pendingJoins: pendingJoins as unknown as PendingJoinMap,
    wsService: wsService as unknown as WsService,
    _api: api,
    _pendingJoins: pendingJoins,
    _wsService: wsService,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findMyGroupById", () => {
  it("returns group when found on first page", async () => {
    const group = makeGroupResponse({ id: "target-id" });
    const api = createMockApi();
    api.getMyGroups.mockResolvedValue(makePaginatedResponse([group]));

    const result = await findMyGroupById(api as unknown as MeshimizeAPI, "target-id");
    expect(result).toEqual(group);
  });

  it("returns group when found on second page", async () => {
    const group = makeGroupResponse({ id: "target-id" });
    const api = createMockApi();
    api.getMyGroups
      .mockResolvedValueOnce(
        makePaginatedResponse([makeGroupResponse({ id: "other" })], true, "cursor-1"),
      )
      .mockResolvedValueOnce(makePaginatedResponse([group]));

    const result = await findMyGroupById(api as unknown as MeshimizeAPI, "target-id");
    expect(result).toEqual(group);
    expect(api.getMyGroups).toHaveBeenCalledTimes(2);
  });

  it("returns null when group not found", async () => {
    const api = createMockApi();
    api.getMyGroups.mockResolvedValue(makePaginatedResponse([]));

    const result = await findMyGroupById(api as unknown as MeshimizeAPI, "missing-id");
    expect(result).toBeNull();
  });
});

describe("searchGroupsHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("returns groups with membership enrichment", async () => {
    const searchGroup = makeGroupResponse({ id: "g-1", name: "Search Result" });
    const myGroup = makeGroupResponse({ id: "g-1", my_role: "member" });

    deps._api.searchGroups.mockResolvedValue(makePaginatedResponse([searchGroup]));
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([myGroup]));

    const result = await searchGroupsHandler({}, deps);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].id).toBe("g-1");
    expect(result.groups[0].is_member).toBe(true);
    expect(result.groups[0].my_role).toBe("member");
    expect(result.groups[0].owner).toBe("Owner One");
    expect(result.groups[0].owner_verified).toBe(true);
  });

  it("returns groups when myGroups call fails (graceful degradation)", async () => {
    const searchGroup = makeGroupResponse({ id: "g-1" });
    deps._api.searchGroups.mockResolvedValue(makePaginatedResponse([searchGroup]));
    deps._api.getMyGroups.mockRejectedValue(new Error("network error"));

    const result = await searchGroupsHandler({}, deps);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].is_member).toBe(false);
    expect(result.groups[0].my_role).toBeNull();
  });

  it("returns empty groups with has_more=false when no results", async () => {
    deps._api.searchGroups.mockResolvedValue(makePaginatedResponse([]));
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([]));

    const result = await searchGroupsHandler({}, deps);

    expect(result.groups).toHaveLength(0);
    expect(result.has_more).toBe(false);
  });

  it("passes query, type, limit parameters to REST client", async () => {
    deps._api.searchGroups.mockResolvedValue(makePaginatedResponse([]));
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([]));

    await searchGroupsHandler({ query: "test", type: "qa", limit: 10 }, deps);

    expect(deps._api.searchGroups).toHaveBeenCalledWith({
      q: "test",
      type: "qa",
      limit: 10,
    });
  });

  it("includes has_more from search result meta", async () => {
    deps._api.searchGroups.mockResolvedValue(
      makePaginatedResponse([makeGroupResponse()], true, "next"),
    );
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([]));

    const result = await searchGroupsHandler({}, deps);
    expect(result.has_more).toBe(true);
  });
});

describe("listMyGroupsHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("returns mapped groups from REST response", async () => {
    const group = makeGroupResponse({
      id: "g-1",
      name: "My Group",
      description: "desc",
      type: "qa",
      my_role: "owner",
      member_count: 3,
    });
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([group]));

    const result = await listMyGroupsHandler({} as Record<string, never>, deps);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toEqual({
      id: "g-1",
      name: "My Group",
      description: "desc",
      type: "qa",
      my_role: "owner",
      member_count: 3,
    });
  });

  it("handles REST client error", async () => {
    deps._api.getMyGroups.mockRejectedValue(new Error("server error"));
    await expect(listMyGroupsHandler({} as Record<string, never>, deps)).rejects.toThrow(
      "server error",
    );
  });
});

describe("joinGroupHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("returns already_pending when group already has pending request", async () => {
    const pending = makePendingJoinRequest();
    deps._pendingJoins.getByGroupId.mockReturnValue(pending);

    const result = await joinGroupHandler({ group_id: "g-111-222-333" }, deps);

    expect(result.status).toBe("already_pending");
    expect(result.pending_request_id).toBe("pjr-1");
    expect(result.group.id).toBe("g-111-222-333");
  });

  it("returns already_member when already a member", async () => {
    deps._pendingJoins.getByGroupId.mockReturnValue(undefined);
    const myGroup = makeGroupResponse({ id: "g-1", name: "My Group", my_role: "member" });
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([myGroup]));

    const result = await joinGroupHandler({ group_id: "g-1" }, deps);

    expect(result.status).toBe("already_member");
    expect(result.group_id).toBe("g-1");
    expect(result.role).toBe("member");
  });

  it("returns pending_operator_approval with group info", async () => {
    deps._pendingJoins.getByGroupId.mockReturnValue(undefined);
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([]));

    const group = makeGroupResponse({ id: "g-target", name: "Target Group" });
    deps._api.searchGroups.mockResolvedValue(makePaginatedResponse([group]));

    const pending = makePendingJoinRequest({ group_id: "g-target" });
    deps._pendingJoins.add.mockReturnValue(pending);

    const result = await joinGroupHandler({ group_id: "g-target" }, deps);

    expect(result.status).toBe("pending_operator_approval");
    expect(result.pending_request_id).toBe("pjr-1");
    expect(result.group.id).toBe("g-target");
    expect(result.message).toContain("meshimize_approve_join");
    expect(deps._pendingJoins.add).toHaveBeenCalledWith({
      id: group.id,
      name: group.name,
      description: group.description,
      type: group.type,
      owner: group.owner,
    });
  });

  it("throws when group not found in search results", async () => {
    deps._pendingJoins.getByGroupId.mockReturnValue(undefined);
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([]));
    deps._api.searchGroups.mockResolvedValue(makePaginatedResponse([]));

    await expect(joinGroupHandler({ group_id: "missing" }, deps)).rejects.toThrow(
      "Group not found or is not public.",
    );
  });
});

describe("approveJoinHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("completes join: REST call + removes pending + subscribes WS + returns joined", async () => {
    deps._pendingJoins.getByGroupId.mockReturnValue(makePendingJoinRequest());
    deps._api.joinGroup.mockResolvedValue({
      data: {
        group_id: "g-111-222-333",
        identity_id: "identity-1",
        role: "member",
        created_at: "now",
      },
    });
    deps._wsService.subscribeToGroup.mockResolvedValue(undefined);

    const result = await approveJoinHandler({ group_id: "g-111-222-333" }, deps);

    expect(result.group_id).toBe("g-111-222-333");
    expect(result.joined).toBe(true);
    expect(result.membership_path_ready).toBe("post_approval_first_ask");
    expect(result.role).toBe("member");
    expect(deps._pendingJoins.remove).toHaveBeenCalledWith("g-111-222-333");
    expect(deps._wsService.subscribeToGroup).toHaveBeenCalledWith("g-111-222-333");
  });

  it("throws when no pending request exists", async () => {
    deps._pendingJoins.getByGroupId.mockReturnValue(undefined);

    await expect(approveJoinHandler({ group_id: "g-missing" }, deps)).rejects.toThrow(
      "No pending join request found for this group.",
    );
  });

  it("handles REST client error", async () => {
    deps._pendingJoins.getByGroupId.mockReturnValue(makePendingJoinRequest());
    deps._api.joinGroup.mockRejectedValue(new Error("forbidden"));

    await expect(approveJoinHandler({ group_id: "g-111-222-333" }, deps)).rejects.toThrow(
      "forbidden",
    );
  });
});

describe("rejectJoinHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("removes pending request and returns rejected status", async () => {
    deps._pendingJoins.getByGroupId.mockReturnValue(
      makePendingJoinRequest({ group_name: "Rejected Group" }),
    );

    const result = await rejectJoinHandler({ group_id: "g-111-222-333" }, deps);

    expect(result.status).toBe("rejected");
    expect(result.group_id).toBe("g-111-222-333");
    expect(result.message).toContain("Rejected Group");
    expect(deps._pendingJoins.remove).toHaveBeenCalledWith("g-111-222-333");
  });

  it("throws when no pending request exists", async () => {
    deps._pendingJoins.getByGroupId.mockReturnValue(undefined);

    await expect(rejectJoinHandler({ group_id: "g-missing" }, deps)).rejects.toThrow(
      "No pending join request found for this group.",
    );
  });
});

describe("listPendingJoinsHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("returns all pending requests with correct shape", async () => {
    const p1 = makePendingJoinRequest({ id: "pjr-1", group_id: "g-1", group_name: "Group 1" });
    const p2 = makePendingJoinRequest({ id: "pjr-2", group_id: "g-2", group_name: "Group 2" });
    deps._pendingJoins.listPending.mockReturnValue([p1, p2]);

    const result = await listPendingJoinsHandler({} as Record<string, never>, deps);

    expect(result.count).toBe(2);
    expect(result.pending_requests).toHaveLength(2);
    expect(result.pending_requests[0]).toEqual({
      id: "pjr-1",
      group_id: "g-1",
      group_name: "Group 1",
      group_type: "qa",
      owner_name: "Owner One",
      owner_verified: true,
      created_at: "2026-01-01T00:00:00Z",
      expires_at: "2026-01-01T00:10:00Z",
    });
  });

  it("returns empty list when no pending requests", async () => {
    deps._pendingJoins.listPending.mockReturnValue([]);

    const result = await listPendingJoinsHandler({} as Record<string, never>, deps);

    expect(result.count).toBe(0);
    expect(result.pending_requests).toHaveLength(0);
  });
});

describe("leaveGroupHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("calls REST leave + unsubscribes WS + returns success", async () => {
    deps._api.leaveGroup.mockResolvedValue(undefined);
    deps._wsService.unsubscribeFromGroup.mockResolvedValue(undefined);

    const result = await leaveGroupHandler({ group_id: "g-leave" }, deps);

    expect(result).toEqual({ success: true });
    expect(deps._api.leaveGroup).toHaveBeenCalledWith("g-leave");
    expect(deps._wsService.unsubscribeFromGroup).toHaveBeenCalledWith("g-leave");
  });

  it("handles REST client error", async () => {
    deps._api.leaveGroup.mockRejectedValue(new Error("not a member"));

    await expect(leaveGroupHandler({ group_id: "g-leave" }, deps)).rejects.toThrow("not a member");
  });
});

describe("registerGroupTools", () => {
  it("registers all 7 tools with correct names", () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    registerGroupTools(pluginApi, deps);

    const toolNames = pluginApi._registeredTools.map((t) => t.name);
    expect(toolNames).toEqual([
      "meshimize_search_groups",
      "meshimize_list_my_groups",
      "meshimize_join_group",
      "meshimize_approve_join",
      "meshimize_reject_join",
      "meshimize_list_pending_joins",
      "meshimize_leave_group",
    ]);
  });

  it("each tool has a description and parameters", () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    registerGroupTools(pluginApi, deps);

    for (const tool of pluginApi._registeredTools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("each execute wrapper catches errors and returns error result with details", async () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();

    // Make all API calls reject to trigger error paths
    deps._api.searchGroups.mockRejectedValue(new Error("test-error"));
    deps._api.getMyGroups.mockRejectedValue(new Error("test-error"));
    deps._api.leaveGroup.mockRejectedValue(new Error("test-error"));
    deps._pendingJoins.getByGroupId.mockReturnValue(undefined);
    deps._pendingJoins.listPending.mockImplementation(() => {
      throw new Error("test-error");
    });

    registerGroupTools(pluginApi, deps);

    // Test search_groups error handling
    const searchTool = pluginApi._registeredTools.find(
      (t) => t.name === "meshimize_search_groups",
    )!;
    const searchResult = await searchTool.execute("test-id", {});
    expect((searchResult as Record<string, unknown>).details).toEqual({ error: true });
    const searchParsed = JSON.parse(searchResult.content[0].text);
    expect(searchParsed.error).toBe("Meshimize: test-error");

    // Test list_my_groups error handling
    const listTool = pluginApi._registeredTools.find((t) => t.name === "meshimize_list_my_groups")!;
    const listResult = await listTool.execute("test-id", {});
    expect((listResult as Record<string, unknown>).details).toEqual({ error: true });

    // Test leave_group error handling
    const leaveTool = pluginApi._registeredTools.find((t) => t.name === "meshimize_leave_group")!;
    const leaveResult = await leaveTool.execute("test-id", { group_id: "g-1" });
    expect((leaveResult as Record<string, unknown>).details).toEqual({ error: true });

    // Test list_pending_joins error handling
    const pendingTool = pluginApi._registeredTools.find(
      (t) => t.name === "meshimize_list_pending_joins",
    )!;
    const pendingResult = await pendingTool.execute("test-id", {});
    expect((pendingResult as Record<string, unknown>).details).toEqual({ error: true });
  });

  it("search_groups execute returns success result with correct format", async () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    deps._api.searchGroups.mockResolvedValue(makePaginatedResponse([]));
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([]));

    registerGroupTools(pluginApi, deps);

    const tool = pluginApi._registeredTools.find((t) => t.name === "meshimize_search_groups")!;
    const result = await tool.execute("test-id", {});

    expect((result as Record<string, unknown>).details).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.groups).toEqual([]);
    expect(parsed.has_more).toBe(false);
  });
});

describe("plugin registration integration", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/v1/account")) {
        return new Response(
          JSON.stringify({
            data: {
              id: "acct-123",
              email: "test@example.com",
              display_name: "Parent Account",
              description: null,
              verified: true,
              current_identity: {
                id: "identity-123",
                display_name: "Acting Identity",
                is_default: true,
              },
              inserted_at: "2026-01-01T00:00:00Z",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url.includes("/api/v1/groups")) {
        return new Response(
          JSON.stringify({ data: [], meta: { has_more: false, next_cursor: null, count: 0 } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({ data: [], meta: { has_more: false, next_cursor: null, count: 0 } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSharedState();
  });

  it("registers 1 service + 21 tools after pluginEntry.register", async () => {
    const api = createMockPluginAPI({
      apiKey: "mshz_test123",
      baseUrl: "https://meshimize.fly.dev",
    });
    await pluginEntry.register(api);

    expect(api._registeredServices).toHaveLength(1);
    expect(api._registeredServices[0].id).toBe("meshimize-ws");
    expect(api._registeredTools).toHaveLength(21);
  });

  it("all 21 tools have meshimize_ prefix", async () => {
    const api = createMockPluginAPI({
      apiKey: "mshz_test123",
      baseUrl: "https://meshimize.fly.dev",
    });
    await pluginEntry.register(api);

    for (const tool of api._registeredTools) {
      expect(tool.name).toMatch(/^meshimize_/);
    }
  });
});
