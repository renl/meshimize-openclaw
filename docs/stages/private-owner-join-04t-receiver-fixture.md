# Receiver fixture prerequisite (04t)

Goal: make the exact receiver acceptance packet available without making the uncorrected safety baseline falsely GREEN or breaking default CI. This is test-tooling readiness, not receiver correctness or useful private-answer proof.

- Worktree/branch: `repos/meshimize-openclaw/.worktree/private-owner-join-04t-receiver-fixture` / `private-owner-join-04t-receiver-fixture`; SDET lifecycle owner; active, unlanded. Baseline: approved available safety chain `748768d25d84532b3034a5bef751ffda0d22e432` (PR24), not main. Consumer: functional04b, explicitly pinned before creation; no prerequisite landing wait or tooling publication.
- Files: `tests/harness/{receiver.mjs,inputs.json,run.mjs}`, this brief and `docs/stages/README.md`. Production, package scripts and default test selection remain unchanged. Delta limit600 lines/20files.
- Preserve receiver fixture SHA256 `1a23e02749e13e5269dfb099d1813f44bb92fc24f8d0ea2fcabacdcb35a6b496` exactly and all original28 unit assertions at existing manifest pins. No assertion drop, mute or normative weakening.
- Founder outcome: an approved private-group join permits a useful answer through installed OpenClaw. This packet is supporting/proxy evidence only. Standalone proof is fixture integrity, existing322 regressions and installed public Q&A baseline; full receiver9 is correction acceptance only on combined04b.

## Execution / proof separation

Windows PowerShell invokes inherited finite Linux Docker harness: `node tests/harness/run.mjs fixture <HEAD>` → `regression <HEAD>` → `baseline <HEAD>`. Fixture gate verifies SHA256 of every manifest input and syntax-checks receiver JavaScript; it does NOT execute or claim receiver assertions. `npm test` remains existing322. Explicit `receiver` selects all9 unchanged acceptance tests; `units` selects preserved28 (known RED cases remain honest, not standalone green gates).

Format: `npm run format`; check: `npm run format:check`. Docker lifecycle, isolation, pinned images, bounded readiness/test/teardown and separate cleanup evidence inherited unchanged. Monitor4GiB free floor before each run; no prune/resize. Retain both worktrees until verified landing/promotion or explicit abandonment.

## Boundary Verification / narrow review

No new application boundary or public tool. Exact copied fixture uses bearer `POST /api/v1/groups/:group_id/join` (empty body) and Phoenix-v2 `ws(s)://<host>/api/v1/ws/websocket?token=<key>&vsn=2.0.0`, current identity/group topics and original lifecycle/ack/message frames. It remains a loopback transport fixture, not real-server eligibility or installed conversational private proof. Existing04b boundary block remains authoritative. Decomposition checklist: YES shared inputs, NO baseline mutation, YES receiver-before-event, YES combined evidence, YES setup/proof separation. CoS must obtain narrow Architect partition/decomposition review; no self-approval.

Evidence: harness `evidence.json` records candidate, input/artifact hashes, assertions and cleanup independently. Next: CoS→SE git-only persistence/PR targeting safety branch; no production implementation, release, deploy or merge authorization. Cleanup pending verified landing; original45686cc recovery retained untouched.
