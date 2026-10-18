// US-PGI-8; private-group-invitations §14.2–3; OpenClaw §4.4.1/3.
// Registered-tool contract proxies, not installed Gateway/private-Q&A proof.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPendingJoinMap } from "../../src/state/pending-joins.js";
import type { PendingJoinRequest } from "../../src/types/pending-joins.js";
import { registerGroupTools, type GroupToolDeps } from "../../src/tools/groups.js";
import { createMockPluginAPI } from "../__mocks__/openclaw-plugin-sdk/api.js";

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const page = (data: unknown[]) => ({ data, meta: { has_more: false, next_cursor: null } });
const group = {
  id,
  name: "Public fixture",
  description: null,
  type: "qa",
  visibility: "public",
  owner: { id: other, display_name: "Owner", verified: false },
  member_count: 1,
  my_role: null,
};
const unknown = {
  id: "40000000-0000-4000-8000-000000000001",
  group_id: id,
  metadata_source: "unknown",
  group_name: null,
  group_description: null,
  group_type: null,
  owner_account_id: null,
  owner_display_name: null,
  owner_verified: null,
  created_at: "2026-10-18T00:00:00.000Z",
  expires_at: "2026-10-18T00:10:00.000Z",
};
let pending: ReturnType<typeof createPendingJoinMap>;
let registry: ReturnType<typeof createMockPluginAPI>;
let api: ReturnType<typeof makeApi>;
let subscribe: ReturnType<typeof vi.fn>;
let expired: ReturnType<typeof vi.fn>;
let removed: ReturnType<typeof vi.fn>;
function makeApi() {
  return {
    configBaseUrl: "https://example.invalid",
    getMyGroups: vi.fn().mockResolvedValue(page([])),
    searchGroups: vi.fn().mockResolvedValue(page([])),
    getGroup: vi.fn().mockRejectedValue(Error("forbidden private detail probe")),
    joinGroup: vi.fn().mockRejectedValue(Error("unapproved write")),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
  expired = vi.fn();
  removed = vi.fn();
  pending = createPendingJoinMap(
    { joinTimeoutMs: 600_000, maxPendingJoins: 1 },
    {
      onExpired: expired,
      onRemoved: removed,
    },
  );
  api = makeApi();
  subscribe = vi.fn();
  registry = createMockPluginAPI();
  registerGroupTools(registry, {
    api,
    pendingJoins: pending,
    wsService: { subscribeToGroup: subscribe },
  } as unknown as GroupToolDeps);
});
afterEach(() => {
  pending.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function call(name: string, groupId = id) {
  const result = await registry._registeredTools
    .find((t) => t.name === `meshimize_${name}`)!
    .execute("contract", { group_id: groupId });
  return { result, body: JSON.parse(result.content[0].text) };
}
function noSideEffects() {
  expect(api.getGroup).not.toHaveBeenCalled();
  expect(api.joinGroup).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
}
function unknownGroup(value: unknown) {
  expect(value).toEqual({
    id,
    metadata_source: "unknown",
    name: null,
    description: null,
    type: null,
    owner_name: null,
    owner_verified: null,
  });
}
function trustedPrompt(value: string) {
  expect(value).toContain(id);
  expect(value).toMatch(/trusted/i);
  expect(value).toMatch(/(not verified|unverified|unknown)/i);
  expect(value).toMatch(/(denied|eligibility)/i);
  expect(value).not.toMatch(/group ["']null["']|private group|group exists/i);
}
// Test-only canonical output fixture, NOT a proposed storage/add signature.
// Isolate consumers so a failing new-request branch cannot hide their assertions.
function seedConsumer() {
  vi.spyOn(pending, "getByGroupId").mockReturnValue(unknown as unknown as PendingJoinRequest);
  vi.spyOn(pending, "listPending").mockReturnValue([unknown as unknown as PendingJoinRequest]);
}
it("new absent UUID returns unknown literal-null metadata and a trusted-ID warning", async () => {
  const { result, body } = await call("join_group");
  noSideEffects();
  expect(result.details?.error).not.toBe(true);
  expect(body.status).toBe("pending_operator_approval");
  unknownGroup(body.group);
  trustedPrompt(body.message);
  expect(pending.getByGroupId(id)).toMatchObject({ ...unknown, id: body.pending_request_id });
});
it("repeat independently serializes unknown metadata and retains ID/expiry", async () => {
  seedConsumer();
  const { body } = await call("join_group");
  unknownGroup(body.group);
  trustedPrompt(body.message);
  expect(body.status).toBe("already_pending");
  expect(body.pending_request_id).toBe(unknown.id);
  expect(pending.getByGroupId(id)).toEqual(unknown);
  noSideEffects();
  expect(api.searchGroups).not.toHaveBeenCalled();
});
it("list independently preserves nulls rather than false/fabricated metadata", async () => {
  seedConsumer();
  const { body } = await call("list_pending_joins");
  expect(body.count).toBe(1);
  expect(body.pending_requests).toEqual([
    {
      id: unknown.id,
      group_id: id,
      metadata_source: "unknown",
      group_name: null,
      group_type: null,
      owner_name: null,
      owner_verified: null,
      created_at: unknown.created_at,
      expires_at: unknown.expires_at,
    },
  ]);
  noSideEffects();
});
it("reject independently uses UUID fallback and removes without network effects", async () => {
  seedConsumer();
  const remove = vi.spyOn(pending, "remove");
  const { body } = await call("reject_join");
  expect(remove).toHaveBeenCalledWith(id);
  expect(body.status).toBe("rejected");
  expect(body.message).toContain(id);
  expect(body.message).not.toMatch(/["']null["']/);
  noSideEffects();
});
it("public metadata preserves false verification and nullable description", async () => {
  api.searchGroups.mockResolvedValue(page([group]));
  const { body } = await call("join_group");
  const repeat = await call("join_group");
  const listed = await call("list_pending_joins");
  expect(body.group).toEqual({
    id,
    metadata_source: "public_discovery",
    name: group.name,
    description: null,
    type: "qa",
    owner_name: "Owner",
    owner_verified: false,
  });
  expect(repeat.body.group).toEqual(body.group);
  expect(listed.body.pending_requests[0]).toMatchObject({
    metadata_source: "public_discovery",
    owner_verified: false,
  });
  expect(pending.getByGroupId(id)).toMatchObject({
    metadata_source: "public_discovery",
    group_name: group.name,
    group_description: null,
    group_type: "qa",
    owner_display_name: "Owner",
    owner_account_id: other,
    owner_verified: false,
  });
  noSideEffects();
});
it("capacity remains bounded for unknown UUIDs without inventing visibility", async () => {
  await call("join_group");
  const second = await call("join_group", other);
  expect(pending.listPending()).toHaveLength(1);
  expect(second.result.details?.error).toBe(true);
  expect(pending.getByGroupId(other)).toBeUndefined();
  noSideEffects();
});
it("unknown expiry callback receives null metadata; expired approval makes no write", async () => {
  await call("join_group");
  vi.advanceTimersByTime(600_001);
  const approval = await call("approve_join");
  expect(expired).toHaveBeenCalledTimes(1);
  expect(expired.mock.calls[0][0]).toMatchObject({ ...unknown, id: expect.any(String) });
  expect(approval.result.details?.error).toBe(true);
  expect(pending.listPending()).toEqual([]);
  noSideEffects();
});
it("unknown removal callback receives null metadata through actual reject", async () => {
  await call("join_group");
  await call("reject_join");
  expect(removed).toHaveBeenCalledTimes(1);
  expect(removed.mock.calls[0][0]).toMatchObject({ ...unknown, id: expect.any(String) });
  expect(pending.listPending()).toEqual([]);
  noSideEffects();
});
it("only public discovery/membership reads precede approval, absent UUID is not private evidence", async () => {
  const { body } = await call("join_group");
  expect(api.getMyGroups).toHaveBeenCalled();
  expect(api.searchGroups).toHaveBeenCalled();
  noSideEffects();
  expect(body.group?.metadata_source).toBe("unknown");
  expect(body.message).not.toMatch(/private group|does not exist/i);
});
it("UUID-only input and conversational approval remain the public interface", () => {
  for (const name of ["join_group", "approve_join", "reject_join"]) {
    const tool = registry._registeredTools.find((t) => t.name === `meshimize_${name}`)!;
    expect(Object.keys(tool.parameters.properties)).toEqual(["group_id"]);
    expect(tool.parameters.properties.group_id.format).toBe("uuid");
  }
  expect(
    registry._registeredTools.find((t) => t.name === "meshimize_join_group")!.description,
  ).toMatch(/operator/);
});
