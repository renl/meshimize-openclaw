# Receiver correction — byte-preserving partition

Goal: after approval, report current answer-delivery readiness truthfully and never repeat the membership write to repair delivery. Full founder outcome remains a useful private answer through installed OpenClaw on both eligibility paths; registered-tool/transport proof and installed public baseline do not prove that full outcome.

## Chain / scope

- Worktree/branch: `repos/meshimize-openclaw/.worktree/private-owner-join-04b-receiver-functional` / `private-owner-join-04b-receiver-functional`. SDET lifecycle owner, active/unlanded; retain until verified landing/promotion or explicit abandonment. Original `private-owner-join-04b-receiver-chain` at `45686cc43bef40abdd00a212775b557c94793e08` remains untouched recovery, not abandoned.
- Prerequisite: **approved pinned available chain**, fixture04t `a793f117e61144745128e77fe476c4dc46aca63e`, on safety `748768d25d84532b3034a5bef751ffda0d22e432`; no helper landing or external publication wait. Functional PR targets `private-owner-join-04t-receiver-fixture`; prerequisite PR targets `private-owner-join-04s-single-write`. Neither targets main.
- Copy existing verified production bytes ONLY from45686cc: `src/services/ws-manager.ts`, `src/ws/channel.ts`, `src/tools/{groups,messages}.ts`, **`src/plugin.ts`**. Plugin allowlist addition explicitly authorized by CoS: pass existing shared WS service to existing registered ask-tool dependencies; no new tool/API/auth/security scope. This is a partition, not new implementation or a state-machine rewrite.
- Other changes: this brief and `docs/stages/README.md`; tests inherited unchanged. Production delta419 lines/5files. Each batch cap600 added+deleted lines/20files; count against exact chain baseline before persistence. Version0.1.15 inherited; no bump, release, deploy or merge authorization.

## Executable acceptance (unchanged)

Exact receiver fixture SHA256 `1a23e02749e13e5269dfb099d1813f44bb92fc24f8d0ea2fcabacdcb35a6b496` and existing28 manifest-pinned units retained, never dropped/muted. Receiver9 cover accepted REST with refusal/disconnection; phx_error/phx_close/socket termination invalidating ready with ZERO question/join POSTs; exactly10s from REST-success deadline; obsolete ack rejection; real reconnect coalescing with recovery; stop/unsubscribe cancellation; one current shared-buffer delivery. Preserve all timing/lifecycle negatives. Supporting fixture gate validates pins/syntax only, never receiver-green on safety base.

Windows PowerShell, inherited finite Linux Docker harness: `node tests/harness/run.mjs receiver <HEAD>` → `safety <HEAD>` → `regression <HEAD>` → `baseline <HEAD>`. Required fresh results:9/13/322/8 installed public checkpoints, each assertions and cleanup PASS. `units <HEAD>` preserves28 selectable diagnostic assertions; historical RED cases remain honest, not confused with322 existing regressions or full private proof. Format: `npm run format`; check: `npm run format:check`.

## Boundary Verification — narrow Architect review needed

No boundary semantics changed by partition. Original04b review packet remains readable at45686cc (`docs/stages/private-owner-join-04b-receiver-chain.md`). Wire endpoint: `ws(s)://<host>/api/v1/ws/websocket?token=<key>&vsn=2.0.0`; Phoenix-v2 `[join_ref,ref,topic,event,payload]`, `identity:<current_identity.id>`, `group:<group_id>`, `phx_join`, `phx_reply` with `{status:"ok",response:{}}`, `new_message`, `phx_error`, `phx_close`. Ready requires CURRENT acknowledged channel plus shared buffer handler, invalidated on subsequent disconnect/error. REST bearer `POST /api/v1/groups/:group_id/join`, empty body, no identity override, one attempt. Preserve server role, joined outcome, readiness:null and no-replay guidance on receiver failure; never roll membership back or re-ask. Existing `content` JSON-text / `details.error:true` envelope, not MCP isError.

Contract/source cross-check inherited from original reviewed packet: root OpenClaw §4.4.1–3/§6.4, MAI contract, `endpoint.ex`, `group_membership_json.ex`; historical websocket mount examples are not wire URLs. No new contract translation. Request narrow Architect review of plugin allowlist addition and setup/proof partition, not implementation redesign. Checklist YES shared inputs, NO baseline mutation, YES receiver-before-event, YES combined evidence, YES split setup/proof: cannot self-approve readiness.

## Evidence / lifecycle

Fixture prerequisite a793f11: `meshimize-oc04-e77a9836` fixture PASS, `793366cc` regression322 PASS, `d25d0268` installed public8 PASS; all cleanup PASS. Evidence under root `_build/sdet-local/openclaw04/runs/`. Combined candidate freshly executes exact receiver fixture; bind production/dependency hashes to45686cc and report four fresh gates separately. Monitor Docker approximately4GiB free; no prune/resize; inherited bounded start/readiness/test/log/teardown/inspection. Loopback receiver proof is not real private eligibility; installed public8 exercises actual Gateway,21 tools, identity receiver and correlated useful public answer. Private owner/invitee combined workflow and guides remain pending.

Next: CoS narrow Architect review, then two SE git-only persistence/push/PR handoffs; no further production edits. Worktree cleanup pending verified landing/promotion; harness cleanup separate from worktree removal.

### Independent partition verification

Executed on immutable candidate `51c27cbd034b6658dd85e0d5cff6795ecf10df6e`; subsequent evidence-only brief/index edits do not change harness inputs, runtime source, dependencies or packaged inputs. Artifact SHA256 `3a2a6d5d01ae64fa389fdeb4a528d97e1bc39f063d4df4bb4a57963c1dc96482` identical across all four fresh runs.

| Gate                                               | Run (prefix meshimize-oc04-) | Assertions             | Cleanup |
| -------------------------------------------------- | ---------------------------- | ---------------------- | ------- |
| Receiver, all lifecycle/deadline negatives         | 04caae32                     | 9/9 PASS, zero skipped | PASS    |
| Physical single-write/error safety                 | f57d1b7a                     | 13/13 PASS             | PASS    |
| Format/typecheck/lint/build + existing regressions | b7e435f4                     | 322/322 PASS           | PASS    |
| Actual installed Gateway/public Q&A                | 53641701                     | 8/8 checkpoints PASS   | PASS    |

Entire `src`, package/lock/plugin manifest and receiver fixture equal45686cc by Git object comparison plus physical fixture hash. All28 unit pins verified by prerequisite fixture mode; not freshly executed and not claimed28 GREEN. Prerequisite artifact `b326bbd7d34e9b9f5cc0dc715d8b99b151be41911263f77464cb299f2f2735c4`; regression322 and installed8 independently PASS on uncorrected base. Docker before each gate4,225,772KiB (first fixture4,225,780); lowest observed4,096,104KiB during installed baseline (~3.91GiB), all owned run resources removed; no prune/resize. Worktrees remain active, not removed. Full feature verification/release readiness NOT claimed.
