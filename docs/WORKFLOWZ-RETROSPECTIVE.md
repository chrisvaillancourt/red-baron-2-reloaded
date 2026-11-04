# Workflowz retrospective and restart recommendations

Recorded 2026-10-05 UTC after the user paused execution. Its operating rules were applied on 2026-11-04: see AGENTS.md "Work in progress" and the DECISIONS entry that supersedes D-114.

## Assessment

Some of the three-hour session was wasted. The full backlog is substantial, but the actual pace was slower than justified. The parent spent too long reasoning about integration details, maintaining receipts and managing review queues instead of finishing small, verifiable increments.

The checks themselves were not the main bottleneck:

- Latest full CPU/typecheck/build gate: **36 seconds**.
- Initial new mutual-support suite: **4.6 seconds**, with eight failures out of 19 cases.
- Corrected commit-checker suite: **2.2 seconds**, seven passing cases.
- Full browser gate: approximately **six minutes**.

Real verification and independent review were necessary. Excessive parent analysis and orchestration were not.

## Delivered work and paused state

Two source waves were published and live-verified:

1. Collision correction, bomber measurements and model-provenance logging.
2. Calibration diagnostics and the ground-listener audio bench.

Author-tool source publication: `185143100c6dac6f2c7d120cb9ec0180cda32af7`. Consolidated receipts were committed and pushed as `6e49706b8ae52caae70bc3833664fd2584b0e14d`. The latter is a documentation transition commit; this report does not claim an independently observed deployment of that later commit.

Unfinished source is isolated, not published:

- **Q-13 controller coverage:** navigation passed 16 actual browser cases and both round-two reviews. HUD/navigation source is composed in the session workspace. Session binding remains unfinished; a newly authored menu-owner regression has not been executed or implemented. Prompt round-one review found three defects: Flying School grid structure, incorrect action-card entry instructions and a missing L3 manual binding. Corrections and actual UI proof remain pending.
- **Q-06 mutual support:** initial behavioral proof failed. The author corrected eligibility and fixture confounds; the corrected candidate has not been rerun or independently accepted. Do not infer credible assistance from the authored implementation.
- **F-44 commit checker:** the corrected source passed seven focused lifecycle tests. Round-two review and real two-commit installation/typecheck/unit execution remain pending.
- Other ready utilities remain in the existing queue; do not expand dispatch merely because worker slots are available.

The temporary prompt-QA server was stopped. Workspaces, retained evidence and user playtest services were preserved. F-49/F-55 were marked complete in session task state; the remaining 14 items were blocked by the explicit user pause.

Use [STATUS](STATUS.md), [BACKLOG](BACKLOG.md) and the retained workspaces for exact contracts and evidence. Reconcile current revisions and working changes before resumption; this report is not a fresh claim that every retained workspace is clean.

## Proposed operating rules

**Use fewer active tasks, make runtime evidence the next step, and put a hard limit on orchestration overhead.**

| Problem | Proposed rule |
|---|---|
| Too many candidates waiting for attention | Two implementation tracks maximum. Only one candidate awaiting integration. Stop dispatching when that slot is occupied. |
| Long parent analysis without code progress | After scoping, choose one concrete next edit or discriminating experiment. If the design remains unresolved, send a bounded question to a specialist rather than repeatedly reconsidering it. |
| Workers produce substantial untested behavior | Permit implementation workers to run focused tests in their own worktrees. Parent retains integrated gates, shared GPU scheduling and publication. The session's blanket prohibition delayed feedback unnecessarily. |
| Reviews catch defects that cheap execution would expose | Run focused behavior checks before independent review. Review a frozen, exercised candidate—not merely authored source. |
| Incorrect paths and unrealistic fixtures | Verify owned paths against the assigned base. Validate the fixture's physical opportunity before implementing the policy: visibility, range, intercept feasibility, formation and objective. |
| Frequent receipt maintenance | Update the live queue on meaningful transitions; write one consolidated acceptance receipt per wave. Do not repeatedly restate evidence across several documents. |
| Repeated broad verification | Focused checks during development; one full gate after integration. Repeat only checks invalidated by a correction. Documentation-only changes get link/consistency validation, not another gameplay cycle. |

These are recommendations for the next session. In particular, worker verification permissions and dispatch limits must be explicitly reflected in the resumed briefs; they have not been changed retroactively.

### Preserve safeguards that worked

- Separate worktrees and explicit ownership.
- Independent Standards and Spec reviews, capped at three rounds per candidate/scope.
- Serial integration and one GPU-heavy automation job at a time.
- Actual runtime proof, inspected screenshots and separate hardware acceptance.
- No publication of incomplete controller or AI behavior.

## Completion loop

1. **Select one bounded deliverable.** Name its acceptance scenario and non-goals.
2. **Establish the scenario.** Confirm it actually exercises the intended opportunity or failure.
3. **Implement and run focused checks.** Worker owns this feedback loop under the proposed permissions.
4. **Freeze and review.** Standards and Spec run concurrently.
5. **Correct, integrate and run the full gate once.** Keep the existing three-round limit; do not reset it by renaming a correction.
6. **Commit, publish, verify and record the receipt.** Then refill the slot.

For uncertain AI changes, step two is mandatory. The original support fixture was outside the selected intercept limit. Discovering that before implementation would have avoided a substantial correction cycle. Matched controls also need identical formation conditions and genuine engagement scope; changing flight membership can otherwise confound the comparison.

## Observable progress and stop conditions

Every **20–30 minutes**, give a short checkpoint:

- What landed.
- What executable behavior was proved.
- Current blocker.
- Next concrete action.

If nothing has landed or been proved since the previous checkpoint, name the cause and change the approach. Do not continue generating plans and receipts as a substitute for progress.

A user pause stops dispatch, implementation and checks. Preserve work, stop temporary owned services and record the pause rather than allowing an automatic task reminder to restart execution.

## Recommended restart

Finish **F-44, the commit checker**, first, with only one additional track active. It has seven passing focused tests and a bounded remaining review/runtime acceptance path. Do not reopen the whole queue at once.

Before acting:

1. Reconcile the retained candidate and current main without overwriting other work.
2. Confirm the revised worker-verification and work-in-progress rules the user wants to adopt.
3. Perform the outstanding bounded review and real CLI acceptance; integrate only when clean.
4. Select the next deliverable based on verified readiness, not the volume already authored.

## Friction

- **Parent reasoning and bookkeeping became the bottleneck.** Fix: evidence-led next actions, smaller work-in-progress limits and checkpoint-triggered course correction.
- **Worker verification was centralized too aggressively.** Fix: permit isolated focused tests; centralize integration, expensive shared-resource checks and release authority.
- **Task briefs misidentified existing paths/modules.** Fix: inspect the assigned base and actual imports before declaring owned files or describing a module as new.
- **AI fixtures contained feasibility and formation confounds.** Fix: establish physical admission and matched-control conditions before interpreting behavioral results.
