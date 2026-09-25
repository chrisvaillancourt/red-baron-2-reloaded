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

**Do — flight and HUD**
- The HUD centre is crowded at mission start (waypoint, aim marker and target
  box overlap).
- The player's own tracers read as dots from the cockpit. Consider a
  short-streak shader.
- The Fokker E.III is hard to hold on target in turning fights. Review its
  pitch authority.

**Do — visuals**
- Produce the showcase set `docs/screenshots/game-*.png` (dogfight, balloon
  flaming, strafing, dawn patrol, above the clouds).
- Critique low-altitude trenches and wire in real flights, and measure
  16-aircraft and 'low'-preset frame budgets.
- Move the crater grid (~0.5 s per date, main thread) into a worker.

**Do — menus**
- At 720p the Quick Mission side panels and the enlistment difficulty picker
  need scrolling. Tighten the layout.

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
