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
  accumulator += dt * timeScale; while accumulator >= 1/120:
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
  below. "Abandon mission" always works (captured if over enemy lines).

## Mouse-aim

`mouseAimControls(ac, aimDir, state, dt, out)` steers toward a world
direction: banks the lift vector toward the aim point, pulls, levels the
wings when the aim is within a few degrees, adds rudder, and refuses to dive
into the ground below 120 m. Damping uses error derivatives so it doesn't
depend on the sim's angular-velocity sign convention. Keyboard or gamepad
input overrides it and re-syncs the aim to the nose.

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
`endFlight()` and `abandon()`.

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
  Screenshots land in `test-results/`.
