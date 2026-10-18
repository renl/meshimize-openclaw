// Test-only installed gateway probe. No mock register, no application imports.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire("/opt/runtime/package.json");
const { WebSocket, WebSocketServer } = require("ws");
const base = "http://localhost:4000",
  gateway = "http://127.0.0.1:18789";
const secrets = [],
  keys = [],
  groups = [];
let processGateway,
  raw = "",
  responder,
  proxy;
const sockets = new Set(),
  acknowledged = new Set();
let physicalJoinPosts = 0;
const result = { assertions: [], cleanup: "NOT_RUN" };
function scrub(s) {
  for (const v of secrets) if (v) s = s.split(v).join("[REDACTED]");
  return s.replace(/mshz_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]");
}
function pass(name) {
  result.assertions.push({ name, status: "PASS" });
  console.log(`PASS ${name}`);
}
async function api(path, method = "GET", auth = {}, body, status = 200) {
  const r = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { ...auth, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(r.status, status, `${method} ${path}: status only, body redacted`);
  return status === 204 ? null : r.json();
}
async function cli(args, deadline = 60000) {
  const child = spawn("openclaw", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let captured = "";
  for (const s of [child.stdout, child.stderr])
    s.on("data", (b) => {
      captured = (captured + b).slice(-2000000);
    });
  const timer = setTimeout(() => child.kill("SIGKILL"), deadline);
  const status = await new Promise((yes, no) => {
    child.once("exit", yes);
    child.once("error", no);
  }).finally(() => clearTimeout(timer));
  const text = scrub(captured);
  writeFileSync(`/proof/cli-${args[1]}.log`, text);
  assert.equal(
    status,
    0,
    `official CLI ${args.slice(0, 2).join(" ")} failed: ${text.slice(-5000)}`,
  );
  return text;
}
let session;
try {
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) })).ok) break;
    } catch {}
    assert.ok(Date.now() < deadline, "server health deadline");
    await delay(300);
  }
  pass("pinned real server health");
  const nonce = randomUUID(),
    password = `Proof-${nonce}!`;
  secrets.push(password);
  const owner = await api(
    "/auth/register",
    "POST",
    {},
    { email: `oc04-${nonce}@example.com`, display_name: "OC04 Owner", password },
    201,
  );
  secrets.push(owner.token);
  session = { "x-session-token": owner.token };
  async function keyFor(id) {
    const k = (
      await api(
        "/account/api-keys",
        "POST",
        session,
        { label: "OC04", ...(id ? { agent_identity_id: id } : {}) },
        201,
      )
    ).data;
    keys.push(k);
    secrets.push(k.key);
    return k;
  }
  const creator = await keyFor();
  const actingId = (
    await api("/account/identities", "POST", session, { display_name: "OC04 Acting" }, 201)
  ).data.id;
  const acting = await keyFor(actingId);
  const creatorAuth = { authorization: `Bearer ${creator.key}` };
  const creatorIdentity = (await api("/account", "GET", creatorAuth)).data.current_identity.id;
  const group = (
    await api(
      "/groups",
      "POST",
      creatorAuth,
      { name: `OC04 public ${nonce}`, type: "qa", visibility: "public" },
      201,
    )
  ).data.id;
  groups.push(group);
  result.actingIdentity = actingId;
  result.group = group;
  pass("public API creates disposable identity/key/group");
  // Physical transparent boundary observer: forward real HTTP/WS unchanged,
  // retain only successful join topics. Never store headers, frame bodies or keys.
  proxy = createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === `/api/v1/groups/${group}/join`) physicalJoinPosts++;
      const chunks = [];
      for await (const b of req) chunks.push(b);
      const body = Buffer.concat(chunks);
      const r = await fetch(`${base}${req.url}`, {
        method: req.method,
        headers: req.headers,
        ...(body.length ? { body } : {}),
        signal: AbortSignal.timeout(10000),
      });
      res.writeHead(r.status, {
        "content-type": r.headers.get("content-type") ?? "application/json",
      });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(502);
      res.end();
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  proxy.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (down) => {
      const up = new WebSocket(`ws://localhost:4000${req.url}`);
      sockets.add(down);
      sockets.add(up);
      const queued = [],
        joins = new Map();
      down.on("message", (b) => {
        try {
          const [, ref, topic, event] = JSON.parse(b.toString());
          if (event === "phx_join") joins.set(ref, topic);
        } catch {}
        if (up.readyState === WebSocket.OPEN) up.send(b.toString());
        else queued.push(b.toString());
      });
      up.on("open", () => {
        for (const b of queued) up.send(b);
      });
      up.on("message", (b) => {
        try {
          const [, ref, topic, event, payload] = JSON.parse(b.toString());
          if (event === "phx_reply" && payload.status === "ok" && joins.get(ref) === topic)
            acknowledged.add(topic);
        } catch {}
        if (down.readyState === WebSocket.OPEN) down.send(b.toString());
      });
      for (const ws of [up, down]) {
        ws.on("error", () => {
          up.terminate();
          down.terminate();
        });
        ws.on("close", () => {
          sockets.delete(ws);
          up.terminate();
          down.terminate();
        });
      }
    }),
  );
  await new Promise((r) => proxy.listen(4400, "127.0.0.1", r));
  const token = randomUUID() + randomUUID();
  secrets.push(token);
  process.env.OPENCLAW_GATEWAY_TOKEN = token;
  mkdirSync("/isolated-home/.openclaw", { recursive: true });
  const config = {
    gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } },
    tools: { alsoAllow: ["meshimize"] },
    plugins: {
      entries: {
        meshimize: {
          enabled: true,
          config: { apiKey: acting.key, baseUrl: "http://localhost:4400" },
        },
      },
    },
  };
  // Do not predeclare absent plugin entries: install first, then set activation config.
  writeFileSync(
    process.env.OPENCLAW_CONFIG_PATH,
    JSON.stringify({ gateway: config.gateway, tools: config.tools }),
  );
  // Reviewed local manifest: exactly the 21 approved Meshimize tools; no hooks,
  // providers, model access or subagent grants. Consent is isolated to this run.
  await cli(
    [
      "plugins",
      "install",
      "/proof/candidate/meshimize-openclaw-plugin-0.1.14.tgz",
      "--force",
      "--accept-capabilities",
    ],
    120000,
  );
  pass("official archive installation");
  const installed = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
  installed.plugins ??= {};
  installed.plugins.allow = ["meshimize"];
  installed.plugins.entries ??= {};
  installed.plugins.entries.meshimize = config.plugins.entries.meshimize;
  writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(installed));
  const inspected = await cli(["plugins", "inspect", "meshimize", "--runtime", "--json"]);
  result.inspectRetained = true;
  processGateway = spawn("openclaw", ["gateway", "run", "--bind", "loopback", "--port", "18789"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [processGateway.stdout, processGateway.stderr])
    stream.on("data", (b) => {
      raw = (raw + b).slice(-100000);
    });
  const ready = Date.now() + 45000;
  for (;;) {
    if (processGateway.exitCode !== null)
      throw Error(`Gateway exited ${processGateway.exitCode}: ${scrub(raw).slice(-7000)}`);
    try {
      const r = await fetch(`${gateway}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) break;
    } catch {}
    assert.ok(Date.now() < ready, `Gateway readiness timeout: ${scrub(raw).slice(-7000)}`);
    await delay(250);
  }
  pass("actual gateway listening");
  async function invoke(tool, args = {}) {
    const r = await fetch(`${gateway}/tools/invoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ tool, args, sessionKey: "main" }),
      signal: AbortSignal.timeout(100000),
    });
    const b = await r.json();
    assert.equal(r.status, 200, `gateway ${tool}: ${scrub(JSON.stringify(b)).slice(0, 2000)}`);
    assert.equal(b.ok, true);
    assert.notEqual(
      b.result.details?.error,
      true,
      `plugin ${tool} error: ${scrub(JSON.stringify(b.result)).slice(0, 2000)}`,
    );
    return JSON.parse(b.result.content[0].text);
  }
  const my = await invoke("meshimize_list_my_groups");
  assert.deepEqual(my.groups, []);
  assert.ok(raw.includes(actingId), "acting identity resolved by installed plugin");
  pass("gateway public tool reaches fixture and resolves acting identity");
  // Inspect is supporting evidence; service start is asserted from its real socket readiness log.
  const serviceDeadline = Date.now() + 10000;
  while (!acknowledged.has(`identity:${actingId}`)) {
    assert.ok(
      Date.now() < serviceDeadline,
      "meshimize-ws physical identity receiver start deadline",
    );
    await delay(100);
  }
  pass("gateway started meshimize-ws identity receiver");
  const info = JSON.parse(inspected.slice(inspected.indexOf("{")));
  const serialized = JSON.stringify(info);
  const names = [...new Set(serialized.match(/meshimize_[a-z_]+/g) ?? [])];
  assert.equal(names.length, 21, "runtime inspect registered 21 tools");
  result.tools = names;
  pass("21 runtime registered meshimize tools");
  // Responder uses physical Phoenix V2, no plugin internals.
  responder = new WebSocket(
    `ws://localhost:4000/api/v1/ws/websocket?token=${encodeURIComponent(creator.key)}&vsn=2.0.0`,
  );
  let ref = 0;
  const pending = new Map();
  let answerError;
  const fact = `oc04-answer-${nonce}`;
  secrets.push(fact);
  responder.on("message", (b) => {
    const [jr, r, topic, event, payload] = JSON.parse(b.toString());
    if (event === "phx_reply") pending.get(r)?.(payload);
    if (event === "new_message") {
      const m = payload.data ?? payload;
      if (m.message_type === "question")
        api(
          `/groups/${group}/messages`,
          "POST",
          creatorAuth,
          { content: fact, message_type: "answer", parent_message_id: m.id },
          201,
        ).catch((e) => (answerError = e));
    }
  });
  await new Promise((yes, no) => {
    responder.once("open", yes);
    responder.once("error", no);
    setTimeout(() => no(Error("responder open timeout")), 5000).unref();
  });
  const joinRef = String(++ref);
  const joined = new Promise((yes, no) => {
    pending.set(joinRef, yes);
    setTimeout(() => no(Error("responder join timeout")), 5000).unref();
  });
  responder.send(JSON.stringify([joinRef, joinRef, `group:${group}`, "phx_join", {}]));
  assert.equal((await joined).status, "ok");
  const request = await invoke("meshimize_join_group", { group_id: group });
  assert.equal(request.status, "pending_operator_approval");
  await invoke("meshimize_approve_join", { group_id: group });
  const groupDeadline = Date.now() + 10000;
  while (!acknowledged.has(`group:${group}`)) {
    assert.ok(Date.now() < groupDeadline, "plugin physical group receiver readiness");
    await delay(100);
  }
  const answer = await invoke("meshimize_ask_question", {
    group_id: group,
    question: "Return disposable public baseline fact",
    timeout_seconds: 90,
  });
  assert.ifError(answerError);
  assert.equal(answer.answered, true);
  assert.equal(answer.answer.content, fact);
  assert.equal(answer.answer.responder_identity_id, creatorIdentity);
  assert.equal(answer.group_id, group);
  assert.ok(answer.question_id);
  assert.equal(physicalJoinPosts, 1);
  const members = (await api(`/groups/${group}/members`, "GET", creatorAuth)).data;
  assert.ok(members.some((m) => m.agent_identity_id === actingId && m.role === "member"));
  assert.ok(members.some((m) => m.agent_identity_id === creatorIdentity && m.role === "owner"));
  assert.equal(members.length, 2);
  pass("actual plugin public question receives correlated useful answer");
} catch (e) {
  result.failure = scrub(e.stack ?? String(e));
  console.error(result.failure);
  process.exitCode = 1;
} finally {
  responder?.terminate();
  if (processGateway) {
    processGateway.kill("SIGTERM");
    await Promise.race([new Promise((r) => processGateway.once("exit", r)), delay(5000)]);
    if (processGateway.exitCode === null) processGateway.kill("SIGKILL");
  }
  try {
    for (const g of groups)
      await api(
        `/groups/${g}`,
        "DELETE",
        { authorization: `Bearer ${keys[0].key}` },
        undefined,
        204,
      );
    for (const k of keys) await api(`/account/api-keys/${k.id}`, "DELETE", session);
    result.cleanup = "PASS";
  } catch (e) {
    result.cleanup = "FAIL";
    result.cleanupFailure = scrub(e.message);
    process.exitCode = 1;
  }
  for (const ws of sockets) ws.terminate();
  proxy?.closeAllConnections();
  proxy?.close();
  result.acknowledgedTopics = [...acknowledged];
  result.physicalJoinPosts = physicalJoinPosts;
  writeFileSync("/proof/gateway-redacted.log", scrub(raw));
  writeFileSync("/proof/result.json", JSON.stringify(result, null, 2));
}
