# Game layer (`src/game`)

The glue: app bootstrap, the in-flight loop, input, cameras, the mission
director, and in-flight overlays. Everything else is reached through one
composition point.

## Files

| File | Role |
|---|---|
| `modules.ts` | **Composition point.** Binds every subsystem factory (`GameModules`). |
| `moduleTypes.ts` | `GameModules` factory signatures, `AIControllerOptions`, `HudHandle`, `UiHandle`. |
| `app.ts` | `startApp(root, modules)`: settings, `GameServices`, audio unlock on first gesture, UI mount, `showFatalError`. |
| `flightSession.ts` | `createFlightLauncher(modules, audio)` → `FlightLauncher.fly`. The loop. |
| `world.ts` | `buildWorld`: entities from a `MissionDefinition` (formation offsets, ground starts, spawn delays), `WorldQuery`. |
| `missionDirector.ts` | Objectives, kill credit → `VictoryClaim`, radio chatter, end conditions, `MissionResult`. |
| `input.ts` | Keyboard (rebindable actions), mouse (direct stick / mouse-aim instructor), gamepad. |
| `cameras.ts` | Cockpit (head look, snap views), chase, padlock, fly-by, target, orbit. |
| `hudView.ts` | `HudFrame` (per-frame HUD data) and `buildHudFrame`. |
| `overlays.ts` | Pause menu (resume / end flight / abandon) and tactical map (M). |
| `stubs/` | Placeholder implementations of every subsystem. |

## Loop

```
per rAF frame (dt clamped to 0.1 s):
  input.update -> player.controls, edge commands (views, time, wingmen, pause...)
  if time compression > 1 and an enemy is within 4 km: drop to x1
  accumulator += dt * timeScale; while accumulator >= 1/120:
      world.time += h; spawn due flights
      every 4th step (30 Hz): ai.update(ac, world, 4h) for AI aircraft
      sim.stepFlight(ac, env, realism, h)   (skip wrecks on the ground)
      landing detection (was airborne, on ground, < 2 m/s) -> landed-friendly/enemy
      combat.update(world, h)
      director.update(h)
  visuals.update, camera rig, renderer.update/render, audio.updateFlight, hud.update(HudFrame)
  director.ended -> build MissionResult, teardown, resolve
```

Events go through one `EventBus` per session; `onAny` fans out to
`renderer.handleEvent`, `audio.handleEvent` and radio messages to the HUD.
The director emits `aircraft-destroyed` itself for outcome changes not
already reported by combat (e.g. crashes into the ground), so kills are
counted exactly once.

`controls.clearJam` is an edge: the session clears it after the first sim
step of the frame. Flexible (rear) guns are driven by the AI via
`modules.setGunnerTarget`.

## Kill credit and fates

- Credit goes to `killerId`, else `victim.damage.lastAttackerId`.
- **Witnessed** if the kill is over the player's own lines or a live
  friendly aircraft is within 3 km. **Shared** if another friendly also hit
  the victim. Ground targets are objectives, not victory claims.
- Enemy aircraft forced down on your side (`landed-enemy`) count as lost.
- Player fate: killed (pilot killed, fire, structural failure, collision,
  impact > 45 m/s), captured (down or landed behind enemy lines, abandoning
  over enemy lines), wounded, landed-elsewhere (> 2.5 km from home), returned.
- "End flight" (N or pause menu) needs no enemy within 5 km **and** friendly
  ground below. "Abandon mission" always works (captured if over enemy lines).

## Mouse-aim

`mouseAimControls(ac, aimDir, state, dt, out)` steers toward a world
direction: banks the lift vector toward the aim point, pulls, levels the
wings when the aim is within a few degrees, adds rudder, and refuses to dive
into the ground below 120 m. Damping uses error derivatives so it doesn't
depend on the sim's angular-velocity sign convention. Keyboard or gamepad
input overrides it and re-syncs the aim to the nose. The stub AI reuses it.

## Swapping stubs

Edit only `modules.ts`. Expected real exports (adapt names if the module
chose different ones):

| Entry | Real module |
|---|---|
| `sim`, `createFlightEnvironment`, `createCombatSystem`, `setGunnerTarget` | `src/sim` (`sim`, `createFlightEnvironment` from `atmosphere.ts`, `createCombatSystem(bus, getRealism)`, `setGunnerTarget(ac, id \| null)`) |
| `createWorldRenderer` | `src/render/worldRenderer.ts` `createWorldRenderer(canvas, { quality, date })` |
| `createAircraftVisual`, `preloadAircraftModels` | `src/render/aircraft` |
| `createAIController` | `src/ai` `createAIController(ac, opts: AIControllerOptions)` |
| `createAudioEngine` | `src/audio` |
| `createCampaignService` | `src/campaign` |
| `createUi` | `src/ui` `createUi(root, services)`; must return `{ dispose() }` |
| `createHud` | `src/ui` HUD, wrapped so it takes `HudFrame` (see below) |
| `terrainHeightAt`, `sideOfFrontAt` | `src/world` (already real imports) |

If the UI's HUD consumes its own `HudView` type, wrap it in `modules.ts`:

```ts
createHud: (el, settings) => {
  const hud = createUiHud(el, settings);
  return {
    update: (f) => hud.update(toHudView(f)),
    showMessage: (t, from) => hud.showMessage(t, from),
    setVisible: (v) => hud.setVisible(v),
    dispose: () => hud.dispose(),
  };
},
```

## Debug hook and tests

`window.__rb2 = { services, session }`. `session` exposes `time`,
`timeScale`, `player`, `world`, `frames`, `samplePixels()` (reads back the
WebGL drawing buffer right after a render), `command(action)`,
`endFlight()` and `abandon()`.

- `pnpm test`: `missionDirector.test.ts` (claims, witnesses, objectives,
  fates, end flight) and `input.test.ts` (bindings, shaping, mouse-aim).
- `pnpm e2e`: `tests/e2e/smoke.spec.ts` boots the app, launches a quick
  mission through `services.launcher` (independent of the UI), flies 10 s,
  checks the frame isn't blank and there are no console errors, and checks the
  MissionResult. Screenshots land in `test-results/`. Uses the installed
  Google Chrome (`PW_CHANNEL=chromium` to use Playwright's own browser).
