// Physical HTTP request contract proxy, not installed Gateway/private-server proof.
// No fetch/client stubs: every request reaches the socket; count forbidden writes too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { register, resetSharedState, waitForStartup } from "/proof/candidate/dist/plugin.js";
const group = "10000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000001";
const account = "30000000-0000-4000-8000-000000000001";
const page = (data) => ({ data, meta: { has_more: false, next_cursor: null } });
for (const fault of [
  "absent",
  "malformed",
  "membershipMalformed",
  "discovery403",
  "membership403",
  "reconfigure",
]) {
  test(`preapproval physical allowlist: ${fault}`, { timeout: 15000 }, async (t) => {
    const requests = [],
      upgrades = [];
    t.after(() => t.diagnostic(JSON.stringify({ fault, requests, upgrades })));
    const allowed = new Set([
      "GET /api/v1/account",
      "GET /api/v1/groups",
      "GET /api/v1/discover/groups",
    ]);
    const server = createServer((req, res) => {
      const path = new URL(req.url, "http://fixture");
      const signature = `${req.method} ${path.pathname}`;
      requests.push({
        signature,
        auth: req.headers.authorization,
        query: [...path.searchParams.keys()],
      });
      res.setHeader("content-type", "application/json");
      if (!allowed.has(signature)) {
        res.writeHead(418);
        res.end("{}");
        return;
      }
      if (
        (fault === "discovery403" && path.pathname.includes("discover")) ||
        (fault === "membership403" && path.pathname === "/api/v1/groups")
      ) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: "fixture denied" }));
        return;
      }
      const data =
        path.pathname === "/api/v1/account"
          ? {
              data: {
                id: account,
                email: "fixture@example.com",
                display_name: "Owner",
                verified: false,
                description: null,
                current_identity: {
                  id:
                    req.headers.authorization === "Bearer mshz_other_identity"
                      ? "20000000-0000-4000-8000-000000000002"
                      : actor,
                  display_name: "Acting",
                },
                created_at: "2026-10-18T00:00:00Z",
                updated_at: "2026-10-18T00:00:00Z",
              },
            }
          : (fault === "malformed" && path.pathname.includes("discover")) ||
              (fault === "membershipMalformed" && path.pathname === "/api/v1/groups")
            ? { data: null }
            : fault === "reconfigure" && path.pathname.includes("discover")
              ? page([
                  {
                    id: group,
                    name: "Public fixture",
                    description: null,
                    type: "qa",
                    visibility: "public",
                    owner: { id: account, display_name: "Owner", verified: false },
                    member_count: 1,
                    my_role: null,
                  },
                ])
              : page([]);
      res.end(JSON.stringify(data));
    });
    server.on("upgrade", (req, socket) => {
      upgrades.push(req.url);
      socket.destroy();
    });
    await new Promise((yes) => server.listen(0, "127.0.0.1", yes));
    t.after(() => {
      resetSharedState();
      server.closeAllConnections();
      server.close();
    });
    function instance(key) {
      const tools = new Map();
      register({
        pluginConfig: { apiKey: key, baseUrl: `http://127.0.0.1:${server.address().port}` },
        registerTool: (tool) => tools.set(tool.name, tool),
        registerService() {},
        logger: { info() {}, warn() {}, error() {}, debug() {} },
      });
      return tools;
    }
    const tools = instance("mshz_wire");
    await waitForStartup();
    const result = await tools.get("meshimize_join_group").execute("wire", { group_id: group });
    if (fault === "reconfigure") {
      const same = instance("mshz_wire");
      const list = async (registry) =>
        JSON.parse(
          (await registry.get("meshimize_list_pending_joins").execute("wire", {})).content[0].text,
        ).pending_requests;
      assert.equal((await list(tools)).length, 1);
      assert.deepEqual(await list(same), await list(tools));
      const changed = instance("mshz_other_identity");
      await waitForStartup();
      const approvals = [];
      for (const registry of [tools, same, changed]) {
        approvals.push(
          await registry.get("meshimize_approve_join").execute("wire", { group_id: group }),
        );
      }
      assert.deepEqual(
        requests.filter((r) => r.signature.startsWith("POST ")),
        [],
        "retained-first approvals emit zero physical join writes",
      );
      for (const approval of approvals) assert.equal(approval.details?.error, true);
      assert.deepEqual(await list(changed), []);
      return;
    }
    // Evaluate the complete physical trace before nullable assertions can fail.
    assert.deepEqual(
      requests.filter((r) => !allowed.has(r.signature)),
      [],
      "no private read/write",
    );
    assert.deepEqual(upgrades, [], "preapproval must not start a group subscription");
    assert.ok(
      requests.every((r) => r.auth === "Bearer mshz_wire"),
      "configured identity key only",
    );
    assert.ok(requests.some((r) => r.signature === "GET /api/v1/account"));
    assert.ok(requests.some((r) => r.signature === "GET /api/v1/groups"));
    if (!["membership403", "membershipMalformed"].includes(fault))
      assert.ok(requests.some((r) => r.signature === "GET /api/v1/discover/groups"));
    const body = JSON.parse(result.content[0].text);
    for (const request of requests) {
      const allowedQuery = request.signature.endsWith("/discover/groups")
        ? ["q", "type", "limit", "after"]
        : request.signature.endsWith("/groups")
          ? ["limit", "after"]
          : [];
      assert.ok(
        request.query.every((key) => allowedQuery.includes(key)),
        "no identity/account override query",
      );
    }
    if (fault === "absent") {
      assert.notEqual(result.details?.error, true);
      assert.equal(body.group.metadata_source, "unknown");
      await tools.get("meshimize_reject_join").execute("wire", { group_id: group });
    } else {
      assert.equal(result.details?.error, true, "failed/malformed lookup is never unknown pending");
      const listed = await tools.get("meshimize_list_pending_joins").execute("wire", {});
      assert.deepEqual(JSON.parse(listed.content[0].text).pending_requests, []);
    }
    assert.deepEqual(
      requests.filter((r) => !allowed.has(r.signature)),
      [],
    );
  });
}
