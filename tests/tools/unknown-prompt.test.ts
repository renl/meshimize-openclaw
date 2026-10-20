// US-PGI-8 / private-group-invitations §14.2–14.3. Registered public tool.
// API doubles: not installed Gateway/private-answer acceptance.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPendingJoinMap } from "../../src/state/pending-joins.js";
import { registerGroupTools, type GroupToolDeps } from "../../src/tools/groups.js";
import { createMockPluginAPI } from "../__mocks__/openclaw-plugin-sdk/api.js";
const id = "10000000-0000-4000-8000-000000000001";
const page = { data: [], meta: { has_more: false, next_cursor: null } };
const corrected = `Group ID ${id}: details and eligibility are unverified. Compare this ID with a trusted source before approving. Approval only attempts the join and may be denied.`;
const broken = `A join request for group ID ${id} is already pending operator approval. Meshimize returned no verified public metadata for this ID, so its details and your eligibility are unverified. No public details does not verify existence or eligibility. Compare the ID with your trusted source before approving. The request pending-1 expires at 2026-10-20T13:00:00.000Z.`;
function warnings(message: string) {
  expect(message).toContain(id);
  expect(message).toMatch(/details[\s\S]*eligibility[\s\S]*(unverified|not verified)/i);
  expect(message).toMatch(/compare[\s\S]*\bid\b[\s\S]*trusted source[\s\S]*approv/i);
  expect(message).toMatch(/approval[\s\S]*only attempts?[\s\S]*join[\s\S]*may be denied/i);
}
it("corrected prompt independently satisfies every warning meaning", () => warnings(corrected));
it("current broken repeat is independently rejected", () => {
  expect(() => warnings(broken)).toThrow();
});
let pending: ReturnType<typeof createPendingJoinMap>;
let registry: ReturnType<typeof createMockPluginAPI>;
const api = {
  getMyGroups: vi.fn(),
  searchGroups: vi.fn(),
  joinGroup: vi.fn(),
  getGroup: vi.fn(),
  postMessage: vi.fn(),
};
const subscribe = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  api.getMyGroups.mockResolvedValue(page);
  api.searchGroups.mockResolvedValue(page);
  pending = createPendingJoinMap({ joinTimeoutMs: 600000, maxPendingJoins: 10 });
  registry = createMockPluginAPI();
  registerGroupTools(registry, {
    api,
    pendingJoins: pending,
    wsService: { subscribeToGroup: subscribe },
  } as unknown as GroupToolDeps);
});
afterEach(() => pending?.dispose());
async function call() {
  const result = await registry._registeredTools
    .find((t) => t.name === "meshimize_join_group")!
    .execute("prompt-contract", { group_id: id });
  expect(result.details?.error).not.toBe(true);
  return JSON.parse(result.content[0].text);
}
it.each([false, true])(
  "unknown prompt has all warnings; repeat=%s without replay or writes",
  async (repeat) => {
    const first = await call();
    const stored = structuredClone(pending.getByGroupId(id));
    const data = repeat ? await call() : first;
    expect(data.status).toBe(repeat ? "already_pending" : "pending_operator_approval");
    expect(data.pending_request_id).toBe(first.pending_request_id);
    expect(data.group).toEqual({
      id,
      metadata_source: "unknown",
      name: null,
      description: null,
      type: null,
      owner_name: null,
      owner_verified: null,
    });
    expect(pending.getByGroupId(id)).toEqual(stored);
    expect(api.getMyGroups).toHaveBeenCalledTimes(1);
    expect(api.searchGroups).toHaveBeenCalledTimes(1);
    expect(api.joinGroup).not.toHaveBeenCalled();
    expect(api.getGroup).not.toHaveBeenCalled();
    expect(api.postMessage).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    warnings(data.message);
  },
);
