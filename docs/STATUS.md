# Agent orientation and current scheduling ledger

Snapshot checked **UTC 2026-10-05T02:47:56Z**. This is the only current dispatch queue.
[BACKLOG](BACKLOG.md) holds task contracts and evidence; [DECISIONS](../DECISIONS.md)
holds design rationale; [STATUS-ARCHIVE](STATUS-ARCHIVE.md) preserves superseded
release notes, measurements and queues. Historical prose is not a task assignment.
UTC receipt dates can differ from a harness's local calendar date; compare absolute
timestamps, not bare date labels. Uncommitted branch edits are an owned working-copy
proposal, not another session's confirmed ledger.

## Release anchor

- Latest verified gameplay release: **`9c40f8ee5b1c2aee9a7038428d63daac18a74a6c`**,
  [PR #14 receipt](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/14#issuecomment-5986900031).
  Resolve fetched `origin/main` for a new task's actual base; this anchor is not a
  promise that the local checkout or remote main will remain at this revision.
- Airfield Defense and its Xbox controls are published: left-stick aim, right-stick
  click (R3/button 11) ranging, RT fire, LT focus, LB/RB stations, X reload, D-pad
  fuze, Menu pause/return, scoped A/B navigation. No-touch battery; custom seeds
  and Options sliders still use keyboard/mouse. Broader flight-controller work is open.
- Final gameplay-release evidence: typecheck/build; **696 Vitest + 20 Node tests**
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

## Current queue

All rows checked at the snapshot time above; re-run the freshness gate when claimed.
No implementation workers or unattended scheduler are running at this handoff.
Current documentation owner: parent omp session, `docs/agent-handoff-freshness`.

| ID | Outcome / phase | Owner to claim | Evidence and next action |
|---|---|---|---|
| Q-01 | Non-publishing validation — released | Integration lead | [PR #9](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/9); preserve main-push-only publication. |
| Q-02 | Isolated browser automation — released | Integration lead | Shared native launch/fixtures, D-112; follow HARNESSES and GPU isolation. |
| Q-03 | Frozen gameplay baseline — evidence collected | Integration lead | BACKLOG's revisioned cohorts; historical measurements, not current-main/human calibration. |
| Q-04 | Tailhold/defence/raid A/B tools — released | Tools lead | [PR #11](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/11); use existing adapters, not duplicate tooling. |
| Q-05 | Collision correction reviewed; integration/publication pending | Integration lead | [Corrected `92d3dba` comparison](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/10#issuecomment-5978434564) and [staged handoff](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/10#issuecomment-5978462638). Preserve the 24-file merge of old `4dc8ec8`; refresh against current main and decision numbering, review/gate, commit and publish. The superseded 4.2% failure is not a new design task. Historical signing failure is not proof of today's auth state. |
| Q-06 | Ordinary flight-mate mutual support — waiting on Q-05 publication | AI lead | Compare both pursuers, meaningful threat, collision cases and mirror fairness after collision release. |
| Q-07 | Human-like pursuer calibration — evidence blocked | Calibration lead + user | Collect meaningful comparable rated default dogfights with aim-bearing reports and held-out evaluation; battery raids and mixed/provenance-unknown cohorts are not substitutes. |
| Q-08 | Bomber pacing/interception — measurement ready | Campaign/AI lead | Measure loaded speed and formation-slot error before policy/tuning; preserve aircraft performance. |
| Q-09 | Damage/career policies — owner decision required | User + integration lead | Damage-path/default and bullet-sponge feel, historical day-bomber career eligibility; no implicit policy change. |
| Q-10 | CI runner migration — deferred | CI lead | Pinned Ubuntu 24.04, D-077; target 2027-01-31, isolated workflow_dispatch validation before cutover. |
| Q-11 | LICENSE — owner decision required | User | Explicit license selection; telemetry and release authorization do not select a license. |
| Q-12 | Touch browser path published; physical acceptance blocked | Mobile lead + user | BACKLOG Q-12 contract; real recent iPhone/Safari, repeated sorties/save/rotation/backgrounding and sustained performance. |
| Q-13 | Battery Xbox delivered; broader mapping audit ready | Game/UI lead + user | D-113/PR #14. Audit flight/combat/crew/camera/map/orders/common menus and accurate prompts; retain mouse/keyboard/touch and verify physical lifecycle/ergonomics. |
| Q-14 | Production Airfield Defense — release-verified | Integration lead | Battery [PR #13](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/13), controller PR #14 receipt above; no unfinished battery dependency. |
| Q-15 | Claude routing/workspace trial — deferred | Next Claude project session + user | Review BACKLOG Q-15 before configuration/routing changes. Context-discovery probes do not enable that trial. |

## Next dispatch

1. Finish Q-05's retained integration rather than re-solving its corrected design.
2. Audit Q-13's broader flight/controller coverage independently of AI changes.
3. Measure Q-08 bomber pacing independently; decide behavior only after evidence.

At most three implementation/evidence tracks plus one integration lead. Two changes
waiting for review/integration pause new dispatch. Q-06 waits on collision publication;
Q-07 waits on comparable human evidence. Hardware, LICENSE and gameplay choices do not
block unrelated ready work. No new implementation track was dispatched by this doc update.

## Protected workspaces and processes

Observed **29 registered worktrees** at the snapshot time. Cleanup remains unauthorized.
Only the docs task tree is edited; no retained collision staging or user inbox was moved.
Recheck ownership, dirty/staged/ignored work, unpushed commits and processes before cleanup.
Archived inventories/worker evidence remain in STATUS-ARCHIVE; this is the live snapshot.

| Workspace | Branch / revision / owner | Preservation reason |
|---|---|---|
| `red-baron-2-reloaded` | Human `main` at `87b798e`, behind remote; clean at inspection | No 5173 listener at inspection. Integration owner may fast-forward only after rechecking clean/no live-user surface; preserve inbox/scratch. |
| OS-temp `rb2r-ab-aA0DOQ` | Detached `d52b64a`; prior A/B | Un-audited provenance/output; preserve. |
| OS-temp `rb2r-ab-dyK0Zu` | Detached `87b798e`; prior A/B | Same retention rule. |
| `rb2r-agent-handoff` | `docs/agent-handoff-freshness`, base `9c40f8e`; current docs owner | Current handoff/protocol changes and orientation evidence. |
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

User-owned playtest services 5390/5392 and the prototype service remain available;
release QA browsers/servers exited. OMP's LSP/shared browser daemon are harness-owned,
not game services to kill. Separate retained harness workers are recorded in the archive;
source was integrated, but ignored evidence and ownership were not cleanup-audited.
