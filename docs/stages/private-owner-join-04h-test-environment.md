# OpenClaw04 test environment and physical boundaries

## Current materialization (supersedes preparation restrictions below)

CoS task2026-10-18 reports Architect PASS for installed baseline and REST/WS/Gateway boundaries and authorizes AVAILABLE IMMUTABLE PINCHAIN. Single-write/error unit may proceed independently of receiver/nullable gaps. No new public interface. All five decomposition triggers remain YES; prior approval applies only to faithful partition, not future interface changes.

Runner now builds **its own worktree**, requiring exact SHA argument and clean production paths. `inputs.json` declares per-mode inputs with SHA256; external test files are materialized with `git show <published-commit>:<path>`, never sibling filesystem reads. Only `baseline` loads04i; only `units` loads preserved safety20+receiver8. `wire` and `regression` need neither. Local runtime images remain explicit local prerequisites, not publicly released tooling. Run `node tests/harness/run.mjs regression <HEAD-SHA>` for existing GREEN regressions; `units`/`wire` retain expected REDs, not harness failure. Candidate archive name follows version for postimplementation replay. Storage consumption<=4GiB, free floor1.5GiB, containers memory<=4GiB, no prune/resize/TLS bypass.

SDET retains all source worktrees and evidence through verified landing/promotion. Earliest functional unit chains on this prepared harness, not all future user merges. No PR/publish/production edits authorized.

SDET-owned test-only setup; **review-ready, not implementation/landing-ready**. Parent: root `docs/stages/README.md`. Authority: current root OpenClaw architecture §4.4.1–3, private-group §14.2–5, DevOps `docs/operations/openclaw04-runtime.md`.

## Goal, baseline, isolation

Prove or falsify the client’s physical single-write/readiness behavior without production credentials or feature edits. This is supporting evidence; founder success remains useful authorized private Q&A through installed OpenClaw, with only the intended identity joined.

- Worktree/branch: `repos/meshimize-openclaw/.worktree/private-owner-join-04h-test-environment` / `private-owner-join-04h-test-environment`; lifecycle owner SDET; status blocked/retained.
- Preparation baseline `1e7ee434a8c05fdb4050a19e6f17f5f97a4cf204`; no production changes. Root fixture baseline `a93478e67ad67802f0ea09cb2693733487f98bb3`; exact existing local server image `sha256:4a77a71f0e3290f0158bd94362db48abe6b7d2eb0c8cc15eaf6195307b6f55d3` from retained MCP baseline provenance.
- Prerequisites: provisioned pinned runtime; preparation source readable in sibling04 safety; `baseline` mode additionally reads sibling04i executable; `units` reads receiver test from04b. These are explicit **local preparation dependencies**, not approved pinned implementation chains. No proof consumes either future private-proof identity.
- Files to touch: `tests/harness/run.mjs`, `tests/harness/wire.mjs`, this brief, local index. No application code, package version/lock edits or new platform APIs. ~430 test lines plus brief/index, below600; do not bundle baseline executable or functional changes.
- Before landing, CoS must confirm satellite integration route and SDET must consolidate the peer-file preparation inputs into the approved shared harness layout. Current peer-worktree paths are not a portable installed-package distribution.

## Runtime/lifecycle boundary

Runtime is OpenClaw2026.10.4/source `383c124cc32ffee3f8e56f549b88da94d269a4af`, Node24.16.0, exact **local image ID** `sha256:5c2b8f89fa8d40ec311a1d42f5871c6d9d3274182e18d837a667597556673084` (not registry digest). DevOps retained tarball SRI/lock/disabled-lifecycle-script evidence. No duplicate image build/commit/pull, prune, disk resize or script re-enabling.

One finite host orchestration owns named containers, isolated network, DB tmpfs, readiness, bounded test commands, redacted capture and removal/absence checks. Deadline720s; child operations bounded. Public baseline install needs npm egress via an additional bridge connection; fixture network itself is internal. No published ports, Docker socket mount, host HOME/state/config or production access. Container-only HOME `/isolated-home`; Meshimize keys/session and Gateway operator token are generated per run and never retained. Source, package and test hashes live in run evidence. Candidate dependency copies intentionally remain under root ignored `_build/sdet-local/openclaw04/runs/`; disposable DB/accounts/state die with verified containers. Minimum Docker free1.5GiB, checked before/after, no broad cleanup.

## Commands and assertions

PowerShell/Windows host with Docker Linux amd64; from this worktree:

1. `node tests/harness/run.mjs baseline` — locked candidate install with scripts disabled → TypeScript build → npm pack → disposable DB readiness/migration/server health →04i installed public baseline → cleanup.
2. `node tests/harness/run.mjs units` — same locked build, network-off focused safety+receiver tests. Receiver is preparation-only baseline, not claimed04 inheritance. Latest executed `meshimize-oc04-b955c029`:28 cases20 expected behavioralRED/8PASS, exit1, cleanupPASS.
3. `node tests/harness/run.mjs wire` — network-off loopback HTTP/WS listeners:429 and lost-response physical POST count must each equal1; accepted REST+refused/silent WS must not claim readiness and silence must settle within10s. Run `meshimize-oc04-f09e8650`:4 expectedRED, exit1/cleanupPASS (each retry fault3POSTs; false ready on refusal; silence exceeds10s). No installed-runtime claim for these compiled-service probes.
4. Format `npm run format`; gate `npm run format:check`. In this prep session formatting used the candidate’s locked Prettier inside the pinned runtime container; full suite/lint/build must pass before any landing.
5. After implementation, SDET explicitly repins immutable source and affected harness inputs; focusedGREEN → static/full suite/build → physical faults → installed baseline → private spikes. Do not silently relax current drift guard.

## Boundary Verification / review

- Meshimize fixture public account/identity/key/group/message setup only. Join `POST /api/v1/groups/:id/join`, bearer Meshimize key, no body/identity override. Serializer `group_membership_json.ex:33–40`: `data.{group_id,agent_identity_id,role,inserted_at,created_at}`; fault server uses all fields. Other reads return canonical paginated envelopes.
- Actual Phoenix-v2 frames over `ws://127.0.0.1:<port>/api/v1/ws/websocket?token=<key>&vsn=2.0.0`, identity/group topics, matched join refs and successful reply. Historical websocket boundary `/socket` remains an additional server mount; current MAI/OpenClaw contract and actual config/Endpoint govern this client. No account-topic substitution.
- Tests own protocol peers and faults; production never imports/deploys/depends on them. Real local server evidence comes separately through04i. No claim about external provider retrieval, human conversational approval, private eligibility or published package installation.
- Decomposition checklist1–5: **YES**. CoS→Architect decomposition and interface-fidelity review required before implementation readiness. Next owner CoS for routing/landing baseline; SDET for remaining test gaps/layout. No SE dispatch/PR/publish/merge/deploy.
- Cleanup: run resources removed/verified individually; worktree retained, no landed/abandoned ending route. SDET owns lifecycle through authorized landing/promotion/removal.
