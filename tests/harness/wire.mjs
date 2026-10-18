// US-PGI-8/OpenClaw §4.4.1 physical transport supporting tests, NOT installed-runtime proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { MeshimizeAPI } from "/proof/candidate/dist/api/client.js";
import { createWsService } from "/proof/candidate/dist/services/ws-manager.js";
import { MessageBuffer } from "/proof/candidate/dist/buffer/message-buffer.js";
import { DelegationContentBuffer } from "/proof/candidate/dist/buffer/delegation-content-buffer.js";
import { createPendingJoinMap } from "/proof/candidate/dist/state/pending-joins.js";
import { approveJoinHandler } from "/proof/candidate/dist/tools/groups.js";
const { WebSocketServer } = createRequire("/opt/runtime/package.json")("ws");
const id = "10000000-0000-4000-8000-000000000001",
  actor = "20000000-0000-4000-8000-000000000002",
  account = "30000000-0000-4000-8000-000000000003";
async function boundary(t, fault = "ok") {
  let posts = 0,
    groupJoin,
    groupRef,
    groupSocket;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === `/api/v1/groups/${id}/join`) {
      posts++;
      assert.equal(req.headers.authorization, "Bearer mshz_transport_fixture");
      if (fault === "drop") {
        req.socket.destroy();
        return;
      }
      if (fault === "429") {
        res.writeHead(429, { "Retry-After": "0" });
        res.end(JSON.stringify({ error: "Rate limited" }));
        return;
      }
      res.end(
        JSON.stringify({
          data: {
            group_id: id,
            agent_identity_id: actor,
            role: "member",
            inserted_at: "2026-10-18T00:00:00Z",
            created_at: "2026-10-18T00:00:00Z",
          },
        }),
      );
      return;
    }
    res.end(JSON.stringify({ data: [], meta: { has_more: false, next_cursor: null } }));
  });
  const wss = new WebSocketServer({ server });
  let physicalJoins = 0;
  wss.on("connection", (ws) =>
    ws.on("message", (b) => {
      const [jr, ref, topic, event] = JSON.parse(b.toString());
      if (event === "phx_join") {
        physicalJoins++;
        if (topic === `group:${id}`) {
          groupJoin = jr;
          groupRef = ref;
          groupSocket = ws;
          if (fault === "delay") return;
        }
        const status = topic === `group:${id}` && fault === "refuse" ? "error" : "ok";
        ws.send(
          JSON.stringify([
            jr,
            ref,
            topic,
            "phx_reply",
            { status, response: status === "ok" ? {} : { reason: "not_a_member" } },
          ]),
        );
      }
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  t.after(() => {
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    server.closeAllConnections();
    server.close();
  });
  const config = {
    apiKey: "mshz_transport_fixture",
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/api/v1/ws/websocket`,
  };
  const api = new MeshimizeAPI(config);
  const runtimeIdentity = {
    account: { id: account, display_name: "Fixture account", verified: false },
    current_identity: { id: actor, display_name: "Fixture acting identity" },
  };
  api.setRuntimeIdentity(runtimeIdentity);
  return {
    api,
    config,
    runtimeIdentity,
    posts: () => posts,
    joins: () => physicalJoins,
    ack: () =>
      groupSocket.send(
        JSON.stringify([
          groupJoin,
          groupRef,
          `group:${id}`,
          "phx_reply",
          { status: "ok", response: {} },
        ]),
      ),
    groupJoined: () => !!groupRef,
  };
}
for (const fault of ["429", "drop"])
  test(`physical ${fault}: join emits one HTTP POST`, { timeout: 15000 }, async (t) => {
    const b = await boundary(t, fault);
    await assert.rejects(b.api.joinGroup(id));
    assert.equal(b.posts(), 1, "no automatic join replay at physical HTTP boundary");
  });
for (const fault of ["refuse", "delay"])
  test(
    `physical WS ${fault}: REST membership is not receiver readiness`,
    { timeout: 16000 },
    async (t) => {
      const b = await boundary(t, fault);
      const service = createWsService({
        ...b,
        messageBuffer: new MessageBuffer(),
        delegationContentBuffer: new DelegationContentBuffer(),
      });
      const pending = createPendingJoinMap({ joinTimeoutMs: 600000, maxPendingJoins: 2 });
      t.after(() => {
        service.stop();
        pending.dispose();
      });
      pending.add({
        id,
        name: "Wire fixture",
        description: null,
        type: "qa",
        owner: { id: account, display_name: "Fixture account", verified: false },
      });
      await service.start();
      const approval = approveJoinHandler(
        { group_id: id },
        { api: b.api, wsService: service, pendingJoins: pending },
      );
      const result = await Promise.race([
        approval,
        delay(11500).then(() => {
          throw Error("10-second readiness bound exceeded");
        }),
      ]);
      assert.equal(b.posts(), 1);
      assert.equal(b.joins(), 2, "identity and group physical joins");
      assert.equal(result.joined, true);
      assert.equal(result.membership_path_ready, null);
      assert.equal(result.receiver.ready, false);
    },
  );
