// Test-only US-PGI-8 / OpenClaw §4.4.1 steps2 + refusal/uncertainty rows.
// Real loopback HTTP + compiled registration/result envelopes; NOT Gateway/receiver proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MeshimizeAPI } from "/proof/candidate/dist/api/client.js";
import { createPendingJoinMap } from "/proof/candidate/dist/state/pending-joins.js";
import { registerGroupTools } from "/proof/candidate/dist/tools/groups.js";
const id = "10000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000002";
const group = {
  id,
  name: "Public safety fixture",
  description: null,
  type: "qa",
  visibility: "public",
  owner: { id: actor, display_name: "Owner", verified: false },
  member_count: 1,
  my_role: null,
};
const page = (data) => ({ data, meta: { has_more: false, next_cursor: null } });
async function fixture(t, fault) {
  const seen = { posts: 0, reads: 0, subscriptions: 0, bodies: [], auth: [] };
  let member = false;
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    const path = new URL(req.url, "http://fixture").pathname;
    if (req.method === "POST" && path === `/api/v1/groups/${id}/join`) {
      seen.posts++;
      seen.auth.push(req.headers.authorization);
      let body = "";
      for await (const chunk of req) body += chunk;
      seen.bodies.push(body);
      // Keep the physical request in flight while the second approval enters.
      await new Promise((r) => setTimeout(r, 40));
      if (fault === "drop") {
        member = true;
        req.socket.destroy();
        return;
      }
      if (typeof fault === "number") {
        res.writeHead(fault, { "Retry-After": "0" });
        res.end(JSON.stringify({ error: "Fixture refusal" }));
        return;
      }
      member = true;
      res.end(
        JSON.stringify(
          fault === "malformed"
            ? { data: null }
            : {
                data: {
                  group_id: id,
                  agent_identity_id: actor,
                  role: "member",
                  inserted_at: "2026-10-18T00:00:00Z",
                  created_at: "2026-10-18T00:00:00Z",
                },
              },
        ),
      );
      return;
    }
    seen.reads++;
    res.end(
      JSON.stringify(
        page(
          path === "/api/v1/discover/groups"
            ? [group]
            : member
              ? [{ ...group, my_role: "member" }]
              : [],
        ),
      ),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const api = new MeshimizeAPI({
    apiKey: "mshz_safety_fixture",
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  });
  api.setRuntimeIdentity({
    account: group.owner,
    current_identity: { id: actor, display_name: "Actor" },
  });
  const pending = createPendingJoinMap({ joinTimeoutMs: 600000, maxPendingJoins: 2 });
  const tools = new Map();
  registerGroupTools(
    { registerTool: (tool) => tools.set(tool.name, tool) },
    {
      api,
      pendingJoins: pending,
      // Safety-only observer. Successful receiver behavior is deliberately NOT asserted here.
      wsService: {
        subscribeToGroup: async () => {
          seen.subscriptions++;
        },
      },
    },
  );
  const call = (name) => tools.get(`meshimize_${name}`).execute("fixture", { group_id: id });
  t.after(() => {
    t.diagnostic(JSON.stringify({ fault, ...seen }));
    pending.dispose();
    server.closeAllConnections();
    server.close();
  });
  await call("join_group");
  assert.ok(
    pending.getByGroupId(id),
    "public pending setup must be reachable without nullable expansion",
  );
  assert.equal(seen.posts, 0, "requesting approval never writes");
  return { api, pending, call, seen };
}
function single(seen) {
  assert.equal(seen.posts, 1, "exactly one physical join POST");
  assert.deepEqual(seen.bodies, [""], "no identity override/body");
  assert.deepEqual(seen.auth, ["Bearer mshz_safety_fixture"]);
}
const text = (r) => r.content.map((c) => c.text).join("\n");
for (const fault of [429, "drop"]) {
  test(`request ${fault}: no automatic retry`, { timeout: 20000 }, async (t) => {
    const b = await fixture(t, fault);
    await assert.rejects(b.api.joinGroup(id));
    single(b.seen);
  });
}
for (const status of [403, 404, 409, 429]) {
  test(
    `registered ${status}: retain pending, fresh approval only`,
    { timeout: 20000 },
    async (t) => {
      const b = await fixture(t, status),
        before = { ...b.pending.getByGroupId(id) };
      const result = await b.call("approve_join");
      single(b.seen);
      assert.equal(result.details.error, true);
      assert.equal(b.seen.subscriptions, 0);
      assert.deepEqual(b.pending.getByGroupId(id), before);
      assert.match(text(result), /(fresh|explicit).*approv/i);
      assert.match(text(result), /no automatic|not.*(retry|replay)|do not.*(retry|replay)/i);
      const count = b.seen.posts;
      await b.call("list_pending_joins");
      await b.call("list_my_groups");
      assert.equal(b.seen.posts, count, "read/list does not replay refused approval");
    },
  );
}
for (const fault of [503, "drop", "malformed"]) {
  test(
    `registered ${fault}: uncertain clears replay and directs membership check`,
    { timeout: 20000 },
    async (t) => {
      const b = await fixture(t, fault);
      const result = await b.call("approve_join");
      single(b.seen);
      assert.equal(result.details.error, true);
      assert.equal(b.pending.getByGroupId(id), undefined);
      assert.equal(b.seen.subscriptions, 0);
      assert.match(text(result), /(may|might|uncertain)/i);
      assert.match(text(result), /meshimize_list_my_groups/);
      await b.call("approve_join");
      await b.call("list_my_groups");
      single(b.seen);
    },
  );
}
for (const fault of ["ok", 403, "drop"]) {
  test(
    `concurrent registered ${fault}: one in-flight physical write`,
    { timeout: 20000 },
    async (t) => {
      const b = await fixture(t, fault);
      await Promise.all([b.call("approve_join"), b.call("approve_join")]);
      single(b.seen);
      if (fault !== "ok") assert.equal(b.seen.subscriptions, 0);
    },
  );
}
test("rejection does not emit POSTs", { timeout: 20000 }, async (t) => {
  const b = await fixture(t, "ok");
  await b.call("reject_join");
  await b.call("approve_join");
  assert.equal(b.seen.posts, 0);
  // Existing deterministic expiry unit remains in the preserved28; no wall-clock wait here.
});
