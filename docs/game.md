# Game layer (`src/game`)

The glue: app bootstrap, the in-flight loop, input, cameras and the mission
director. Everything else is reached through one composition point.

## Files

| File | Role |
|---|---|
| `modules.ts` | **Composition point.** Binds every subsystem factory (`GameModules`). |
| `moduleTypes.ts` | `GameModules` factory signatures, `AIControllerOptions`, `UiHandle`. The HUD type is `Hud` from `src/ui/hud/types.ts`. |
| `app.ts` | `startApp(root, modules)`: settings, `GameServices`, display catalog (`setUiCatalog(catalogFromCampaignData())`), UI mount, `showFatalError`. |
| `flightSession.ts` | `createFlightLauncher(modules, audio)` → `FlightLauncher.fly`. The loop; drives the HUD cards (pause, end flight, orders, map). |
| `simCore.ts` | `SimCore`: the headless flight — world, combat, AI controllers, mission director, the fixed step, landing detection, wingman orders. Shared by `FlightSession` and the autoplayer. |
| `heightCache.ts` | Tiled bilinear cache (32 m cells, 1 km tiles, LRU) over `terrainHeightAt`; every ground query in a flight goes through it. |
| `autoplay.ts` | Autoplayer: `runAutoplay(mission)` flies a mission headlessly with the player's aircraft on an AI controller; `headlessModules`. |
| `world.ts` | `buildWorld`: entities from a `MissionDefinition` (formation offsets, ground starts, spawn delays), `WorldQuery`. |
| `missionDirector.ts` | Objectives, kill credit → `VictoryClaim`, radio chatter, end conditions, `MissionResult`. |
| `input.ts` | Keyboard (rebindable actions), mouse (direct stick / mouse-aim instructor), gamepad. |
| `cameras.ts` | Cockpit (head look, snap views), chase, padlock, fly-by, target, orbit. |
| `hudView.ts` | `buildHudView` → the UI's `HudView` each frame; `toScreen`, `advanceWaypoint`. |
| `stubs/` | Placeholders still bound in `modules.ts` (renderer, aircraft visuals) plus `sim`/`campaign` stubs used by unit tests. |

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

## Swapping stubs

Edit only `modules.ts`. Real today: sim, combat, AI, audio, campaign, UI,
HUD, world. Still stubbed:

| Entry | Real module |
|---|---|
| `createWorldRenderer` | `src/render/worldRenderer.ts` `createWorldRenderer(canvas, { quality, date })` |
| `createAircraftVisual`, `preloadAircraftModels` | `src/render/aircraft` |

## Debug hook and tests

`window.__rb2 = { services, session }`. `session` exposes `time`,
`timeScale`, `paused`, `player`, `world`, `frames`, `samplePixels()` (reads
back the WebGL drawing buffer right after a render), `command(action)`,
`endFlight()`, `abandon()`, and two test hooks: `aiState(id)` (an AI's
behaviour label, e.g. `formation`, `engage #4`, `rtb`) and `placeAtHome()`
(parks the player, stopped, on the home strip to exercise the landing rules).

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
  - `flak/ground(<outcome>)` for damage without a bullet hit;
  - `self(<outcome>, <AI phase>)` for everything else.

  The soak summary prints a histogram of these causes and the claims per
  mission.
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
  sets the career difficulty. The output ends with a per-type
  table: contact %, median contact time, success %, kills per mission,
  returned/killed/captured/wounded %, timeouts. ~110 missions take ~10 min.
  Note the AI player is a `veteran`; its death rate is an upper bound on a
  careful human's, not a target to drive to zero.

