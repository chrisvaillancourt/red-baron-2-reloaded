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

**Done (wave 5) — AI and sim survivability** (docs/ai.md "Wave 5"; DECISIONS ai-sim wave 5)
- Stall overshoot fixed at the root: the pitch law settles on the tail's AoA, and
  slipstream made the wing overshoot. The AI and the sim's relaxed caps now divide
  by `tailPressureRatio`. Low-level survey: stalled time 1,880 → ~590 s, ground
  impacts 19 → 5, recovery share of engage time ~11.5% → ~4–5%.
- Low-level defence: energy-aware g, faster recovery, level breaks and deck
  extensions below 350 m (scissors measured worse and were dropped).
- Wounds before deaths: a softer pilot-kill roll, wounds degrade pull, roll and aim,
  wider target spreading, and wreck avoidance. Veteran career deaths 31% → 18%.
- Strafers: pass and ammo limits, leaving when scouts close, energy floors, and
  RTB flights that fight back. Quick ground attack returned 13% → 25%.

Remaining:
- **Done (wave 6):** defended quick ground attacks. The defenders now scramble low in
  staggered elements; see "Balance — wave 6".
- **Defer:** quick dogfight survey setups (D.VII against two veteran SPADs)
  are hard by construction (~75% killed); not a bug.
- **Done (wave 6):** career collisions. Head-on break and separation; see "Balance —
  wave 6".

**Balance — wave 6**
- **Done:**
  - Quick ground attack: the defenders scramble low in two staggered elements, and
    strafers leave the flak gun until last. The screen default went from 38% to 100%
    success, and killed-or-captured from 21% to 13% (docs/ai.md "Wave 6").
  - Collisions: early head-on break, and a wider berth for the player and for flight-mates
    chasing the same target. Career collisions per 100 missions fell from 8.5 to 3.5, and
    player losses to collision from 2.5% to 1.0%.
  - Career-awards e2e (`tests/e2e/career-awards.spec.ts`): through the real campaign it
    shows the report, newspaper ("NEW ACE…"), promotion (Leutnant → Oberleutnant) and
    Iron Cross, and HQ shows the victories.
  - Autoplayer: logs every collision, has setup and type filters and seed offsets, and no
    longer counts a shot-up airframe that fails later as a flak loss.
- **Defer:** the Quick Mission default dogfight is lopsided in the player's favour. Player
  down is 4%, against a 40–55% target. Mirror matchups are fair, so this is the matchup,
  not skill scaling: the AI rarely hits a hard-turning Camel. Next step, in two parts:
  improve AI gunnery against high-turn-rate targets (src/ai), and/or change the screen's
  default enemy type (src/ui). Measure with `AI_SOAK=fairness AI_FAIR_SET=default,mirror`.
- **Defer:** quick ground attack against *veteran* defenders is still 63% killed or
  captured. The difficulty is chosen by the player; revisit only if players complain.
- **Defer:** the career killed-or-captured rate is ~25% for the veteran autoplayer
  (patrol 35%, free hunt 35%). Enemy fire, not collisions, is now the cause. This is an
  upper bound for a careful human (see docs/game.md).
- **Do (game owner):** wire `pilotGTolerance` into `FlightSession.updateGEffect` (from
  wave 5; not done here).

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

**Done (wave 5) — flight and HUD**
- Mouse-aim fine aim: within 10° the lateral demand is softened and the rudder
  takes up the rest. E.III bank rate near the aim ~20 → ~14°/s
  (`aimDither.realsim.test.ts`).
- `Autopilot.stallMarginDeg` is split from `diveCaution`. `INSTRUCTOR` margins are relaxed
  3.2°, standard 1.8°, authentic 1.3°; relaxed never stalls a Camel/D.V in a max
  turn (`instructorMargin.realsim.test.ts`).
- `pilotGTolerance(ac)` (src/sim) is exported for a wound-aware grey-out.

**Do — flight and HUD (remaining)**
- Wire `pilotGTolerance` into `FlightSession.updateGEffect` (src/game, fixed 4.5 g
  onset today) so a wounded player greys out sooner. It returns 5.5 g unwounded, so
  use `pilotGTolerance(p) - 1` to keep today's onset.
- E.III still rocks a little near the aim (~14°/s bank activity); acceptable,
  revisit only if playtests complain.

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
