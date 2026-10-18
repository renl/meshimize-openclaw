// SDET owned finite Docker lifecycle, architecture OpenClaw §4.4.2.
import { spawnSync } from "node:child_process";
import { mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
const home = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const source = home;
const manifest = JSON.parse(readFileSync(join(home, "tests/harness/inputs.json")));
const root = resolve(home, "../../../..");
const run = `meshimize-oc04-${randomUUID().slice(0, 8)}`;
const out = join(root, "_build/sdet-local/openclaw04/runs", run);
const mode = process.argv[2] ?? "baseline";
if (!manifest.modes[mode]) throw Error("Unknown manifest mode");
mkdirSync(out, { recursive: true });
const env = { ...process.env, DOCKER_CONFIG: join(root, "_build/sdet-local/docker") };
const runtime = "sha256:5c2b8f89fa8d40ec311a1d42f5871c6d9d3274182e18d837a667597556673084";
const server = "sha256:4a77a71f0e3290f0158bd94362db48abe6b7d2eb0c8cc15eaf6195307b6f55d3";
const containers = [];
let network = false;
const evidence = {
  run,
  mode,
  runtime,
  server,
  candidate: process.argv[3] ?? manifest.candidate,
  assertion: "BLOCKED",
  cleanup: "NOT_RUN",
  commands: [],
};
const start = Date.now();
evidence.inputs = {};
function hashTree(path, prefix) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name),
      key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) hashTree(file, key);
    else evidence.inputs[key] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
}
function cmd(exe, args, seconds = 30, allow = false) {
  const r = spawnSync(exe, args, {
    env,
    encoding: "utf8",
    timeout: Math.min(seconds * 1000, Math.max(1000, 720000 - (Date.now() - start))),
    maxBuffer: 4 * 1024 * 1024,
  });
  evidence.commands.push({ exe, operation: args[0], exit: r.status, error: r.error?.code });
  if (r.status !== 0 && !allow)
    throw Error(`${exe} ${args[0]} exit ${r.status}: ${(r.stderr ?? "").slice(-2000)}`);
  return {
    ok: r.status === 0,
    text: `${r.stdout ?? ""}\n${r.stderr ?? ""}`,
    value: (r.stdout ?? "").trim(),
  };
}
const docker = (args, seconds, allow) => cmd("docker", args, seconds, allow);
function create(suffix, args) {
  const name = `${run}-${suffix}`;
  containers.push(name);
  docker([
    "create",
    "--name",
    name,
    "--memory=4g",
    "--label",
    `meshimize.sdet.run=${run}`,
    ...args,
  ]);
  return name;
}
function space(stage) {
  const name = `${run}-space`;
  containers.push(name);
  const r = docker([
    "run",
    "--name",
    name,
    "--pull=never",
    "--network=none",
    runtime,
    "sh",
    "-c",
    "df -k /",
  ]);
  const free = Number(r.value.split("\n").at(-1).trim().split(/\s+/)[3]);
  (evidence.space ??= []).push({ stage, freeKiB: free });
  docker(["rm", name]);
  containers.pop();
  if (!Number.isFinite(free) || free < 1572864) throw Error("1.5GiB capacity floor");
  if (evidence.space[0].freeKiB - free > 4194304) throw Error("4GiB run storage budget");
}
try {
  if (cmd("git", ["-C", source, "rev-parse", "HEAD"]).value !== evidence.candidate)
    throw Error("candidate drift");
  cmd("git", [
    "-C",
    source,
    "diff",
    "--exit-code",
    "HEAD",
    "--",
    "src",
    "package.json",
    "package-lock.json",
    "openclaw.plugin.json",
  ]);
  space("before");
  const candidate = join(out, "candidate");
  mkdirSync(candidate);
  for (const p of [
    "src",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "openclaw.plugin.json",
    "README.md",
    "LICENSE",
    "meshimize",
    ".gitignore",
    ".prettierrc",
    ".eslintrc.cjs",
  ])
    cpSync(join(source, p), join(candidate, p), { recursive: true });
  hashTree(candidate, "candidate");
  for (const input of manifest.modes[mode]) {
    const bytes = input.commit
      ? spawnSync("git", ["-C", home, "show", `${input.commit}:${input.path}`], { timeout: 10000 })
          .stdout
      : readFileSync(join(home, input.path));
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== input.sha256)
      throw Error(`pinned input mismatch: ${input.path}`);
    const target = join(out, input.target);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, bytes);
    evidence.inputs[input.path] = input.sha256;
  }
  const build = create("pack", [
    "-v",
    `${candidate}:/candidate`,
    "-w",
    "/candidate",
    runtime,
    "sh",
    "-c",
    "npm ci --ignore-scripts --no-audit --no-fund && npm run build && npm pack --ignore-scripts --json",
  ]);
  const built = docker(["start", "-a", build], 180, true);
  writeFileSync(join(out, "pack.log"), built.text);
  if (!built.ok) throw Error("candidate build/pack failed");
  evidence.artifactSHA256 = createHash("sha256")
    .update(
      readFileSync(
        join(
          candidate,
          `meshimize-openclaw-plugin-${JSON.parse(readFileSync(join(candidate, "package.json"))).version}.tgz`,
        ),
      ),
    )
    .digest("hex");
  if (["units", "regression"].includes(mode)) {
    cpSync(join(source, "tests"), join(candidate, "tests"), { recursive: true });
    cpSync(join(source, "vitest.config.ts"), join(candidate, "vitest.config.ts"));
    hashTree(join(candidate, "tests"), "tests");
    const test = create("units", [
      "--network=none",
      "-v",
      `${out}:/proof`,
      "-w",
      "/proof/candidate",
      runtime,
      ...(mode === "regression"
        ? [
            "sh",
            "-c",
            "npm run format:check && npm run typecheck && npm run lint && npm test && npm run build",
          ]
        : [
            "node",
            "node_modules/vitest/vitest.mjs",
            "run",
            ...(mode === "units"
              ? [
                  "tests/tools/private-known-id.test.ts",
                  "tests/api/join-single-attempt.test.ts",
                  "tests/identity-pending.test.ts",
                  "tests/services/private-receiver.test.ts",
                ]
              : []),
            "--reporter=verbose",
          ]),
    ]);
    const r = docker(["start", "-a", test], 90, true);
    writeFileSync(join(out, "units.log"), r.text);
    evidence.assertion = r.ok ? "PASS" : "FAIL";
  } else if (["wire", "safety", "receiver"].includes(mode)) {
    const test = create("wire", [
      "--network=none",
      "-v",
      `${out}:/proof`,
      runtime,
      "node",
      "--test",
      `/proof/${mode}.mjs`,
    ]);
    const r = docker(["start", "-a", test], 90, true);
    writeFileSync(join(out, `${mode}.log`), r.text);
    evidence.assertion = r.ok ? "PASS" : "FAIL";
  } else {
    network = true;
    docker(["network", "create", "--internal", "--label", `meshimize.sdet.run=${run}`, run]);
    const db = create("db", [
      "--network",
      run,
      "--network-alias",
      "db",
      "--tmpfs",
      "/var/lib/postgresql/data",
      "-e",
      "POSTGRES_PASSWORD=disposable",
      "-e",
      "POSTGRES_DB=meshimize_oc04",
      "postgres:16",
    ]);
    docker(["start", db]);
    let ready = false;
    for (let i = 0; i < 30; i++) {
      if (docker(["exec", db, "pg_isready", "-U", "postgres"], 3, true).ok) {
        ready = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    if (!ready) throw Error("DB readiness");
    const appArgs = [
      "--network",
      run,
      "-e",
      "DATABASE_URL=ecto://postgres:disposable@db/meshimize_oc04",
      "-e",
      `SECRET_KEY_BASE=${randomUUID().repeat(3)}`,
      "-e",
      "PHX_HOST=localhost",
      "-e",
      "MESHIMIZE_RUNTIME_ENV=test",
      server,
    ];
    const migrate = create("migrate", [
      ...appArgs,
      "/app/bin/meshimize",
      "eval",
      "Meshimize.Release.migrate()",
    ]);
    docker(["start", "-a", migrate], 90);
    const app = create("server", appArgs);
    docker(["start", app]);
    // Install needs registry access; only fixture network gets an additional egress connection.
    const probe = create("baseline", [
      "--network",
      `container:${app}`,
      "-v",
      `${out}:/proof`,
      "-e",
      "HOME=/isolated-home",
      "-e",
      "OPENCLAW_STATE_DIR=/isolated-home/.openclaw",
      "-e",
      "OPENCLAW_CONFIG_PATH=/isolated-home/.openclaw/openclaw.json",
      runtime,
      "node",
      "/proof/baseline.mjs",
    ]);
    docker(["network", "connect", "bridge", app]);
    const r = docker(["start", "-a", probe], 300, true);
    writeFileSync(join(out, "baseline.log"), r.text);
    evidence.assertion = r.ok ? "PASS" : "FAIL";
  }
  space("after-test");
} catch (e) {
  evidence.failure = e.message;
} finally {
  let clean = true;
  for (const c of containers.reverse()) {
    if (!docker(["rm", "-f", "-v", c], 15, true).ok) clean = false;
    if (docker(["inspect", c], 5, true).ok) clean = false;
  }
  if (network && !docker(["network", "rm", run], 15, true).ok) clean = false;
  if (network && docker(["network", "inspect", run], 5, true).ok) clean = false;
  evidence.cleanup = clean ? "PASS" : "FAIL";
  evidence.elapsedMs = Date.now() - start;
  writeFileSync(join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({ out, ...evidence, commands: undefined, inputs: undefined }, null, 2),
  );
  process.exitCode = evidence.assertion === "PASS" && clean ? 0 : 1;
}
