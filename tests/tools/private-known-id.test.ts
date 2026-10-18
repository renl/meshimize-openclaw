// US-PGI-8; root architecture private-group-invitations §14.2–3,
// openclaw-integration §4.4.1. Unit/contract proxy, NOT installed-runtime proof.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshimizeAPIError } from "../../src/api/client.js";
import { createPendingJoinMap } from "../../src/state/pending-joins.js";
import { registerGroupTools, type GroupToolDeps } from "../../src/tools/groups.js";
import { createMockPluginAPI } from "../__mocks__/openclaw-plugin-sdk/api.js";

const id = "10000000-0000-4000-8000-000000000001";
const page = (data: unknown[]) => ({ data, meta: { has_more: false, next_cursor: null } });
const publicGroup = {
  id,
  name: "Public reference",
  description: null,
  type: "qa",
  visibility: "public",
  owner: { id: "20000000-0000-4000-8000-000000000002", display_name: "Owner", verified: false },
  member_count: 2,
  my_role: null,
};

describe("known-ID pending and approved-write safety", () => {
  let pending: ReturnType<typeof createPendingJoinMap>;
  let api: ReturnType<typeof makeApi>;
  let subscribe: ReturnType<typeof vi.fn>;
  let call: (name: string) => Promise<unknown>;
  function makeApi() {
    return {
      configBaseUrl: "https://example.invalid",
      getMyGroups: vi.fn().mockResolvedValue(page([])),
      searchGroups: vi.fn().mockResolvedValue(page([])),
      joinGroup: vi.fn().mockResolvedValue({
        data: {
          group_id: id,
          agent_identity_id: "20000000-0000-4000-8000-000000000002",
          role: "member",
          inserted_at: "2026-10-18T00:00:00Z",
          created_at: "2026-10-18T00:00:00Z",
        },
      }),
    };
  }
  beforeEach(() => {
    vi.useFakeTimers();
    pending = createPendingJoinMap({ joinTimeoutMs: 600_000, maxPendingJoins: 2 });
    api = makeApi();
    subscribe = vi.fn().mockResolvedValue(undefined);
    const registry = createMockPluginAPI();
    registerGroupTools(registry, {
      api,
      pendingJoins: pending,
      wsService: { subscribeToGroup: subscribe },
    } as unknown as GroupToolDeps);
    call = async (name) =>
      registry._registeredTools
        .find((t) => t.name === `meshimize_${name}`)!
        .execute("test", { group_id: id });
  });
  afterEach(() => {
    pending.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const text = (result: unknown) => JSON.stringify(result);
  async function publicPending() {
    api.searchGroups.mockResolvedValue(page([publicGroup]));
    await call("join_group");
  }

  it("unknown ID preserves literal null metadata through new/repeat/list/reject", async () => {
    const first = text(await call("join_group"));
    expect(JSON.parse(first).details?.error).not.toBe(true);
    expect(pending.getByGroupId(id)).toMatchObject({
      group_id: id,
      metadata_source: "unknown",
      group_name: null,
      group_description: null,
      group_type: null,
      owner_account_id: null,
      owner_display_name: null,
      owner_verified: null,
    });
    const original = pending.getByGroupId(id)!;
    for (const response of [first, text(await call("join_group"))]) {
      // Registered tools emit JSON inside their text content; parse the public envelope.
      const envelope = JSON.parse(response);
      const body = JSON.parse(envelope.content[0].text);
      expect(body.group).toEqual({
        id,
        metadata_source: "unknown",
        name: null,
        description: null,
        type: null,
        owner_name: null,
        owner_verified: null,
      });
      expect(body.pending_request_id).toBe(original.id);
      expect(body.message).toContain(id);
      expect(body.message).toMatch(/trusted/i);
      expect(body.message).toMatch(/(not verified|unverified|unknown)/i);
      expect(body.message).toMatch(/(denied|eligibility)/i);
    }
    expect(pending.getByGroupId(id)?.expires_at).toBe(original.expires_at);
    const listed = JSON.parse(JSON.parse(text(await call("list_pending_joins"))).content[0].text);
    expect(listed.pending_requests[0]).toMatchObject({
      metadata_source: "unknown",
      group_name: null,
      group_type: null,
      owner_name: null,
      owner_verified: null,
    });
    const rejected = JSON.parse(JSON.parse(text(await call("reject_join"))).content[0].text);
    expect(rejected.message).toContain(id);
    expect(rejected.message).not.toContain('"null"');
    expect(pending.listPending()).toHaveLength(0);
    expect(api.joinGroup).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("public metadata keeps false verification, nullable description, canonical owner account", async () => {
    await publicPending();
    expect(pending.getByGroupId(id)).toMatchObject({
      metadata_source: "public_discovery",
      group_name: publicGroup.name,
      group_description: null,
      group_type: "qa",
      owner_account_id: publicGroup.owner.id,
      owner_verified: false,
    });
    const body = JSON.parse(JSON.parse(text(await call("join_group"))).content[0].text);
    expect(body.group).toMatchObject({
      metadata_source: "public_discovery",
      owner_verified: false,
    });
  });

  it.each([
    new MeshimizeAPIError(401, {}),
    new MeshimizeAPIError(429, {}),
    new Error("fetch failed"),
    { data: null },
    { data: [{ id }] },
  ])("lookup error/malformed data never becomes unknown pending: %j", async (fault) => {
    if (fault instanceof Error) api.searchGroups.mockRejectedValue(fault);
    else api.searchGroups.mockResolvedValue(fault);
    expect(JSON.parse(text(await call("join_group"))).details.error).toBe(true);
    expect(pending.listPending()).toHaveLength(0);
    expect(api.joinGroup).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("existing membership never writes or discovers", async () => {
    api.getMyGroups.mockResolvedValue(page([{ ...publicGroup, my_role: "responder" }]));
    expect(text(await call("join_group"))).toContain("already_member");
    expect(api.searchGroups).not.toHaveBeenCalled();
    expect(api.joinGroup).not.toHaveBeenCalled();
  });

  it("expiry prevents approval and fresh map carries no previous pending state", async () => {
    await publicPending();
    vi.advanceTimersByTime(600_001);
    expect(JSON.parse(text(await call("approve_join"))).details.error).toBe(true);
    expect(pending.listPending()).toHaveLength(0);
    expect(api.joinGroup).not.toHaveBeenCalled();
    pending.dispose();
    pending = createPendingJoinMap({ joinTimeoutMs: 600_000, maxPendingJoins: 2 });
    expect(pending.listPending()).toEqual([]);
  });

  it.each([403, 404, 409, 429])(
    "HTTP %i refusal retains pending but requires fresh approval",
    async (status) => {
      await publicPending();
      const before = pending.getByGroupId(id);
      api.joinGroup.mockRejectedValue(new MeshimizeAPIError(status, { error: "Refused" }));
      const response = text(await call("approve_join"));
      expect(JSON.parse(response).details.error).toBe(true);
      expect(response).toMatch(/(fresh|explicit).*(approv)/i);
      expect(pending.getByGroupId(id)).toEqual(before);
      expect(api.joinGroup).toHaveBeenCalledTimes(1);
      expect(subscribe).not.toHaveBeenCalled();
    },
  );

  it.each([new Error("fetch failed"), new MeshimizeAPIError(503, {}), { data: null }])(
    "uncertain result clears replayable pending and preserves recovery in public errors: %j",
    async (fault) => {
      await publicPending();
      if (fault instanceof Error) api.joinGroup.mockRejectedValue(fault);
      else api.joinGroup.mockResolvedValue(fault);
      const response = text(await call("approve_join"));
      expect(JSON.parse(response).details.error).toBe(true);
      expect(response).toMatch(/(may|might|uncertain)/i);
      expect(response).toContain("meshimize_list_my_groups");
      expect(pending.getByGroupId(id)).toBeUndefined();
      await call("approve_join");
      expect(api.joinGroup).toHaveBeenCalledTimes(1);
      expect(subscribe).not.toHaveBeenCalled();
    },
  );

  it("concurrent approvals produce only one dispatch for a live pending attempt", async () => {
    await publicPending();
    let release!: (value: unknown) => void;
    const response = new Promise((resolve) => {
      release = resolve;
    });
    api.joinGroup.mockImplementation(() => response);
    const first = call("approve_join");
    const second = call("approve_join");
    // Check before completion: a handler-count proxy; real transport count is a later gate.
    const writes = api.joinGroup.mock.calls.length;
    release({
      data: {
        group_id: id,
        agent_identity_id: "20000000-0000-4000-8000-000000000002",
        role: "member",
        inserted_at: "2026-10-18T00:00:00Z",
        created_at: "2026-10-18T00:00:00Z",
      },
    });
    await Promise.all([first, second]);
    expect(writes).toBe(1);
  });
});
