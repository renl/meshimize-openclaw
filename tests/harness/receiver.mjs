// Test-only US-PGI-8 / OpenClaw §4.4.1: physical HTTP + Phoenix-v2 WS.
// Compiled registered tools, real service/socket/channel/buffer; not Gateway/private proof.
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
import { registerGroupTools } from "/proof/candidate/dist/tools/groups.js";
import { registerMessageTools } from "/proof/candidate/dist/tools/messages.js";
const { WebSocketServer } = createRequire("/proof/candidate/package.json")("ws");
const id = "10000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000002";
const question = "40000000-0000-4000-8000-000000000004";
const topic = `group:${id}`;
const page = (data) => ({ data, meta: { has_more: false, next_cursor: null } });
const data = (result) => JSON.parse(result.content[0].text);
async function until(predicate, label) {
  for (let i = 0; i < 600; i++) {
    if (predicate()) return;
    await delay(5);
  }
  throw Error(`fixture observation deadline: ${label}`);
}
async function flush() {
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
}
async function fixture(t) {
  const seen = { posts: 0, questions: 0, connections: 0, deliveries: 0, joins: [] };
  let member = false,
    mode = "hold",
    restAt;
  const group = {
    id,
    name: "Public receiver fixture",
    description: null,
    type: "qa",
    visibility: "public",
    owner: { id: actor, display_name: "Owner", verified: false },
    member_count: 1,
    my_role: "member",
  };
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    assert.equal(req.headers.authorization, "Bearer mshz_receiver_fixture");
    const path = new URL(req.url, "http://fixture").pathname;
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.method === "POST" && path.endsWith("/join")) {
      seen.posts++;
      member = true;
      assert.equal(body, "");
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
    } else if (req.method === "POST" && path.endsWith("/messages")) {
      seen.questions++;
      res.end(JSON.stringify({ data: { id: question } }));
    } else res.end(JSON.stringify(page(path.includes("discover") || member ? [group] : [])));
  });
  const wss = new WebSocketServer({ server, path: "/api/v1/ws/websocket" });
  const sockets = [];
  const reply = (join, status = "ok") =>
    join.ws.send(
      JSON.stringify([
        join.frame[0],
        join.frame[1],
        join.frame[2],
        "phx_reply",
        { status, response: {} },
      ]),
    );
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://fixture");
    assert.equal(url.searchParams.get("token"), "mshz_receiver_fixture");
    assert.equal(url.searchParams.get("vsn"), "2.0.0");
    seen.connections++;
    sockets.push(ws);
    ws.on("message", (bytes) => {
      const frame = JSON.parse(bytes.toString());
      if (frame[3] === "phx_join" && frame[2] === topic) {
        const join = { ws, frame };
        seen.joins.push(join);
        if (mode !== "hold") reply(join, mode === "refuse" ? "error" : "ok");
      } else reply({ ws, frame });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const api = new MeshimizeAPI({ baseUrl, apiKey: "mshz_receiver_fixture" });
  api.setRuntimeIdentity({
    account: group.owner,
    current_identity: { id: actor, display_name: "Actor" },
  });
  const joinGroup = api.joinGroup.bind(api);
  api.joinGroup = async (...args) => {
    const result = await joinGroup(...args);
    restAt = Date.now();
    return result;
  };
  const buffer = new MessageBuffer();
  const add = buffer.addGroupMessage.bind(buffer);
  buffer.addGroupMessage = (...args) => {
    seen.deliveries++;
    return add(...args);
  };
  const service = createWsService({
    api,
    messageBuffer: buffer,
    delegationContentBuffer: new DelegationContentBuffer(),
    config: {
      baseUrl,
      apiKey: "mshz_receiver_fixture",
      wsUrl: baseUrl.replace("http", "ws") + "/api/v1/ws/websocket",
    },
  });
  const pending = createPendingJoinMap({ joinTimeoutMs: 600000, maxPendingJoins: 2 });
  const tools = new Map(),
    registration = { registerTool: (tool) => tools.set(tool.name, tool) };
  registerGroupTools(registration, { api, pendingJoins: pending, wsService: service });
  registerMessageTools(registration, { api, messageBuffer: buffer, wsService: service });
  const call = (name) =>
    tools.get(`meshimize_${name}`).execute("fixture", {
      group_id: id,
      question: "Never post without current delivery",
      timeout_seconds: 1,
    });
  const push = (join, event = "new_message") =>
    join.ws.send(
      JSON.stringify([
        join.frame[0],
        null,
        topic,
        event,
        {
          id: "50000000-0000-4000-8000-000000000005",
          group_id: id,
          message_type: "answer",
          content: "One delivery",
          parent_message_id: question,
          sender: { id: actor, display_name: "Responder", verified: false },
          created_at: "2026-10-18T00:00:01Z",
        },
      ]),
    );
  t.after(async () => {
    t.mock.timers.reset();
    service.stop();
    pending.dispose();
    for (const ws of sockets) ws.terminate();
    await new Promise((r) => wss.close(r));
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    t.diagnostic(JSON.stringify({ ...seen, joins: seen.joins.map((j) => j.frame), restAt }));
  });
  await service.start();
  await call("join_group");
  assert.ok(pending.getByGroupId(id));
  return {
    seen,
    service,
    pending,
    buffer,
    call,
    reply,
    push,
    setMode: (value) => {
      mode = value;
    },
    restAt: () => restAt,
  };
}
function notReady(result) {
  assert.equal(data(result).group_id, id);
  assert.equal(data(result).joined, true);
  assert.equal(data(result).role, "member");
  assert.equal(data(result).membership_path_ready, null);
  assert.equal(data(result).receiver.ready, false);
  assert.equal(typeof data(result).receiver.reason, "string");
  assert.match(data(result).message, /meshimize_list_my_groups/);
  assert.match(data(result).message, /not.*(replay|retry)|do not.*(join|retry|replay)/i);
}
async function noQuestion(b) {
  const result = await b.call("ask_question");
  assert.equal(b.seen.questions, 0, "ZERO physical question POSTs");
  assert.equal(b.seen.posts, 1, "ZERO join replay");
  assert.equal(result.details.error, true, "observable delivery-not-ready error");
  assert.match(data(result).error, /delivery|receiver|ready/i);
}
for (const fault of ["refuse", "disconnected"]) {
  test(`accepted REST + ${fault}: truthful joined-not-ready`, { timeout: 20000 }, async (t) => {
    const b = await fixture(t);
    if (fault === "disconnected") b.service.getSocket().disconnect();
    else b.setMode("refuse");
    notReady(await b.call("approve_join"));
    assert.equal(b.pending.getByGroupId(id), undefined);
    assert.equal(b.seen.posts, 1);
  });
}
for (const event of ["phx_error", "phx_close", "disconnect"]) {
  test(
    `${event} after ready: first ask sends ZERO question/join POSTs`,
    { timeout: 20000 },
    async (t) => {
      const b = await fixture(t);
      b.setMode("ok");
      assert.equal(
        data(await b.call("approve_join")).membership_path_ready,
        "post_approval_first_ask",
      );
      const join = b.seen.joins.at(-1);
      b.setMode("refuse");
      if (event === "disconnect") {
        join.ws.terminate();
        await until(() => b.service.getSocket().getState() !== "connected", "actual disconnection");
      } else {
        b.push(join, event);
        await until(() => b.service.getSocket().channel(topic).getState() !== "joined", event);
      }
      await noQuestion(b);
    },
  );
}
test(
  "10s from REST success; recovery rejects obsolete ack and has one delivery",
  { timeout: 20000 },
  async (t) => {
    const b = await fixture(t);
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    let outcome;
    const approval = b.call("approve_join").then((r) => {
      outcome = r;
    });
    await until(() => b.seen.joins.length === 1, "withheld physical ack");
    await flush();
    assert.equal(b.restAt(), 0);
    assert.equal(outcome, undefined, "no early ready");
    t.mock.timers.tick(9999);
    await flush();
    t.mock.timers.tick(1);
    await flush();
    // No 11.5s race: application must settle by exactly REST success + 10000 virtual ms.
    assert.ok(outcome, "readiness must settle within exactly 10000ms of REST success");
    notReady(outcome);
    await approval;
    assert.equal(b.pending.getByGroupId(id), undefined);
    let recovered = false;
    const recovery = b.service.subscribeToGroup(id).then(() => {
      recovered = true;
    });
    await until(() => b.seen.joins.length === 2, "new physical recovery join");
    b.reply(b.seen.joins[0]);
    await delay(25);
    await flush();
    assert.equal(recovered, false, "obsolete reply cannot complete current attempt");
    b.push(b.seen.joins[0]);
    await delay(25);
    assert.equal(b.seen.deliveries, 0, "obsolete work cannot install a handler");
    b.reply(b.seen.joins[1]);
    await recovery;
    b.push(b.seen.joins[1]);
    await until(() => b.seen.deliveries > 0, "current answer");
    assert.equal(b.seen.deliveries, 1);
    assert.equal(b.seen.posts, 1);
    assert.equal(JSON.stringify(b.buffer.getGroupMessages(id)).includes("One delivery"), true);
  },
);
test(
  "actual reconnect overlaps approval/recovery: one join, all wait, one delivery",
  { timeout: 20000 },
  async (t) => {
    const b = await fixture(t);
    let approved = false;
    const approval = b.call("approve_join").then((r) => {
      approved = true;
      return r;
    });
    await until(() => b.seen.joins.length === 1, "initial approval join");
    b.seen.joins[0].ws.terminate();
    await until(
      () => b.seen.connections === 2 && b.seen.joins.length >= 2,
      "actual second WS handshake/rejoin",
    );
    let recovered = false;
    const recovery = b.service.subscribeToGroup(id).then(() => {
      recovered = true;
    });
    await delay(50);
    const early = recovered,
      joinCount = b.seen.joins.length;
    b.reply(b.seen.joins.at(-1));
    await recovery;
    const result = await approval;
    assert.equal(joinCount, 2, "one group join per actual connection/attempt");
    assert.equal(early, false, "recovery waits for current ack");
    // Approval may truthfully report lost receiver; it must never invent rollback or repeat REST.
    assert.equal(data(result).joined, true);
    assert.equal(approved, true);
    b.push(b.seen.joins.at(-1));
    await until(() => b.seen.deliveries > 0, "reconnected answer");
    assert.equal(b.seen.deliveries, 1);
    assert.equal(b.seen.posts, 1);
  },
);
for (const action of ["stop", "unsubscribe"]) {
  test(
    `${action} during outstanding ack: no late handler/readiness resurrection`,
    { timeout: 20000 },
    async (t) => {
      const b = await fixture(t);
      const approval = b.call("approve_join");
      await until(() => b.seen.joins.length === 1, "outstanding join");
      const old = b.seen.joins[0];
      if (action === "stop") {
        b.reply(old);
        b.service.stop();
      } else {
        await b.service.unsubscribeFromGroup(id);
        b.reply(old);
      }
      const result = await approval;
      if (old.ws.readyState === 1) b.push(old);
      await delay(50);
      assert.equal(b.seen.deliveries, 0, "cancelled completion attaches no buffer handler");
      notReady(result);
      assert.equal(b.seen.posts, 1);
      if (action === "stop") assert.equal(b.service.getSocket(), null);
    },
  );
}
