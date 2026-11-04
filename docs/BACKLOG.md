# Backlog contracts

This file holds one contract for each open item: what it is for, how we will know it is
done, what it won't do, and what it waits on. It is not a queue: [STATUS](STATUS.md) owns
Now and Next and decides what runs. Receipts, run logs, review history, closed items and
superseded policy are in [BACKLOG-ARCHIVE](BACKLOG-ARCHIVE.md). Untriggered ideas and
upstream harness conditions stay in [DEFERRED-TODOS](DEFERRED-TODOS.md).

## Operating decisions

- Check STATUS Now/Next and confirm claims in git or CI before dispatch; this file does not override STATUS.
- Work-in-progress limits are in AGENTS.md "Work in progress".
- Use isolated workspaces and exact base SHAs. One owner for each shared production file; freeze pursuer/damage policy during tactics comparisons. One exclusive GPU verification slot.
- Ready work requires observable acceptance and satisfied prerequisites. Blocked work names its unblock condition; deferred work names a trigger or date.
- Prioritize release safety, reproduced player problems, enabling work, repeated friction, then conditional polish. Refactor locally where duplicated knowledge is already causing errors; do not build speculative frameworks.
- Record committed, reviewed, integrated, deployed and release-verified separately. No task-branch handoff implies deployment.
- Baseline numbers identify commit, seeds/settings, cohort and command. Same-SHA A/B runs establish reproducibility, not improvement. CPU surveys do not replace human ratings or actual-browser evidence.

## Q-07 — Human-like pursuer calibration

**Goal.** Fit the human-like pursuer to comparable, rated human fixed-gun evidence, so
surveys that use it reflect how real players shoot.

**Acceptance.**
- The fit is trained and evaluated on comparable cohorts: aim-bearing default dogfights
  with settings, build and human provenance, rounds, and ratings or notes.
- A held-out evaluation cohort reports error and limitations, at appropriate repetitions.

**Non-goals.**
- Battery raids, balloon runs and synthetic pilots as substitutes for human dogfights.
- A pooled percentage from mixed, unrated or provenance-unknown reports, or a
  training/holdout split of today's tiny default-flight counts.
- Changing the fit during tactical A/Bs, which freeze it.

**State.** Blocked on the owner: rated human dogfight reports, as a provenance-confirmed
cohort with enough firing opportunities for a meaningful held-out comparison.
TODO(owner): how many reports or rounds count as "enough" is not defined.

**Evidence.** [Calibration evidence gate](BACKLOG-ARCHIVE.md#calibration-evidence-gate-q-07),
[report inventory](BACKLOG-ARCHIVE.md#report-inventory-and-replay),
[AI human-like pursuer](ai.md#human-like-pursuer-srcaihumanaimts), D-087.

## Q-08-TUNING — Bomber pacing and interception tuning

**Goal.** Change formation speed, catch rate or escort pacing only after a measured,
reproducible issue gets an owner-approved behavioral target. The Q-08 measurement is done.

**Acceptance.**
- Controlled and production evidence are kept separate, covering both relevant load
  states and fixed cohorts.
- Aircraft historical performance is preserved unless separately authorized.

**Non-goals.** Guaranteeing that every scout catches every bomber.

**State.** Deferred until a fresh revisioned measurement identifies a reproducible issue
and the owner approves a behavioral target. TODO(owner): no target has been named.

**Evidence.** [Q-08 measurement](BACKLOG-ARCHIVE.md#q-08--bomber-pacing-and-interception-measurement-only),
[bombers](bombers.md), D-093/D-098/D-099.

## Q-08-HUMAN — Bomber pacing: human difficulty and visual feel

**Goal.** Establish how hard bomber interception is for people and how formations look,
which CPU pacing data cannot show.

**Acceptance.** An explicit human or visual cohort with screenshots, reported separately
from reproducibility equality and simulation metrics.

**Non-goals.** Human-difficulty or visual claims drawn from CPU pacing data.

**State.** Deferred until comparable real player reports or ratings exist, or an in-engine
inspection is separately scheduled.

**Evidence.** [bombers](bombers.md),
[raid baseline](BACKLOG-ARCHIVE.md#frozen-baseline-fairness-and-raids).

## Q-09-DAMAGE — Damage-path default

**Goal.** Decide the damage-path default; it is off today.

**Acceptance.**
- Evidence under both rules, across cohorts, plus human feel supports the selected default.
- All affected callers and docs state the policy truthfully.

**Non-goals.** Treating tooling (F-57/F-58) or telemetry as approval to change the default.

**State.** Blocked on the owner: select the default and measurable acceptance before any
flag change.

**Evidence.** D-089, [sim](sim.md),
[debt dispositions](BACKLOG-ARCHIVE.md#debt-dispositions).

## Q-09-SPONGE — Bullet-sponge feel

**Goal.** Agree on a target for how much punishment aircraft absorb, and which lever
(tail damage, hitbox or g-limit) may move it.

**Acceptance.** Real comparisons against both pursuers and across cohorts, plus rated play,
show the agreed effect.

**Non-goals.** Silently changing unrelated airframe performance.

**State.** Blocked on the owner: comparable human complaints or ratings, and an explicit
choice of feel and allowed lever.

**Evidence.** D-089, [sim](sim.md), [AI](ai.md).

## Q-09-DAY — Day-bomber career eligibility

**Goal.** Decide whether the Gotha and O400 are eligible as day bombers in careers. This is
an undecided historical policy, not a proven bug.

**Acceptance.**
- Builder and service pools, UI, persistence and invariants agree on the choice.
- Old saves are exercised.

**Non-goals.** Inferring career eligibility from the all-seven-carrier Quick measurements.

**State.** Blocked on the owner: choose historical day/night eligibility and the resulting
career scope.

**Evidence.** [bombers](bombers.md), `src/campaign/squadronUtil.ts`,
[debt dispositions](BACKLOG-ARCHIVE.md#debt-dispositions).

## Q-09-RAID-ENEMY — Bombing-raid enemy restriction

**Goal.** Decide whether bombing-raid enemies are restricted to fighters. Selection is
unrestricted today; this is a historical policy question.

**Acceptance.** Programmatic builders, persisted options and the UI enforce the same
chosen policy.

**Non-goals.** UI-only filtering.

**State.** Blocked on the owner: an explicit raid-enemy policy.

**Evidence.** [STATUS archive](STATUS-ARCHIVE.md), `src/ui/screens/quick.ts`,
[campaign](campaign.md).

## Q-10 — CI runner migration

**Goal.** Move both CI jobs off the pinned `ubuntu-24.04` runner as a planned change,
after an isolated safe rehearsal.

**Acceptance.**
- `workflow_dispatch` validation of typecheck, tests and build passes before each
  runner cutover.
- Pinned actions, main-push-only publication and live release verification are preserved.

**Non-goals.** Changing publication triggers or action pins as part of the move.

**State.** Deferred until the target date, 2027-01-31; establish safe validation before
any rehearsal.

**Evidence.** D-077, `.github/workflows/deploy.yml`,
[debt dispositions](BACKLOG-ARCHIVE.md#debt-dispositions).

## Q-12 — High-end modern iPhone playability

**Goal.** The game plays well on a recent Pro-class iPhone in Safari with touch alone. The
touch browser path is published; what remains is acceptance on a physical device.

**Acceptance.** On the device:
- Record model, iOS/Safari version, viewport/orientation and graphics preset.
- Touch-only flight, camera, fire, throttle and crew controls work without keyboard, mouse
  or controller; desktop controls are retained.
- Menus, briefing, HUD, options and debrief fit landscape safe areas with readable touch
  targets; rotation and browser chrome are handled.
- Quick Mission and career run from start through flight, debrief, save and reload,
  including repeated sorties, app switching, backgrounding and resume, and WebAudio unlock.
- A representative 15-minute flight measures the frame-time distribution, stalls, memory
  and thermal behavior before the mobile preset is chosen. Provisional target: stable
  30 FPS minimum, aiming for 60 FPS on high-end hardware; the exact device/quality budget
  comes from this study.

**Non-goals.** Desktop device emulation as acceptance; promising desktop Ultra or
inferring performance from emulation; claiming mobile support before this passes.

**State.** Blocked on the owner: physical iPhone playtest (planned for 2026-11-04).

**Evidence.** [Original contract](BACKLOG-ARCHIVE.md#q-12--high-end-modern-iphone-playability),
[implemented browser path](BACKLOG-ARCHIVE.md#implemented-browser-path-cycle-two).

## Q-13 — Xbox controller coverage and ergonomics

**Goal.** A modern Xbox controller works well for all common controls, not just basic
stick input. The software is merged (`04ddbae`); what remains is acceptance on a physical
controller.

**Acceptance.** With a real Xbox controller:
- Record model, transport (USB and Bluetooth), OS and browser (Chrome and Safari).
- Controller-only play runs menu → flight → crew, bombs, views and orders → debrief and
  replay.
- Disconnect/reconnect, sleep and focus loss behave; multiple pads are tested when
  available. Unavailable cases are left marked unverified.
- Explicit findings on whether the controls are comfortable and repeatable (feel).

**Non-goals.** Remapping, sensitivity, inversion or controller-selection options
([Q-13-OPTIONS](#q-13-options--controller-preference-options)); `src/core` contract
changes; treating browser stubs as hardware evidence.

**State.** Blocked on the owner: physical Xbox playtest (planned for 2026-11-04).

**Evidence.** Merge `04ddbae` (its message), D-113,
[original contract and finish plan](BACKLOG-ARCHIVE.md#q-13--xbox-controller-coverage-and-ergonomics).

## Q-13-OPTIONS — Controller preference options

**Goal.** Add remapping, sensitivity, look-inversion or controller-selection preferences
only if a real device need shows the existing ones fall short.

**Acceptance.** A justified, bounded settings contract with its lifecycle and caller
migration.

**Non-goals.** Treating keyboard rebinding as pad remapping, or mouse sensitivity as pad
sensitivity.

**State.** Deferred until a reproducible physical or accessibility need shows that the
existing enablement, deadzone, pitch inversion and stable standard owner cannot suffice.

**Evidence.** `src/core/settings.ts`,
[Q-13 history](BACKLOG-ARCHIVE.md#q-13--xbox-controller-coverage-and-ergonomics).

## Q-13-FOLLOWUPS — Controller polish follow-ups

**Goal.** Fix the small controller issues deferred from the Q-13 finish.

**Acceptance.**
- Flight pauses on pad loss, as Airfield Defense does.
- Pressing B and View in one frame toggles the map once.
- Hint timing under time compression and faint D-pad glyphs are addressed.
  TODO(owner): no observable check was given for these two.

**Non-goals.** Anything beyond these four issues; new controller options (Q-13-OPTIONS).

**State.** Deferred until the next controller change.

**Evidence.** [Finish plan](BACKLOG-ARCHIVE.md#finish-plan--2026-11-04).

## Closed items

Delivered, dropped or superseded. History is in [BACKLOG-ARCHIVE](BACKLOG-ARCHIVE.md#closed-items).

| Item | Outcome | Decision or receipt | Archive |
|---|---|---|---|
| Q-01 | Non-publishing CI validation released | [PR #9](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/9) | [Initial contracts](BACKLOG-ARCHIVE.md#initial-work-contracts), [evidence](BACKLOG-ARCHIVE.md#evidence-and-implementation-notes) |
| Q-02 | Isolated browser automation released | [PR #9](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/9), D-112 | [Initial contracts](BACKLOG-ARCHIVE.md#initial-work-contracts), [implemented seams](BACKLOG-ARCHIVE.md#implemented-seams) |
| Q-03 | Frozen gameplay baseline collected | Historical, not current calibration | [Evidence](BACKLOG-ARCHIVE.md#evidence-and-implementation-notes) |
| Q-04 | Survey adapters released | [PR #11](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/11) | [Q-04](BACKLOG-ARCHIVE.md#q-04--survey-adapters) |
| Q-05 | Collision correction released | D-115; [PR #10](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/10) closed as superseded | [Q-05](BACKLOG-ARCHIVE.md#q-05--corrected-collision-integration-contract), [first wave](BACKLOG-ARCHIVE.md#workflowz-first-integrated-wave--2026-10-05-utc) |
| Q-06 | Flight-mate mutual support dropped | D-121 | [Q-06](BACKLOG-ARCHIVE.md#q-06--ordinary-flight-mate-mutual-support) |
| Q-08 | Bomber pacing measurement released; tuning continues as Q-08-TUNING | D-093/D-098/D-099 | [Q-08](BACKLOG-ARCHIVE.md#q-08--bomber-pacing-and-interception-measurement-only) |
| Q-11 | LICENSE chosen: MIT | D-122 | [Q-11](BACKLOG-ARCHIVE.md#q-11--license) |
| Q-14 | Airfield Defense released | D-110, D-113, [PR #13](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/13), [PR #14](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/14) | [Q-14](BACKLOG-ARCHIVE.md#q-14--production-airfield-defense), [release review](BACKLOG-ARCHIVE.md#airfield-defense-release-review--2026-10-04) |
| Q-15 | Claude worker routing superseded | D-119 | [Q-15](BACKLOG-ARCHIVE.md#q-15--deferred-claude-worker-routing) |
