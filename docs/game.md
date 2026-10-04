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
| `heightCache.ts` | Tiled bilinear cache (32 m cells, 1024 m tiles, 600-tile LRU) over `terrainHeightAt`; every ground query in a flight goes through it. |
| `autoplay.ts` | Autoplayer: `runAutoplay(mission)` flies a mission headlessly with the player's aircraft on an AI controller; `headlessModules`. |
| `flightRecorder.ts` | `FlightRecorder`: the flight report's statistics (`MissionResult.telemetry`): hits taken, loss cause, combat time, each enemy's first pass, gunnery (`aimStats.ts`), time at each crew station, time compression, fps. See "Flight report". |
| `aimStats.ts` | `AimTracker`: the player's gunnery by mount, aim error with the trigger held, firing range and time to the first shot (flight recorder and autoplayer). |
| `lossCause.ts` | `LossCauseTracker`: what took the player out. Shared by the autoplayer and the recorder. |
| `world.ts` | `buildWorld`: entities from a `MissionDefinition` (formation offsets, ground starts, spawn delays), `WorldQuery`. |
| `missionDirector.ts` | Objectives, kill credit → `VictoryClaim`, radio chatter, end conditions, `MissionResult`. |
| `input.ts` | Keyboard (rebindable actions), mouse (direct stick / mouse-aim instructor), gamepad. |
| `cameras.ts` | Cockpit (head look, snap views), chase, padlock, fly-by, target, orbit, and the crew views: gunner and bombsight. |
| `hudView.ts` | `buildHudView` → the UI's `HudView` each frame; `toScreen`, `advanceWaypoint`. |
| `crewSeat.ts` | Crew-seat logic (pure): seat cycling, the starting seat, the AI pilot's route pickup, a flexible gun's aim clamped to its station's fire arcs, the arcs' outer edge, `StationInputs` from aim and buttons. See "Crew stations". |
| `playerCrew.ts` | `PlayerCrew`: the player's seat in flight. Seat keys, gunner aim, bombsight and release, camera and input mode, the HUD's seat, sight and bomb fields. |
| `bombsight.ts` | The bombsight's drift, each target's release radius (from the sim's blast), the release solution. The impact is the sim's `predictBombImpact`. |
| `testing/crewMissions.ts` | Fixtures: a Bristol fight at a chosen seat, a D.H.4 bomb run (until track D's raid builder). |
| `stubs/` | `sim`/`campaign` stand-ins used by unit tests (no stub is bound in the game any more). |

The height cache refreshes recency on sampling and prefetch. Linked entries avoid
allocation or Map reinsertion on hits; consecutive samples in the newest tile skip
the Map lookup. Evicted entries and sample arrays are recycled through one detached
spare (600 cached tiles plus one spare in ordinary use). A miss publishes only after
sampling finishes, so callback failures cannot corrupt completed tiles. Nested
sampling may temporarily need extra buffers. Switching tiles on every hit pays for
recency updates; the newest-tile fast path favours clustered flight queries.

## Loop

```
per rAF frame (dt clamped to 0.1 s):
  input.enabled = !hud.menuOpen          (HUD cards own the keyboard)
  input.update -> edge commands (views, seats, time, wingmen, pause...)
  PlayerCrew.pilotControls -> player.controls (pilot's seat only; not on the hand-back frame)
  at a crew station: the gun's aim and buttons instead (PlayerCrew.applyInput)
  threats.update (hits, silent damage, enemy rounds within 40 m)
  if time compression > 1 and compressionBlock(): drop to x1 (see Time compression)
  accumulator += dt * timeScale; while accumulator >= 1/120:   (SimCore.step)
      PlayerCrew.beforeStep: stationInputs (or the pilot's bomb release) for this step
      world.time += h; spawn due flights
      every 4th step (30 Hz): ai.update(ac, world, 4h) for AI aircraft
      sim.stepFlight(ac, env, realism, h)   (skip wrecks on the ground)
      landing detection (was airborne, on ground, < 2 m/s) -> landed-friendly/enemy
      combat.update(world, h)
      director.update(h)
      player lost or mission over at a station: back to the pilot's seat, AI pilot released
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
`modules.setGunnerTarget`, except at the station the player works (below).

## Crew stations

Bombers wave 1 (docs/bombers.md, D-086 contracts). Every aircraft has crew stations,
pilot first (`crewStations(spec)` in `src/data/crew.ts`); the player can take any of them.

- **Keys.** `stationNext` C and `stationPrev` V cycle the stations, `stationPilot` F goes
  straight back to the pilot's seat, `viewBombsight` F6 takes the bomb aimer's seat and
  looks through the sight (again: back to his gun), `releaseBomb` R releases. The starting
  seat is `MissionFlightMember.station` of the player (the autoplayer ignores it).
- **Who flies** (D-090). At any station but the pilot's, `SimCore.setPlayerStation` gives the
  player's aircraft an AI controller on the flight's own task, as the autoplayer does. It
  sees the route from the player's next waypoint on (a `WorldQuery` view whose `getFlight`
  returns the trimmed route), so a pilot taking over mid-mission doesn't turn back for
  waypoints already flown; a recalled flight's new pilot heads home. The HUD's next
  waypoint moves on within 1.5 km, so on the run-in it can lie past the target: the pilot
  never skips a bomb or attack waypoint whose work isn't done (targets left, or bombs
  aboard for a bomb run) and picks up at the first of those (`pilotPickupWaypoint`). The
  aircraft keeps `controller: 'player'`: combat's invulnerability, the AI's collision rules
  for the human (the AI flying it splits the other way, `splitSide`), the HUD and the
  director still find him. The session stops copying input into `controls`. Back at the
  pilot's seat the AI is dropped and released (`releaseAIPilot`), the gunner's target is
  reset to automatic, and `InputManager.syncTo` takes the throttle and mouse stick from
  where the AI left them, re-centres the mouse-aim point on the nose and starts a fresh
  instructor. That frame's input was built at the gun, so `PlayerCrew.pilotControls` skips
  it and the controls stay where the AI left them: no jolt. When the aircraft is lost or
  the mission ends at a station, SimCore does the same hand-back (no station inputs, no AI
  pilot) and PlayerCrew follows it.
- **Station inputs.** Before each sim step `PlayerCrew.beforeStep` writes
  `AircraftEntity.stationInputs` in place: `aim` is the gun's body-frame aim turned into a
  world direction by that step's orientation, and `fire` is held. `clearJam` is true for
  the frame's first step only (combat consumes the press). `releaseBomb` is a held input
  (lead decision): true while R is down, never pulsed or cleared by the game; the sim drops
  one bomb per false-to-true edge, and refuses on the ground or with the bomb aimer dead. A
  pilot who aims his own bombs releases through `controls.releaseBomb`, held the same way;
  in any other pilot's seat the game holds it false, and R says who aims. A key held
  across a seat change is ignored until released, so it can't drop a bomb at the new seat.
  A tap quicker than a frame (the press arrives as a command, the key already reads up)
  holds the flag until a sim step has seen it.
- **Aim** (D-091). In `InputManager.stationMode` the mouse (0.0022 rad per pixel, as
  mouse-aim), the flight keys and the left stick (60°/s) swing the gun; left button, the
  fire key and RT fire; the right button (or the mouse with mouse mode off) drags the view,
  which stays off the gun until the gun swings or F1 re-centres it. The aim is held in the body frame
  (the gun turns with the airframe) and clamped to the station's arcs: an aim outside is
  pulled to the nearest point of the union of arc boxes, by angle on the sphere, so pushing
  past an edge slides along it. `StationAim.limited` marks the HUD edge red.
- **Views.** `gunner`: the camera at the station's eye (`AircraftVisual.stationEyes`, else
  `stationEye(spec, station)`), looking along the gun; snap-look keys turn the head away
  while held; F1 at a gun is this view (again: re-centre the head), and padlock works from
  the station's eye. `bombsight`: wings-level and heading-up, looking down the sight line
  to the sim's predicted impact (`predictBombImpact`, D-092), with the player's own
  aircraft hidden. The release cue shows while the impact lies within the target's release
  radius: where the sim's `blastDamage` falls to 0.25 for the next store's charge, plus the
  half-width of the target's narrower side (`releaseRadiusM`; about 19 m for a lorry and
  12 m for a battery under a 20 kg charge). F6 on a type whose pilot aims goes to the
  pilot's seat and his sight. External views are unchanged. The
  3D cockpit (pilot hidden) shows only from the pilot's seat.
- **Bombs.** A flight tasked to bomb, or the player's flight on a bombing raid, starts with
  its full load (the sim's `loadBombs`). Every aircraft of a type that can carry bombs is
  trimmed at `effectiveMass`, so a D.H.4 flying without its load starts lighter.
  `MissionResult` `bombsDropped` / `bombHits` are `getBombStats(player)` (a hit is a
  bomb that damaged an enemy ground target), only for a sortie that carried bombs.
- **Flight report.** On a type with more than one station, `FlightTelemetry.stationTimeS`
  (and the report's `outcome.stationTimeS`) gives the mission seconds spent at each.

## HUD wiring

The session builds the UI's `HudView` directly (no adapter layer):

- **Target box**: the padlocked entity, else the one selected with T, else
  the nearest live enemy aircraft within 2.5 km that the player could know
  about (below). Lead point is drawn only on the relaxed flight model (HUD rule).
- **Threat ring**: enemies within 3 km that the player could know about;
  `danger` when behind, closing and under 800 m.
- **What the player could know** (`PlayerAwareness`, `src/game/playerAwareness.ts`):
  an enemy a human could see (4 km, shortened by sun glare and cloud, as the AI's
  perception), one shooting at the player within 900 m, or one that hit the player,
  within the last 8 s. An enemy diving out of the sun or hiding in cloud gets no
  triangle and no auto box. Padlock and a T-selected target are not filtered.
- **Sun glare** (`HudView.sunGlare`): a wash-out 15° around the sun, full in the
  core 5°, fading with low sun and gone when cloud covers it, so an enemy close to
  the sun is hard to see on screen too.
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
  judged only at the end (`survive`, `protect-balloons` success). An escort
  (`protect-flight`) only counts at the end if its charges have been out over
  the lines, so a player lost on the way out doesn't earn it. The rules
  for each kind are in docs/campaign.md. When every primary objective is
  decided, the radio says so. If the job was tied to other aircraft or
  balloons (escort, intercept, balloon defence) and no enemy is within 4 km,
  the director's `onRecall` hook fires. `SimCore` then orders the player's
  wingmen home, and the player too when the player is AI-flown.
- `MissionResult.acesDown` lists every historical ace lost in the fight
  (either side, whoever brought him down); the campaign retires killed and
  captured ones from the career.

## Time compression

x1/x2/x4/x8 (`TIME_SCALES`). `compressionBlock` (`timeCompression.ts`) refuses
it, or drops it to x1 with a HUD message, when:
- an enemy aircraft is within 4 km (`COMPRESSION_SAFE_RANGE`);
- the player was threatened in the last 8 s (`ThreatWatch`): hit, damaged
  without an event (trench small-arms fire), a flak burst within 200 m, or an
  enemy round passing within 40 m;
- the player is below 300 m AGL over enemy-held ground, or near a live enemy
  ground target (2.5 km; AA guns 4 km).

## G-effects

`stepGEffect` (`gEffect.ts`) builds grey-out a g below the pilot's sustained
tolerance (sim `pilotGTolerance`: 5.5 g fit, down to 2.5 g badly wounded), so a
fit pilot greys from 4.5 g and a wounded one sooner. Red-out starts at -1.5 g,
scaled by the same ratio.

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
- **Cockpit view:** the head leads toward the aim point by at most ±25° yaw,
  +12° / −10° pitch (`aimHeadLead`, `cameras.ts`), eased at 4/s, so the nose,
  struts and horizon stay in view in hard manoeuvres. Free-look, snap views and
  padlock keep the full neck range. When the aim point leaves the view the HUD
  pins its ring to the screen edge (`pinToEdge`, `hudView.ts`).
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
`timeScale`, `paused`, `cameraMode`, `station` (the player's crew station), `player`, `world`, `frames`, `samplePixels()` (reads
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
  - `crew.spec.ts`: Bristol seat switch (C, keyboard aim, the arc limit, F hands back with
    the throttle unchanged, V, F1 at a gun), a mission starting at the gun, and a D.H.4 bomb
    run (R from the pilot's seat, F6 to the bombsight and back). Screenshots in
    `test-results/crew/`.
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

- `playerLossCause` (`LossCauseTracker`, `lossCause.ts`) classifies what took the player out:
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
- `pilot: 'human'` (or `AUTOPLAY_PILOT=human` in the environment, which every soak
  and the replay honour) keeps the AI player's tactics but aims and fires like a
  mouse-aim human: aim lag, reaction delay, drifting bias and jitter, long bursts
  (`src/ai/humanAim.ts`; docs/ai.md "Human-like pursuer"). `AUTOPLAY_HUMAN=
  aimLagS=0.4,biasDeg=1,...` overrides single parameters for calibration sweeps.
  The report's `aim` holds the player's gunnery (`aimStats.ts`, as in the flight
  report) and `humanPilot` says which pilot flew.
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
  Quick Mission screen's default (`QUICK_DEFAULTS`, src/data/quickDefaults.ts);
  `AUTOPLAY_QUICK_SETUPS=default,camel,dvii` and
  `AUTOPLAY_QUICK_TYPES=dogfight,ground-attack` select setups and types, and
  `AUTOPLAY_QUICK_BY_SETUP=1` summarises per setup as well as per type. The output ends with a per-type
  table: contact %, median contact time, success %, kills per mission,
  returned/killed/captured/wounded %, timeouts. ~110 missions take ~10 min.
  Note the AI player is a `veteran`; its death rate is an upper bound on a
  careful human's, not a target to drive to zero.

## Flight report

`FlightRecorder` (`flightRecorder.ts`) rides along on every flight and fills
`MissionResult.telemetry` (`FlightTelemetry` in `src/core/types.ts`) when the
flight ends. The debrief turns it into the flight report (see docs/PLAYTEST.md
"Human playtests"). It is headless: `FlightSession` feeds it `afterStep()` after
every sim step and `frame(dtReal, timeScale)` every rendered frame, and a test
can wrap any `SimCore` (`src/game/testing/recordedFlight.ts`).

- **Hits taken:** `bullet-hit` events on the player.
- **Loss cause:** the autoplayer's rules (`LossCauseTracker`).
- **Combat time:** mission seconds with the player alive and an enemy within
  1.5 km, sampled at 10 Hz.
- **Each enemy's first pass:** `EntryTracker` (`src/ai/entryStats.ts`, the same
  geometry as the gunnery soak). Height advantage when he closed inside 600 m,
  from above (100 m or more), up-sun (within 15° of the sun seen from his
  target), and whether his target knew about him. For the player that is the
  HUD's `PlayerAwareness`: the same "could a human know?" model that gates the
  threat triangles.
- **Time compression:** real and mission seconds above 1x, and the highest
  factor.
- **Frame rate:** a 0.5 ms histogram of unclamped frame times. `p50` is the
  median, and `p95` is the rate at the 95th-percentile frame time (the slow end).
- **Gunnery** (`aim`, `aimStats.ts`; the autoplayer records the same): rounds and
  hits split into the player's and the AI crew's, since `outcome.hits` also counts a
  two-seater's AI-aimed rear gun. A gun is the player's when it belongs to the
  station he is at (`stationInputs.station`, the pilot's by default; `bullet-hit`
  carries `mountIndex`, and `stationForGun` in `src/data/crew.ts` maps it). While
  his fixed guns fire, seconds by angle from the gun line to the true lead of the
  enemy nearest it inside 400 m and 30° (1° buckets to 20°); while any of his guns
  fire, seconds by range to the target nearest the gun line (50 m buckets to 1 km).
  Each time an enemy inside 400 m comes within 10° of the gun line's lead, the
  seconds to his first fixed-gun shot. This is what the autoplayer's human-like
  pilot is fitted to (docs/ai.md "Human-like pursuer").

A recorder failure is logged and the debrief goes on without telemetry.

**Replay.** `src/game/replay.soak.test.ts` (skipped unless `REPLAY=<report.json>`;
wrapped by `node tools/playtest/replay-report.mjs <report.json>`) flies a report's
mission with `runAutoplay` at the report's realism, `REPLAY_REPS` times (default
8). It prints one line per run and a `fairnessLine` row (`autoplaySummary.ts`,
shared with the fairness soak). Run 0 uses `headlessModules`, the game's own seeds,
and repeats exactly: a headless flight is deterministic. Runs 1 and up use
`seededHeadlessModules(n)`, which reseeds combat's chance draws and each AI
controller. `runAutoplay` takes `modules` for this. `--browser` launches the
mission in a running dev server through `window.__rb2.services.launcher.fly`.


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
  GLB or worker, the lazy flight chunk not loading, or a blank frame.
- Check the deployed site the same way: `pnpm prodcheck https://chrisvaillancourt.github.io/red-baron-2-reloaded/`.
  Every run uses a fresh browser context, so it measures a cold-cache first load.
