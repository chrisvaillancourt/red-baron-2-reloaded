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

**Visuals — done (wave 4)**
- Showcase set `docs/screenshots/game-*.png` (7 shots) is in the README gallery.
  Regenerate with `Q=ultra node src/render/dev/playShots.mjs <out> <port> sc-dogfight sc-balloon sc-trench sc-dawn sc-clouds sc-burning sc-aero`.
- Low-level pass: craters are ragged and shallower, with murky water only in
  fresh ground. Communication trenches are continuous. The mown aerodrome
  grass no longer aliases.
- Frame budgets were measured with 16 aircraft (see `docs/world.md`): 'low' ≈ 2 ms
  p50, 'high' ≈ 3.5 ms, 'ultra' ≈ 4 ms uncapped, and a locked 60 fps with vsync.
- The crater grid is built in a worker at load, and `whenReady` waits for it.

**Defer — visuals**
- Dusk and dawn light is correct but muted: low sun lights the ground weakly.
  Revisit if players want more golden-hour drama.
- Openfield strips read busy from 700–1500 m. Consider lowering the
  per-field contrast at distance if playtesters notice.
- Fire trails on burning aircraft run long (40–60 m of flame). Shorten them if
  it reads as arcade.

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
