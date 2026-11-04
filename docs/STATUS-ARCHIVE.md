# Status archive — snapshot before agent-handoff reconciliation

> Historical evidence and superseded scheduling, preserved from gameplay release
> `9c40f8e`. This file is not a dispatch queue or a claim about current state.
> Read [STATUS.md](STATUS.md) for current orientation, ownership and receipt freshness.

## Workflowz ledger — snapshot 2026-10-05, archived 2026-11-04

The full STATUS.md as last reconciled by the omp workflowz session (UTC 2026-10-05T05:35:44Z), kept for its receipts and workspace preservation reasons. Not current state.


Snapshot checked **UTC 2026-10-05T05:35:44Z**, using the active parent's fresh
main/deployment/workspace receipts and worker handoffs. This is the only live dispatch queue.
[BACKLOG](BACKLOG.md) holds contracts/evidence; [DEFERRED-TODOS](DEFERRED-TODOS.md)
holds genuine blockers/untriggered ideas; [IMPLEMENTATION-NOTES](IMPLEMENTATION-NOTES.md)
holds compact pending designs. [DECISIONS](../DECISIONS.md) holds rationale and
[STATUS-ARCHIVE](STATUS-ARCHIVE.md) preserves historical state, not assignments.
UTC receipt dates can differ from a harness's local calendar date; compare absolute
timestamps, not bare date labels. Uncommitted branch edits are an owned working-copy
proposal, not another session's confirmed ledger.

### Release anchor

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

### Receipt freshness gate

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

### State transitions and blocked handoffs

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

### Current queue

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
| Q-05 | Release-verified | Parent integration owner | Signed transfer `9aa8c3d`, merge `d9008294`, published in first wave `e8095da`. [PR #10](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/10) closed as superseded, not old-head ancestry merged. Final integration round-three clean; CPU 699 Vitest/21 Node/build; 44 browser cases/one skip; whole collision approaches repeat exactly with zero collisions. Main deployment and live flight smoke passed. Original staged merge protected; [dated receipts](BACKLOG-ARCHIVE.md#workflowz-first-integrated-wave--2026-10-05-utc), D-115. |
| Q-06 | Ordinary flight-mate mutual support — implementation active | Parent + `rb2r-workflowz-mutual-support` | Exact base `1851431` after Q-05 release. Narrow bounded relief intent, one-helper election and physical intercept; parent owns two-pursuer/ordinary-flight threat, complete collision and five-mirror frozen comparisons. No new balance claim or generic threat-score bonus. |
| Q-07 | Human-like pursuer calibration — evidence blocked | Calibration lead + user | Collect meaningful comparable rated default dogfights with aim-bearing reports and held-out evaluation; battery raids and mixed/provenance-unknown cohorts are not substitutes. |
| Q-08 | Measurement release-verified; tuning still evidence/owner-gated | Parent + `rb2r-workflowz-bomber` | Authored tree `9a6d8047dde1b7378829da52cf0574431a959a74`: all 114 equal in 83579/87132; integrated d2a1788: all 114 equal in 96580/7161, with one authored-versus-integrated Quick Voisin triple difference, not global equivalence. Controlled table unchanged. [Provenance/limits](bombers.md#measured-authored-cohort--2026-10-05-utc). Both final reviews/full wave gates/main deployment/live smoke passed; published `adf1d37` in `e8095da`, no tuning. |
| Q-09 | Damage/career/raid policies — owner decision required | User + integration owner | Separate damage default, bullet-sponge feel, day-bomber eligibility and raid-enemy policy; [durable blockers](DEFERRED-TODOS.md#blocked-task-contracts). No implicit policy change. |
| Q-10 | CI runner migration — deferred | CI lead | Pinned Ubuntu 24.04, D-077; target 2027-01-31, isolated workflow_dispatch validation before cutover. |
| Q-11 | LICENSE — owner decision required | User | Explicit license selection; telemetry and release authorization do not select a license. |
| Q-12 | Touch browser path published; physical acceptance blocked | Mobile lead + user | BACKLOG Q-12 contract; real recent iPhone/Safari, repeated sorties/save/rotation/backgrounding and sustained performance. |
| Q-13 | Input committed; HUD/navigation reviewed and composed for session binding | Parent + separate HUD/navigation/session/prompts workspaces; user for hardware | Input prerequisite `bbfdcd0b693595865cc9488530dfb442c0f2be5d`: full CPU green, both round-two reviews clean. HUD `2edd91e` clean round one; navigation `ae82dbb` clean round two and all 16 actual navigation/battery/options cases passed. Both composed into parent session tree; B session ownership/teardown/epoch binding and E player prompts active. Not integrated into main or published. [Revisioned receipts](BACKLOG-ARCHIVE.md#q13a-input-prerequisite--revisioned-receipts). |
| Q-14 | Production Airfield Defense — release-verified | Integration lead | Battery [PR #13](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/13), controller PR #14 receipt above; no unfinished battery dependency. |
| Q-15 | Claude routing/workspace trial — deferred | Next Claude project session + user | Review BACKLOG Q-15 before configuration/routing changes. Context-discovery probes do not enable that trial. |

### Next dispatch

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

### Protected workspaces and processes

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

## Historical rolling queue — captured Xbox release preparation

At capture, this table superseded the older scheduling instructions below. Current
dispatch now lives only in STATUS; contracts/evidence: [BACKLOG](BACKLOG.md).
Owner: parent omp integration session, `integrate/xbox-release`. User authorized
verified merges and deployments while away: independent review, relevant checks,
green CI, then live verification before the next publication. No workspace cleanup
or unresolved LICENSE/gameplay-policy decisions are authorized.

| ID | Outcome | State / owner | Acceptance or unblock condition |
|---|---|---|---|
| Q-01 | Non-publishing PR/manual validation | Released / lead | PR #9 merged as 87b798e; deploy run 37184804448 and live smoke passed |
| Q-02 | Isolated, consistent browser automation | Released / lead | 23 browser tests and live production smoke passed |
| Q-03 | Current gameplay evidence | Complete / integration lead | Frozen-SHA fairness/quick/career/raid surveys and report replays recorded in BACKLOG |
| Q-04 | Tailhold/defence/raid A/B coverage | Released / lead | PR #11 merged as 4fb2224; deploy run 37189540415 and inspected live flight smoke passed |
| Q-05 | Attack-extension collision reproduction | Correction verified / retained integration pending, PR #10 | 92d3dba removed the earlier large balance shift: default player-down 29.2% → 25.0% at 48 flights/side; mirrors and quick outcomes within noise. The old 4dc8ec8 merge remains staged in the collision workspace; refresh it against current main, commit, validate CI and publish. Latest PR receipts supersede the obsolete 4.2% blocker. |
| Q-06 | Mutual support for ordinary flight-mates | Blocked on Q-03/Q-05 / AI tactics | Both pursuers, meaningful threat, collision and mirror-fairness gates |
| Q-07 | Human-like pursuer calibration | Blocked on comparable human evidence / calibration | Only 58 rounds/two hits in aim-bearing default flights; require provenance-confirmed cohort and meaningful held-out evaluation before changing fit |
| Q-08 | Bomber pacing/interception policy | Ready for measurement / lead | Measure speed/slot error before choosing policy; preserve aircraft performance |
| Q-09 | Damage and career eligibility policies | Blocked on owner decision / lead | Explicit default/feel/day-bomber choices; no implicit tuning |
| Q-10 | CI runner migration | Deferred / CI | Safe branch validation first; target 2027-01-31 |
| Q-11 | LICENSE | Blocked on owner choice | Explicit license selection |
| Q-12 | Playable on a high-end modern iPhone | Browser implementation verified / physical-device acceptance blocked | Touch-only raid/debrief, multipointer and hybrid keyboard/controller flows pass; 29 full browser tests pass; physical iPhone Safari lifecycle, saves and sustained performance remain required |
| Q-13 | Xbox controller support for common controls | Battery via PR #14 / broader flight mapping audit ready | Playtest-approved left-stick aim and R3 ranging; [publication/verification receipt](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/14). Flight/combat/crew/camera audit and formal hardware lifecycle coverage remain open; see BACKLOG and D-113. |
| Q-14 | Production Airfield Defense | Released / integration lead | Battery PR #13/main 1ef1893 passed deployment and live checks. D-113 Xbox follow-up is [PR #14](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/14); its receipt records publication status and deployed evidence. |
| Q-15 | Explicit Claude worker workspace and bounded trial | Deferred / next Claude project session | Review/resume with the owner next time Claude is used here; scope and acceptance in BACKLOG; no Claude changes authorized or implemented now |

States distinguish implementation from integration and deployment. Deferred visual/gameplay
ideas below stay deferred until their stated player-evidence trigger occurs.

The game is playable end to end: `pnpm dev`, then open http://localhost:5173
(README "Your first flight" walks a new player through it). Career (all four
nations, 1915–1918), quick missions, the full flight/combat sim, AI, streamed
Western Front terrain, 33 Blender-built aircraft and procedural audio are all
integrated on `main`.

The wave-7 release check (docs/PLAYTEST.md, top section) gave a **GO**: a fan
can play for an evening without hitting a blocker. Everything still open below
is minor or polish, and each item carries a disposition.

Verified on `main` after the wave-9 merges: `npx tsc --noEmit` clean, `pnpm test`
382 passed (24 env-gated soak tests skipped), `pnpm e2e` 18 passed (1 gated
soak skipped) with no game running on the same GPU (FRICTION F-20). The deploy passed on the pinned `ubuntu-24.04` runner, and
`pnpm prodcheck` passed on the live URL.

## Historical figures (wave 9 re-baseline, 2026-09-28, commit f84cb16)
These veteran-autoplayer measurements are historical, not a current-main baseline.
Preserve their commands/cohorts; newer frozen evidence is recorded in [BACKLOG.md](BACKLOG.md).
- **Default quick dogfight** (Camel+1 v 2 veteran D.VII, D-078): 28% player down, 96 runs; 30%
  with clear head-on starts (D-082), within noise.
- **Mirror fights** (48 runs each), player down: Camel 38%, D.V 52%, Dr.I 44%, SPAD XIII 31%,
  D.VII 23%.
- **Quick defaults by type** (24 runs each), success / killed / captured:
  - dogfight 83 / 8 / 4%
  - balloon attack 100 / 42 / 0%
  - escort 92 / 4 / 8%
  - intercept 88 / 17 / 0%
  - ground attack 92 / 17 / 0%
- **Veteran career** (3 seed sets, 245 missions): 21.6% killed or captured. There were
  1.6 collisions per 100 missions, counting every collision event, and none involved the
  player.
- **Ambush entries** where stalking can apply (14 runs each): veteran 57%, ace 62%,
  stalker ace 100% (all unseen). Unchanged from wave 8.
- **Cloud refuge** (6 seeds): a wounded pilot takes 28 hits with refuge against 195 without.

## Historical release chronology (snapshot 2026-10-04)

**PR #4 is merged and deployed:** `f814e2a` on main, decisions D-101/D-102.
GitHub Pages build/deploy run `37174451413` succeeded. This includes the bomber
simulation/model-alignment fixes and exact differential tooling.

**Player-access cutover: PR #5, decision D-103.** All 33 aircraft are available in ordinary
Quick Missions, seven in bombing raids. Aircraft and valid crew seats survive mission
changes and reloads. The user authorized integration into main after independent review.

- Typecheck/build passed; 662 Vitest and 8 Node tool tests passed, 30 gated tests skipped.
- The updated D.H.4 raid/observer/debrief/mission-transition Playwright test passed.
  Actual Chrome/Metal UI checks selected all 14 unlocked types and flew the Gotha tunnel/
  pilot and F.E.2b nose-gunner stations. No full Playwright or AI balance survey is claimed.
- Fresh-process comparison against main: all 40 sampled AI pools and 20 career
  squadron/equipment selections equal. No physics, AI composition, campaign content,
  shared contract or dependency changes in this cutover.
- Decisions and measured implementation notes are in `DECISIONS.md` and `docs/bombers.md`.
- Independent Standards and Spec reviews of `a0bbd77` found no violations or missing
  requirements. The associated GitHub Actions run records deployment status.

**Atmosphere pass: PR #6 merged and deployed** as `89ae060`. GitHub Pages
[run 37181203687](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/37181203687)
passed typecheck, tests, build and deployment. A fresh Chrome/Metal session on the
public site exercised Quick Mission, briefing, first-flight instructions and an
actual Camel flight; the cockpit screenshot was inspected and no browser errors
were observed. This is a release smoke, not a full Playwright run.

**Graphics detail cutover: [PR #7](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/7),
decision D-104.** The user authorized integration after independent review.
The cutover includes clustered high/ultra crowns, aircraft surface UVs/material
finishes, instrument readability and differential-test failure diagnostics.
Behaviour through `59f3fc7` passed typecheck, 663 Vitest tests
and 8 Node tool regressions (30 gated tests skipped), in-engine visual checks and
independent Standards/Spec reviews. Before/after images and measured GPU costs are
in the PR; performance samples are scene-specific, not a general 60-FPS guarantee.
The PR's associated GitHub Actions run and release-smoke comment record deployment status.

**Cockpit/quality integration: [PR #8](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/8),
decision D-105**, based on PR #7 (`dc9f085`): low/medium aircraft surface shaders now cost less, while
high/ultra retain the full finish. The generator refines pilot padding, panel
construction and fixed guns across all 33 models; all stay below 12,000 triangles.
Shared core change: an optional third graphics-quality factory argument, passed
explicitly by live-flight and hangar consumers. No simulation changes.
Matched comparisons are in `docs/screenshots/cockpit-quality/`; method and
scene-specific timings are in `docs/models.md`. Local typecheck, 663 Vitest tests,
8 tool regressions and production build passed (30 gated tests skipped).
Chrome/Metal/M3 Max QA inspected Camel, D.H.4, Albatros and Gotha cockpits,
exercised flights at every preset, and verified mixed-quality material/disposal
isolation with no browser errors. Full Playwright suite was not run.
The hangar now pins animation/gauge time for repeatable captures (F-88).
The user authorized the merge; the PR's associated Actions run and integration
comment record the final merge and deployment status.

- **Merged: bombers and gunner seats, wave 1** (plan and file ownership in
  `docs/bombers.md` "Waves"). All four tracks are on main:
  - **Contracts** (D-086, `src/data/crew.ts`) and **track A, sim** (D-088): combat on crew
    stations, twins, bombs.
  - **Track C, game and UI** (D-090 to D-092): seat picker, gunner view, bombsight, bomb
    results in the debrief.
  - **Track B, data, models and effects** (D-093 to D-096): six bombers (Gotha G.V,
    O/400, AEG G.IV, Breguet 14, D.H.9, Voisin III) calibrated to their sources, falling
    bombs, whistles, bursts, craters.
  - **Track D, campaign and AI** (D-097 to D-099): the quick Bombing raid (no longer
    behind `?bombing`), bomber formations, a gunner per crew member, interceptors from the
    blind spot, escorts that stay with the bombers, career bomb waypoints, a `twoseat`
    fairness set, repeatable seeded careers (F-33). Every A/B within noise; raid survey in
    docs/ai.md "Bombers".
  - Lead fixes on main: `splitSide` and `releaseAIPilot` (track C review).
- **Next work, in order:**
  1. **Done: readiness integration.** PR #4 resolved the low roll-rate floor, twin support
     and engine-hit geometry, and prone ventral crew. F-71 is resolved. Per-engine propeller
     sizing was already correct. Rough/sloped-field and crosswind limits remain unmeasured.
  2. **Done: player-access cutover (PR #5, D-103).** Selection, persistence and live crew
     flows are verified; AI pools remain independent.
  3. **Lead:** replay the user's reports (`playtests/reports/` and the main checkout's
     `playtests/inbox/`) against the defence changes (D-085) with
     `node tools/playtest/replay-report.mjs`, and re-baseline "Current figures" with
     `tools/dev/ab.mjs` now that the bomber tracks have merged.
  4. **Mutual support** (item 4 below); it edits `src/ai/controller.ts`, now free.
  5. **Track D's open questions, for the user with a recommendation:**
     - Gotha wingmen fall about 80 m behind their slots on a long run in: formation speed
       (0.72 of top) sits near the Gotha's loaded minimum. Set it within the band between
       stall and top speed?
     - The career bomber pool includes the O/400 and Gothas, which flew mostly at night or
       against England: day bombers only for career `bomb` flights until night bombing?
     - The Quick Mission enemy list offers bombers as interceptors on a raid: fighters
       only?
     - Interceptors can't catch a lone D.H.4 at 0.8 of top speed (formations fly at 0.72).
- **Needs a user decision (asked 2026-09-28):**
  - **The damage-path flag** (D-089, `SIM_FLAGS.damagePath`): the engine block in path
    order changes no outcome within noise. The lead recommends turning it on (it also
    lowers the combat.test floor).
  - **Bullet-sponge levers:** about 38 hits to kill, 54–58% of victories from tail failure.
    The feel comes from tail damage per hit and tail box size, and from wing damage lowering
    the g limit. Should an agent A/B those levers?
- **Waiting on the user:** 3–5 flights at the default setup (a Camel against 2 veteran
  D.VIIs at 2,500 m) with ratings, and the LICENSE decision.

## Historical next-up queue (2026-09-28; superseded by STATUS)
1. **Do: human playtest** on `pnpm dev`, 5–10 missions (one done, see 4). Every other
   figure comes from the autoplayer. Each flight's report saves itself to the git-ignored
   `playtests/inbox/` (D-084); rating it and adding a note on the debrief is optional. On
   the live URL, press **Copy flight report** and paste it into the chat instead (D-083).
   Look at:
   - whether the new default fight (2 veteran D.VIIs, D-078) is too hard
   - whether default balloon attacks feel punishing
   - whether sun attacks feel fair
   - whether a dive into cloud shakes a pursuer (D-081)
   The lead then replays each report (`node tools/playtest/replay-report.mjs <file>`) and
   turns the fights that felt wrong into seeded scenes or tests.
2. **Done (wave 9, D-078): the default quick fight** is now 2 veteran D.VIIs, at 28% player
   down over 96 runs (was 4% against D.Vs). Every other quick type got harder too, balloon
   attacks most of all (31% killed). See docs/ai.md "Wave 9".
   - **Defer:** first-visit enemy skill that depends on the mission type. Do it if
     playtests find default balloon attacks or escorts punishing.
   - **Skip:** tuning the D.V's dive limit or drag. The default no longer depends on it.
3. **Done: cloud cuts hits, not just sight** (D-081).
   A contrast limit on in-cloud sight, no blind pursuit or fire while cloud hides the
   target, and a refuge that circles the core for 25–40 s. A wounded pilot takes 28 hits
   with refuge against 195 without (was 196 against 213; `cloudEscape.realsim.test.ts`).
   **Check** in the human playtest that a player who dives into cloud shakes a pursuer.
4. **Done (wave 9, D-085, D-087 "Human-like pursuer"): enemies with you on their tail.**
   This answers the first playtest report ("they just fly in circles"). Every design was
   measured against the veteran autoplayer and a new human-like pursuer (`AUTOPLAY_PILOT=
   human`, fitted to the user's flights). Turning stays their best defence; the scissors,
   dive and climb ladder got them shot down 2-4x as often against both pursuers. Shipped:
   - veterans and aces above 500 m throttle back in the turn to make you overshoot, then
     turn on you
   - anyone above novice reverses his turn when you fall into lag behind him
   - nobody but novices jinks with you close behind
   With a human-like pursuer on his tail at 2,000 m a D.VII takes 432 hits instead of 645
   (96 seeds, after the code-review fixes), and 53% of the tail-hold is out of one
   constant-direction turn instead of 41%; at 300 m 62% against 52%, hits within 7%.
   Fairness, quick and career surveys: all within noise. See docs/ai.md "Wave 9: defence"
   and "Human-like pursuer".
   - **Do next: mutual support.** In the report the player took 3 hits in 6 minutes against
     5 aces. The aces who aren't being chased never come to clear a friend's tail. D-070
     dropped this for the autoplayer's mirror fights; re-measure it with the report scene
     (`playtests/reports/2026-09-28-…-low.json`), `AI_SOAK=tailhold AI_TH_SET=low` and
     both pursuers.
   - **Do: refit the human-like pursuer** from the next few human reports, which now carry
     `aim` (the player's accuracy apart from the AI crew's, aim error, firing range, time to
     fire). The current fit is one scene and two usable flights; replays and balloon runs
     don't match it (docs/ai.md "Human-like pursuer"). Over 96 seeds it hits with 9% of its
     fixed rounds in the fitted scene, the low edge of the human's 10-14% (the 12% fit was
     on 24 seeds); fit on 96 seeds next time.
   - **Defer:** low-level defence beyond the reversal. Below 500 m there is no brake turn
     (D-060); revisit if players find low fights too easy after mutual support.
   - **Do: collision care in the attack extension.** AI-against-enemy collisions in the
     quick survey are 7 of 360 missions with or without the escalation, nearly all with both
     aircraft in the *extend* phase after a pass, mostly Camel+2 v 3 Dr.I. The collision
     soak's furballs don't reproduce it (0 in 60), so it needs a scene built from the quick
     survey's cases first. After the review fixes the player's own collisions are 3 → 5
     distinct in the quick survey and 2 → 5 in the career (both within noise), mostly the
     same extension case with the player's aircraft; include those in the scene.
   - **Check:** the SPAD XIII mirror is 33 → 25% player down with the escalation (within
     noise, below the 30-70% band). Re-measure at the next re-baseline.
   - **Check:** self-crashes on the way home 1 → 3 in the quick survey (360 missions). A
     small count; re-measure at the next re-baseline.
   - **Check:** the report's human hit D.VIIs 104 times for one kill (roughly 40-55 of those were
     the observer's). That's D.VII damage tolerance, not AI; look at it if players say
     D.VIIs are bullet sponges.
5. **Housekeeping:**
   - **Decide: add a LICENSE.** The repo is public but has none, so no reuse is allowed.
     The original game's names and assets are a separate question.
   - **Do: upgrade the CI runner to Ubuntu 26.04, target 2027-01-31.** Deploys are
     pinned to `ubuntu-24.04` (D-077), so the 2026-10-19 `ubuntu-latest` switch can't
     break them. The pin stays until someone moves it. On a branch, change both
     `runs-on` lines in `.github/workflows/deploy.yml` to `ubuntu-26.04` and run it
     with `workflow_dispatch`. It passes when typecheck, tests and build are green.
     Then merge to `main`, run `pnpm prodcheck` against the live URL, and update D-077.
   - **Defer: split `flightModules`** (699 kB, 202 kB gzip). It's prefetched already;
     do it only if the first flight is slow on weak connections.
6. **Skip:** e2e in CI (it needs a GPU runner; run `pnpm e2e` locally before pushing),
   and the untried AI ideas in "AI depth — wave 8" until playtests show fights feel
   shallow.

## Deployment
- **Live:** https://chrisvaillancourt.github.io/red-baron-2-reloaded/ (public repo
  `chrisvaillancourt/red-baron-2-reloaded`, GitHub Pages; DECISIONS D-072).
- **How deploys happen:** every push to `main` runs `.github/workflows/deploy.yml` on a
  pinned `ubuntu-24.04` runner (D-077): frozen-lockfile install, typecheck, unit tests,
  build, then a Pages deploy. A failing
  test blocks the release. E2E is not in CI (it needs a GPU), so run `pnpm e2e` locally
  before pushing.
- **After a deploy:** `pnpm prodcheck https://chrisvaillancourt.github.io/red-baron-2-reloaded/`
  runs a cold-cache load, a flight, GLBs and workers, and fails on any error.

## AI depth — wave 8 (sun, cloud, stalking, ace signatures)
Details in docs/ai.md ("Wave 8 results", "Known weaknesses") and DECISIONS D-073..D-076.
- **Done:**
  - **Shared sky:** one sun and one cloud field in src/world, used by both the renderer
    and the AI.
  - **Perception:** sun glare (the core is within 5° of the sun), cloud line of sight,
    and last-seen memory. The player's threat triangles and automatic target box follow
    the same rules; padlock is unchanged. The HUD draws a glare wash-out so the sun hides
    a diving enemy from humans too.
  - **Tactics:** stalking down the sun line on a constant-bearing course, veterans and
    aces turning up into a bounce, cloud refuge for pilots forced home, and hunting from
    the last-seen position.
  - **Ace signatures:** `Ace.tactics`, with sources in D-074. The ace id reaches the AI
    through one shared adapter (`src/game/aiOptions.ts`) for both the game and the
    autoplayer.
- **Measured in wave 8** (on / off, with run counts in docs/ai.md). These are superseded by
  "Current figures" above:
  - Where stalking can apply, aces enter 62% of first passes from above or up-sun
    against 0% for novices. A stalker-signature ace enters 100% of them, every one unseen.
  - Default quick fight: 4% player down, unchanged (the default changed in wave 9, D-078).
  - Camel mirror: 35% player down (48 runs).
  - Veteran career: 21% killed or captured, and 3.8 collisions per 100 missions (80
    missions).
  - Quick ground attack: 96% success, 8% killed or captured.
  - Screenshots: `docs/screenshots/ai-out-of-the-sun.jpg` and `ai-cloud-escape.jpg`.
- **Skip (measured, D-075):** boom-and-zoom for out-turned types. It lost more fights in
  every matchup, because the D.V is dive-limited in the flight model. The code stays
  behind `TACTICS_FLAGS`.
- **Superseded (D-078):** D-076 kept the Camel v D.V quick default. Wave 9 changed it to
  2 veteran D.VIIs.
- **Skip:** making the D.V dangerous through the flight model. The default no longer
  depends on it.
- **Done (perception, wave 9, D-081):** a pursuer ~100 m behind no longer sees into a cloud core,
  follows the true position or fires blind, so cloud refuge now cuts the hits a wounded
  pilot takes (28 against 195). A pursuer already within 30–80 m still sees him, as the
  player would on screen.
- **Defer:** generic veterans and aces (no signature) never reach the merge unseen, because
  their ≤ 60 s patience runs out first. Raise it only if career playtests want more
  ambushes.
- **Defer:** the HUD glare overlay ignores the player's own wing blocking the sun.
- **Don't bundle (untried ideas):** refuge taking priority over defensive breaks when a
  cloud is close; signature straggler-hunting tuned for career missions; wingmen
  positioning up-sun on a leader's stalk.

## How it was built
Parallel agents in git worktrees, one subsystem each, merged by the lead over
eight waves. Rationale for every significant choice is in `DECISIONS.md`
(D-001..D-084); module docs are in `docs/*.md`; playtest findings are in
`docs/PLAYTEST.md`.

## Wave 7 release-check leftovers (docs/PLAYTEST.md)
- **Done:** escorts only count at the end if the charges have been out over the
  lines (PLAYTEST #4). Quick intercept contact is about 90 s. Squadron mates who
  are lost never fly again. Abandoned flights are stamped "Mission Abandoned".
- **Done (polish, wave 9):** a Quick Mission hint when the chosen aircraft never
  met in service; one Tab stop per button group (Quick Mission takes 12 Tabs, not ~57);
  no drop cap on a CO remark that opens with "Lt."; ace standings show "Off the front"
  for aces between service spells (additive `AceStanding` status `'away'`); French
  ranks for Lafayette mates (docs/PLAYTEST.md #5, #6, #8, #10, #11).
- **Defer:** a Lafayette player's own rank still follows the US ladder among
  French-ranked mates. Revisit only if Lafayette careers get attention.
- **Defer:** one tree-lined road that still reads near-black from 2 km (render).
- **Skip:** SwiftShader 'low' at about 9 fps; the README asks for a real GPU.

## Next steps (disposition for each item)

**Gameplay balance — wave 4 (BALANCE) status**

Done (DECISIONS "Patrols are judged on time on station…", "Contact within
about two minutes…", "Low-level attack runs keep their energy…", "Rear gunners
are less accurate"):
- **Patrols:** `patrol-area` objective, met by time on station or by engaging
  the enemy. Patrol success is 100% (was 48%).
- **Early outcomes:**
  - Escorts fail as soon as too few charges are left.
  - Intercepts fail when their targets escape.
  - Escorts complete once the charges are home.
  - When the job is settled and no enemy is near, the flight is recalled home.
- **Contact:** career contact median is about 2 min (was 3.5–7).
- **Attack runs:**
  - Balloon runs no longer fly into the envelope or stall in the pull-out.
  - Strafing re-attacks keep their energy.
  - Defenders scramble from low altitude instead of waiting above.
- **Two-seater gunners:** less accurate, which fixed intercepts.
- **Autoplayer:**
  - Reports a cause for every player loss.
  - Seeded quick repetitions (`AUTOPLAY_QUICK_REPS`) and `AUTOPLAY_DIFFICULTY`.
  - A passive-recruit regression test.

**Done (wave 5) — AI and sim survivability** (docs/ai.md "Wave 5"; DECISIONS ai-sim wave 5)
- Stall overshoot fixed at the root: the pitch law settles on the tail's AoA, and
  slipstream made the wing overshoot. The AI and the sim's relaxed caps now divide
  by `tailPressureRatio`. Low-level survey: stalled time 1,880 → ~590 s, ground
  impacts 19 → 5, recovery share of engage time ~11.5% → ~4–5%.
- Low-level defence: energy-aware g, faster recovery, level breaks and deck
  extensions below 350 m (scissors measured worse and were dropped).
- Wounds before deaths: a softer pilot-kill roll, wounds degrade pull, roll and aim,
  wider target spreading, and wreck avoidance. Veteran career deaths 31% → 18%.
- Strafers: pass and ammo limits, leaving when scouts close, energy floors, and
  RTB flights that fight back. Quick ground attack returned 13% → 25%.

Remaining:
- **Done (wave 6):** defended quick ground attacks. The defenders now scramble low in
  staggered elements; see "Balance — wave 6".
- **Defer:** quick dogfight survey setups (D.VII against two veteran SPADs)
  are hard by construction (~75% killed); not a bug.
- **Done (wave 6):** career collisions. Head-on break and separation; see "Balance —
  wave 6".

**Balance — wave 6**
- **Done:**
  - Quick ground attack: the defenders scramble low in two staggered elements, and
    strafers leave the flak gun until last. The screen default went from 38% to 100%
    success, and killed-or-captured from 21% to 13% (docs/ai.md "Wave 6").
  - Collisions: early head-on break, and a wider berth for the player and for flight-mates
    chasing the same target. Career collisions per 100 missions fell from 8.5 to 3.5, and
    player losses to collision from 2.5% to 1.0%.
  - Career-awards e2e (`tests/e2e/career-awards.spec.ts`): through the real campaign it
    shows the report, newspaper ("NEW ACE…"), promotion (Leutnant → Oberleutnant) and
    Iron Cross, and HQ shows the victories.
  - Autoplayer: logs every collision, has setup and type filters and seed offsets, and no
    longer counts a shot-up airframe that fails later as a flak loss.
- **Done (gunnery wave 7):** the AI lead solution now models bullet drag (it under-led by
  10–20% at 200–400 m), with a turn-aware lead regression test (`src/ai/gunnery.test.ts`)
  and a gunnery diagnostic soak (`AI_SOAK=gundiag`). See DECISIONS "Drag-aware lead".
- **Superseded (D-078, wave 9: the default is now 2 veteran D.VIIs):** the Quick Mission default dogfight (Camel+1 v 2 regular
  D.V) stays lopsided: player down 0–8% (target 35–55%), and 6–13% against veteran D.Vs.
  Wave 7 showed it is the airframe, not gunnery: the D.V (wing loading 44 against the
  Camel's 31 kg/m², same speed and climb) almost never reaches a Camel's six, so its hits
  are all head-on. Three out-turned tactics (high yo-yo, diving extension, jousting) and
  mutual-support targeting were measured and dropped (docs/ai.md "Known weaknesses").
  If an even first fight is wanted, change the screen default: 2 regular Dr.I put the
  player down ~70%, novice Dr.I 6%, regular D.VII 17%. Keeping the D.V default as an
  easy first fight for a new player is also defensible; decide from human playtests,
  not the veteran autoplayer.
- **Defer:** quick ground attack against *veteran* defenders is still 63% killed or
  captured. The difficulty is chosen by the player; revisit only if players complain.
- **Defer:** the career killed-or-captured rate is ~25% for the veteran autoplayer
  (patrol 35%, free hunt 35%). Enemy fire, not collisions, is now the cause. This is an
  upper bound for a careful human (see docs/game.md).
- **Done (game wave 6):** `pilotGTolerance` drives the grey-out (see below).

**Done (wave 4) — flight and HUD**
- HUD centre declutter (`src/ui/hud/declutter.ts`; DECISIONS "HUD declutter by priority"): the waypoint fades
  in combat and hides under the target box, and its name and distance ride
  the heading tape. The aim ring merges with the nose/reticle when aligned.
  Threat triangles skip enemies already on screen.
- Tracers (DECISIONS "Tracer streaks use eye persistence") are streaks with eye persistence re-projected through the
  camera: rounds smear into a hosepipe as you turn. There are screen-space
  caps for rounds flying straight away, and premultiplied blending keeps them
  visible against bright cloud.
- Fokker E.III (DECISIONS "Fokker E.III handling left as is"): three candidate fixes were measured on a multi-start
  benchmark (`MOUSEAIM_SEEDS`/`MOUSEAIM_PAIRS`) and none beat the current
  handling. The data is unchanged. It is flyable (vs Nieuport 11 at standard:
  5/6 kills, 56% on target) and loses turning fights to the D.H.2, as it
  historically did.

**Done (wave 5) — flight and HUD**
- Mouse-aim fine aim: within 10° the lateral demand is softened and the rudder
  takes up the rest. E.III bank rate near the aim ~20 → ~14°/s
  (`aimDither.realsim.test.ts`).
- `Autopilot.stallMarginDeg` is split from `diveCaution`. `INSTRUCTOR` margins are relaxed
  3.2°, standard 1.8°, authentic 1.3°; relaxed never stalls a Camel/D.V in a max
  turn (`instructorMargin.realsim.test.ts`).
- `pilotGTolerance(ac)` (src/sim) is exported for a wound-aware grey-out.

**Do — flight and HUD (remaining)**
- **Done (game wave 6):** `pilotGTolerance` drives the g-effect overlay
  (`src/game/gEffect.ts`): onset at tolerance − 1 g, so 4.5 g fit as before and
  sooner when wounded.
- **Done (game wave 6):** PLAYTEST #4, mouse-aim cockpit view: the head leads
  the aim by at most ±25° yaw and +12° up, eased, and the aim ring pins to the
  screen edge. PLAYTEST #11, clashing wingman surnames, get initials. Time
  compression also drops when low over enemy ground, near targets/AA, or under
  fire. The "could not be started" toast no longer follows mid-flight errors.
- **Defer:** an Options toggle for the old full-follow cockpit view (needs a
  src/ui control). Add it only if players ask.
- **Defer:** E.III still rocks a little near the aim (~14°/s bank activity); acceptable,
  revisit only if playtests complain.

**Visuals — done (wave 4)**
- Showcase set `docs/screenshots/game-*.png` (7 shots) is in the README gallery.
  Regenerate with `Q=ultra node src/render/dev/playShots.mjs <out> <port> sc-dogfight sc-balloon sc-trench sc-dawn sc-clouds sc-burning sc-aero`.
- Low-level pass: craters are ragged and shallower, with murky water only in
  fresh ground. Communication trenches are continuous. The mown aerodrome
  grass no longer aliases.
- Frame budgets were measured with 16 aircraft (see `docs/world.md`): 'low' ≈ 2 ms
  p50, 'high' ≈ 3.5 ms, 'ultra' ≈ 4 ms uncapped, and a locked 60 fps with vsync.
- The crater grid is built in a worker at load, and `whenReady` waits for it.

**Visuals — done (wave 6)**
- PLAYTEST #3 (trenches and woods as black ink from altitude) is fixed
  (DECISIONS "Trenches drawn as energy-conserving lines"). Trenches thin with
  distance and read as pale chalk lines from 1–3 km. Up close they are
  crenellated cuts edged with spoil. No-man's-land is a mottled brown-grey band,
  and woods are mottled mid-tones. Check with
  `node src/render/dev/frontShots.mjs <out> <port>` (300 m / 1 km / 2.5 km /
  straight down at Croisilles, the Somme and Ypres).
- Showcase gallery regenerated. Before/after (left/right): `docs/screenshots/front-before-after.jpg`.

**Defer — visuals**
- Trench bays follow a fixed world axis, so east–west stretches of the line
  show stretched bays. Fix with an arc-length vertex attribute only if players
  notice.
- Dusk and dawn light is correct but muted: low sun lights the ground weakly.
  Revisit if players want more golden-hour drama.
- Openfield strips read busy from 700–1500 m. Consider lowering the
  per-field contrast at distance if playtesters notice.
- Fire trails on burning aircraft run long (40–60 m of flame). Shorten them if
  it reads as arcade.

**Done (wave 4) — menus**
- At 1280×720 and 1366×768 the Quick Mission and enlistment screens now fit.
  The squadron and ace lists scroll inside their own boxes, and the
  difficulty picker is pinned. The HQ machine cards fit too.
- Briefing objectives now come before the dossier text, and briefing-map
  waypoint tags avoid each other and the circles (`src/ui/map/labels.ts`).
- `dev/walk-menus.mjs` now reports every scrolling panel per screen
  (`OVERFLOW …`). The remaining overflows are long lists and documents that
  scroll within their own panel by design: aces, key bindings, the controls
  reference, the logbook, standings, and the briefing text.
- Gamepad: the mapping is a pure function (`readGamepad`) with virtual-pad
  tests (`src/game/gamepad.test.ts`). A controller connect/disconnect toast
  shows in menus and in flight, and the Flying School card shows gamepad
  button glyphs when a pad is connected. It is still untested on a physical
  device (see Defer).

**Done (wave 6) — early-war two-seaters (PLAYTEST #15)** (DECISIONS "Early-war two-seaters")
- B.E.2c, F.E.2b, Farman F.40 and Albatros C.III: specs, Blender models, liveries. 1915–16
  escorts and intercepts fly period types, and escorts guard their own nation's machines.
- Pusher nose gunners have their own field of fire (`gunnerFacesForward`). Crew hit boxes
  follow the seats. Tests: `src/ai/earlyTwoSeaters.realsim.test.ts`,
  `src/campaign/twoSeaters.test.ts`, and "early-war two-seater observers" in
  `src/sim/combat.test.ts`.
- **Defer:** German two-seaters before December 1915 still use the C.III as a stand-in, named
  generically. Add an Aviatik C.I if 1915 careers get more attention.
- **Defer:** the D.H.2's tail booms (x = 1.2 m) pass through its 1.3 m propeller disc. The
  two-seat pushers root theirs outside the disc; the D.H.2 was left as is to keep its model
  unchanged.
- **Skip:** the F.E.2b's second, rear-firing Lewis. Combat models one flexible gun per aircraft,
  and the nose arc already allows fire high over the top wing.

**Defer**
- Gamepad support is implemented but untested on a real device. Test when one
  is available.
- Squadron mates are regenerated each quarter rather than persisted. Mates killed or captured in your flight are now remembered (`CareerPilot.lostMates`) and never fly again (wave 7); the rest of the roster still turns over quarterly. Defer.

**Skip**
- Remotion or any video pipeline. Not needed for the game.

## Housekeeping
- The six historical Claude worktrees were audited and unregistered on 2026-09-29 after
  cleanup authorization. All six had clean tracked/untracked status, no commits outside
  main or the remote refs, and no observed process using them as its working directory.
  Their directories were moved intact to Trash to preserve ignored scratch scripts,
  screenshots and reports; their branches remain available. Use `git worktree list` for
  the live inventory. The integration owner audits cleanup at each handoff (AGENTS.md).
- Shared instructions now live in root `AGENTS.md`; `CLAUDE.md` is only its import.
  Follow its session-ownership rules for Claude Code and omp. No integration owner
  means a committed task-branch handoff, not permission to merge or push `main`.
- Human play keeps port 5173. Agent servers use explicit strict ports and isolated
  flight-report output; e2e uses a free `E2E_PORT` (for example, `E2E_PORT=5241 pnpm e2e`).
  Ports do not isolate GPU load: coordinate heavy runs rather than launching them together.

### Retained workspace inventory (2026-10-04 UTC)

Observed during Airfield Defense handoff: 21 registered Git worktrees, plus
separately retained harness workers. This inventory is not cleanup authorization.
Other workspaces' dirty/ignored files, unpushed commits and processes were not
re-audited; preserve them until their owners authorize and verify removal.
The human checkout was untouched. This task's browsers are closed and port 5370
is stopped; Playwright's isolated port 5371 server exited with the suite.

| Workspace | Branch / owner | Preservation reason |
|---|---|---|
| `red-baron-2-reloaded` | `main` at `87b798e`; human/integration owner | Human checkout left untouched. |
| OS-temp `rb2r-ab-aA0DOQ` | Detached `d52b64a`; prior A/B tooling | Prior comparison workspace; output/provenance not audited, no cleanup authorization. |
| OS-temp `rb2r-ab-dyK0Zu` | Detached `87b798e`; prior A/B tooling | Same retention rule. |
| `rb2r-airfield-defense` | `feat/airfield-defense`; current parent omp session | Complete production mode, screenshots/JSON and committed branch handoff; human playtest/integration pending. |
| `rb2r-archie-prototype` | `prototype/archie-defense` at `b82eab2`; prior prototype session | Validated throwaway evidence; production implementation was reimplemented, not copied. |
| `rb2r-backlog-cycle-two` | `docs/backlog-cycle-two-evidence` at `4dc8ec8`; prior parent session | Retain cycle-two evidence and integration base. |
| `rb2r-backlog-execution` | `chore/backlog-execution` at `b3c9623`; prior parent session | Backlog execution evidence; no cleanup authorization. |
| `rb2r-bomber-readiness` | `fix/bomber-sim-readiness` at `8aac951`; prior parent session | PR #4 squash-merged; original branch and ignored QA evidence preserved. Its handoff recorded services stopped. |
| `rb2r-collision-baseline` | Detached `87b798e`; prior collision track | Baseline/reproduction evidence; no cleanup authorization. |
| `rb2r-collision-escape` | `fix/feasible-collision-escape` at `92d3dba`; prior collision track | Q-05/PR #10 release gate remains blocked; preserve candidate and evidence. |
| `rb2r-debt-height` | `perf/height-cache-locality` at `4057201`; prior height-cache task | PR #3 squash-merged; original branch/workspace preserved. |
| `rb2r-debt-spatial` | `perf/world-spatial-queries` at `aed20d9`; prior spatial task | PR #2 squash-merged; same retention rule. |
| `rb2r-debt-spec` | `fix/spec-cache-identity` at `791da38`; prior spec-cache task | PR #1 squash-merged; same retention rule. |
| `rb2r-defense-combat` | `feat/defense-combat` at `7b05fd0`; current parent session | Unused prepared external track; actual implementation ran in the harness worker. Preserved, not removed. |
| `rb2r-defense-menu` | `feat/defense-menu` at `7b05fd0`; current parent session | Same retention rule. |
| `rb2r-defense-render` | `feat/defense-render` at `7b05fd0`; current parent session | Same retention rule. |
| `rb2r-headless-browser-qa` | `docs/headless-browser-qa` at `fef7d92`; prior parent session | QA policy/evidence retained; prerequisite incorporated into the defense branch. |
| `rb2r-player-aircraft-access` | `feat/player-aircraft-access` at `37e8c0b`; prior parent session | PR #5 branch and ignored screenshots/JSON retained. Its handoff recorded browsers/servers stopped. |
| `rb2r-pr-integration` | `review/open-pr-integration` at `0ef2f76`; prior parent review | Reviewed snapshot/evidence retained until authorized cleanup. |
| `rb2r-survey-adapters` | `feat/survey-adapters` at `3d8ae87`; prior tooling track | Released Q-04/PR #11 source/evidence; original branch/workspace retained. |
| `rb2r-visual-atmosphere` | `feat/cockpit-quality-refinement` at `538b6f5`; prior parent session | PR #8 before/after images, baseline models and flight evidence retained. Its handoff recorded browser/port 5326 stopped. |
| omp isolated `t18fe94f19/m`, `t761509680/m`, `tb9b8755f9/m` | Completed flight, damage and tooling workers | Earlier source/evidence incorporated into their parent; separate harness workspaces, not registered here. |
| omp isolated `te0a804f7d/m`, `t722c9056b/m` | Completed MaterialQuality and CockpitGeometry workers | Integrated commits `ed2fa5b`, `bf7f6eb`, `0eed40e`; earlier evidence retained. |
| omp isolated `t9bb320d31/m`, `tf8da99131/m`, `t6ddd574a5/m` | Completed DefenseCombat, DefenseRendering and DefenseMenus workers | Owned changes integrated into `feat/airfield-defense` and verified together; retained worker patches/evidence. No unresolved implementation dependency. |


### Development-feedback handoff addition (2026-10-04 UTC)

Fresh `git worktree list` observed 22 registered worktrees: the 21 above plus
`rb2r-development-feedback`, owned by this parent session on
`perf/development-feedback`. Preserve its committed tooling and ignored
screenshots/JSON pending integration/authorized cleanup. Human main remains
`87b798e`; Airfield Defense remains `0652782`, both clean.
The separate fresh-session isolation smoke observed child `t573d5d225/m` with
no captured changes; its lifecycle is harness-owned, not a registered worktree.
Task QA tabs, port 5374 server and focused watch process are stopped. Existing
workspaces were not removed or newly authorized for cleanup.


### Direct-Playwright handoff addition (2026-10-04 UTC)

Fresh inventory observed 23 registered worktrees: the previous 22 plus
`rb2r-direct-playwright-qa` on `perf/direct-playwright-qa`, owned by this parent.
Retain its committed native tooling and ignored successful/failed smoke evidence
pending integration/authorized cleanup. Main remains `87b798e`, playtest remains
`0652782`, both observed clean; prior tooling remains `dfb8c3b`.
Owned dev/preview ports 5382/5384 and native browsers are stopped; the isolated
full-suite port 5383 server exited with its successful run. No existing workspace
was removed and no Claude workflow/configuration change was made.

### Published battery and Xbox follow-up inventory (2026-10-04 UTC)

Fresh inventory observed 25 registered worktrees: the previous 23 plus
`rb2r-airfield-release` (`integrate/airfield-defense-release` at `e3e6fa5`) and
`rb2r-defense-xbox` (`feat/defense-xbox-controls`, based on published `1ef1893`),
both owned by this parent session. The release tree retains integration evidence;
the Xbox tree retains the unmerged follow-up and ignored native screenshots/JSON
for physical-controller playtest. Existing workspaces and harness workers remain
preserved without cleanup authorization. Human main stays at `87b798e`; publication
was performed through PR #13, without switching or updating the human checkout.

Release QA services on 5387/5388 stopped. Xbox port 5390 is intentionally retained
and handed to the user for local controller playtest, with reports isolated under
`tools/dev/scratch/defense-xbox/flight-reports`. Its persistent service is
`defense-xbox-dev`; the user may stop it when playtest ends. Automation uses fresh
strict port 5391 and one GPU worker, never the human's 5173.

### Xbox layout adjustment inventory (2026-10-04 UTC)

Fresh inventory observed 26 registered worktrees: the previous 25 plus
`rb2r-defense-xbox-layout` on `fix/defense-xbox-layout`, owned by this parent and
based on Xbox follow-up `5315da8`. Preserve the revised controls and scoped evidence
pending physical playtest/integration. Existing workspaces and user-owned port
5390 were untouched; no cleanup, merge or publication was performed.

The revised layout uses port 5392, service `defense-xbox-layout-dev`, with reports
under `tools/dev/scratch/defense-xbox-layout/flight-reports`; it is intentionally
handed to the user for continued playtest. Automation uses fresh strict port 5393
with the user's exclusive GPU slot. Both playtest servers remain available, but
5390 is the original right-stick/Y layout and 5392 is left-stick/R3.

### Xbox release inventory (2026-10-05 UTC)

Fresh inventory observed 28 registered worktrees: the previous 26 plus
`rb2r-xbox-release` on `integrate/xbox-release`, owned by this integration session,
based on published main `1ef1893` and containing approved Xbox head `1a7ea7e`.
Retain this tree for the integration/CI/live receipt and ignored release evidence.
The user-owned 5390/5392 playtest services and their original workspaces remain
untouched. Other workspaces, branches and harness evidence remain preserved;
cleanup authorization and owner-specific dirty/ignored/process audits are absent.
The additional `rb2r-xbox-menu-baseline` is detached at approved `1a7ea7e`, owned
by this integration session for sequential fresh-Menu comparison. Its temporary
test edits were restored, source is clean and its strict 5399 test server exited.
Retain ignored comparison evidence until cleanup is authorized.

Release automation owns strict port 5395 for the full browser suite and temporary
preview port 5396 for the production smoke, with task-scoped output under
`tools/dev/scratch/xbox-release/`. Temporary release services must stop before
handoff; the existing user playtest services remain under their handed-over ownership.

