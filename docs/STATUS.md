# Project status — paused 2026-09-24

The game is playable end to end: `pnpm dev`, then open http://localhost:5173.
Career (all four nations, 1915–1918), quick missions, the full flight/combat
sim, AI, streamed Western Front terrain, Blender-built aircraft and procedural
audio are all integrated on `main`.

Verified at pause: `pnpm typecheck` clean, `pnpm test` 240 passed (13
env-gated soak tests skipped), `pnpm e2e` 6/6, `pnpm build` OK.

## How it was built
Parallel agents in git worktrees, one subsystem each, merged by the lead.
Rationale for every significant choice is in `DECISIONS.md` (D-001..D-046);
module docs are in `docs/*.md`.

## Next steps (disposition for each item)

**Do — gameplay balance (highest value)**
- Quick ground-attack and balloon-attack missions are too deadly: tune the
  trench ground-fire kill chance (`src/sim/combat.ts`) and the AI's pull-up
  after a strafing run (`src/ai/controller.ts`). Re-run
  `AUTOPLAY=quick AUTOPLAY_MISSIONS=5` to confirm.
- Patrol success depends on reaching waypoint 2, which fights often
  prevent. Make the patrol objective count time on station or enemies engaged.
- Escorts whose charges are all shot down loiter until the time limit. End
  the escort (fail) and send the flight home.
- Contact still takes ~3.5 min of sim time. Consider starting career flights
  closer to the lines.

**Done (wave 4) — flight and HUD**
- HUD centre declutter (`src/ui/hud/declutter.ts`; DECISIONS "HUD declutter by priority"): the waypoint fades
  in combat and hides under the target box, and its name and distance ride
  the heading tape. The aim ring merges with the nose/reticle when aligned.
  Threat triangles skip enemies already on screen.
- Tracers (DECISIONS "Tracer streaks use eye persistence") are streaks with eye persistence re-projected through the
  camera: rounds smear into a hosepipe as you turn. There are screen-space
  caps for rounds flying straight away, and premultiplied blending keeps them
  visible against bright cloud.
- Fokker E.III (DECISIONS "Fokker E.III handling left as is"): three candidate fixes were measured on a multi-start
  benchmark (`MOUSEAIM_SEEDS`/`MOUSEAIM_PAIRS`) and none beat the current
  handling. The data is unchanged. It is flyable (vs Nieuport 11 at standard:
  5/6 kills, 56% on target) and loses turning fights to the D.H.2, as it
  historically did.

**Do — flight and HUD (remaining)**
- Mouse-aim roll dithers on slow-rolling types (E.III bank ±20° while the aim
  error is 3–7°). The fix belongs in the aim mode of `src/ai/autopilot.ts`:
  bank demand for small errors is about 30° for a 5° error. An
  instructor-side rudder blend was tried and made things worse (see the E.III decision).
- The instructor's `caution` presets pass the AI's skill value as
  `diveCaution`, which *lowers* the stall margin (relaxed gets the ace's 1.0°).
  Split the stall margin from the dive governor in the autopilot, then
  retune `INSTRUCTOR`.

**Do — visuals**
- Produce the showcase set `docs/screenshots/game-*.png` (dogfight, balloon
  flaming, strafing, dawn patrol, above the clouds).
- Critique low-altitude trenches and wire in real flights, and measure
  16-aircraft and 'low'-preset frame budgets.
- Move the crater grid (~0.5 s per date, main thread) into a worker.

**Done (wave 4) — menus**
- At 1280×720 and 1366×768 the Quick Mission and enlistment screens now fit.
  The squadron and ace lists scroll inside their own boxes, and the
  difficulty picker is pinned. The HQ machine cards fit too.
- Briefing objectives now come before the dossier text, and briefing-map
  waypoint tags avoid each other and the circles (`src/ui/map/labels.ts`).
- `dev/walk-menus.mjs` now reports every scrolling panel per screen
  (`OVERFLOW …`). The remaining overflows are long lists and documents that
  scroll within their own panel by design: aces, key bindings, the controls
  reference, the logbook, standings, and the briefing text.
- Gamepad: the mapping is a pure function (`readGamepad`) with virtual-pad
  tests (`src/game/gamepad.test.ts`). A controller connect/disconnect toast
  shows in menus and in flight, and the Flying School card shows gamepad
  button glyphs when a pad is connected. It is still untested on a physical
  device (see Defer).

**Defer**
- Gamepad support is implemented but untested on a real device. Test when one
  is available.
- AI doesn't use the sun or clouds, and aces make little use of the vertical.
  This is a depth improvement, not a bug.
- Squadron mates are regenerated each quarter rather than persisted.

**Skip**
- Remotion or any video pipeline. Not needed for the game.

## Housekeeping
- Agent worktrees remain under `.claude/worktrees/` (gitignored), and all
  their branches are merged. Remove them with
  `git worktree list` → `git worktree remove <path>`, then
  `git branch -d worktree-agent-*`.
- E2E needs a free port: `E2E_PORT=5241 pnpm e2e` if 5199 is taken by a dev
  server.
