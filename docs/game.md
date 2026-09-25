# Game layer (`src/game`)

The glue: app bootstrap, the in-flight loop, input, cameras and the mission
director. Everything else is reached through one composition point, split
into a menu half (bound at boot) and a flight half (a lazily loaded chunk).

## Files

| File | Role |
|---|---|
| `modules.ts` | **Composition point, menu half.** `menuModules` (audio, campaign, UI); `createLazyFlightLauncher`, `loadFlightChunk`, `prefetchFlightChunk`. |
| `flightModules.ts` | **Composition point, flight half.** `flightModules` (sim, combat, AI, world renderer, aircraft visuals, HUD, terrain) — its own build chunk. |
| `moduleTypes.ts` | `GameModules` factory signatures (= `MenuModules` + `FlightOnlyModules`), `AIControllerOptions`, `UiHandle`. The HUD type is `Hud` from `src/ui/hud/types.ts`. |
| `app.ts` | `startApp(root, menuModules)`: settings, `GameServices`, display catalog (`setUiCatalog(catalogFromCampaignData())`), UI mount, error recovery (`restart()`), `installGlobalErrorHandlers`. |
| `errorOverlay.ts` | `showFatalError` (recoverable: "Return to menu" / "Reload") and `showFlightInterrupted`. |
| `activeFlight.ts` | Registry of the flight in progress; `abortActiveFlight(err, { silent })`. |
| `flightSession.ts` | `createFlightLauncher(modules, audio)` → `FlightLauncher.fly`. The loop; drives the HUD cards (pause, end flight, orders, map). |
| `simCore.ts` | `SimCore`: the headless flight — world, combat, AI controllers, mission director, the fixed step, landing detection, wingman orders. Shared by `FlightSession` and the autoplayer. |
| `heightCache.ts` | Tiled bilinear cache (32 m cells, 1 km tiles, LRU) over `terrainHeightAt`; every ground query in a flight goes through it. |
| `autoplay.ts` | Autoplayer: `runAutoplay(mission)` flies a mission headlessly with the player's aircraft on an AI controller; `headlessModules`. |
| `world.ts` | `buildWorld`: entities from a `MissionDefinition` (formation offsets, ground starts, spawn delays), `WorldQuery`. |
| `missionDirector.ts` | Objectives, kill credit → `VictoryClaim`, radio chatter, end conditions, `MissionResult`. |
| `input.ts` | Keyboard (rebindable actions), mouse (direct stick / mouse-aim instructor), gamepad. |
| `cameras.ts` | Cockpit (head look, snap views), chase, padlock, fly-by, target, orbit. |
| `hudView.ts` | `buildHudView` → the UI's `HudView` each frame; `toScreen`, `advanceWaypoint`. |
| `stubs/` | `sim`/`campaign` stand-ins used by unit tests (no stub is bound in the game any more). |

## Loop

```
per rAF frame (dt clamped to 0.1 s):
  input.enabled = !hud.menuOpen          (HUD cards own the keyboard)
  input.update -> player.controls, edge commands (views, time, wingmen, pause...)
  if time compression > 1 and an enemy is within 4 km: drop to x1
  accumulator += dt * timeScale; while accumulator >= 1/120:   (SimCore.step)
      world.time += h; spawn due flights
      every 4th step (30 Hz): ai.update(ac, world, 4h) for AI aircraft
      sim.stepFlight(ac, env, realism, h)   (skip wrecks on the ground)
      landing detection (was airborne, on ground, < 2 m/s) -> landed-friendly/enemy
      combat.update(world, h)
      director.update(h)
  visuals.update, camera rig, renderer.update/render, audio.updateFlight
  hud.update(buildHudView(...)), hud.setGEffect, map overlay redraw at 5 Hz when open
  director.ended -> build MissionResult, teardown, resolve
```

Events go through one `EventBus` per session; `onAny` fans out to
`renderer.handleEvent`, `audio.handleEvent`, and HUD messages (radio,
victories, jams, objectives) plus a red hit flash when the player is struck.
The director emits `aircraft-destroyed` itself for outcome changes not
already reported by combat (e.g. crashes into the ground), so kills are
counted exactly once.

`controls.clearJam` is an edge: the session clears it after the first sim
step of the frame. Flexible (rear) guns are driven by the AI via
`modules.setGunnerTarget`.

## HUD wiring

The session builds the UI's `HudView` directly (no adapter layer):

- **Target box**: the padlocked entity, else the one selected with T, else
  the nearest live enemy aircraft within 2.5 km. Lead point is drawn only on
  the relaxed flight model (HUD rule).
- **Threat ring**: enemies within 3 km; `danger` when behind, closing and
  under 800 m.
- **Waypoint**: the player's next waypoint; advances within 1.5 km.
- **Wingmen**: flight-mates with status (ok / engaged / damaged / down /
  landed) and the last acknowledged order.
- **Mouse-aim**: aim circle and nose cross (`HudView.mouseAim`).
- **Menus**: Esc → HUD pause card (resume / end flight / abandon); N → HUD
  end-flight card (safe → recorded as returned; unsafe → abandon, captured if
  over enemy lines); O → orders card (closes when an order is given); M → map
  card (`MapView` centred on the player, 40 km across).

## Kill credit and fates

- Credit goes to `killerId`, else `victim.damage.lastAttackerId`.
- **Witnessed** if the kill is over the player's own lines or a live
  friendly aircraft is within 3 km. **Shared** if another friendly also hit
  the victim. Ground targets are objectives, not victory claims.
- Enemy aircraft forced down on your side (`landed-enemy`) count as lost.
- Player fate: killed (pilot killed, fire, structural failure, collision,
  impact > 45 m/s), captured (down or landed behind enemy lines, abandoning
  over enemy lines), wounded, landed-elsewhere (> 2.5 km from home), returned.
- A safe "End flight" needs no enemy within 5 km **and** friendly ground
  below. "Abandon mission" always works: over enemy lines he is captured;
  over our own it is `landed-elsewhere` with `MissionResult.aborted` set, which
  always fails the mission (and gets its own CO remark in the debrief).
- **Objectives** are checked every tick. Each one can complete early, fail
  early (`objective-failed` event plus a radio call and HUD warning), or be
  judged only at the end (`survive`, `protect-balloons` success). The rules
  for each kind are in docs/campaign.md. When every primary objective is
  decided, the radio says so. If the job was tied to other aircraft or
  balloons (escort, intercept, balloon defence) and no enemy is within 4 km,
  the director's `onRecall` hook fires. `SimCore` then orders the player's
  wingmen home, and the player too when the player is AI-flown.
- `MissionResult.acesDown` lists every historical ace lost in the fight
  (either side, whoever brought him down); the campaign retires killed and
  captured ones from the career.

## Mouse-aim

In flight the instructor is `mouseAimAssist` (`input.ts`): it drives the
AI's model-inverse `Autopilot` (src/ai) in gun-aim mode, so it respects each
type's stall AoA, g limit, Vne, torque and the terrain. Limits per realism
level live in `INSTRUCTOR` (relaxed 5 g / wide margins … authentic 6.2 g).
It takes stick and rudder only; throttle and blip stay with the player.

- **Ground:** mouse steers with rudder, wings held level, tail up to
  accelerate, rotates at 1.15 Vs when the aim is raised, tail down on
  rollout.
- **Landing:** throttle under 30% below 150 m switches to a landing law
  (no terrain-margin defence, gentle g), so pointing at the field lands.
- Keyboard or gamepad input overrides it and re-syncs the aim to the nose.
- `mouseAimControls` is the legacy PD law, kept as the fallback when no
  WorldQuery is available (unit tests, harnesses).

Regression tests on the real sim: `mouseAim.realsim.test.ts` (duels; full
10-type × 3-level table with `MOUSEAIM_SOAK=1`, written to
`test-results/mouseaim-soak.txt`), `mouseAimField.realsim.test.ts`
(take-off/landing), `keyboardFeel.realsim.test.ts` (held keys).

## Render interpolation

`renderInterp.ts` blends aircraft poses between the last two 120 Hz sim
steps by the accumulator fraction for drawing only, then restores the true
state before audio/HUD/sim — no stutter when a frame sees 0, 1 or 2 steps
(120/144 Hz displays).

## Playtest screenshots

`node tools/playtest/flight-shots.mjs --aircraft <id> --views cockpit,chase,padlock --fly 4`
against a running dev server (`--port`, `--keys Space --hold 1.5`, `--count`,
`--start`, `--realism`; `|`-separate views that carry JS). The session debug
handle exposes `rig`, `visuals` and `freeze()` for QA.

## Binding subsystems

Every entry is real. To swap an implementation, edit `modules.ts` (audio,
campaign, UI) or `flightModules.ts` (everything a flight needs). Keep
flight-only code out of `modules.ts` and `app.ts`: anything they import
statically lands in the boot bundle (see Robustness → Bundles).

## Debug hook and tests

`window.__rb2 = { services, session }`. `session` exposes `time`,
`timeScale`, `paused`, `player`, `world`, `frames`, `samplePixels()` (reads
back the WebGL drawing buffer right after a render), `command(action)`,
`endFlight()`, `abandon()`, and test hooks: `aiState(id)` (an AI's
behaviour label, e.g. `formation`, `engage #4`, `rtb`), `placeAtHome()`
(parks the player, stopped, on the home strip to exercise the landing rules),
`simulateContextLoss(restoreAfterMs | null)` and `throwNextFrame(message)`
(see Robustness).

- `pnpm test`: `missionDirector.test.ts` (claims, witnesses, objectives,
  fates, end flight), `input.test.ts` (bindings, shaping, mouse-aim),
  `src/ui/campaignCatalog.test.ts` (campaign ids → display names).
- `pnpm e2e` (Playwright, installed Google Chrome; `PW_CHANNEL=chromium` for
  Playwright's own browser; `E2E_PORT` to change the dev-server port, which is
  never reused so a server from another worktree can't serve stale code):
  - `smoke.spec.ts`: launches a quick mission through `services.launcher`,
    flies 10 s, checks a non-blank frame, no console errors, the MissionResult.
  - `ui-flow.spec.ts`: (a) Quick Mission screen → briefing → 15 s flight →
    Esc → Abandon → debrief → back to Quick Mission; (b) career: enlist
    (Germany, 1 April 1917, Jasta 11) → HQ → briefing → take off → 10 s →
    N → end flight → debrief pages → HQ shows 1 sortie → reload → roster →
    HQ still shows 1 sortie.
  - `missions.spec.ts`: wingman orders (radio acknowledgement + AI state
    change), time compression up/down and refused near enemies, end flight
    refused near enemies, abandon = aborted failure, landing at home =
    returned, a career balloon attack at x8 (balloons on the enemy side).
  - `robustness.spec.ts`: see Robustness below.
  - `soak.spec.ts` (skipped unless `E2E_SOAK=1`; `pnpm e2e:soak`).
  Screenshots land in `test-results/`.

## Autoplayer

`runAutoplay(mission, { maxTime, realism, contactRange, endFlightWhenSafe })`
builds a `SimCore` with `aiPlayer: true` (the player's aircraft gets an AI
controller at its own skill) and steps it at 120 Hz until the director ends
the mission. Like a human it presses "end flight" once its AI is heading home
and the end-flight rules allow it. It reports the `MissionResult` plus: first
contact time (enemy within 3 km), initial enemy range, first shot, player
kills, losses, balloons/ground targets destroyed, spawns below 30 m AGL,
balloons/targets on the wrong side of the front, aces present/downed, and an
event histogram. Headless it runs ~200x real time (the height cache is what
makes that possible: the analytic terrain costs ~20 us a call).

- `playerLossCause` classifies what took the player out:
  - `collision-<wingman|friendly|enemy|balloon>`;
  - `enemy-fire(<outcome>)` for bullets within the last 25 s;
  - `flak/ground(<outcome>)` for damage without a bullet hit (a shot-up airframe
    that fails later, a zone jumping to 1, still counts as enemy fire);
  - `self(<outcome>, <AI phase>)` for everything else.

  The soak summary prints a histogram of these causes and the claims per
  mission.
- `collisions` lists every aircraft–aircraft collision in the flight as
  `<player|ai>-<enemy|wingman|friendly>[ wreck] <angle between noses>deg
  <stateA>/<stateB> t=<s>`; the soak prints them per mission (`COLL …`) and a
  `COLLISIONS` histogram (head-on = noses 130–180° apart).
- `passivePlayer: true` replaces the AI player with one that holds wings
  level and the nose on the horizon and never fights.
- `src/game/autoplay.test.ts` (in `pnpm test`):
  - two career patrols must reach contact inside 330 s and end cleanly;
  - a passive recruit must survive the first 60 s of at least 90% of 16
    missions.
- `src/game/autoplay.soak.test.ts` (skipped unless `AUTOPLAY` is set):

  ```sh
  AUTOPLAY=career,quick AUTOPLAY_MISSIONS=5 AUTOPLAY_OUT=/tmp/ap.txt \
    pnpm vitest run src/game/autoplay.soak.test.ts
  ```

  `career` flies `AUTOPLAY_MISSIONS` consecutive missions for 20 pilots (all
  four nations, dates 1915-08..1918-10), applying each result through the
  campaign (promotions, medals, wounds, fates) and logging a debrief line;
  `quick` flies every quick-mission type. `AUTOPLAY_QUICK_REPS=N` repeats each
  quick setup with N fixed seeds, and `AUTOPLAY_DIFFICULTY=recruit|pilot|ace`
  sets the career difficulty. `AUTOPLAY_SEED_BASE=N` offsets the career pilots'
  seeds so parallel runs sample different careers. The quick setups include the
  Quick Mission screen's default (Camel and wingman v two regular D.Vs);
  `AUTOPLAY_QUICK_SETUPS=default,camel,dvii` and
  `AUTOPLAY_QUICK_TYPES=dogfight,ground-attack` select setups and types, and
  `AUTOPLAY_QUICK_BY_SETUP=1` summarises per setup as well as per type. The output ends with a per-type
  table: contact %, median contact time, success %, kills per mission,
  returned/killed/captured/wounded %, timeouts. ~110 missions take ~10 min.
  Note the AI player is a `veteran`; its death rate is an upper bound on a
  careful human's, not a target to drive to zero.


## Robustness

### Long sessions (no per-flight leaks)

A flight builds a fresh canvas, `WebGLRenderer`, scene, workers and audio
loops; all of it must go when the flight ends.

- **GPU sweep.** three.js adds a `'dispose'` listener to every geometry,
  material and texture it uploads, and `WebGLRenderer.dispose()` does not
  remove them. Anything that outlives the flight — the aircraft model cache,
  livery canvases, shared balloon materials, three's own module-level DFG LUT —
  would otherwise pin every past renderer with its GL context and programs.
  `WorldRenderer.dispose()` therefore first calls `releaseGpuResources`
  (`src/render/releaseGpu.ts`), which disposes everything reachable from the
  scene (including renderer-injected uniforms), then force-loses the context.
  Shared resources stay usable: three re-uploads them next time. The flight
  session disposes the renderer *while aircraft are still in the scene*.
- **Livery cache** (`src/render/aircraft/livery.ts`) is an LRU capped at
  `LIVERY_CACHE_MAX` (48): every squadron mate has a personal marking.
- **Teardown** isolates each step, so one throwing `dispose` can't leave the
  `fly()` promise unsettled.
- **Soak test**: `E2E_PORT=5323 pnpm e2e:soak` (`E2E_SOAK_FLIGHTS`, default
  20) flies consecutive quick and career flights in one page and asserts,
  after every flight: 0 live WebGL contexts, 0 workers, no extra rAF loop,
  no live audio source with music off, and bounded DOM/listener/heap growth.
  Before the sweep, each flight left its context alive (6 flights → 6
  contexts); after it, heap levels at ~26 MB and DOM nodes at ~1,200 over
  20 flights.
- **Hunting a leak**: with a dev server running,
  `node tools/playtest/retainers.mjs <port> diff 2 3` lists the object
  groups that grow per flight, and
  `node tools/playtest/retainers.mjs <port> path 3 <CtorName|~prefix>` prints
  the retainer path from a GC root.

### Errors

| Failure | Behaviour |
|---|---|
| Exception in a frame or in flight setup | Flight tears down, `fly()` rejects, "Flight interrupted" card (`#rb-flight-error`). Nothing is recorded. |
| Exception in audio during a flight | Audio is switched off for that flight; the flight continues. |
| WebGL context lost | Simulation holds still, HUD says "restoring"; resumes on `webglcontextrestored`. Not restored within `CONTEXT_RESTORE_TIMEOUT_MS` (8 s): flight ends as an error. |
| Uncaught error / rejection outside a flight | Fatal overlay (`#rb-fatal`) with "Return to menu" (`App.restart()`: aborts any flight, remounts the UI) and "Reload". ResizeObserver loop noise is ignored. |
| Missing aircraft GLB | Procedural fallback mesh (`src/render/aircraft/fallbackModel.ts`). |
| No WebAudio | `NullAudioEngine` (silent). |

`tests/e2e/robustness.spec.ts` covers each row, using the
`throwNextFrame` / `simulateContextLoss` debug hooks and request routing for
the missing GLB.

### Saves

`CareerStore` (`src/campaign/storage.ts`, tests in `storage.test.ts`):

- **Read-modify-write**: each mutation re-reads storage and changes only its
  own pilot, so two tabs never erase each other's careers.
- **Quarantine**: a record that fails validation is kept in `quarantined`,
  never dropped by the next save.
- **Newer version**: a document with `version` above ours is never written
  (`readOnly`); changes stay in memory for the session.
- **Migration**: `migrate()` upgrades old documents (version-less → v1). Add a
  step there with every schema change and bump `VERSION`.
- **Corrupt JSON** is copied to `rb2r.campaign.v1.corrupt-<time>` before the
  store starts afresh.
- **Quota**: a refused write leaves memory authoritative until one succeeds.
- **Interrupted flights**: a career changes only when `applyMissionResult` runs
  after a flight, and missions are generated deterministically from the
  pilot's state. Closing the tab mid-flight therefore loses nothing and skips
  nothing: the same sortie is waiting (e2e: "closing the tab mid-flight…").
  The flip side: quitting a doomed flight dodges its outcome (no "ironman" mode).

### Bundles and the production build

- Boot bundle (menus): ~580 kB (180 kB gzip). The flight half
  (`flightModules.ts`: three's WebGL renderer, sim, AI, render) is a separate
  ~670 kB chunk, prefetched when the browser is idle after the menus mount
  and awaited by the first `launcher.fly()`. Workers are their own chunks.
  Dev harness pages (`dev/*.html`) are not part of the build.
- `base: './'` makes the build hostable from any path. `assetUrl()` returns
  absolute URLs because a relative `url()` inside a CSS custom property
  resolves against the stylesheet (`dist/assets/`) rather than the document.
  That bug hid the title key art in production builds only.
- Check a build: `pnpm build && pnpm preview --port 5325 --strictPort`, then
  `pnpm prodcheck 5325` (or `pnpm prodcheck 5326 /sub/` against
  `vite preview --base /sub/`). The check loads the menus, flies a mission,
  and fails on any 4xx, any asset served as HTML, any console error, a missing
  GLB or worker, or a blank frame.
