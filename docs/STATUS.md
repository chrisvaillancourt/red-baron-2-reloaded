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

**Gameplay balance — wave 4 (BALANCE) status**

Done (DECISIONS "Patrols are judged on time on station…", "Contact within
about two minutes…", "Low-level attack runs keep their energy…", "Rear gunners
are less accurate"):
- **Patrols:** `patrol-area` objective, met by time on station or by engaging
  the enemy. Patrol success is 100% (was 48%).
- **Early outcomes:**
  - Escorts fail as soon as too few charges are left.
  - Intercepts fail when their targets escape.
  - Escorts complete once the charges are home.
  - When the job is settled and no enemy is near, the flight is recalled home.
- **Contact:** career contact median is about 2 min (was 3.5–7).
- **Attack runs:**
  - Balloon runs no longer fly into the envelope or stall in the pull-out.
  - Strafing re-attacks keep their energy.
  - Defenders scramble from low altitude instead of waiting above.
- **Two-seater gunners:** less accurate, which fixed intercepts.
- **Autoplayer:**
  - Reports a cause for every player loss.
  - Seeded quick repetitions (`AUTOPLAY_QUICK_REPS`) and `AUTOPLAY_DIFFICULTY`.
  - A passive-recruit regression test.

Remaining:
- **Do:** defended quick ground attacks now succeed (100%), but the
  autoplayer still dies in about 88% of them. The defending scouts arrive after
  the strafing and win the low-level fight that follows (the player's flight is
  slow and low). Look at the AI's low-altitude defensive manoeuvres and energy in
  turning fights; the dogfight AI also spends 2–11% of engage time in stall
  recovery. A "run home when outnumbered low" rule was tried and made things
  worse.
- **Do:** career patrol deaths vary from 25% to 50% by run for the veteran
  autoplayer, often with the player killed early by the pilot-hit roll.
  Consider softening the per-round pilot-kill chance (`src/sim/combat.ts`
  pilot case) or enemy focus on flight leaders.
- **Defer:** quick dogfight survey setups (D.VII against two veteran SPADs)
  are hard by construction; not a bug.

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
