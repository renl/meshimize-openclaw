// OpenClaw §4.4.1 pending identity isolation; mock registry proxy only.
import { afterEach, expect, it, vi } from "vitest";
import { register, resetSharedState, waitForStartup } from "../src/plugin.js";
import { createMockPluginAPI } from "./__mocks__/openclaw-plugin-sdk/api.js";
const group = "10000000-0000-4000-8000-000000000001";
afterEach(() => {
  resetSharedState();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("same-key registration shares pending state; another key cannot approve the previous identity attempt", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const changed =
      (init?.headers as Record<string, string>)?.Authorization === "Bearer mshz_identity_B";
    const data = url.endsWith("/account")
      ? {
          id: "30000000-0000-4000-8000-000000000003",
          email: "fixture@example.com",
          display_name: "Owner",
          verified: false,
          current_identity: {
            id: changed
              ? "20000000-0000-4000-8000-000000000002"
              : "20000000-0000-4000-8000-000000000001",
            display_name: changed ? "B" : "A",
          },
          description: null,
          created_at: "2026-10-18T00:00:00Z",
          updated_at: "2026-10-18T00:00:00Z",
        }
      : url.includes("/discover/")
        ? [
            {
              id: group,
              name: "Public fixture",
              description: null,
              type: "qa",
              visibility: "public",
              owner: {
                id: "30000000-0000-4000-8000-000000000003",
                display_name: "Owner",
                verified: false,
              },
              member_count: 1,
              my_role: null,
            },
          ]
        : [];
    return new Response(JSON.stringify({ data, meta: { has_more: false, next_cursor: null } }));
  });
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  function instance(key: string) {
    const api = createMockPluginAPI({ apiKey: key, baseUrl: "http://example.invalid" });
    register(api);
    return api;
  }
  async function call(api: ReturnType<typeof instance>, name: string) {
    const r = await api._registeredTools
      .find((t) => t.name === `meshimize_${name}`)!
      .execute("fixture", { group_id: group });
    return { envelope: r, data: JSON.parse(r.content[0].text) };
  }
  const first = instance("mshz_identity_A");
  await waitForStartup();
  await call(first, "join_group");
  const original = (await call(first, "list_pending_joins")).data.pending_requests;
  expect(original).toHaveLength(1);
  const same = instance("mshz_identity_A");
  expect((await call(same, "list_pending_joins")).data.pending_requests).toEqual(original);
  const changed = instance("mshz_identity_B");
  await waitForStartup();
  const listed = (await call(changed, "list_pending_joins")).data.pending_requests;
  const approval = await call(changed, "approve_join");
  expect(
    fetch.mock.calls.filter(
      ([url, init]) => String(url).endsWith("/join") && init?.method === "POST",
    ),
  ).toHaveLength(0);
  expect(listed).toEqual([]);
  expect(approval.envelope.details?.error).toBe(true);
});
