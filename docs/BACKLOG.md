# Backlog execution record

Current integration owner: parent omp session, branch `feat/backlog-cycle-two`.
Current base: `87b798eb0710dc7dc59d519c12634190ebdd63a0` (released PR #9).
Initial cycle base was `07dfaa462a098df633e512a86406b9d7c416fc73`.
Workspace cleanup remains unauthorized.

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

The user selected **Verified merges and deployments** for autonomous work while away:
publish completed PRs after independent review, relevant regression/runtime checks and
green CI; verify each live deployment before publishing another. Do not change LICENSE
or unresolved gameplay policies. This supersedes the earlier PR-9-only permission.
The integration comment on PR #9 is its durable merge/deployment/live-smoke receipt.

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

### Implemented browser path (cycle two)

Touch intent now feeds the existing input frame and crew/command path. The UI owns
per-pointer capture, a native throttle slider and a scrollable flight action sheet;
Menu remains accessible with gestures or HUD hidden. Responsive screens/cards scroll,
44px touch targets and safe-area padding avoid fixed desktop-only layout assumptions.
Lifecycle/seat/modal transitions cancel transient input; backgrounded touch flights
pause for explicit resume, whose gesture unlocks audio.

Parent Chrome/ANGLE Metal (Apple M3 Max) smoke inspected real 844×390 and 390×844
game screenshots, exercised simultaneous stick/fire with neutral release, the
paused action sheet, throttle command, map and hidden-HUD access. A hidden-HUD
end-flight prompt defect was reproduced and fixed. The multipointer test's initial
CDP partial-release calls were corrected after tracing real pointer IDs.

Final `E2E_PORT=5358 pnpm e2e`: 29 passed, one gated soak skipped, one GPU worker.
This includes touch-only D.H.4 crew/bomb/map/end/debrief and multi-owner release,
rudder, throttle, cancellation, rotation and toggle scenarios. The desktop frozen
crew-handback test caught conflation of simulation hold with input capture; the fix
preserves that seam and AI handback. Typecheck, 677 Vitest tests (30 gated skips),
eight Node regressions and production build passed.

Independent review reproduced hybrid-input defects: returning from the sheet left
keyboard focus trapped, captured maps lost keyboard/controller close commands, and
keyboard autorepeat could revive a canceled bomb hold after a crew-seat change.
The session now restores canvas ownership, shares map-close permission across the
capture-phase keyboard route and polled controller edges, and rejects map edges
under other captures. Input cancellation requires a fresh non-repeat keydown.
Four additional browser regressions cover these paths; all six touch/hybrid cases
pass. An actual 844×390 Chrome flight confirmed canvas focus, keyboard fire and
map open/close with gestures hidden; the inspected screenshot rendered correctly
and the browser reported no errors. Both independent re-reviews are clear.

Cycle-two integration check after merging released survey tooling (`4fb2224`):
typecheck, 677 Vitest tests (30 gated skips), 20 Node tool tests and production
build passed. The 29-case browser acceptance above covers the unchanged mobile
runtime; incoming main changes were survey tooling/tests and documentation.

Screenshots and earlier failure evidence remain in the task workspace's ignored
`tools/dev/scratch/q12/`. No physical iPhone/Safari or thermal/frame-time claim:
the on-device acceptance above remains blocked on hardware access, not on a stub.

## Q-13 — Xbox controller coverage and ergonomics

User-requested backlog addition: make a modern Xbox controller work as well as
possible for all common controls, not merely provide basic stick input.

- Audit existing standard Gamepad mappings before introducing another convention.
  Cover pitch/roll/yaw, throttle, guns/jam clearing, bombs, target selection/padlock,
  camera/free look, crew station changes and aiming, time compression, pause,
  map, common wingman orders, end flight and menu/briefing/debrief navigation.
- Design contextual mappings or a discoverable modifier/radial scheme where buttons
  are insufficient. Avoid accidental destructive actions and awkward simultaneous
  chords; preserve keyboard, mouse and touch operation.
- Show accurate Xbox button prompts and a controls reference. Evaluate remapping,
  deadzones, sensitivity/inversion and connected-controller selection using the
  existing settings model; do not add options without a demonstrated need.
- Release held actions on disconnect, focus loss and mode changes. Test reconnect,
  multiple controllers and transitions among pilot, gunner and menus.
- Verify mapping semantics with deterministic tests, then play end to end on a
  physical Xbox controller. Record model/transport/browser; browser stubs alone
  cannot establish ergonomics or physical-device compatibility.
- Coordinate with Q-12 at the input-command seam; serialize changes to shared
  input/session files rather than implementing two competing control systems.

### Airfield Defense Xbox follow-up — 2026-10-04

Published battery release is the prerequisite, not completion of the broader
flight-controller audit above. Follow-up starts at published `1ef1893` on
`feat/defense-xbox-controls`, with no new settings or core contract changes.

- Right stick aim; RT fire; LT focus/fine aim; LB/RB station cycle; X reload;
  Y tracked range; D-pad up/down fuze; Menu pause/return; A selection; B close pause.
- Existing deadzone/expo shaping, Gamepad enablement and pitch inversion apply.
  Pin the first standard pad; disconnect/replacement pauses. Release controls after
  station/lifecycle changes before combat re-arms.
- Battery-scoped pause/resupply navigation remains separate from parent menus.
  Neutral/ownership gating protects loading, purchases, next-raid overlays, report
  handback and replay from held activation or same-frame chords.
- Deterministic adapter tests and real browser ownership regressions cover analog
  triggers, edge commands, inversion, station/fire handoff, pause clock,
  replacement, held launch and report/replay handback.
- Direct native Headless Chrome 154 / ANGLE Metal Apple M3 Max smoke exercised
  aiming, focus (70° → 38.5°), fire, reload, fuze/range, guide scrolling, pause/B,
  resupply purchase/navigation, next raid, report and teardown; error logs empty.
  Inspected 1280×720 guide/battery/pause/resupply screenshots. Resupply in this
  ad-hoc probe used explicit scenario setup, not a claimed natural five-raid run.
- OS HID inventory observed an Xbox Wireless Controller over Bluetooth Low Energy
  (vendor 0x45e / product 0xb22). Physical button compatibility/ergonomics has not
  been exercised; API-stub evidence is not hardware acceptance. Q-13 stays open.
- Review-driven corrections cover same-slot disconnect events, pause-only repeated
  Escape/Backspace, held A during blocked loading, foreground error-card ownership
  and guarded resume. Mouse-to-controller focus had no visible ring; the browser
  regression failed before the existing navigation ring was applied.
- Controller navigation covers the battery guide, difficulty/lead choices,
  pause/resupply, purchases, report and replay. Numeric custom seeds and Options
  sliders still use keyboard/mouse; broader controller-only menu coverage belongs
  to the open Q-13 audit, not a hardware-acceptance claim.
- Final native smoke fired all three stations and inspected controller-battery,
  hybrid pause and foreground-error screenshots at 1280×720 CSS/backing pixels,
  DPR 1. A mouse-started controller focus changed from invisible to the existing
  gold ring; foreground error pause froze the clock and blocked Menu resume.
  Chrome 154 / ANGLE Metal Apple M3 Max, no console/page errors. Temporary smoke
  drivers removed; PNGs/JSON remain in owning ignored scratch. Port 5390 is
  intentionally handed to the user for physical Xbox playtest.
- Frozen `pnpm check` passed after the final focus correction: typecheck,
  694 Vitest tests (30 gated skips), 20 Node tooling regressions and production
  build. Error cards retain their independent DOM root; the shared navigation
  ring works above the menu without changing menu-root selectors.
- Final fresh-server `E2E_PORT=5391 pnpm e2e`: 41 passed, one gated soak
  skipped. Includes all battery/controller regressions, existing error recovery,
  keyboard/options, touch, crew, campaign and flight flows. Native QA browsers
  closed and the isolated regression server exited; only the handed-over 5390
  playtest server remains. Xbox follow-up is not merged or deployed.


## Q-14 — Production Airfield Defense

User approved a separate optional battery action alongside Career and Quick
Mission. Initial implementation was verified on `feat/airfield-defense`, based on
`4dc8ec8` plus the headless-QA prerequisite. That initial handoff is historical:
PR #13 has now published the integrated battery/tooling release as `1ef1893`.

### Delivered behavior

- Title → defense briefing / Gunner’s Guide / Options → first-person battery →
  five raids with untimed resupply → Won/Lost/Aborted report → exact replay,
  fresh attack or main menu.
- Vickers MG, direct-hit cannon and ranged timed flak; physical shells,
  falling-bomb interception and battery-only aerial credit. Veteran increases
  pressure without inflating health; lead hints never steer or change combat.
- HQ income, depot reload efficiency and hospital recovery; repairs, destroyed
  asset rebuilding and power/cooling/reload upgrades. Upgrades reset each run.
- Production Bertangles terrain, four existing aircraft types, a procedural
  Zeppelin, aircraft damage/wrecks, ordnance/effects and real WebAudio.
- Shared graphics/audio/mouse/fire/pause preferences, but separate battery ammo
  and heat. Mouse/keyboard controls; touch flight intent is intentionally unused.
- No pilot/career mutation, flight report, fake player aircraft or unfinished
  flight-combat dependency. Shared core changes are new defense contracts plus
  optional `GameServices.defense`.

### Verification and handoff

The executable model smoke won both difficulties; 13 model regressions pass.
The physical-input Chrome/Metal browser smoke won all five Regular raids with
all three guns, four resupplies, 29 credited kills and one bomb intercepted;
all three assets finished intact. A separate idle run lost with no kills or
interceptions. Reports recorded 3m 43s and 4m 49s combat time respectively.
Replay, fresh choices, pause/chords, real audio buffers and legacy void-returning
pointer lock were exercised; inspected gun/report screenshots cover desktop and
430×900 viewports. Browser error captures were empty.

Final owning-workspace checks: `pnpm typecheck`; `pnpm test` (690 Vitest passed,
30 gated skips, 20 Node tooling passed); `pnpm build`;
`E2E_PORT=5371 pnpm exec playwright test` (33 passed, one gated soak skipped).
The browser regressions include career-save isolation, cross-mode ownership and
shared fire/pause bindings colliding with station-selection keys.

Screenshots/JSON remain in ignored `tools/dev/scratch/airfield-defense/`.
Throwaway smoke drivers are removed, QA browsers are closed and port 5370 is
stopped. Workspaces/worker evidence are retained without cleanup authorization.
No unresolved implementation dependency. Next release gate: human gun-view,
aiming and difficulty approval, then independent integration review and normal
release checks; no publication has been performed.

## Cycle two: decisions and evidence

Base `87b798e`; integration branch `feat/backlog-cycle-two`. Initial dispatch:
SurveyAdapters (Sol high), CollisionFix (Astra high), MobileFeasibility (Sol high,
read-only). Central docs remain lead-owned; no shared production-file writers.

### Calibration evidence gate (Q-07)

Further inspection of the 12 aim-bearing inbox reports found four standard
dogfights with only 144 player rounds and two hits total. The two default Camel
reports account for 58 rounds/two hits; the other two use different encounters.
The remaining aim reports are one standard intercept, two standard balloon runs,
one standard ground attack, one relaxed dogfight and three relaxed intercepts.
Three non-dogfight reports identify a dirty build. None supplies a rating or note.

Decision: do not replace the current pursuer fit with a pooled percentage or split
these tiny default-flight counts into a misleading training/holdout set. Q-07
parameter changes wait for a comparable, provenance-confirmed human cohort with
enough firing opportunities for a meaningful held-out comparison. Existing telemetry
and the original fit remain usable for diagnostics; tactical A/Bs freeze the fit.
This evidence gate does not block collision, survey or mobile work.

## Development feedback — 2026-10-04

Tooling branch `perf/development-feedback`, based on Airfield Defense `0652782`.
Human main and the playtest checkout remain unchanged. No runtime, dependency,
CI/publication or Playwright configuration changes; this is an unmerged handoff.

### Measurements and decision

| Existing loop | Observed wall time |
|---|---:|
| Focused defense unit file (13 tests) | 1.75 s; Vitest itself 308 ms |
| Typecheck | 0.89 s |
| Full unit/tool test command (690 + 20 tests) | 34.76 s |
| Standalone validated build | 1.02 s |
| Four defense browser regressions | 41.30 s |
| Previous complete 33-case browser gate | 4.4 min |

The fresh CPU and targeted-browser timing jobs overlapped; these are descriptive
costs, not a controlled performance A/B. The full-browser figure is the previous
feature gate. Smaller feedback scope is the main gain, not faster game time or
less release coverage.

Added direct `test:unit`, `test:related` and complete CPU `check`; kept finite
`test` and standalone `build` unchanged. Related explicitly disables Vitest's
successful empty-selection default. Watch explicitly sets `--watch`, because
Vitest disables its implicit default in agent/CI sessions. Commands documentation
now separates focused edits, affected browser smoke and complete handoff gates.
No bespoke selector/orchestration framework or permanent shell-wiring tests.

### Independent review and exercised proof

Before edits, FeedbackPlanReview caught silent empty-related success and incomplete
graph coverage; HarnessPlanReview caught possible relay/CDP/cmux routing to a
user-owned browser. Both corrections were accepted. The watch amendment was
separately reviewed before editing after its implicit command exited instead of
watching.

- Direct unit command: 13 passed, 540 ms wall; `-t` forwarded correctly (one
  passed, 12 skipped, 411 ms). Related source selected the 13 tests in 993 ms.
- Absent-only and no-argument related calls exited 1. Mixed valid/absent sources
  still selected the valid file and exited 0: graph results are explicitly not
  proof that every requested path or asset dependency was covered.
- Explicit watch stayed alive, then a timestamp-only file change triggered a
  real 13-test rerun in 211 ms. No test/source contents changed.
- `pnpm check` passed typecheck, 690 Vitest (30 gated skips), 20 Node tooling and
  production bundling in 35.17 s, with one TypeScript invocation. Standalone
  `pnpm build` passed too. Timings have different load/cache conditions; no
  numeric alias/watch speedup is claimed.
- Fresh `omp --cwd` session produced isolated child `t573d5d225/m`, distinct
  from the parent, at full `0652782faf2d1c3d6e87eb645a6494249f512b8f`. Both
  committed defense contracts were present; parent/child clean, no repair, and
  retained metadata said “Isolation: no changes captured.”
- Safe managed route (no configured CDP/cmux route, relay explicitly disabled)
  used cached Headless Chrome 150, ANGLE/Metal Apple M3 Max and pre-navigation
  controller isolation. Actual defense capture/movement/fire/pause/resume/replay
  passed; the replay retained seed 1917 and spent ammunition. Inspected desktop
  gun and narrow resupply screenshots cover 1600×900 and 430×900 CSS layouts
  at DPR 1.25 (2000×1125 and 538×1125 PNGs). Browser error logs were empty.

F-98 was session-root misuse, not demonstrated wrong-base selection. F-99's
attach/recovery viewport defects remain upstream; the exact pointer-lock rejection
is unproven. Supported owned automation and explicit recovery avoid those paths;
no installed-global patch or game error suppression was made.

Full browser suite was not repeated for script/docs-only edits: runtime and
Playwright configuration are unchanged, four affected browser cases passed and
the actual launch workflow was exercised. Full runtime release gates remain.
Owned QA tabs/server and watch process are stopped. Screenshots/JSON remain in
ignored `tools/dev/scratch/development-feedback/`; throwaway probes are removed.


## Direct native gameplay QA — 2026-10-04

User authorized the direct Playwright recommendation while explicitly deferring
Claude changes. Branch `perf/direct-playwright-qa`, based on tooling `dfb8c3b`;
human main/playtest checkouts stay untouched. No game/core/runtime dependency,
Claude CLI/bridge/model/auth/permission or Claude-specific instruction changes.
No merge, push or deployment.

### Cutover

- The existing browser-automation module owns one installed-Chrome/headless/GPU
  profile, preserving `PW_CHANNEL`, explicit SwiftShader fallback and the menu
  tool's autoplay flag. Twelve direct launch scripts and the regression config
  consume it; caller viewports, DPR and per-scene context choices stay unchanged.
- `withAutomationPage` creates an owned isolated context, disables controllers
  before startup, runs one awaited callback and closes the native browser.
  A sole operation/close error is preserved; dual errors remain an AggregateError.
- `pnpm smoke:defense --port <owned-port>` performs exactly two initial/replay
  passes in the same browser/page. Actual controls exercise mouse/arrow aim,
  independent focus/fire chord release, every gun's ammo, keyboard reload,
  wheel/F/slider ranging, pause/capture and no stale held fire. Abort removes
  hook/canvas/host/capture; replay starts paused with exact options and reset
  timers/counters/upgrades/full magazines.
- Native viewport screenshots assert live CSS/backing/camera dimensions and PNG
  pixels at DPR 1. The explicit CLI refuses missing/human ports and escaping
  output paths or links before launch; run failures save checkpoint/error JSON
  and a screenshot where possible. There is no retry or game-state mutation.
- The omp harness reference now selects direct Playwright for critical gameplay,
  retaining its browser tool only for lightweight inspection. Regression server
  isolation, GPU scheduling and complete release gates are unchanged.

### Review and evidence

Fresh plan reviewers tightened error preservation, observable controls, replay
reset/teardown and resize/error acceptance before implementation. Post-change
review found the output escape; confinement and public negative cases fixed it.
A stale-plan request to add unused launch overrides was withdrawn against the
accepted viewport-only contract; no unused interface was added.

Final native smoke passed: browser/context/page setup **448 ms**, first defense
readiness **4068 ms**, exact same-page replay **3956 ms**, total **20,305 ms**.
Both passes spent ammunition with all three guns, ranged a real live target,
completed control/lifecycle checks and removed all battery resources on abort.
Headless Chrome 154.0.8037.93 used ANGLE/Metal Apple M3 Max; console/page errors
were empty and browser closure was observed. All four desktop/narrow PNGs
(1280×720 and 430×900) were inspected on the successful native path.

The roughly 112 ms readiness difference is not meaningful evidence of a speedup.
The benefit is a single bounded, repeatable, owned sequence without OMP attachment
or worker recovery, not caching a live simulation or weakening release proof.
The 20 s smoke and complete suite cover different scopes; do not quote a ratio.

Other exercised gates:
- `pnpm check`: typecheck, 690 Vitest tests (30 gated skips), 20 Node tooling
  tests and production bundle passed.
- `E2E_PORT=5383 pnpm e2e`: 33 passed, one gated soak skipped, one GPU worker
  and fresh strict-port server; 4.4 minutes.
- `pnpm prodcheck 5384`: production menu/flight/GLBs/four workers/pixels passed,
  no failed requests or errors.
- All 14 affected native scripts passed syntax checks. Actual callback failure
  retained the same Error object and closed browser/page. Missing/human port
  calls exited 2; an unavailable owned port exited 1, saved failure JSON/PNG
  and observed closed browser. Absolute, relative and symlink output escapes
  all exited 2 before browser/artifact creation; the generated link was removed.

QA dev/preview services and all owned native browsers are stopped. Native success,
initial failed-probe and negative-boundary artifacts remain under ignored
`tools/dev/scratch/direct-playwright-qa/`. Existing workspaces remain preserved
without cleanup authorization. No unresolved implementation dependency.


## Q-15 — Deferred Claude worker routing

**State:** deferred by the user on 2026-10-04 until the next time they use Claude
in this project. Review/resume this item with the owner then; opening Claude
alone does not authorize configuration changes. Nothing below is implemented.

### Recommended scope

1. **Explicit workspace and base.** Inspect the then-current bridge/CLI first.
   If still absent, add a per-call working-directory/workspace selector and
   expected-full-SHA preflight, rather than relying on task prose or the OMP
   session's directory. Launch each worker in its separately owned worktree,
   commit shared prerequisites before dispatch, and verify actual root/HEAD
   before edits. Preserve parent-owned integration and scoped handoff evidence.
   **Why:** avoids main/feature-root ambiguity and stale-base prerequisite deltas.
2. **Assignment-appropriate mode.** Use read-only mode for static reviews;
   use work mode only for bounded implementation or experiments in the assigned
   workspace. Include owned paths, non-goals and acceptance evidence in the brief.
   The bridge is not an OS filesystem sandbox; do not solve routing with blanket
   permission expansion or change authentication/profile/signing flows.
   **Why:** independent review and implementation need different capabilities,
   while filesystem ownership still needs an explicit contract.
3. **One bounded trial before expansion.** Run one independent review or disjoint
   implementation slice; record model/effort, elapsed time, actual reported usage/
   cost, review quality and exercised acceptance. Compare with the current OMP
   workflow before expanding Claude's role; keep the parent as integration owner.
   **Why:** another worker may improve independence, but lower latency/cost or
   better quality is not established. Paid-credit use has no included-only guarantee.

### Completion / limits

- A fresh worker proves the intended actual directory/full commit, separate
  ownership and loaded project instructions; no stale prerequisite-only delta.
- Required capabilities and failure behavior are exercised without widening
  permissions or silently substituting workspaces/models.
- The bounded trial has an evidence-backed retain/change decision, not an
  automatic wholesale harness migration.
- No Claude CLI/bridge/model/auth/permission settings change is made before the
  owner resumes this deferred item. Native Playwright remains the gameplay QA path.


## Airfield Defense release review — 2026-10-04

User approved the battery's feel and authorized release before a separate Xbox
follow-up. Standards review found loading-abandonment resource retention and
artifact-file symlink escapes; Spec review separately found pause ignored while
the fuze slider owned focus.

Both browser regressions failed on the release candidate before correction:
Escape left the keyboard-mode raid running; blocked model loading left seven
workers alive after abandonment (zero before launch). Session cancellation now
disposes the in-progress renderer immediately. Pause handling precedes form-input
filtering. The CLI leaf-link probe overwrote an owned external sentinel before
correction; fixed preflight exited 2 with the sentinel unchanged and no browser
launch. All fixed artifact leaves are checked before launch and written with
`O_NOFOLLOW`. No unrelated tool or Claude changes were made.

Release integration `e3e6fa5` passed frozen `pnpm check` (690 Vitest tests,
30 gated skips; 20 Node tool tests; typecheck/build), all 35 browser regressions
(one gated soak skipped), native two-pass battery smoke and local production
flight smoke. PR #13 validation run 37243051972 built without publication.
Authorized merge produced main `1ef1893`; deployment run 37243290029 passed.
Inspected deployed flight and battery screenshots, exercised all three guns,
capture/pause/Aborted teardown and observed no network/console errors.
The live playtest worktree at `0652782` was preserved; release QA services stopped.


