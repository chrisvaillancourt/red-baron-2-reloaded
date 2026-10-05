# Agent orientation and current scheduling ledger

Snapshot checked **UTC 2026-10-05T05:35:44Z**, using the active parent's fresh
main/deployment/workspace receipts and worker handoffs. This is the only live dispatch queue.
[BACKLOG](BACKLOG.md) holds contracts/evidence; [DEFERRED-TODOS](DEFERRED-TODOS.md)
holds genuine blockers/untriggered ideas; [IMPLEMENTATION-NOTES](IMPLEMENTATION-NOTES.md)
holds compact pending designs. [DECISIONS](../DECISIONS.md) holds rationale and
[STATUS-ARCHIVE](STATUS-ARCHIVE.md) preserves historical state, not assignments.
UTC receipt dates can differ from a harness's local calendar date; compare absolute
timestamps, not bare date labels. Uncommitted branch edits are an owned working-copy
proposal, not another session's confirmed ledger.

## Release anchor

- Latest verified published `origin/main`:
  `185143100c6dac6f2c7d120cb9ec0180cda32af7`. [Main Actions 37266530088](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/37266530088)
  built/deployed successfully; deployed `prodcheck` passed with inspected menu/flight
  PNGs, all four workers/two aircraft models and empty errors/failed requests.
  Author-tool wave: 700 Vitest/21 Node/typecheck/build; 44 browser cases/one gated
  soak skip. F-49/F-55 source and module docs are published; no performance retune.
- Prior gameplay release `9c40f8ee5b1c2aee9a7038428d63daac18a74a6c` retains its
  [PR #14 receipt](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/14#issuecomment-5986900031)
  and scope-specific evidence below. Reconcile remote main again before later dispatch.
- Airfield Defense and its Xbox controls are published: left-stick aim, right-stick
  click (R3/button 11) ranging, RT fire, LT focus, LB/RB stations, X reload, D-pad
  fuze, Menu pause/return, scoped A/B navigation. No-touch battery; custom seeds
  and Options sliders still use keyboard/mouse. Broader flight-controller work is open.
- Prior flight/battery-release evidence: typecheck/build; **696 Vitest + 20 Node tests**
  passed (30 gated skips); **44 full browser cases** passed (one gated soak skipped).
  [PR validation](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/37253074881)
  built without publication; [main deployment](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/37253757536)
  built/deployed successfully. Deployed flight/battery screenshots and actual
  Chrome/Metal behavior were inspected; network/console error logs were empty.
  Synthetic input is not comprehensive hardware acceptance or a fresh AI balance study.

## Receipt freshness gate

1. **Orient:** read this snapshot, relevant task contract and decision/module docs.
   Identify the actual checkout/branch, fetched main and proposed owned workspace.
   A stale or occupied human checkout is not the worker base.
2. **Reconcile before dispatch:** for a candidate with a PR or retained work, read
   current PR metadata, the latest transition receipt and the owned workspace's
   read-only state. Match evidence to its exact head, integration base and scope.
   A newer receipt, changed head, conflicting blocker or missing evidence requires
   reconciliation before implementation or publication; mark uncertainty explicitly.
3. **Update the ledger:** record phase, owner/workspace, verified revision, receipt,
   checked UTC and concrete next action here. A newer proof supersedes a cached
   blocker only for the revision/scope it verified. Preserve dated evidence elsewhere.
4. **Claim and act:** name integration owner, task ID, exact base, owned files,
   acceptance, resource slot and handoff location before editing. Queue roles below
   are unclaimed roles, not authority to edit another session's tree.

**Completion:** the candidate's ledger state agrees with the newest applicable
receipt and protected-workspace facts. A plausible remembered status is insufficient.
Tool-limited sessions may propose work but must name the freshness check still needed.

## State transitions and blocked handoffs

- The task owner updates this row and the evidence receipt whenever a blocker,
  unblock, review result or completion changes the next action—not only at release.
  Keep the update with the relevant logical commit/PR; the integration owner publishes
  the reconciled ledger. BACKLOG/module notes link here rather than copy a live queue.
- Keep **implemented**, **reviewed**, **integrated**, **deployed** and **release-verified**
  distinct. Blocked/deferred rows name the missing decision/evidence or a trigger/date.
  No child report, local commit or staged merge proves publication.
- If signing, commit or push is blocked, publish a durable receipt on the existing
  PR/issue and notify the integration owner before yielding. Include task ID, exact
  verified head/base, owner/workspace, staged/ignored evidence, current blocker,
  superseded blocker and next action. Preserve the tree and authentication settings.
  If no shared channel is reachable, state that explicitly; the tracked ledger stays
  unconfirmed and the next agent must reconcile, not repeat the old design work.
- Receipt fields: **ID; phase change; head/base; evidence; owner/workspace; protected
  work; current blocker; superseded blocker; next action; checked UTC**.
  The receiver either reconciles this ledger or marks the row awaiting reconciliation.
- The parent counts at most **three independent review rounds per candidate/scope**:
  initial review plus at most two correction/re-review cycles, each on a frozen
  exact revision; corrections never reset the count. Record rounds/findings in
  BACKLOG. If round three still has blockers, mark the task **deferred**, retain
  branch/worktree/patch and findings with owner/reason/acceptance/concrete resumption
  trigger in [DEFERRED-TODOS](DEFERRED-TODOS.md#exhausted-review-retention), and release
  the track without publishing the red candidate. Resumption needs parent
  reconciliation and a newly bounded assignment, not an unattended scheduler.

## Current queue

Rows reflect the checked parent receipt above, not an unattended scheduler.
Parent omp is the sole active integration/publication owner; GPU QA is serial.
Workflowz collision/controller/bomber candidates and this intake ledger have active
owned handoffs; calibration/model-log/ground-audio trees are prepared for independent
bounded work. At most three implementation/evidence tracks run concurrently.
Documentation owner: `docs/workflowz-ledger`; parent owns integration/final receipts.

| ID | Outcome / phase | Owner | Evidence and next action |
|---|---|---|---|
| Q-01 | Non-publishing validation — released | Integration lead | [PR #9](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/9); preserve main-push-only publication. |
| Q-02 | Isolated browser automation — released | Integration lead | Shared native launch/fixtures, D-112; follow HARNESSES and GPU isolation. |
| Q-03 | Frozen gameplay baseline — evidence collected | Integration lead | BACKLOG's revisioned cohorts; historical measurements, not current-main/human calibration. |
| Q-04 | Tailhold/defence/raid A/B tools — released | Tools lead | [PR #11](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/11); use existing adapters, not duplicate tooling. |
| Q-05 | Release-verified | Parent integration owner | Signed transfer `9aa8c3d`, merge `d9008294`, published in first wave `e8095da`. [PR #10](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/10) closed as superseded, not old-head ancestry merged. Final integration round-three clean; CPU 699 Vitest/21 Node/build; 44 browser cases/one skip; whole collision approaches repeat exactly with zero collisions. Main deployment and live flight smoke passed. Original staged merge protected; [dated receipts](BACKLOG.md#workflowz-first-integrated-wave--2026-10-05-utc), D-115. |
| Q-06 | Ordinary flight-mate mutual support — implementation active | Parent + `rb2r-workflowz-mutual-support` | Exact base `1851431` after Q-05 release. Narrow bounded relief intent, one-helper election and physical intercept; parent owns two-pursuer/ordinary-flight threat, complete collision and five-mirror frozen comparisons. No new balance claim or generic threat-score bonus. |
| Q-07 | Human-like pursuer calibration — evidence blocked | Calibration lead + user | Collect meaningful comparable rated default dogfights with aim-bearing reports and held-out evaluation; battery raids and mixed/provenance-unknown cohorts are not substitutes. |
| Q-08 | Measurement release-verified; tuning still evidence/owner-gated | Parent + `rb2r-workflowz-bomber` | Authored tree `9a6d8047dde1b7378829da52cf0574431a959a74`: all 114 equal in 83579/87132; integrated d2a1788: all 114 equal in 96580/7161, with one authored-versus-integrated Quick Voisin triple difference, not global equivalence. Controlled table unchanged. [Provenance/limits](bombers.md#measured-authored-cohort--2026-10-05-utc). Both final reviews/full wave gates/main deployment/live smoke passed; published `adf1d37` in `e8095da`, no tuning. |
| Q-09 | Damage/career/raid policies — owner decision required | User + integration owner | Separate damage default, bullet-sponge feel, day-bomber eligibility and raid-enemy policy; [durable blockers](DEFERRED-TODOS.md#blocked-task-contracts). No implicit policy change. |
| Q-10 | CI runner migration — deferred | CI lead | Pinned Ubuntu 24.04, D-077; target 2027-01-31, isolated workflow_dispatch validation before cutover. |
| Q-11 | LICENSE — owner decision required | User | Explicit license selection; telemetry and release authorization do not select a license. |
| Q-12 | Touch browser path published; physical acceptance blocked | Mobile lead + user | BACKLOG Q-12 contract; real recent iPhone/Safari, repeated sorties/save/rotation/backgrounding and sustained performance. |
| Q-13 | Input committed; HUD/navigation reviewed and composed for session binding | Parent + separate HUD/navigation/session/prompts workspaces; user for hardware | Input prerequisite `bbfdcd0b693595865cc9488530dfb442c0f2be5d`: full CPU green, both round-two reviews clean. HUD `2edd91e` clean round one; navigation `ae82dbb` clean round two and all 16 actual navigation/battery/options cases passed. Both composed into parent session tree; B session ownership/teardown/epoch binding and E player prompts active. Not integrated into main or published. [Revisioned receipts](BACKLOG.md#q13a-input-prerequisite--revisioned-receipts). |
| Q-14 | Production Airfield Defense — release-verified | Integration lead | Battery [PR #13](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/13), controller PR #14 receipt above; no unfinished battery dependency. |
| Q-15 | Claude routing/workspace trial — deferred | Next Claude project session + user | Review BACKLOG Q-15 before configuration/routing changes. Context-discovery probes do not enable that trial. |

## Next dispatch

1. Finish Q-13 session/prompts from the exact committed input prerequisite and
   reviewed HUD/navigation counterparts; run integrated software gates. Do not
   publish an incomplete controller feature or imply physical hardware acceptance.
2. Q-06's separate ordinary-flight support implementation and F-44's exact-commit
   verification utility are active; gate their authored scopes independently.
3. Refill ready utility debt only after review/integration backpressure clears.
4. Q-08 authored observations are not retagged as integrated observations.
   Formation/pacing tuning remains owner-blocked.

Refill eligible independent author/tool debt through the parent's bounded pull loop,
at most three active implementation/evidence tracks plus parent. Two pending
reviews/integrations pause new implementation dispatch. F-49's author diagnostic
is reviewed, locally integrated, and has focused consumer/native-equivalence proof.
F-55's corrected authored tree `5bd5baac` passed actual WebAudio QA; both independent
round-two reviews are clean. Its actual destination output is measured after the
unchanged limiter, not the former pre-limiter headroom tap. Locally integrated;
full tooling-wave regression gates/publication remain pending. No gates or commits
are delegated. F-51/F-72/F-74 are release-verified in first wave `e8095da`.
Active/reachable F-25/F-44/F-53/F-56/F-57/F-58/F-67/F-75 remain eligible subject
to exact scoped contracts.
Genuine conditions live in DEFERRED-TODOS, not another ready queue.

## Protected workspaces and processes

Parent preserved the original **29 registered trees** and created **13 workflowz
owned trees** (42 registered at 2026-10-05T05:35:44Z). Seven use exact base
`a91f9b478b964491d1b86f1e493a7969eaab1068`; HUD/navigation/session/prompts use input
prerequisite `bbfdcd0b693595865cc9488530dfb442c0f2be5d`; mutual-support/checkcommits
use published `1851431`. No removal authorized.
Recheck ownership, dirty/staged/ignored work, unpushed commits and processes before
cleanup. Old per-tree refs below are retained inventory, not freshly verified source
cleanliness for every tree.

| Workspace | Branch / revision / owner | Preservation reason |
|---|---|---|
| `red-baron-2-reloaded` | Parent integration owner, local/published `main` `185143100c6dac6f2c7d120cb9ec0180cda32af7` | First-wave and author-tool full gates, deployments and inspected live flight smokes passed. Only owned receipt edits remain; unfinished controller/AI/tools are isolated elsewhere. Human inbox/scratch preserved. |
| OS-temp `rb2r-ab-aA0DOQ` | Detached `d52b64a`; prior A/B | Un-audited provenance/output; preserve. |
| OS-temp `rb2r-ab-dyK0Zu` | Detached `87b798e`; prior A/B | Same retention rule. |
| `rb2r-agent-handoff` | `docs/agent-handoff-freshness`, original base `9c40f8e`; prior docs owner | Published handoff/protocol and orientation evidence; preserved, not current documentation worker. |
| `rb2r-airfield-defense` | `feat/airfield-defense` / `0652782`; prior feature owner | Published source and original playtest evidence. |
| `rb2r-airfield-release` | `integrate/airfield-defense-release` / `e3e6fa5`; prior release owner | PR #13 integration/QA evidence. |
| `rb2r-archie-prototype` | `prototype/archie-defense` / `b82eab2`; prior prototype owner | Prototype evidence; persistent `archie-prototype-dev` remains handed over. |
| `rb2r-backlog-cycle-two` | `docs/backlog-cycle-two-evidence` / `4dc8ec8`; prior lead | Frozen cohorts and cycle-two evidence. |
| `rb2r-backlog-execution` | `chore/backlog-execution` / `b3c9623`; prior lead | Earlier scheduling/replay evidence. |
| `rb2r-bomber-readiness` | `fix/bomber-sim-readiness` / `8aac951`; prior sim owner | PR #4 original branch/QA evidence. |
| `rb2r-collision-baseline` | Detached `87b798e`; prior AI owner | Collision reproduction baseline. |
| `rb2r-collision-escape` | `fix/feasible-collision-escape` / `92d3dba`; prior AI owner | **24 staged files, MERGE_HEAD `4dc8ec8`**; preserve old verified merge, refresh in owned integration. |
| `rb2r-debt-height` | `perf/height-cache-locality` / `4057201`; prior owner | PR #3 source/evidence. |
| `rb2r-debt-spatial` | `perf/world-spatial-queries` / `aed20d9`; prior owner | PR #2 source/evidence. |
| `rb2r-debt-spec` | `fix/spec-cache-identity` / `791da38`; prior owner | PR #1 source/evidence. |
| `rb2r-defense-combat` | `feat/defense-combat` / `7b05fd0`; prior lead | Unused prepared track; actual harness worker evidence was integrated. |
| `rb2r-defense-menu` | `feat/defense-menu` / `7b05fd0`; prior lead | Same retention rule. |
| `rb2r-defense-render` | `feat/defense-render` / `7b05fd0`; prior lead | Same retention rule. |
| `rb2r-defense-xbox` | `feat/defense-xbox-controls` / `5315da8`; user playtest | Service `defense-xbox-dev`, port 5390: original right-stick/Y layout, not final published code. |
| `rb2r-defense-xbox-layout` | `fix/defense-xbox-layout` / `1a7ea7e`; user playtest | Service `defense-xbox-layout-dev`, port 5392: approved left-stick/R3, before final release guards. |
| `rb2r-development-feedback` | `perf/development-feedback` / `dfb8c3b`; prior tools owner | Published tooling/QA evidence. |
| `rb2r-direct-playwright-qa` | `perf/direct-playwright-qa` / `153eb02`; prior tools owner | D-112 native QA source/evidence. |
| `rb2r-headless-browser-qa` | `docs/headless-browser-qa` / `fef7d92`; prior owner | Shared QA policy evidence. |
| `rb2r-player-aircraft-access` | `feat/player-aircraft-access` / `37e8c0b`; prior owner | PR #5 source/roster screenshots. |
| `rb2r-pr-integration` | `review/open-pr-integration` / `0ef2f76`; prior reviewer | Reviewed historical snapshot. |
| `rb2r-survey-adapters` | `feat/survey-adapters` / `3d8ae87`; prior tools owner | PR #11 survey recipes/raw comparisons. |
| `rb2r-visual-atmosphere` | `feat/cockpit-quality-refinement` / `538b6f5`; prior render owner | PR #8 matched visual/model evidence. |
| `rb2r-xbox-menu-baseline` | Detached `1a7ea7e`; prior release owner | Sequential fresh-Menu baseline, test edits restored/source clean; 5399 exited. |
| `rb2r-xbox-release` | `integrate/xbox-release` / `3a5d34e`; prior release owner | Final PR #14 source, receipt, local/live PNGs/JSON; 5396 preview stopped. |
| `rb2r-workflowz-collision` | `fix/workflowz-collision`, signed `9aa8c3d`, base `a91f9b4`; collision worker + parent | Source published in first wave `e8095da`; Q-05 receipt above. Original occupied collision tree is separate and untouched. |
| `rb2r-workflowz-controller` | `feat/workflowz-flight-controller`, signed `bbfdcd0b693595865cc9488530dfb442c0f2be5d`, base `a91f9b4`; input worker + parent | Input prerequisite full CPU green, both round-two reviews clean; broader software/hardware pending. Historical native proof retains its own revisions. |
| `rb2r-workflowz-bomber` | `tools/workflowz-bomber-pacing`, final authored tree `9a6d8047dde1b7378829da52cf0574431a959a74`, base `a91f9b4`; measurement worker + parent | Final 114-case authored repetition and complete pre-hoist comparison equal; round-three reviews clean. Integrated tree d2a1788 repeats all 114 exactly in its own processes but differs from authored observations in one Quick case; retained distinct reports, no global equivalence claim. |
| `rb2r-workflowz-ledger` | `docs/workflowz-ledger`, reviewed tree `c253109e772c502383a3eddeeb066f66c389014d`, base `a91f9b4`; intake worker + parent | Both round-two reviews clean; proposal integrated/published with parent reconciled receipts in `e8095da`; original worker proposal retained. |
| `rb2r-workflowz-calibration` | `tools/workflowz-calibration`, reviewed authored tree `6d3015dc964bdf706b403c06828ebd0a290b95f8`, base `a91f9b4`; author-diagnostics worker + parent | Both round-one reviews clean; five targeted/native diagnostic and all derived coefficient equality probes passed. Published `b0c76fe` in author-tool wave `1851431`, full CPU/browser/deployment/live smoke passed. No retune. |
| `rb2r-workflowz-model-log` | `tools/workflowz-model-log`, authored tree `1ce07668905f2e085bc4cefacd8ecc55aa776711`, base `a91f9b4`; model-log worker + parent | Real Blender four-model no-export provenance proof, clean reviews, full integrated gates; published `817696f` in first wave `e8095da`. No GLB geometry change. |
| `rb2r-workflowz-ground-audio` | `tools/workflowz-ground-audio`, corrected reviewed tree `5bd5baac83f31e1d4126d4a584a11c66281b4b3a`, base `a91f9b4`; bench worker + parent | Actual WebAudio QA and physical-impact probe passed, both round-two reviews clean. Published `1851431`, full regression/deployment/live gates passed. Saved bench PNGs and distinct pre-/post-limiter probe retained; service stopped. |
| `rb2r-workflowz-controller-hud` | `feat/workflowz-controller-hud`, frozen `2edd91e57416eb78252a92df28838b7672872cb3`, base `bbfdcd0b`; Q-13C worker + parent | Both round-one reviews clean; composed into separate session workspace. Standalone authored scope, not full Q-13 software proof/publication. |
| `rb2r-workflowz-controller-nav` | `fix/workflowz-controller-nav`, frozen `ae82dbb7ffda1064cd7d3a53e430457c56eeeef1`, base `bbfdcd0b`; Q-13D worker + parent | Both round-two reviews clean; actual 16 navigation/battery/options cases passed after retaining partial-redraw focus and baseline loading first-A acquisition. Composed into session workspace; main publication pending. |
| `rb2r-workflowz-controller-session` | `feat/workflowz-controller-session`, base `bbfdcd0b`; parent Q-13B owner | Reviewed C/D source composed; input ownership/modal/error/epoch/teardown integration active, no standalone feature publication. |
| `rb2r-workflowz-controller-prompts` | `feat/workflowz-controller-prompts`, base `bbfdcd0b`; Q-13E worker | Owned manual/tutorial/briefing/contextual flight prompts; parent binds helper after review. |
| `rb2r-workflowz-mutual-support` | `feat/workflowz-mutual-support`, base `1851431`; Q-06 worker | Owned ordinary-flight relief/physical-intercept candidate and real-sim fixtures; parent owns baseline/updated proof. |
| `rb2r-workflowz-checkcommits` | `feat/workflowz-checkcommits`, base `1851431`; F-44 worker | Owned exact-commit verification/lifecycle utility, prerequisite for F-75; parent owns real installs/gates and caller-preservation proof. |

Observed listeners **5390/5392** are preserved user playtests; **5365** is the
preserved prototype. No removal or stopping authorized. Existing release QA services
remain historical receipts; active parent gate processes are parent-owned.
OMP's LSP/shared browser daemon are harness-owned, not game services to kill.
Separate retained harness workers and ignored evidence remain protected pending
fresh cleanup authority/audit.
