# Backlog execution record

Integration owner: parent omp session. Branch: `chore/backlog-execution`.
Base: `07dfaa462a098df633e512a86406b9d7c416fc73`. The user subsequently authorized
merging PR #9 and its main-push deployment. Workspace cleanup remains unauthorized.

## Operating decisions

- STATUS is the authoritative scheduling ledger. This file records execution methods and evidence, not a second queue.
- Three active implementation/evidence tracks maximum; refill on completion or external blocking. Clear review/integration congestion before starting more code.
- Use isolated workspaces and exact base SHAs. One owner for each shared production file; freeze pursuer/damage policy during tactics comparisons. One exclusive GPU verification slot.
- Ready work requires observable acceptance and satisfied prerequisites. Blocked work names its unblock condition; deferred work names a trigger or date.
- Prioritize release safety, reproduced player problems, enabling work, repeated friction, then conditional polish. Refactor locally where duplicated knowledge is already causing errors; do not build speculative frameworks.
- Record committed, reviewed, integrated, deployed and release-verified separately. No task-branch handoff implies deployment.
- Baseline numbers identify commit, seeds/settings, cohort and command. Same-SHA A/B runs establish reproducibility, not improvement. CPU surveys do not replace human ratings or actual-browser evidence.

### Completion-triggered dispatch

The first execution was a bounded three-track batch, not a continuously refilled
queue. The operating policy below makes subsequent active sessions a pull loop;
there is no unattended scheduler running between sessions.

1. On a worker result, blocker, review result or new report: update STATUS, resolve
   changed dependencies, and choose the highest-impact eligible task.
2. Keep at most three workers plus one integration lead active. A completed worker
   hands off its patch/commit and evidence, then its slot takes the next independent
   ready slice without waiting for the other tracks.
3. Two changes waiting for review/integration stop new implementation dispatch.
   Drain that queue first; completed code without acceptance evidence is not progress.
4. Give each worker an exact base SHA, isolated workspace, file ownership, observable
   acceptance, non-goals, resource needs and a retained handoff location. Review the
   changed commit, not a moving branch. Parent integrates and checks the combined tree.
5. Use one GPU lease and one coordinated CPU survey budget. Separate ports are not
   GPU isolation. Schedule independent code work while expensive checks run; do not
   run multiple full suites or redundant same-SHA A/Bs merely to keep agents busy.
6. A blocker names the exact decision/evidence needed, releases the worker slot,
   and leaves all independently reachable work eligible. Batch owner questions with
   recommendations; do not wait for LICENSE or iPhone hardware to do unrelated work.
7. Refactor only a touched area with demonstrated duplication or maintenance cost;
   isolate behavior-preserving work from tuning. Log unrelated debt with its trigger.
8. Close tasks against their acceptance evidence. Record bug fixes separately from
   duplicate/stale-item closure; track reopened defects and queue age, not agent count.

Next dispatch: Q-05 collision-case extraction/fix, Q-04 demanded survey adapters,
and Q-12 iPhone compatibility/touch-design investigation. Q-07 calibration can take
the first compatible free slot; freeze its parameters during tactical comparisons.
Q-06 mutual support waits for the collision safety scenarios. Mobile acceptance
requires a physical device, but code/layout investigation does not.

PR #9 merge permission is specific to that PR. Further implementation can proceed
autonomously on task branches; future main publication still requires authorization.
The integration comment on PR #9 is the durable merge/deployment/live-smoke receipt.

## Initial work contracts

1. CI safety: validation on PR/manual events, publication only on main push; read-only validation permissions and isolated concurrency. Preserve pinned versions and all existing gates.
2. Browser reliability: shared pre-start controller isolation and cold-flight readiness; all existing specs/flight tools migrate, preserving error/lifecycle semantics. Actual fresh-server full-suite acceptance, exclusive GPU slot.
3. Gameplay evidence: inventory available reports, replay complaint/default scenarios, frozen-SHA fairness/quick/career/raid measurements. No tuning while collecting the baseline.

## Evidence and implementation notes

### Implemented seams

- `.github/workflows/deploy.yml`: one validation job for PR/manual/main-push events;
  Pages upload and deployment guarded by main push, privileged permissions only on
  deployment, separate validation/publication concurrency. `actionlint` passed.
  Independent CI review found no defects; pinned configure-pages needs no checkout.
- `tools/playtest/browser-automation.mjs`: context-wide controller isolation and
  90-second frame-readiness policy shared by specs and standalone flight tools.
  `tests/e2e/fixtures.ts` also consolidates identical boot/primer helpers. The enclosing
  default test timeout is 180 seconds; one worker serializes GPU specs.
- Replay `--help` now exits 0 without loading a report. Real eight-run CPU replay
  exercised the CLI after integration. An earlier parent run occurred before its
  shared helper patch was integrated and failed to import; no gameplay failure.
- Integrated typecheck, 663 Vitest tests (30 gated skips), eight Node regressions,
  and production build passed. Browser and remote CI evidence follows below.

### Report inventory and replay

The existing inbox contains 18 reports: 12 with aim, zero ratings, zero notes.
Cohorts: standard dogfight 8, standard balloon 4, standard intercept 1,
standard ground attack 1, relaxed dogfight 1, relaxed intercept 3.
Do not pool these for calibration. Metadata does not prove human provenance.

Eight-run replays on unchanged gameplay at base `07dfaa4`:
- Tracked low Brisfit complaint (mission `q-6xelyf`): 0% wins, all eight down
  (6 killed, 1 captured, 1 wounded); fixed/player accuracy 100/372 (26.9%),
  crew 192/3397 (5.7%). This does not invalidate the human's too-easy rating.
- Default Camel report (mission `q-1tjvtq`, report build `1612485`): all eight
  returned successfully; fixed accuracy 348/1610 (21.6%). Its human outcome was
  a self-crash with 2/44 hits and no rating. Different pilots, not an exact replay.

Command: `node tools/playtest/replay-report.mjs <report> --reps 8`.
The cited default report is promoted alongside these notes; other inbox reports
remain untouched. Future calibration should use held-out comparable cohorts.

### Frozen baseline: fairness and raids

Fairness command: `node tools/dev/ab.mjs --soak fairness --set default,mirror --reps 48
--base 07dfaa4 --head 07dfaa4 --jobs 2 --out tools/dev/scratch/backlog/fairness`.
Both same-SHA sides report identical player-down rates; each row is 48 runs,
not 96 independent samples: default 29.2%, Camel mirror 43.8%, D.V 39.6%,
Dr.I 31.3%, SPAD XIII 22.9%, D.VII 35.4%. The tool labels comparisons
within noise; this is reproducibility evidence, not an improvement claim.

Raid command: `AI_SOAK=raid AI_RAID_REPS=24 AI_RAID_SET=default pnpm exec vitest run
src/ai/raid.soak.test.ts`. Gameplay files unchanged from base; 24 runs per row:

| Setup | Bombs on target / dropped | Success | Player down |
|---|---|---|---|
| D.H.4+2 vs 3 regular D.V | 127/288 | 79% | 17/24 |
| Same, two Camel escorts | 133/288 | 83% | 7/24 |
| D.H.4+2 vs 2 veteran D.VII, two S.E.5a escorts | 133/288 | 83% | 5/24 |

All rows dropped 288/288 carried bombs. This is a separate raid survey, not part
of quick-survey coverage or a claim about human difficulty.

### Quick/career baseline and acceptance

Both same-SHA sides agree:
- Quick: 360 missions, 126 killed/captured (35.0%, 95% interval 30.3–40.1),
  20 collision events (5.6/100 missions), eight player collision events.
  Causes: enemy fire 87, flak/ground 30, enemy collision 7, RTB self-crash 5,
  friendly collision 1. Events are not necessarily distinct collision cases.
- Career: seed bases 0/1000/2000, ten missions per surviving pilot, 206 missions,
  26.7% killed/captured (21.1–33.1), 4.9 collisions/100, two player collisions.
  Earlier headline figures are historical, not the current baseline.

Commands use the fairness command's frozen refs/output convention, with
`--soak quick --reps 24` or `--soak career --seeds 0,1000,2000`, `--jobs 2`.
Raw outputs remain in this workspace's `tools/dev/scratch/backlog/{fairness,quick,career}`.
No statistical improvement is claimed against earlier revisions.

Fresh-server `E2E_PORT=5341 pnpm e2e`: 23 passed, one gated 20-flight soak skipped,
one Chrome/Metal worker. No runtime source edits during the run.
`pnpm prodcheck 5342` exercised the production flight via the migrated standalone
helper: all four workers and both GLBs loaded, 1019/1024 sampled pixels nonblack,
no failed requests or browser errors. The actual cockpit screenshot was inspected.
Preview service stopped. Independent CI and browser reviews found no defects.
The gated soak was not run; no leak/performance improvement is claimed.

Retained workspaces: parent `rb2r-backlog-execution`, isolated SafeCI and
BrowserReliability workers (patches integrated). Existing worktrees were preserved.
The cited inbox report was copied to the task's tracked reports without removing
the human checkout's copy. No human inbox or public deployment was modified.

PR #9: commit `5761599`; Actions run
https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/37184184678
completed successfully for `pull_request`: build passed, deploy skipped.
This exercises the actual remote non-publishing path, not merely YAML inspection.
Publication remains untested by this task because main was not changed.

### Q-04 — Survey adapters

`tools/dev/ab.mjs` now runs the actual tailhold, defence and raid reporters alongside
career/quick/fairness. New aggregates are descriptive; existing interval heuristics
remain limited to career/quick rates and fairness fate counts. Defence mode selection
is explicit because `DEFENCE_AB` overrides the three defence tactic flags.
Repeated `--env`/`--a`/`--b KEY=VALUE` arguments preserve comma-valued tactics/JSON;
grouping separate variables with commas is removed, with migration diagnostics.

Parent smoke: all six actual adapters completed, serially (`--jobs 1`), including
human-like tailhold and `DEFENCE_AB=off` versus `mix`; raw recipes/stdout/stderr/reports
remain under `tools/dev/scratch/q04-*` in the survey task workspace. Tiny smoke samples
prove the adapters run, not tactical improvements. Twelve parser/summary regressions
passed. Three invalid CLI cases exited 2 before launch; an empty fairness cohort
retained both successful worker outputs but exited 2 without a comparison.
Independent review found inherited-mode loss, missing damage-mode evidence, and
valid zero-drop/two-aircraft-crash/overlapping-set reports rejected by parser guards.
Corrections have failing-before/passing-after regressions. Actual inherited off/mix
defence runs preserve `SIM_DAMAGE_PATH=1` in both recipes; actual overlapping fairness
sets produce one cohort at n=1, not a doubled sample. Frozen-ref CLI smoke passed.
Final typecheck, 663 Vitest tests (30 gated skips) and 20 Node tool tests passed.
Usage, defaults and interpretation are in `docs/ai.md` → A/B measurement.

## Debt dispositions

- F-7 debrief order is already documented (`docs/ui.md`); do not implement a second navigation convention.
- F-23 pursuer exists; remaining work is cohort-aware calibration, not another pursuer.
- F-43/F-64 are one staging utility request. Defer until staging needs recur; prefer separate logical edits/commits now.
- Q-04 implements the demanded tailhold/defence/raid A/B adapters; direct surveys remain available.
- CI runner migration remains scheduled for 2027-01-31; establish safe validation before any rehearsal.
- LICENSE, damage default and historical career eligibility remain explicit owner decisions. Telemetry is not permission to change gameplay policy.

## Q-12 — High-end modern iPhone playability

User-requested backlog addition; not a claim of current mobile support.
Start with a physical recent Pro-class iPhone and record model, iOS/Safari version,
viewport/orientation and graphics preset. Desktop device emulation is not acceptance.

- Audit WebGL2/shader support, memory/asset loading, WebAudio gesture unlock,
  save persistence, interrupted/backgrounded sessions and resume behavior in Safari.
- Design touch-only flight/camera/fire/throttle/crew controls without requiring
  keyboard, mouse or an attached controller; retain existing desktop controls.
- Make menus, briefing, HUD, options and debrief fit landscape safe areas and
  readable touch targets; explicitly handle rotation and browser chrome.
- Exercise Quick Mission and career from start through flight, debrief, save and
  reload on device. Include repeated sorties and app switching.
- Measure sustained frame-time distribution, stalls, memory and thermal behavior
  over a representative 15-minute flight before selecting the mobile preset.
  Provisional target: stable 30 FPS minimum, aim for 60 FPS on high-end hardware;
  establish the exact device/quality budget from the spike rather than promise
  desktop Ultra or infer performance from emulation.
- Dependencies: mobile interaction design and access to a physical target device.
  Lack of device access blocks on-device acceptance, not code/layout investigation.
