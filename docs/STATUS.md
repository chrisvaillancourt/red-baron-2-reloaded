# Project status — release candidate, 2026-09-28

The game is playable end to end: `pnpm dev`, then open http://localhost:5173
(README "Your first flight" walks a new player through it). Career (all four
nations, 1915–1918), quick missions, the full flight/combat sim, AI, streamed
Western Front terrain, 27 Blender-built aircraft and procedural audio are all
integrated on `main`.

The wave-7 release check (docs/PLAYTEST.md, top section) gave a **GO**: a fan
can play for an evening without hitting a blocker. Everything still open below
is minor or polish, and each item carries a disposition.

Verified on `main` after the wave-9 merges: `npx tsc --noEmit` clean, `pnpm test`
362 passed (23 env-gated soak tests skipped), `pnpm e2e` 17 passed (1 gated
soak skipped). The deploy passed on the pinned `ubuntu-24.04` runner, and
`pnpm prodcheck` passed on the live URL.

## Current figures (wave 9 re-baseline, 2026-09-28, commit f84cb16)
These are the numbers to quote. They come from the veteran autoplayer, not humans; the
commands and full tables are in docs/ai.md ("Wave 9 re-baseline").
- **Default quick dogfight** (Camel+1 v 2 veteran D.VII, D-078): 28% player down, 96 runs; 30%
  with clear head-on starts (D-082), within noise.
- **Mirror fights** (48 runs each), player down: Camel 38%, D.V 52%, Dr.I 44%, SPAD XIII 31%,
  D.VII 23%.
- **Quick defaults by type** (24 runs each), success / killed / captured:
  - dogfight 83 / 8 / 4%
  - balloon attack 100 / 42 / 0%
  - escort 92 / 4 / 8%
  - intercept 88 / 17 / 0%
  - ground attack 92 / 17 / 0%
- **Veteran career** (3 seed sets, 245 missions): 21.6% killed or captured. There were
  1.6 collisions per 100 missions, counting every collision event, and none involved the
  player.
- **Ambush entries** where stalking can apply (14 runs each): veteran 57%, ace 62%,
  stalker ace 100% (all unseen). Unchanged from wave 8.
- **Cloud refuge** (6 seeds): a wounded pilot takes 28 hits with refuge against 195 without.

## Next up (priority order, 2026-09-28)
1. **Do: human playtest** on `pnpm dev`, 5–10 missions (one done, see 4). Every other
   figure comes from the autoplayer. Each flight's report saves itself to the git-ignored
   `playtests/inbox/` (D-084); rating it and adding a note on the debrief is optional. On
   the live URL, press **Copy flight report** and paste it into the chat instead (D-083).
   Look at:
   - whether the new default fight (2 veteran D.VIIs, D-078) is too hard
   - whether default balloon attacks feel punishing
   - whether sun attacks feel fair
   - whether a dive into cloud shakes a pursuer (D-081)
   The lead then replays each report (`node tools/playtest/replay-report.mjs <file>`) and
   turns the fights that felt wrong into seeded scenes or tests.
2. **Done (wave 9, D-078): the default quick fight** is now 2 veteran D.VIIs, at 28% player
   down over 96 runs (was 4% against D.Vs). Every other quick type got harder too, balloon
   attacks most of all (31% killed). See docs/ai.md "Wave 9".
   - **Defer:** first-visit enemy skill that depends on the mission type. Do it if
     playtests find default balloon attacks or escorts punishing.
   - **Skip:** tuning the D.V's dive limit or drag. The default no longer depends on it.
3. **Done: cloud cuts hits, not just sight** (D-081).
   A contrast limit on in-cloud sight, no blind pursuit or fire while cloud hides the
   target, and a refuge that circles the core for 25–40 s. A wounded pilot takes 28 hits
   with refuge against 195 without (was 196 against 213; `cloudEscape.realsim.test.ts`).
   **Check** in the human playtest that a player who dives into cloud shakes a pursuer.
4. **Done (wave 9, D-085, D-XXX "Human-like pursuer"): enemies with you on their tail.**
   This answers the first playtest report ("they just fly in circles"). Every design was
   measured against the veteran autoplayer and a new human-like pursuer (`AUTOPLAY_PILOT=
   human`, fitted to the user's flights). Turning stays their best defence; the scissors,
   dive and climb ladder got them shot down 2-4x as often against both pursuers. Shipped:
   - veterans and aces above 500 m throttle back in the turn to make you overshoot, then
     turn on you
   - anyone above novice reverses his turn when you fall into lag behind him
   - nobody but novices jinks with you close behind
   With a human-like pursuer on his tail at 2,000 m a D.VII takes 128 hits instead of 172
   (24 seeds), and 54% of the tail-hold is out of one constant-direction turn instead of
   37%; at 300 m 63% against 55%, hits within noise. Fairness, quick and career surveys:
   all within noise. See docs/ai.md "Wave 9: defence" and "Human-like pursuer".
   - **Do next: mutual support.** In the report the player took 3 hits in 6 minutes against
     5 aces. The aces who aren't being chased never come to clear a friend's tail. D-070
     dropped this for the autoplayer's mirror fights; re-measure it with the report scene
     (`playtests/reports/2026-09-28-…-low.json`), `AI_SOAK=tailhold AI_TH_SET=low` and
     both pursuers.
   - **Do: refit the human-like pursuer** from the next few human reports, which now carry
     `aim` (fixed-gun accuracy apart from the observer's, aim error, firing range, time to
     fire). The current fit is one scene and two usable flights; replays and balloon runs
     don't match it (docs/ai.md "Human-like pursuer").
   - **Defer:** low-level defence beyond the reversal. Below 500 m there is no brake turn
     (D-060); revisit if players find low fights too easy after mutual support.
   - **Do: collision care in the attack extension.** AI-against-enemy collisions in the
     quick survey are 7 of 360 missions with or without the escalation, nearly all with both
     aircraft in the *extend* phase after a pass, mostly Camel+2 v 3 Dr.I. The collision
     soak's furballs don't reproduce it (0 in 60), so it needs a scene built from the quick
     survey's cases first.
   - **Check:** self-crashes on the way home 1 → 3 in the quick survey (360 missions). A
     small count; re-measure at the next re-baseline.
   - **Check:** the report's human hit D.VIIs 104 times for one kill (roughly 40-55 of those were
     the observer's). That's D.VII damage tolerance, not AI; look at it if players say
     D.VIIs are bullet sponges.
5. **Housekeeping:**
   - **Decide: add a LICENSE.** The repo is public but has none, so no reuse is allowed.
     The original game's names and assets are a separate question.
   - **Do: upgrade the CI runner to Ubuntu 26.04, target 2027-01-31.** Deploys are
     pinned to `ubuntu-24.04` (D-077), so the 2026-10-19 `ubuntu-latest` switch can't
     break them. The pin stays until someone moves it. On a branch, change both
     `runs-on` lines in `.github/workflows/deploy.yml` to `ubuntu-26.04` and run it
     with `workflow_dispatch`. It passes when typecheck, tests and build are green.
     Then merge to `main`, run `pnpm prodcheck` against the live URL, and update D-077.
   - **Defer: split `flightModules`** (699 kB, 202 kB gzip). It's prefetched already;
     do it only if the first flight is slow on weak connections.
6. **Skip:** e2e in CI (it needs a GPU runner; run `pnpm e2e` locally before pushing),
   and the untried AI ideas in "AI depth — wave 8" until playtests show fights feel
   shallow.

## Deployment
- **Live:** https://chrisvaillancourt.github.io/red-baron-2-reloaded/ (public repo
  `chrisvaillancourt/red-baron-2-reloaded`, GitHub Pages; DECISIONS D-072).
- **How deploys happen:** every push to `main` runs `.github/workflows/deploy.yml` on a
  pinned `ubuntu-24.04` runner (D-077): frozen-lockfile install, typecheck, unit tests,
  build, then a Pages deploy. A failing
  test blocks the release. E2E is not in CI (it needs a GPU), so run `pnpm e2e` locally
  before pushing.
- **After a deploy:** `pnpm prodcheck https://chrisvaillancourt.github.io/red-baron-2-reloaded/`
  runs a cold-cache load, a flight, GLBs and workers, and fails on any error.

## AI depth — wave 8 (sun, cloud, stalking, ace signatures)
Details in docs/ai.md ("Wave 8 results", "Known weaknesses") and DECISIONS D-073..D-076.
- **Done:**
  - **Shared sky:** one sun and one cloud field in src/world, used by both the renderer
    and the AI.
  - **Perception:** sun glare (the core is within 5° of the sun), cloud line of sight,
    and last-seen memory. The player's threat triangles and automatic target box follow
    the same rules; padlock is unchanged. The HUD draws a glare wash-out so the sun hides
    a diving enemy from humans too.
  - **Tactics:** stalking down the sun line on a constant-bearing course, veterans and
    aces turning up into a bounce, cloud refuge for pilots forced home, and hunting from
    the last-seen position.
  - **Ace signatures:** `Ace.tactics`, with sources in D-074. The ace id reaches the AI
    through one shared adapter (`src/game/aiOptions.ts`) for both the game and the
    autoplayer.
- **Measured in wave 8** (on / off, with run counts in docs/ai.md). These are superseded by
  "Current figures" above:
  - Where stalking can apply, aces enter 62% of first passes from above or up-sun
    against 0% for novices. A stalker-signature ace enters 100% of them, every one unseen.
  - Default quick fight: 4% player down, unchanged (the default changed in wave 9, D-078).
  - Camel mirror: 35% player down (48 runs).
  - Veteran career: 21% killed or captured, and 3.8 collisions per 100 missions (80
    missions).
  - Quick ground attack: 96% success, 8% killed or captured.
  - Screenshots: `docs/screenshots/ai-out-of-the-sun.jpg` and `ai-cloud-escape.jpg`.
- **Skip (measured, D-075):** boom-and-zoom for out-turned types. It lost more fights in
  every matchup, because the D.V is dive-limited in the flight model. The code stays
  behind `TACTICS_FLAGS`.
- **Superseded (D-078):** D-076 kept the Camel v D.V quick default. Wave 9 changed it to
  2 veteran D.VIIs.
- **Skip:** making the D.V dangerous through the flight model. The default no longer
  depends on it.
- **Done (perception, wave 9, D-081):** a pursuer ~100 m behind no longer sees into a cloud core,
  follows the true position or fires blind, so cloud refuge now cuts the hits a wounded
  pilot takes (28 against 195). A pursuer already within 30–80 m still sees him, as the
  player would on screen.
- **Defer:** generic veterans and aces (no signature) never reach the merge unseen, because
  their ≤ 60 s patience runs out first. Raise it only if career playtests want more
  ambushes.
- **Defer:** the HUD glare overlay ignores the player's own wing blocking the sun.
- **Don't bundle (untried ideas):** refuge taking priority over defensive breaks when a
  cloud is close; signature straggler-hunting tuned for career missions; wingmen
  positioning up-sun on a leader's stalk.

## How it was built
Parallel agents in git worktrees, one subsystem each, merged by the lead over
eight waves. Rationale for every significant choice is in `DECISIONS.md`
(D-001..D-084); module docs are in `docs/*.md`; playtest findings are in
`docs/PLAYTEST.md`.

## Wave 7 release-check leftovers (docs/PLAYTEST.md)
- **Done:** escorts only count at the end if the charges have been out over the
  lines (PLAYTEST #4). Quick intercept contact is about 90 s. Squadron mates who
  are lost never fly again. Abandoned flights are stamped "Mission Abandoned".
- **Done (polish, wave 9):** a Quick Mission hint when the chosen aircraft never
  met in service; one Tab stop per button group (Quick Mission takes 12 Tabs, not ~57);
  no drop cap on a CO remark that opens with "Lt."; ace standings show "Off the front"
  for aces between service spells (additive `AceStanding` status `'away'`); French
  ranks for Lafayette mates (docs/PLAYTEST.md #5, #6, #8, #10, #11).
- **Defer:** a Lafayette player's own rank still follows the US ladder among
  French-ranked mates. Revisit only if Lafayette careers get attention.
- **Defer:** one tree-lined road that still reads near-black from 2 km (render).
- **Skip:** SwiftShader 'low' at about 9 fps; the README asks for a real GPU.

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
- **Done (gunnery wave 7):** the AI lead solution now models bullet drag (it under-led by
  10–20% at 200–400 m), with a turn-aware lead regression test (`src/ai/gunnery.test.ts`)
  and a gunnery diagnostic soak (`AI_SOAK=gundiag`). See DECISIONS "Drag-aware lead".
- **Superseded (D-078, wave 9: the default is now 2 veteran D.VIIs):** the Quick Mission default dogfight (Camel+1 v 2 regular
  D.V) stays lopsided: player down 0–8% (target 35–55%), and 6–13% against veteran D.Vs.
  Wave 7 showed it is the airframe, not gunnery: the D.V (wing loading 44 against the
  Camel's 31 kg/m², same speed and climb) almost never reaches a Camel's six, so its hits
  are all head-on. Three out-turned tactics (high yo-yo, diving extension, jousting) and
  mutual-support targeting were measured and dropped (docs/ai.md "Known weaknesses").
  If an even first fight is wanted, change the screen default: 2 regular Dr.I put the
  player down ~70%, novice Dr.I 6%, regular D.VII 17%. Keeping the D.V default as an
  easy first fight for a new player is also defensible; decide from human playtests,
  not the veteran autoplayer.
- **Defer:** quick ground attack against *veteran* defenders is still 63% killed or
  captured. The difficulty is chosen by the player; revisit only if players complain.
- **Defer:** the career killed-or-captured rate is ~25% for the veteran autoplayer
  (patrol 35%, free hunt 35%). Enemy fire, not collisions, is now the cause. This is an
  upper bound for a careful human (see docs/game.md).
- **Done (game wave 6):** `pilotGTolerance` drives the grey-out (see below).

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
- **Done (game wave 6):** `pilotGTolerance` drives the g-effect overlay
  (`src/game/gEffect.ts`): onset at tolerance − 1 g, so 4.5 g fit as before and
  sooner when wounded.
- **Done (game wave 6):** PLAYTEST #4, mouse-aim cockpit view: the head leads
  the aim by at most ±25° yaw and +12° up, eased, and the aim ring pins to the
  screen edge. PLAYTEST #11, clashing wingman surnames, get initials. Time
  compression also drops when low over enemy ground, near targets/AA, or under
  fire. The "could not be started" toast no longer follows mid-flight errors.
- **Defer:** an Options toggle for the old full-follow cockpit view (needs a
  src/ui control). Add it only if players ask.
- **Defer:** E.III still rocks a little near the aim (~14°/s bank activity); acceptable,
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

**Visuals — done (wave 6)**
- PLAYTEST #3 (trenches and woods as black ink from altitude) is fixed
  (DECISIONS "Trenches drawn as energy-conserving lines"). Trenches thin with
  distance and read as pale chalk lines from 1–3 km. Up close they are
  crenellated cuts edged with spoil. No-man's-land is a mottled brown-grey band,
  and woods are mottled mid-tones. Check with
  `node src/render/dev/frontShots.mjs <out> <port>` (300 m / 1 km / 2.5 km /
  straight down at Croisilles, the Somme and Ypres).
- Showcase gallery regenerated. Before/after (left/right): `docs/screenshots/front-before-after.jpg`.

**Defer — visuals**
- Trench bays follow a fixed world axis, so east–west stretches of the line
  show stretched bays. Fix with an arc-length vertex attribute only if players
  notice.
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

**Done (wave 6) — early-war two-seaters (PLAYTEST #15)** (DECISIONS "Early-war two-seaters")
- B.E.2c, F.E.2b, Farman F.40 and Albatros C.III: specs, Blender models, liveries. 1915–16
  escorts and intercepts fly period types, and escorts guard their own nation's machines.
- Pusher nose gunners have their own field of fire (`gunnerFacesForward`). Crew hit boxes
  follow the seats. Tests: `src/ai/earlyTwoSeaters.realsim.test.ts`,
  `src/campaign/twoSeaters.test.ts`, and "early-war two-seater observers" in
  `src/sim/combat.test.ts`.
- **Defer:** German two-seaters before December 1915 still use the C.III as a stand-in, named
  generically. Add an Aviatik C.I if 1915 careers get more attention.
- **Defer:** the D.H.2's tail booms (x = 1.2 m) pass through its 1.3 m propeller disc. The
  two-seat pushers root theirs outside the disc; the D.H.2 was left as is to keep its model
  unchanged.
- **Skip:** the F.E.2b's second, rear-firing Lewis. Combat models one flexible gun per aircraft,
  and the nose arc already allows fire high over the top wing.

**Defer**
- Gamepad support is implemented but untested on a real device. Test when one
  is available.
- Squadron mates are regenerated each quarter rather than persisted. Mates killed or captured in your flight are now remembered (`CareerPilot.lostMates`) and never fly again (wave 7); the rest of the roster still turns over quarterly. Defer.

**Skip**
- Remotion or any video pipeline. Not needed for the game.

## Housekeeping
- All agent worktrees and their branches have been merged and removed. Future
  agent worktrees go under `.claude/worktrees/` (gitignored).
- E2E needs a free port: `E2E_PORT=5241 pnpm e2e` if 5199 is taken by a dev
  server.
