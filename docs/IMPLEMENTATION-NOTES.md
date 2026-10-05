# Agent implementation and integration notes

This is a compact design/ownership record, **not a dispatch queue or release receipt**.
[STATUS](STATUS.md) owns current phase/owner/next action; [BACKLOG](BACKLOG.md) owns
contracts and revisioned evidence; [DEFERRED-TODOS](DEFERRED-TODOS.md) owns genuine
external blockers/untriggered ideas. Behavioral API details belong in module notes.

## Current orchestration contract

- Parent omp is the sole integration owner. Each bounded brief names its exact
  committed base; dependent work starts from the produced prerequisite, not a
  moving branch name. Verify actual root/full HEAD before edits. Use isolated,
  bounded ownership and communicate shared interfaces before touching another
  track's files. A brief/base is not proof of the worker's actual checkout.
- At most **three active implementation/evidence tracks**, plus parent. Refill from
  eligible STATUS work when a track completes or externally blocks; never create
  fake activity or reopen old features. Two pending reviews/integrations stop new
  implementation dispatch. Durable blocked/conditional entries release the slot.
- The parent counts at most **three independent review rounds per candidate/scope**,
  with independent Standards and Spec lenses on each frozen revision. Corrections
  do not reset the count. The authoritative
  [exhausted-review retention contract](DEFERRED-TODOS.md#exhausted-review-retention)
  defines retained evidence, concrete triggers and the no-red-publication rule.
  Parent numbers decisions at integration; this is not an unattended scheduler.
- Integrate/merge serially. Run full green integrated CPU gates and the applicable
  real-runtime/browser gates; one exclusive GPU QA slot, fresh strict-port server,
  direct native headless Playwright for critical input/screenshots. Preserve human
  playtest/prototype services and input. Main push deploys: verify CI/deployment and
  inspected live smoke before publishing the next phase. Worker handoff ≠ release.
- **Freeze all tracked files and Git state during complete checks**, including docs,
  headings, staging, commits and refs; source fingerprints cover more than `src/`.
  Do read-only or independent-other-worktree work while checks run. No editing a
  tracked candidate mid-survey/gate; keep scenarios, inputs and dependencies fixed.
- Require an exact target SHA and named integration owner in each brief. Do not chase
  moving main, infer publication or merge another session's tree. No auth/signing
  bypass. Instruction-edit phase and evidence belong in STATUS and FRICTION.

## Bounded design interfaces and constraints

### Q-05: corrected collision transfer, not a new avoidance design

Transfer only PR10 corrected `92d3dba` delta and whole-approach helper onto the current
base. Dedicated lift scratch; during extension only, `0 < tcpa < BREAK_LEAD_S`, reflect
positive closest-approach lift component and preserve lateral separation. Keep dead-ahead
split/weights and engagement/defence/long-range behavior. F-74 is a reset comment only:
`bombRun.stage`, not phase, identifies the just-ended run. See [AI notes](ai.md),
[Q-05 contract](BACKLOG.md#q-05--corrected-collision-integration-contract).

Protect the original 24-file staged merge of `4dc8ec8` in the retained collision tree;
do not transplant old survey/mobile history. Smoke, fairness and full release gates
prove different scopes; within-noise comparisons do not establish equivalence.
For current phase see [STATUS](STATUS.md#current-queue); for dated candidate/gate
receipts and signing history see the [Q-05 contract](BACKLOG.md#q-05--corrected-collision-integration-contract).

### Q-13: input prerequisite before session/menu coverage

Preserve established pilot mappings and the existing input-command seam. Stable
standard-pad ownership, disconnect/focus/context release and neutral gating are
prerequisites, not end-to-end coverage by themselves.
Agree game-local crew/bombsight/overlay ownership before later session/HUD/navigation
slices. No new settings/core contracts or policy changes. Common actions, native menu
widgets, accurate prompts and deterministic/browser regressions must all migrate;
physical lifecycle/ergonomics signoff stays distinct. See [game](game.md), [UI](ui.md),
[Q-13 contract](BACKLOG.md#q-13--xbox-controller-coverage-and-ergonomics), D-113.
Current phase belongs in [STATUS](STATUS.md#current-queue); exact candidate-specific
tests and native crew-return proof belong in the
[dated Q13A receipts](BACKLOG.md#q13a-input-prerequisite--revisioned-receipts).

### Q-08: measurement only

Native scenario uses existing Vite SSR runner, realSimHarness and production SimCore
seams; no new runner/dependency, temporary source tests or tuning. All seven bombers,
actual payload/effective mass, controlled full/empty and production cohorts; loaded
performance references versus requested 0.72 formation cap/0.8 cruise are separate
observations. Existing Quick intercept is unloaded recon, not a loaded raid. Account
for slot/relead censoring, null encounter/release windows and every selected case.
Repeatability is not gameplay improvement. See [bombers](bombers.md),
[Q-08 contract](BACKLOG.md#q-08--bomber-pacing-and-interception-measurement-only),
[Architecture probes](ARCHITECTURE.md#exact-cpu-differential-probes), D-093/D-098/D-099.
Current phase belongs in [STATUS](STATUS.md#current-queue); original and corrected
measurement provenance remain in the dated Q-08 BACKLOG receipts linked above.

### Independent author/developer diagnostics

F-49 author diagnostics preserve calibrator bounds/specs; F-51 bounded body-frame
legacy-ring provenance logging changes no mesh; F-55 bench listener must exercise a
real bomber store/predicted whistle queue and WebAudio, not directly play a fake
whistle. See [sim](sim.md), [models](models.md), [audio](audio.md) and FRICTION rather
than copying all APIs here. Current ownership/phase is in STATUS; retained author
and actual runtime receipts are in BACKLOG/FRICTION, distinct from publication.

## Evidence discipline

Each receipt identifies exact candidate/base, command, settings/seeds/cohort, observed
outputs, failures and limitations; keep implemented/reviewed/integrated/deployed/
release-verified/physical-verified distinct. Historical within-noise interval overlap
is not equivalence or global safety. No current gameplay tuning, hardware, license or
Claude changes are authorized by this workflow. Cleanup requires explicit authority
and fresh owner/dirty/staged/ignored/unpushed/process audit; seven new and 29 retained
trees are preserved. Parent updates final gate receipts and decision numbers later.
