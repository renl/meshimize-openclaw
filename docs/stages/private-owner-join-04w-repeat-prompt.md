# OpenClaw unknown-repeat prompt correction

Tell the operator that approving a repeated unknown-ID request only attempts a join and can still be denied.

Parent: [slice index](README.md). Owner SDET. Status: setup complete, expected RED; CoS routes SE. Same first production-hotfix injection as MCP03b; earlier lease/test corrections are not production hotfixes.

## Baseline / delivery

- Worktree: `C:/Users/User/work/projects/meshimize/repos/meshimize-openclaw/.worktree/private-owner-join-04w-repeat-prompt`; branch `private-owner-join-04w-repeat-prompt`.
- Full base/current HEAD: `8b9a6fadd79d670c8c6bc244f74cc7b920993c32`, fetched `origin/private-owner-join-04h-test-environment` on2026-10-20. Prerequisite: landed known-pending/safety/receiver implementation on this harness branch; explicitly authorized pinned harness baseline. No04v helper required for service-free tests.
- Delivery: one legacy hotfix PR to **`private-owner-join-04h-test-environment`**, never OpenClaw main. No promotion, PR creation/merge/publication here. Keep prepared `0.1.15`; no extra unpublished patch bump.
- New files and index are uncommitted, readable in this assigned worktree.

## Contract / acceptance / allowlist

Authority: root `docs/architecture/features/private-group-invitations.md` §14.2–14.3, US-PGI-8, Architect findings in root `.worktree/private-owner-join-06a-public-prerequisites/docs/stages/private-owner-join-06f-contract-cycle1.md`, and exact CoS correction dispatch.

Founder-visible success: an operator receives all consent warnings even on a repeated request without creating access or another network request.

- Unknown initial AND repeat message: full UUID; details and eligibility unverified; compare ID with trusted source before approval; approval only attempts join and may be denied.
- Production allowlist: **only `src/tools/groups.ts` unknown repeat message text**, adding the missing approval-attempt/may-deny meaning. Preserve existing UUID, warnings and expiry rendering; public-discovery prompts unchanged.
- Do not change initial semantics, status, pending ID/TTL, stored metadata/nulls, continuation, approval API/error behavior, identity, readiness, network reads/writes or permissions.
- SDET-owned: `tests/tools/unknown-prompt.test.ts`, this spec, `docs/stages/README.md`. No SE test edits, manifest/lock/release metadata or broad fixture/type migration. Four final files including production; cap600changed lines/20files, final numstat required.
- Separate nonblocking follow-up: both stale `identity_id` declarations in `src/types/groups.ts` must eventually align with serializer/contract `agent_identity_id`. **Excluded here**, no runtime impact inferred away; CoS assigns gap ID/routes separately, not a reason to expand this hotfix.

## Tests / measured RED / commands

Canonical shell: Windows PowerShell, Node22; caller timeout60s per command (full suite120s). Pure/in-process only, no server/lease. Root OpenClaw `node_modules` reused by worktree-local junction; no installation/dependency change.

Run in this worktree, in order:

1. `node node_modules/vitest/vitest.mjs run tests/tools/unknown-prompt.test.ts --maxWorkers=1 --minWorkers=1`
2. `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1` (includes11pending/28original/13safety/9receiver regression coverage;120s).
3. `npm run typecheck`; `npm run lint`; `npm run build` (each60s).
4. Before commit: `npm run format`; before push: `npm run format:check`; `git diff --check`. Do not stage unrelated formatting; return scope conflict via CoS.

Mapping: corrected positive and current broken negative independently validate warnings. Registered `meshimize_join_group` fresh/repeat tests assert every warning meaning after stable pending ID/expiry/nulls, zero join/detail/message/subscription effects, one membership/discovery read total (zero replay). Expected after SE:4PASS/no skips. Public registered-tool invocation uses existing test registry/API doubles; not direct handlers, not installed Gateway proof.

Measured2026-10-20: focused **3PASS/1FAIL, exit1**, only repeat fails missing approval-attempt/may-deny warning. Initial/positive/broken-negative pass. Repeat safety invariants preceding warning assertion passed. Typecheck exit0. Root log `_build/sdet-local/repeat-prompt-setup/openclaw-red.log`. Formatter applied only to new test. Full regression/build/lint not claimed run at setup.

## Boundary Verification / review gate

Already-reviewed unchanged §14.2 prompt contract; no new boundary, external platform behavior, API/auth/payload/schema or wire transport modification. Native public JSON text result/`details.error` handling remains unchanged. Repeat remains local. No fresh interface review required for this exact text-only correction; expansion returns via CoS→Architect. Decomposition1–5: all NO for standalone correction, no cross-client dependency/shared fixture/process prerequisite. Supporting contract proxy only: actual installed Gateway/private useful-answer proof still belongs to reviewed integrated06 after corrected candidate/package pins; no deployment or new lease here.

## Lifecycle / next action

Owner SDET; worktree/branch active until verified harness landing and safe cleanup. CoS dispatches SE; independent verification follows. No04v helper merge wait, main promotion or cleanup performed/authorized. Full feature remains unverified.
