# Restored-image harness packet

Parent: [stage index](README.md). Owner SDET. Status review-ready, not implementation-ready.

## Goal, baseline and scope

Make the private joining proof replayable against explicitly restored images without pretending deleted image IDs exist. Supporting test infrastructure, not proof of published support or reader understanding.

- Path `repos/meshimize-openclaw/.worktree/private-owner-join-04v-image-recovery`; branch same basename.
- Prerequisite shared-unchained: PRs29→28→27 landed on `private-owner-join-04h-test-environment` at `8b9a6fadd79d670c8c6bc244f74cc7b920993c32`, full committed tree equal to testede4bd8d0. Target harness only, never main.
- Allowlist: `tests/harness/{run.mjs,image-selection.mjs,image-selection.test.mjs}`, this brief/index. Under20files/600added+deleted lines. No production/version/publication/deployment/semantic change; no archived docs, SDK or future README edits in PR.

## Test sequence and format

PowerShell/Windows; project-owned Linux/amd64 Docker runtime for application checks:

1. `node --test tests/harness/image-selection.test.mjs`: three pure tests; require all-or-none immutable full image IDs, reject partial/tag input.
2. `node --check tests/harness/run.mjs`; `git diff --check`.
3. Format command: `npm run format:check` inside existing finite container regression mode, followed by typecheck/lint/build/333 tests. Unchanged runner/selector/test hashes match independent decision; reuse that successful container format/matrix evidence, not a new run claim. New Markdown requires format check before commit.
4. If replay requested: create a new root-local supervisor from retained `verify.mjs`, explicitly remapping worktree to this path/candidate to8b9a6fa after hash guards; do not edit historical proof. Sequence pending→pending-wire→units→safety→receiver→regression→baseline→private-owner→private-invited. First run clean build, later reuse only that successful build under existing provenance guards. Exact three image bindings,900s outer deadline/120s teardown reserve, capacity and independent absence checks follow root independent decision. No new server launcher.

Root `docs/test-plan/features/private-owner-join-independent-20261018.md` records exact images and PASS results. Root `_build/sdet-local/openclaw27-29-landing-20261018/revalidation-preservation.json` freshly checks all mapped sources/tests and nine tarball hashes; three transferred files match independent PASS bytes. Revalidation's first attempt missed the deliberately uncommitted selector mapping; correction explicitly separates local recovery from landed Git bytes, no assertion change.

## Boundary Verification and fidelity

Unchanged boundaries: explicit local Docker engine, pinned OpenClaw Gateway HTTP/WebSocket, Phoenix-v2/REST server and isolated PostgreSQL. No production endpoint/key, new API or hosted/Dot work. Selection checks local immutable identity, forbids implicit pull and records harness/image provenance; existing lifecycle/tmpfs/capacity/approval/receiver assertions unchanged. Pure selector/static checks are proxies; actual installed owner/invited→useful answer is workflow proof, not human/autonomous-reader proof.

Decomposition checklist1 YES (fixture inputs consumed),2 NO,3 YES (existing receivers),4 YES (evidence across modes),5 YES (setup/proof split). CoS routes narrow Architect decomposition/interface-fidelity confirmation before implementation-ready. Existing replacement-image approval/full matrix reused; no new contract decision or broad review cycle requested.

## Lifecycle and next action

SDET owns active recovery worktree through landing/cleanup. Next CoS narrow review→SE commit/push and its **own substantive harness PR**, never closed27/28/29. Preserve root recovery/evidence until authorized disposal. Original functional snapshot5527files includes5454ignored SDK/artifact files and two dirty docs; helper/harness snapshots also retained with SHA256 manifests. Published-client proof, public guide and main promotion are separate pending gates.
