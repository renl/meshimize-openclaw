import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MeshimizeAPI } from "../../src/api/client.js";
import type { Delegation } from "../../src/types/delegations.js";
import type { PaginatedResponse } from "../../src/types/api.js";
import { DelegationContentBuffer } from "../../src/buffer/delegation-content-buffer.js";
import {
  enrichWithBuffer,
  createDelegationHandler,
  listDelegationsHandler,
  getDelegationHandler,
  acceptDelegationHandler,
  completeDelegationHandler,
  cancelDelegationHandler,
  acknowledgeDelegationHandler,
  extendDelegationHandler,
  registerDelegationTools,
} from "../../src/tools/delegations.js";
import { createMockPluginAPI } from "../__mocks__/openclaw-plugin-sdk/api.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeDelegation(overrides: Partial<Delegation> = {}): Delegation {
  return {
    id: "del-1",
    state: "pending",
    group_id: "g-1",
    group_name: "Test Group",
    sender_account_id: "acct-sender",
    sender_display_name: "Sender",
    target_account_id: null,
    target_display_name: null,
    assignee_account_id: null,
    assignee_display_name: null,
    description: "Do the thing",
    result: null,
    original_ttl_seconds: 3600,
    expires_at: "2026-01-01T01:00:00Z",
    accepted_at: null,
    completed_at: null,
    acknowledged_at: null,
    cancelled_at: null,
    inserted_at: "2026-01-01T00:00:00Z",
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

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockApi(): {
  [K in keyof MeshimizeAPI]: ReturnType<typeof vi.fn>;
} {
  return {
    getAccount: vi.fn(),
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

function createDeps() {
  const api = createMockApi();
  const delegationBuffer = new DelegationContentBuffer();
  return {
    api: api as unknown as MeshimizeAPI,
    delegationBuffer,
    _api: api,
  };
}

// ---------------------------------------------------------------------------
// Tests: enrichWithBuffer
// ---------------------------------------------------------------------------

describe("enrichWithBuffer", () => {
  it("returns delegation unchanged when no buffer entry exists", () => {
    const buffer = new DelegationContentBuffer();
    const delegation = makeDelegation({ description: "from server" });

    const result = enrichWithBuffer(delegation, buffer);

    expect(result.description).toBe("from server");
    expect(result).toEqual(delegation);
  });

  it("server content takes priority over buffer", () => {
    const buffer = new DelegationContentBuffer();
    buffer.storeDescription("del-1", "from buffer");
    const delegation = makeDelegation({ description: "from server" });

    const result = enrichWithBuffer(delegation, buffer);

    expect(result.description).toBe("from server");
  });

  it("buffer provides fallback when server returns null for description", () => {
    const buffer = new DelegationContentBuffer();
    buffer.storeDescription("del-1", "from buffer");
    const delegation = makeDelegation({ description: null });

    const result = enrichWithBuffer(delegation, buffer);

    expect(result.description).toBe("from buffer");
  });

  it("buffer provides fallback when server returns null for result", () => {
    const buffer = new DelegationContentBuffer();
    buffer.storeResult("del-1", "result from buffer");
    const delegation = makeDelegation({
      state: "completed",
      result: null,
    });

    const result = enrichWithBuffer(delegation, buffer);

    expect(result.result).toBe("result from buffer");
  });

  it("evicts buffer entry for acknowledged state", () => {
    const buffer = new DelegationContentBuffer();
    buffer.storeDescription("del-1", "stale");
    const delegation = makeDelegation({
      state: "acknowledged",
      description: null,
      result: null,
    });

    const result = enrichWithBuffer(delegation, buffer);

    expect(result.description).toBeNull();
    expect(result.result).toBeNull();
    expect(buffer.get("del-1")).toBeUndefined();
  });

  it("evicts buffer entry for expired state", () => {
    const buffer = new DelegationContentBuffer();
    buffer.storeDescription("del-1", "stale");
    buffer.storeResult("del-1", "stale result");
    const delegation = makeDelegation({
      state: "expired",
      description: null,
      result: null,
    });

    const result = enrichWithBuffer(delegation, buffer);

    expect(result.description).toBeNull();
    expect(result.result).toBeNull();
    expect(buffer.get("del-1")).toBeUndefined();
  });

  it("does not enrich non-purged states without buffer entry", () => {
    const buffer = new DelegationContentBuffer();
    const delegation = makeDelegation({
      state: "pending",
      description: null,
    });

    const result = enrichWithBuffer(delegation, buffer);

    expect(result.description).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: Handler functions
// ---------------------------------------------------------------------------

describe("createDelegationHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("creates a delegation and stores description in buffer", async () => {
    const delegation = makeDelegation({ id: "del-new", description: "Task desc" });
    deps._api.createDelegation.mockResolvedValue({ data: delegation });

    const result = await createDelegationHandler(
      { group_id: "g-1", description: "Task desc" },
      deps,
    );

    expect(result.delegation).toEqual(delegation);
    expect(deps._api.createDelegation).toHaveBeenCalledWith({
      group_id: "g-1",
      description: "Task desc",
    });
    expect(deps.delegationBuffer.get("del-new")?.description).toBe("Task desc");
  });

  it("passes optional target_account_id and ttl_seconds", async () => {
    const delegation = makeDelegation();
    deps._api.createDelegation.mockResolvedValue({ data: delegation });

    await createDelegationHandler(
      {
        group_id: "g-1",
        description: "Task",
        target_account_id: "acct-target",
        ttl_seconds: 7200,
      },
      deps,
    );

    expect(deps._api.createDelegation).toHaveBeenCalledWith({
      group_id: "g-1",
      description: "Task",
      target_account_id: "acct-target",
      ttl_seconds: 7200,
    });
  });

  it("does not store in buffer when description is null", async () => {
    const delegation = makeDelegation({ id: "del-null", description: null });
    deps._api.createDelegation.mockResolvedValue({ data: delegation });

    await createDelegationHandler({ group_id: "g-1", description: "Task" }, deps);

    expect(deps.delegationBuffer.get("del-null")).toBeUndefined();
  });

  it("handles REST client error", async () => {
    deps._api.createDelegation.mockRejectedValue(new Error("forbidden"));
    await expect(
      createDelegationHandler({ group_id: "g-1", description: "Task" }, deps),
    ).rejects.toThrow("forbidden");
  });
});

describe("listDelegationsHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("lists delegations with buffer enrichment", async () => {
    const del1 = makeDelegation({ id: "del-1", description: null });
    deps.delegationBuffer.storeDescription("del-1", "buffered desc");
    deps._api.listDelegations.mockResolvedValue(makePaginatedResponse([del1]));

    const result = await listDelegationsHandler({}, deps);

    expect(result.delegations).toHaveLength(1);
    expect(result.delegations[0].description).toBe("buffered desc");
  });

  it("passes filter parameters to REST API", async () => {
    deps._api.listDelegations.mockResolvedValue(makePaginatedResponse([]));

    await listDelegationsHandler(
      { group_id: "g-1", state: "pending", role: "sender", limit: 10, after: "cursor" },
      deps,
    );

    expect(deps._api.listDelegations).toHaveBeenCalledWith({
      group_id: "g-1",
      state: "pending",
      role: "sender",
      limit: 10,
      after: "cursor",
    });
  });

  it("returns meta from API response", async () => {
    deps._api.listDelegations.mockResolvedValue(
      makePaginatedResponse([makeDelegation()], true, "next-cursor"),
    );

    const result = await listDelegationsHandler({}, deps);

    expect(result.meta.has_more).toBe(true);
    expect(result.meta.next_cursor).toBe("next-cursor");
  });
});

describe("getDelegationHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("gets a delegation with buffer enrichment", async () => {
    const delegation = makeDelegation({ id: "del-1", description: null });
    deps.delegationBuffer.storeDescription("del-1", "buffered desc");
    deps._api.getDelegation.mockResolvedValue({ data: delegation });

    const result = await getDelegationHandler({ delegation_id: "del-1" }, deps);

    expect(result.delegation.description).toBe("buffered desc");
    expect(deps._api.getDelegation).toHaveBeenCalledWith("del-1");
  });

  it("returns server content when available", async () => {
    const delegation = makeDelegation({ id: "del-1", description: "server desc" });
    deps._api.getDelegation.mockResolvedValue({ data: delegation });

    const result = await getDelegationHandler({ delegation_id: "del-1" }, deps);

    expect(result.delegation.description).toBe("server desc");
  });
});

describe("acceptDelegationHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("accepts a delegation and returns the data", async () => {
    const delegation = makeDelegation({
      id: "del-1",
      state: "accepted",
      assignee_account_id: "acct-assignee",
    });
    deps._api.acceptDelegation.mockResolvedValue({ data: delegation });

    const result = await acceptDelegationHandler({ delegation_id: "del-1" }, deps);

    expect(result.delegation).toEqual(delegation);
    expect(deps._api.acceptDelegation).toHaveBeenCalledWith("del-1");
  });

  it("handles REST client error", async () => {
    deps._api.acceptDelegation.mockRejectedValue(new Error("not authorized"));
    await expect(acceptDelegationHandler({ delegation_id: "del-1" }, deps)).rejects.toThrow(
      "not authorized",
    );
  });
});

describe("completeDelegationHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("completes a delegation and stores result in buffer", async () => {
    const delegation = makeDelegation({
      id: "del-1",
      state: "completed",
      result: "Task done",
    });
    deps._api.completeDelegation.mockResolvedValue({ data: delegation });

    const result = await completeDelegationHandler(
      { delegation_id: "del-1", result: "Task done" },
      deps,
    );

    expect(result.delegation).toEqual(delegation);
    expect(deps._api.completeDelegation).toHaveBeenCalledWith("del-1", { result: "Task done" });
    expect(deps.delegationBuffer.get("del-1")?.result).toBe("Task done");
  });

  it("does not store in buffer when result is null", async () => {
    const delegation = makeDelegation({
      id: "del-null",
      state: "completed",
      result: null,
    });
    deps._api.completeDelegation.mockResolvedValue({ data: delegation });

    await completeDelegationHandler({ delegation_id: "del-null", result: "Done" }, deps);

    expect(deps.delegationBuffer.get("del-null")).toBeUndefined();
  });
});

describe("cancelDelegationHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("cancels a delegation and returns the data", async () => {
    const delegation = makeDelegation({ id: "del-1", state: "cancelled" });
    deps._api.cancelDelegation.mockResolvedValue({ data: delegation });

    const result = await cancelDelegationHandler({ delegation_id: "del-1" }, deps);

    expect(result.delegation).toEqual(delegation);
    expect(deps._api.cancelDelegation).toHaveBeenCalledWith("del-1");
  });
});

describe("acknowledgeDelegationHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("acknowledges a delegation and clears buffer", async () => {
    deps.delegationBuffer.storeDescription("del-1", "desc");
    deps.delegationBuffer.storeResult("del-1", "result");

    const delegation = makeDelegation({
      id: "del-1",
      state: "acknowledged",
      description: null,
      result: null,
    });
    deps._api.acknowledgeDelegation.mockResolvedValue({ data: delegation });

    const result = await acknowledgeDelegationHandler({ delegation_id: "del-1" }, deps);

    expect(result.delegation).toEqual(delegation);
    expect(deps._api.acknowledgeDelegation).toHaveBeenCalledWith("del-1");
    expect(deps.delegationBuffer.get("del-1")).toBeUndefined();
  });
});

describe("extendDelegationHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("extends with custom ttl_seconds", async () => {
    const delegation = makeDelegation({ id: "del-1", expires_at: "2026-01-01T02:00:00Z" });
    deps._api.extendDelegation.mockResolvedValue({ data: delegation });

    const result = await extendDelegationHandler(
      { delegation_id: "del-1", ttl_seconds: 7200 },
      deps,
    );

    expect(result.delegation).toEqual(delegation);
    expect(deps._api.extendDelegation).toHaveBeenCalledWith("del-1", { ttl_seconds: 7200 });
  });

  it("extends without ttl_seconds (reset to original)", async () => {
    const delegation = makeDelegation({ id: "del-1" });
    deps._api.extendDelegation.mockResolvedValue({ data: delegation });

    const result = await extendDelegationHandler({ delegation_id: "del-1" }, deps);

    expect(result.delegation).toEqual(delegation);
    expect(deps._api.extendDelegation).toHaveBeenCalledWith("del-1", undefined);
  });

  it("handles REST client error", async () => {
    deps._api.extendDelegation.mockRejectedValue(new Error("not authorized"));
    await expect(extendDelegationHandler({ delegation_id: "del-1" }, deps)).rejects.toThrow(
      "not authorized",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: Tool registration
// ---------------------------------------------------------------------------

describe("registerDelegationTools", () => {
  it("registers all 8 tools with correct names", () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    registerDelegationTools(pluginApi, deps);

    const toolNames = pluginApi._registeredTools.map((t) => t.name);
    expect(toolNames).toEqual([
      "meshimize_create_delegation",
      "meshimize_list_delegations",
      "meshimize_get_delegation",
      "meshimize_accept_delegation",
      "meshimize_complete_delegation",
      "meshimize_cancel_delegation",
      "meshimize_acknowledge_delegation",
      "meshimize_extend_delegation",
    ]);
  });

  it("each tool has a description and parameters", () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    registerDelegationTools(pluginApi, deps);

    for (const tool of pluginApi._registeredTools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("each execute wrapper catches errors and returns isError result", async () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();

    deps._api.createDelegation.mockRejectedValue(new Error("test-error"));
    deps._api.listDelegations.mockRejectedValue(new Error("test-error"));
    deps._api.getDelegation.mockRejectedValue(new Error("test-error"));
    deps._api.acceptDelegation.mockRejectedValue(new Error("test-error"));
    deps._api.completeDelegation.mockRejectedValue(new Error("test-error"));
    deps._api.cancelDelegation.mockRejectedValue(new Error("test-error"));
    deps._api.acknowledgeDelegation.mockRejectedValue(new Error("test-error"));
    deps._api.extendDelegation.mockRejectedValue(new Error("test-error"));

    registerDelegationTools(pluginApi, deps);

    // Test each tool's error handling
    for (const tool of pluginApi._registeredTools) {
      const args: Record<string, unknown> = {};
      if (tool.name === "meshimize_create_delegation") {
        args.group_id = "g-1";
        args.description = "task";
      } else if (tool.name === "meshimize_complete_delegation") {
        args.delegation_id = "del-1";
        args.result = "done";
      } else if (tool.name === "meshimize_list_delegations") {
        // No required args
      } else {
        args.delegation_id = "del-1";
      }

      const result = await tool.execute(args);
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("test-error");
    }
  });

  it("create_delegation execute returns success result with correct format", async () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    const delegation = makeDelegation({ id: "del-new" });
    deps._api.createDelegation.mockResolvedValue({ data: delegation });

    registerDelegationTools(pluginApi, deps);

    const tool = pluginApi._registeredTools.find((t) => t.name === "meshimize_create_delegation")!;
    const result = await tool.execute({ group_id: "g-1", description: "task" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.delegation).toBeDefined();
    expect(parsed.delegation.id).toBe("del-new");
  });
});
