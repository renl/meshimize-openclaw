# 04u immutable test-fixture prerequisite

Correction cycle1, SDET-owned. Test-only fixture partition, not a tooling release or nullable implementation. Source baseline `6fdf93ca2713b4f1369823c92eeab3f26ae82b5a`; production tree must remain identical. Goal: preserve every existing contract assertion while leaving at least180 lines of production headroom in the functional slice.

Worktree/branch `.worktree/private-owner-join-04u-contract-fixture` / same; owner SDET; active. Consumer: explicitly authorized pinned functional chain, no helper merge wait. Target remains harness; main unchanged. No PR/publication/deployment authorization.

Files: this brief, local index, `tests/{identity-pending,tools/known-pending}.contract.ts`, `tests/harness/{run.mjs,inputs.json}`. Contract fixtures are not default Vitest suites; `pending` deliberately materializes them under their original test filenames in a disposable candidate. This is explicit RED evidence, never helper-green evidence. Functional wrappers must activate both suites in default tests after implementation. Production cannot import these fixtures.

Validation Windows PowerShell invoking bounded Linux Docker: `node tests/harness/run.mjs regression <HEAD>` then `baseline <HEAD>` (existing322/public8); `pending <HEAD>` separately expected RED. Format via repository cached Prettier for edited files; canonical `npm run format:check` inside regression. Existing safety/receiver proof reused only if source hashes unchanged. Preserve malformed/error negatives in original28 plus new physical request protocol in functional slice.

Founder outcome remains both owner-sibling and invited-account useful private Q&A. These fixtures are proxies only. Private-proof runnable setup is a separate pinned test-only prerequisite reviewed before execution; neither passing private proof nor green RED contracts is required before production implementation.

Boundary unchanged: identity account startup, configured-identity memberships, public discovery; no private detail/read/write/group subscription before explicit approval. Shared-state/setup/event/proof decomposition triggers all YES; CoS must route Architect review of complete partition before implementation. Retain worktree through landing/promotion or authorized abandonment; cleanup pending, no removal evidence.
