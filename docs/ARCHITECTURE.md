# Architecture

```
src/
  core/        Shared contracts (types, interfaces, events, geo, settings). Lead-owned.
  data/        Static historical data: aircraft, aerodromes (lead), squadrons/aces/medals/ranks (campaign),
               geography/front lines (world).
  sim/         Flight model (6-DOF rigid body), weapons, ballistics, damage, collisions, flak. Pure TS.
  ai/          AI pilots: dogfighting, formation, escort, wingman orders. Pure TS. (The AI
               gunners' aiming and fire live in sim/combat.ts; ai/ picks their targets.)
  world/       Terrain height field, land-use, rivers/towns/forests, front lines by date. Pure TS
               (no scene code) so sim/AI/campaign can query it in Node tests.
  render/      Three.js: WorldRenderer (terrain streaming, sky, clouds, water, trenches, towns,
               effects), aircraft visuals (GLB loading, liveries, cockpit, fallback meshes).
  audio/       WebAudio procedural sound: engines (rotary/inline), guns, wind, hits, explosions, music.
  campaign/    Career logic: pilots, squadrons, historical timeline, mission generator, debrief,
               promotions/medals, ace standings, save/load; quick mission builder. Pure TS.
  ui/          DOM screens (main menu, roster, pilot creation, HQ, briefing, debrief, logbook,
               quick mission, options) and the in-flight HUD/overlays. Period styling.
  game/        App bootstrap + screen router wiring, FlightSession (the in-flight loop composing
               sim/ai/render/audio/ui), input (keyboard/mouse/gamepad), cameras (cockpit, chase,
               padlock, fly-by, target), mission director (objectives, end conditions).
tools/blender/ Headless Blender pipeline generating public/models/*.glb and public/art/*.png.
tests/e2e/     Playwright smoke tests.
```

## Flight session loop (src/game)

```
fixed step 1/120 s:
  input -> player.controls
  ai.update(...) for AI aircraft (at 30 Hz)         -> ai.controls
  sim.stepFlight(ac, env, realism, dt) for all aircraft
  combat.update(world, dt)                          -> bullets, hits, damage, events
  missionDirector.update(world, dt)                 -> objectives, spawns, end conditions
per frame:
  cameras.update(); renderer.update(); aircraftVisuals.update(); renderer.render()
  audio.updateFlight(); hud.update()
events (EventBus) fan out to renderer.handleEvent, audio.handleEvent, hud, missionDirector.
```

## Airfield Defense session (src/game/defenseSession.ts)

`createLazyDefenseLauncher` loads a separate battery session on demand. Its fixed
60 Hz ticks feed `src/sim/airfieldDefense.ts`, which slices motion at 120 Hz for
chronological swept contacts. `src/data/airfieldDefense.ts` owns authored raids and
battery balance; it does not change flight performance or campaign data.

`src/render/airfieldDefense.ts` adapts local battery metres onto the historical
Bertangles terrain, production aircraft GLBs/liveries, effects and audio query.
The query has no player aircraft. Aircraft entities mirror authored enemy poses;
they are not a second flight simulation. The airship and camera-space guns are
procedural meshes. Muzzle geometry, physical projectile origin/direction, centered
sight, normal/focused FOV and resize share one presentation contract.

Battery events stay local. Only battery-owned aerial kills and bomb interceptions
earn credit; enemy blasts affect defended assets only. Every scheduled group,
threat, bomb and player shell must settle before resupply or victory. Loss and
abandonment terminate immediately. `DefenseResult` is a copied terminal snapshot,
never a `MissionResult`, pilot claim or flight report.

The menu shares settings and navigation conventions, not career state. Input,
pointer capture, rendering, audio and the dev-only diagnostic hook are released on
exit/restart. Session cancellation disposes an in-progress renderer immediately,
including while model requests are blocked; late visuals remain disposal-guarded.
Both launcher directions reject overlapping flight/defense sessions.


## Contracts

* `src/core/types.ts` — data types (AircraftSpec, entities, MissionDefinition, MissionResult, GameEvent, settings).
* `src/core/interfaces.ts` — module interfaces (SimModule, CombatSystem, AIController, WorldRenderer,
  AircraftVisual, AudioEngine, CampaignService, FlightLauncher, GameServices).
* `src/core/campaignTypes.ts` — career data (CareerPilot, SquadronInfo, DebriefReport, QuickMissionOptions).
* `src/core/defense.ts` — independent battery options, state, owned events, commands,
  terminal results and `DefenseLauncher`; `GameServices.defense` is optional.
* `src/render/defensePresentation.ts` — renderer-owned first-person aim/presentation
  seam, kept out of pure simulation contracts.

### Crew stations and bombs (D-086, docs/bombers.md)

* Every aircraft has crew stations, pilot first: where a crew member works from, the guns he
  fires (`spec.guns` indices) and their fields of fire (`FireArc` boxes in the body frame).
  Read them only through `crewStations(spec)` (`src/data/crew.ts`), which derives the pilot and
  one observer for types that don't list their own. `inFireArcs` tests a direction.
* Stations that share a `crewIndex` are one man, who fires one of them at a time.
* The player's aircraft keeps `controller: 'player'` wherever he sits. At a gunner station
  the game layer sets `AircraftEntity.stationInputs` (aim, fire, bomb release) and lets an AI
  controller fly; those inputs override the AI gunner at that station only.
* Bombs: `spec.bombs` is the load (included in `massLoaded`), `AircraftEntity.bombs` the
  count left per store. Release through `controls.releaseBomb` (pilot, AI) or
  `stationInputs.releaseBomb` (the player at the bombsight).
* The sim side (docs/sim.md "Gunners", "Twins", "Bombs"): combat runs one AI gunner per crew
  member, from `crewStations(spec)`. `setGunnerTarget(ac, id, station?)` and
  `getStationAim(ac, station)` are the gunners' API. The game layer calls `loadBombs(ac)`
  for a bombing sortie and fills `MissionResult` from `getBombStats(ac)`. The bombsight uses
  `predictBombImpact(ac, env)`, and the renderer draws `combat.bombs` (`BombView`).

## Commands

* `pnpm dev` — play at http://localhost:5173
* `pnpm test` — Vitest unit tests followed by CPU-only tool regressions (also used by CI); `pnpm typecheck`; `pnpm build`
* `pnpm check` — complete CPU gate: typecheck, all unit/tool tests, then production bundling; typechecks once
* `pnpm e2e` — Playwright browser tests; `pnpm e2e:soak` — 20-flight leak soak
* `pnpm build && pnpm preview --port 5325` then `pnpm prodcheck 5325` — production-build check
* `blender --background --factory-startup --python tools/blender/build_models.py` — regenerate models
* `pnpm test:tools` — only the Node-based `tools/dev/*.test.mjs` regressions

### Development feedback

Use the smallest check covering the changed behavior while editing; keep full
gates for integration/handoff. Pass selectors to a direct runner, not the chained
`test` or `check` command.

| Change / phase | Feedback command |
|---|---|
| Known pure-logic seam | `pnpm test:unit src/sim/airfieldDefense.test.ts` |
| Repeated edits at that seam | `pnpm test:watch src/sim/airfieldDefense.test.ts` |
| Explore import-graph dependants | `pnpm test:related src/sim/airfieldDefense.ts` |
| Node tooling | `node --test tools/dev/ab.test.mjs` |
| Input/UI behavior | `pnpm smoke:defense --port 5382`, then `E2E_PORT=5383 pnpm e2e tests/e2e/airfield-defense.spec.ts` |
| Integrated CPU gate | `pnpm check` |

`test:related` fails when it discovers zero test files. A mixed valid/absent
selector can still pass: report the discovered files/counts, not the requested
list. Import-graph selection does not track GLB/filesystem inputs or replace
explicit affected Node/browser tests. Prefer a known existing test file when
the seam is already identified; `-t` narrows behavior within that file.

Targeted results are not full-suite proof. Complete `pnpm test` and typechecking
(both included in `check`) before committing. Runtime changes still require the
full browser gate and inspected real-game evidence at integration, with the
existing single GPU worker/exclusive slot and a fresh strict-port server. Reuse
an owned browser/tab only for ad-hoc iteration, not Playwright server reuse.
Standalone `pnpm build`, CI and publication gates remain unchanged.
Keep the entire tracked checkout and Git state fixed during `pnpm test`/`pnpm check`,
including documentation edits and staging/commits: the Node differential regressions
snapshot repository-wide evidence and deliberately fail if it changes mid-scenario.


### Native gameplay smoke

From the owning task worktree, start a dedicated dev server and run the bounded
sequence against its explicit port:

```sh
RB2R_REPORTS_DIR=tools/dev/scratch/direct-playwright-qa/flight-reports pnpm dev --port 5382 --strictPort
pnpm smoke:defense --port 5382 --out tools/dev/scratch/direct-playwright-qa/smoke
```

The runner performs an initial launch and exact replay in one owned native
browser/context/page. It observes aim, mouse chords, keyboard fire/reload,
all three guns, wheel/F/slider ranging, pause/capture, desktop/narrow resize,
complete abort teardown and fresh replay state. It changes no simulation state.
Actual 1280×720 and 430×900 DPR-1 screenshots and checkpointed JSON accompany
browser-run failures; cleanup is awaited before exit. Invalid CLI arguments,
the human port 5173 and output paths/links escaping the workspace are refused
before launch. Keep the example's output directory task-specific in other jobs.
Readiness timings compare first launch and same-page replay under the current
load—not a controlled A/B or proof of a faster flight model.

`automationLaunchOptions()` is the sole native channel/headless/GPU policy,
including existing `PW_CHANNEL` and `E2E_SWIFTSHADER` choices. Fixed extra flags
(such as menu-audio autoplay) remain caller-specific. `withAutomationPage`
owns a fresh isolated context, installs controller isolation before page startup,
and closes its browser after its awaited callback; operation and cleanup failures
remain distinguishable. Use it for one bounded sequence, not as a daemon or a
replacement for regression server isolation.

### Exact CPU differential probes

Compare existing baseline/candidate checkouts with one scenario and one set of inputs:

```sh
node tools/dev/differential-probe.mjs --baseline /path/to/baseline --candidate . \
  --scenario tools/dev/scenarios/world-equivalence.mjs --input '{"seed":42}'
```

`geo-equivalence.mjs` is the leaf-TypeScript loader smoke; `world-equivalence.mjs`
loads the full terrain/land-use/front-line/road graph, warms rivers, aerodrome levels,
crater grids and roads identically, then snapshots deterministic observations. It
includes cold/warm cache evidence and copies observations before shared scratch can
be reused. Equal observations are evidence for these inputs, not a proof for every input.

A scenario is a native Node `.mjs` file default-exporting
`async function ({ load, input })`; use `await load('src/sim/flightModel.ts')` or another
root-relative module path for **all project imports**. Perform warmup/setup and
observations in that one function. There are no separate side-specific setup hooks.
Both workers use the same absolute scenario file and cloned JSON input, with fresh
process globals, scenario modules, dependency singletons and Vite SSR module graphs.
For programmatic use, import `compareRoots` from `tools/dev/differential-probe.mjs`
and pass `{ baseline, candidate, scenario, input, timeoutMs }` (timeout defaults to 60 s).

The JSON report records canonical roots, Git HEADs, dirty status, tracked diff and
untracked-file SHA-256 fingerprints, scenario SHA-256, inputs, complete observations,
worker exits/logs and the first differing path. Exit 0 means equal, 1 different,
2 failed; exceptions, nonzero worker exits, missing results and timeouts cannot pass.
Regression-test verdict failures include both workers' complete reports. CLI
exit-status failures include stdout, stderr, signal and spawn errors, so an
unexpected `failed` verdict does not hide the underlying worker diagnostics.
Return plain objects, dense arrays, strings, booleans, null and numbers. Advanced
IPC and `Object.is` comparisons preserve NaN, infinities and signed-zero identity;
CLI JSON represents special numbers as `{"$number":"NaN"}`, `"Infinity"`,
`"-Infinity"` or `"-0"` tags, while module results retain native numbers. The
`$number` object key is reserved to make this encoding unambiguous. Undefined,
accessors, class instances and cycles fail with an observation path instead of
silently losing data.

This tool intentionally does **not** create/check out refs, install dependencies,
invoke a browser or load project Vite config/plugins/`.env` files. Prepare detached
worktrees separately, and make their dependencies available before running. The
loader comes from the tool checkout's installed Vite, not TypeScript compiler
runtime APIs (TS7 no longer exposes `transpileModule`/`ScriptTarget`). Vite runs in
middleware mode without sockets/watchers; its cache is temporary and removed.
Do not edit either root or the scenario during a comparison; detected checkout
changes fail. Git evidence excludes ignored files and dependency contents, so keep
those fixed. Scenario helper imports must also stay fixed; load candidate project
modules through `load`, never through native scenario imports. Scenarios must seed
randomness and avoid clock/network/filesystem-dependent observations themselves.
