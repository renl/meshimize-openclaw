// Test-only installed-plugin useful-workflow proof. Review setup BEFORE execution.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
const { WebSocket, WebSocketServer } = createRequire("/opt/runtime/package.json")("ws");
const path = process.argv[2];
assert.ok(["owner", "invited"].includes(path));
const base = "http://localhost:4000",
  gateway = "http://127.0.0.1:18789";
const secrets = [],
  sockets = new Set(),
  topics = new Set(),
  requests = [];
const result = { path, assertions: [], cleanup: "NOT_RUN" };
let child,
  proxy,
  responder,
  raw = "";
const scrub = (s) => secrets.reduce((v, k) => v.split(k).join("[REDACTED]"), String(s));
const pass = (name) => result.assertions.push({ name, status: "PASS" });
async function until(fn, ms, label) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    assert.ok(Date.now() < end, label);
    await delay(100);
  }
}
async function api(route, method = "GET", auth = {}, body, status = 200) {
  const r = await fetch(`${base}/api/v1${route}`, {
    method,
    headers: { ...auth, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(r.status, status, `${method} ${route} status (body redacted)`);
  return status === 204 ? null : r.json();
}
async function cli(args) {
  const p = spawn("openclaw", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let text = "";
  for (const s of [p.stdout, p.stderr]) s.on("data", (b) => (text = (text + b).slice(-200000)));
  const timer = setTimeout(() => p.kill("SIGKILL"), 120000);
  const code = await new Promise((yes, no) => {
    p.once("exit", yes);
    p.once("error", no);
  }).finally(() => clearTimeout(timer));
  writeFileSync("/proof/install-redacted.log", scrub(text));
  assert.equal(code, 0, "official plugin archive install");
}
try {
  await until(
    async () => {
      try {
        return (await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    60000,
    "server ready",
  );
  const nonce = randomUUID(),
    password = `Proof-${nonce}!`;
  secrets.push(password);
  async function account(label) {
    const email = `${label}-${nonce}@example.com`;
    const a = await api(
      "/auth/register",
      "POST",
      {},
      { email, display_name: label, password },
      201,
    );
    secrets.push(a.token);
    const session = { "x-session-token": a.token };
    async function key(identity) {
      const k = (
        await api(
          "/account/api-keys",
          "POST",
          session,
          { label, ...(identity ? { agent_identity_id: identity } : {}) },
          201,
        )
      ).data;
      secrets.push(k.key);
      return { authorization: `Bearer ${k.key}` };
    }
    async function identity(name) {
      const id = (await api("/account/identities", "POST", session, { display_name: name }, 201))
        .data.id;
      return { id, auth: await key(id) };
    }
    const auth = await key();
    return {
      email,
      auth,
      identity,
      defaultId: (await api("/account", "GET", auth)).data.current_identity.id,
    };
  }
  const owner = await account("Owner"),
    invitee = path === "invited" ? await account("Invitee") : owner;
  const acting = await invitee.identity("Intended acting identity");
  const control = await invitee.identity("Unjoined control sibling");
  const existing = await owner.identity("Existing member");
  const groups = [];
  for (const label of ["target", "control"]) {
    const id = (
      await api(
        "/groups",
        "POST",
        owner.auth,
        { name: `${label}-${nonce}`, type: "qa", visibility: "private" },
        201,
      )
    ).data.id;
    groups.push(id);
    await api(`/groups/${id}/join`, "POST", existing.auth, undefined, 201);
  }
  const [target, controlGroup] = groups;
  async function memberships() {
    return Object.fromEntries(
      await Promise.all(
        groups.map(async (id) => {
          const response = await api(`/groups/${id}/members`, "GET", owner.auth);
          assert.equal(response.meta.has_more, false, "snapshot must contain every membership");
          const rows = response.data;
          return [id, Object.fromEntries(rows.map((m) => [m.agent_identity_id, m]))];
        }),
      ),
    );
  }
  const before = await memberships();
  if (path === "invited") {
    const invitation = (
      await api(`/groups/${target}/invitations`, "POST", owner.auth, { email: invitee.email }, 201)
    ).data;
    await api(`/invitations/${invitation.id}/accept`, "POST", acting.auth);
    assert.deepEqual(await memberships(), before, "acceptance grants eligibility, not membership");
  }
  for (const id of groups) {
    assert.equal(before[id][acting.id], undefined);
    assert.equal(before[id][control.id], undefined);
    assert.equal(before[id][owner.defaultId].role, "owner");
    assert.equal(before[id][existing.id].role, "member");
  }
  const actingId = (await api("/account", "GET", acting.auth)).data.current_identity.id;
  assert.equal(actingId, acting.id);
  pass("prerequisites preserve complete target/control membership maps");
  // Transparent physical observer forwards real server responses, never fabricates endpoints.
  proxy = createServer(async (req, res) => {
    try {
      requests.push(`${req.method} ${new URL(req.url, base).pathname}`);
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
  const attemptedTopics = [];
  const wss = new WebSocketServer({ noServer: true });
  proxy.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, (down) => {
      const up = new WebSocket(`ws://localhost:4000${req.url}`),
        queued = [],
        refs = new Map();
      sockets.add(up);
      sockets.add(down);
      down.on("message", (b) => {
        const [, ref, topic, event] = JSON.parse(b.toString());
        if (event === "phx_join") {
          attemptedTopics.push(topic);
          refs.set(ref, topic);
        }
        if (up.readyState === WebSocket.OPEN) up.send(b.toString());
        else queued.push(b.toString());
      });
      up.on("open", () => queued.forEach((b) => up.send(b)));
      up.on("message", (b) => {
        const [, ref, topic, event, payload] = JSON.parse(b.toString());
        if (event === "phx_reply" && payload.status === "ok" && refs.get(ref) === topic)
          topics.add(topic);
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
  await new Promise((yes) => proxy.listen(4400, "127.0.0.1", yes));
  const token = randomUUID() + randomUUID();
  secrets.push(token);
  process.env.OPENCLAW_GATEWAY_TOKEN = token;
  mkdirSync("/isolated-home/.openclaw", { recursive: true });
  const config = {
    gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } },
    tools: { alsoAllow: ["meshimize"] },
  };
  writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
  const version = JSON.parse(readFileSync("/proof/candidate/package.json")).version;
  await cli([
    "plugins",
    "install",
    `/proof/candidate/meshimize-openclaw-plugin-${version}.tgz`,
    "--force",
    "--accept-capabilities",
  ]);
  const installed = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH));
  installed.plugins ??= {};
  installed.plugins.allow = ["meshimize"];
  installed.plugins.entries ??= {};
  installed.plugins.entries.meshimize = {
    enabled: true,
    config: { apiKey: acting.auth.authorization.slice(7), baseUrl: "http://localhost:4400" },
  };
  writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(installed));
  child = spawn("openclaw", ["gateway", "run", "--bind", "loopback", "--port", "18789"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const s of [child.stdout, child.stderr])
    s.on("data", (b) => (raw = (raw + b).slice(-100000)));
  await until(
    async () => {
      assert.equal(child.exitCode, null, "Gateway running");
      try {
        return (await fetch(`${gateway}/health`, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    45000,
    "Gateway ready",
  );
  async function invoke(tool, args = {}) {
    const r = await fetch(`${gateway}/tools/invoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ tool, args, sessionKey: "main" }),
      signal: AbortSignal.timeout(100000),
    });
    const b = await r.json();
    assert.equal(r.status, 200);
    assert.equal(b.ok, true);
    assert.notEqual(b.result.details?.error, true, `${tool}: ${scrub(JSON.stringify(b.result))}`);
    return JSON.parse(b.result.content[0].text);
  }
  // Exact draft public workflow, UX openclaw-setup.md §Join a private group.
  // Explicit operator conversation is an auditable fixture input, not inferred consent.
  result.instructions = [
    "Confirm the API key's acting identity before joining.",
    { tool: "meshimize_join_group", args: { group_id: target } },
    "No public details does not verify existence or eligibility. Compare the ID with your trusted source before approving.",
    `Operator: I compared ${target} with the trusted group owner's ID. Approve joining as ${acting.id}.`,
    { tool: "meshimize_approve_join", args: { group_id: target } },
    { tool: "meshimize_list_my_groups", args: {} },
    "Wait for the group receiver and authorized responder before asking.",
    {
      tool: "meshimize_ask_question",
      args: {
        group_id: target,
        question: "What is the run-specific private recovery instruction?",
        timeout_seconds: 90,
      },
    },
  ];
  await invoke("meshimize_list_my_groups");
  assert.ok(raw.includes(acting.id), "installed plugin resolves intended identity");
  await until(() => topics.has(`identity:${acting.id}`), 10000, "identity receiver ready");
  const request = await invoke("meshimize_join_group", { group_id: target });
  assert.equal(request.status, "pending_operator_approval");
  assert.equal(request.group.metadata_source, "unknown");
  assert.ok(request.message.includes(target));
  const allowed = new Set([
    "GET /api/v1/account",
    "GET /api/v1/groups",
    "GET /api/v1/discover/groups",
  ]);
  assert.deepEqual(
    requests.filter((r) => !allowed.has(r)),
    [],
    "preapproval reads allowlist only",
  );
  assert.deepEqual(
    attemptedTopics.filter((t) => t.startsWith("group:")),
    [],
    "no group subscription before consent",
  );
  assert.deepEqual(await memberships(), before);
  pass(
    "installed unknown pending leaves complete memberships unchanged and makes no forbidden request",
  );
  result.operatorApproval = result.instructions[3];
  await invoke("meshimize_approve_join", { group_id: target });
  const after = await memberships();
  const newMember = after[target][acting.id];
  assert.equal(newMember?.role, "member");
  const unchanged = structuredClone(after);
  delete unchanged[target][acting.id];
  assert.deepEqual(
    unchanged,
    before,
    "only intended target member added; creator/existing/control roles untouched",
  );
  assert.equal(after[controlGroup][acting.id], undefined);
  const listed = await invoke("meshimize_list_my_groups");
  assert.ok(listed.groups.some((g) => g.id === target));
  await until(() => topics.has(`group:${target}`), 10000, "installed receiver ready before ask");
  // Authorized responder is a physical Phoenix-v2 consumer, joined before question.
  responder = new WebSocket(
    `ws://localhost:4000/api/v1/ws/websocket?token=${encodeURIComponent(owner.auth.authorization.slice(7))}&vsn=2.0.0`,
  );
  let responderReady = false,
    answerError,
    questionId;
  const fact = `Private recovery: use runbook ${nonce} and contact the authorized owner.`;
  secrets.push(fact);
  responder.on("message", (b) => {
    const [, ref, , event, payload] = JSON.parse(b.toString());
    if (event === "phx_reply" && ref === "1" && payload.status === "ok") responderReady = true;
    if (event === "new_message") {
      const m = payload.data ?? payload;
      if (m.message_type === "question") {
        questionId = m.id;
        api(
          `/groups/${target}/messages`,
          "POST",
          owner.auth,
          { content: fact, message_type: "answer", parent_message_id: m.id },
          201,
        ).catch((e) => (answerError = e));
      }
    }
  });
  responder.on("error", (e) => (answerError = e));
  await until(() => responder.readyState === WebSocket.OPEN, 5000, "responder connected");
  responder.send(JSON.stringify(["1", "1", `group:${target}`, "phx_join", {}]));
  await until(() => responderReady, 5000, "responder acknowledged before ask");
  const answer = await invoke("meshimize_ask_question", result.instructions.at(-1).args);
  assert.ifError(answerError);
  assert.equal(answer.answered, true);
  assert.equal(answer.group_id, target);
  assert.ok(questionId);
  assert.equal(answer.question_id, questionId);
  assert.equal(answer.answer.content, fact);
  assert.equal(answer.answer.responder_identity_id, owner.defaultId);
  assert.equal(requests.filter((r) => r === `POST /api/v1/groups/${target}/join`).length, 1);
  assert.deepEqual(await memberships(), after, "Q&A leaves complete postjoin maps unchanged");
  result.before = before;
  result.after = after;
  result.output = { ...answer, answer: { ...answer.answer, content: "[PRIVATE FACT MATCHED]" } };
  pass(
    "installed plugin outputs useful correlated private answer and authorized responder identity",
  );
} catch (e) {
  result.failure = scrub(e.stack ?? e);
  console.error(result.failure);
  process.exitCode = 1;
} finally {
  responder?.terminate();
  for (const ws of sockets) ws.terminate();
  if (child) {
    child.kill("SIGTERM");
    await Promise.race([new Promise((r) => child.once("exit", r)), delay(5000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  proxy?.closeAllConnections();
  proxy?.close();
  // Disposable database/accounts/keys are removed by outer run-owned container teardown.
  result.cleanup = "OUTER_HARNESS_REQUIRED";
  result.requests = requests;
  result.acknowledgedTopics = [...topics];
  writeFileSync("/proof/gateway-redacted.log", scrub(raw));
  writeFileSync("/proof/private-result.json", scrub(JSON.stringify(result, null, 2)));
}
