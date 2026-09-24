# Architecture

```
src/
  core/        Shared contracts (types, interfaces, events, geo, settings). Lead-owned.
  data/        Static historical data: aircraft, aerodromes (lead), squadrons/aces/medals/ranks (campaign),
               geography/front lines (world).
  sim/         Flight model (6-DOF rigid body), weapons, ballistics, damage, collisions, flak. Pure TS.
  ai/          AI pilots: dogfighting, formation, escort, two-seater gunners, wingman orders. Pure TS.
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

## Contracts

* `src/core/types.ts` — data types (AircraftSpec, entities, MissionDefinition, MissionResult, GameEvent, settings).
* `src/core/interfaces.ts` — module interfaces (SimModule, CombatSystem, AIController, WorldRenderer,
  AircraftVisual, AudioEngine, CampaignService, FlightLauncher, GameServices).
* `src/core/campaignTypes.ts` — career data (CareerPilot, SquadronInfo, DebriefReport, QuickMissionOptions).

## Commands

* `pnpm dev` — play at http://localhost:5173
* `pnpm test` — unit tests; `pnpm typecheck`; `pnpm build`
* `pnpm e2e` — Playwright smoke tests (after integration)
* `blender --background --factory-startup --python tools/blender/build_models.py` — regenerate models
