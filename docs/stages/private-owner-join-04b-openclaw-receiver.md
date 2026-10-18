# OpenClaw acknowledged receiver — preparation

Ensure accepted membership is not falsely reported as ready to deliver the first private answer.

**Status: corrected setup for Architect review, NOT implementation-ready.** Parent root `docs/stages/README.md`; authority root OpenClaw architecture §4.4.1–3 and private-group contract §14.2–5 / US-PGI-8. Proof is useful private Q&A through installed runtime; these tests are proxies.

## Isolation and exact batch

- Worktree `repos/meshimize-openclaw/.worktree/private-owner-join-04b-openclaw-receiver`; branch `private-owner-join-04b-openclaw-receiver`; SDET lifecycle owner, blocked/retained.
- Preparation-only baseline own main `1e7ee434a8c05fdb4050a19e6f17f5f97a4cf204`. Implementation prerequisite **merge after04 safety**, then explicit baseline refresh and affected rerun. This worktree does not yet contain04's future behavior; it is not an authorized pinned chain. No04b implementation dispatch now.
- Exact authored batch: `tests/services/private-receiver.test.ts`, this brief, `docs/stages/README.md`.
- Proposed SE production scope: `src/services/ws-manager.ts`, `src/tools/groups.ts`, `src/tools/messages.ts`; `src/ws/channel.ts`/`src/ws/client.ts` only if needed for current-attempt lifecycle, no protocol redesign. Maximum final600 added+deleted/20files including tests/docs/versionlock. Current test328 lines before docs; estimate production/release delta before dispatch and split if exceeded. No size waiver.

## Contract and runnable evidence

`tests/services/private-receiver.test.ts` uses the real service, real `Channel`, real message buffer and actual approval handler with a test-only socket adapter. No production imports tests. Channel join only succeeds on successful reply; `resetState()` invalidates a pending join; `trigger(new_message)` drives the shared buffer. No new public readiness method is prescribed.

| Case                                          | Expected contract §4.4.1                                                                                                     | Preimplementation result                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| disconnected, join refusal, absent join reply | accepted `joined:true`, `membership_path_ready:null`, `receiver.ready:false`, confirmation/recovery message, pending removed | 3 RED; silence observed via deterministic10.001s fake-clock deadline, not wall-clock timeout |
| delayed successful ack                        | no early ready; then ready + shared-buffer answer event                                                                      | 1 PASS supporting only                                                                       |
| disconnect during ack                         | accepted-not-ready, never stale ready                                                                                        | 1 RED                                                                                        |
| concurrent recovery/subscription              | every waiter awaits same acknowledgment, one join/handler                                                                    | RED: second caller resolves early                                                            |
| disconnect before first ask                   | delivery-not-ready, zero question POST or join replay                                                                        | RED: question posts                                                                          |
| timeout → recovery → obsolete reply           | old work cannot complete new attempt or duplicate handler                                                                    | RED at bounded not-ready prerequisite; later assertions intentionally await implementation   |

Current canonical preparation command from04h (PowerShell/Windows orchestrates Linux Node24 containers): `node tests/harness/run.mjs units`. Run `meshimize-oc04-76989113`: receiver8 cases,7 expected behavioral RED/1PASS; combined28=20RED/8PASS, exit1/cleanupPASS. Full join fixtures now include identity/role/both timestamps; answer events include correlation/sender/timestamp. Real service/Channel with fake socket remains supporting coverage, not physical proof. Deferred replies/timers/signal handlers/pending intervals disposed.

## Ordered work still required before readiness

1. Source/runtime/public baseline are resolved by04h/04i: actual Gateway loaded all21 tools and started receiver; public correlated Q&A PASS. Architect reviews corrected decomposition and Boundary Verification; this is not permission to implement or claim private-workflow readiness.
2. Added executable concurrent-waiter, zero-question-after-disconnect and obsolete-reply/recovery cases. Safety's identity-pending test covers same-key repeated registration and changed-key pending isolation. Physical wire4RED covers429/drop counts and refused/silent join. Still add dedicated phx_error/phx_close first-ask invalidation and physical late-reply/reconnect ordering before final04b implementation dispatch. No mock-based whole-workflow claim.
3. After04 shared landing/baseline refresh, focused receiver tests → inherited safety tests → full unit/static/build/package. Format `npm run format`; gate `npm run format:check`, `npm run lint`, `npm run typecheck`.
   4.04h finite Docker harness: `node tests/harness/run.mjs wire`, then `baseline`. Physical faults are compiled-client/service probes; baseline is actual Gateway installed plugin. Current wire4RED/cleanupPASS in `meshimize-oc04-8d78595f`; public baselinePASS/cleanupPASS in `meshimize-oc04-b99bf152`. After04b, explicitly repin and rerun affected tests, then smallest owner-account private Q&A before broader owner/invited proof.
4. Both private paths through exact installed candidate in real OpenClaw gateway and existing conversational human approval: browser/public setup → identity log and prejoin denied reads/private discovery absence/control-sibling nonmembership → reject/zero POST → fresh request/approval/exactly one POST → current receiver ready → same-group useful authorized responder answer in actual plugin output → independent membership/control/creator-role checks → verified cleanup. Keep responder live before question; consume no prejoin event as later proof. New isolated fixture for each path.
5. Final integrated immutable candidate and exact published package installation, then draft-public-guide walkthrough. No publish/deploy/promotion authorized here. Real provider retrieval remains distinct from deterministic responder delivery proof.

## Boundary Verification and review

Read root integration boundary `websocket-channels.md` with current MAI/OpenClaw feature contracts (historical account-only examples are not current identity semantics). Root Endpoint and actual plugin config/service agree on `ws(s)://<host>/api/v1/ws/websocket?token=<key>&vsn=2.0.0`; use Phoenix-v2 frames, `group:<group_id>` and `identity:<current_identity.id>`, not account-topic inference. Configured API key selects one identity; root serializer join `data.{group_id,agent_identity_id,role,inserted_at,created_at}`. No body/identity override on join. Actual Channel source `join()` awaits `sendJoin`, accepts `status:ok`, rejects changed joinRef/state; service currently swallows refusal/disconnected outcomes. Ten-second maximum post-success wait is normative; obsolete work must not overwrite newer state or attach duplicate handlers.

Boundary/interface review and decomposition review via CoS REQUIRED (all five trigger answers YES); test-only adapters and remaining gap coverage need review. Runtime pin and public installed baseline now PASS; no guessed platform SDK, new approval mechanism, native networking gate or test-only application API. Foundational state via public REST only. Worktree retained/blocked until prerequisite04 lands on the explicitly authorized satellite integration baseline and this worktree is refreshed; no cleanup eligible.
