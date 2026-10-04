# Project status — release candidate, handoff 2026-10-04 UTC

The game is playable end to end: `pnpm dev`, then open http://localhost:5173
(README "Your first flight" walks a new player through it). Career (all four
nations, 1915–1918), quick missions, the full flight/combat sim, AI, streamed
Western Front terrain, 33 Blender-built aircraft and procedural audio are all
integrated on `main`.

The wave-7 release check (docs/PLAYTEST.md, top section) gave a **GO**: a fan
can play for an evening without hitting a blocker. Everything still open below
is minor or polish, and each item carries a disposition.

Verified on `main` after the wave-9 merges: `npx tsc --noEmit` clean, `pnpm test`
382 passed (24 env-gated soak tests skipped), `pnpm e2e` 18 passed (1 gated
soak skipped) with no game running on the same GPU (FRICTION F-20). The deploy passed on the pinned `ubuntu-24.04` runner, and
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

## Resume here (2026-10-04 UTC)

**PR #4 is merged and deployed:** `f814e2a` on main, decisions D-101/D-102.
GitHub Pages build/deploy run `37174451413` succeeded. This includes the bomber
simulation/model-alignment fixes and exact differential tooling.

**Player-access cutover: PR #5, decision D-103.** All 33 aircraft are available in ordinary
Quick Missions, seven in bombing raids. Aircraft and valid crew seats survive mission
changes and reloads. The user authorized integration into main after independent review.

- Typecheck/build passed; 662 Vitest and 8 Node tool tests passed, 30 gated tests skipped.
- The updated D.H.4 raid/observer/debrief/mission-transition Playwright test passed.
  Actual Chrome/Metal UI checks selected all 14 unlocked types and flew the Gotha tunnel/
  pilot and F.E.2b nose-gunner stations. No full Playwright or AI balance survey is claimed.
- Fresh-process comparison against main: all 40 sampled AI pools and 20 career
  squadron/equipment selections equal. No physics, AI composition, campaign content,
  shared contract or dependency changes in this cutover.
- Decisions and measured implementation notes are in `DECISIONS.md` and `docs/bombers.md`.
- Independent Standards and Spec reviews of `a0bbd77` found no violations or missing
  requirements. The associated GitHub Actions run records deployment status.

**Atmosphere pass: PR #6 merged and deployed** as `89ae060`. GitHub Pages
[run 37181203687](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/37181203687)
passed typecheck, tests, build and deployment. A fresh Chrome/Metal session on the
public site exercised Quick Mission, briefing, first-flight instructions and an
actual Camel flight; the cockpit screenshot was inspected and no browser errors
were observed. This is a release smoke, not a full Playwright run.

**Graphics detail cutover: [PR #7](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/7),
decision D-104.** The user authorized integration after independent review.
The cutover includes clustered high/ultra crowns, aircraft surface UVs/material
finishes, instrument readability and differential-test failure diagnostics.
Behaviour through `59f3fc7` passed typecheck, 663 Vitest tests
and 8 Node tool regressions (30 gated tests skipped), in-engine visual checks and
independent Standards/Spec reviews. Before/after images and measured GPU costs are
in the PR; performance samples are scene-specific, not a general 60-FPS guarantee.
The PR's associated GitHub Actions run and release-smoke comment record deployment status.

**Cockpit/quality integration: [PR #8](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/8),
decision D-105**, based on PR #7 (`dc9f085`): low/medium aircraft surface shaders now cost less, while
high/ultra retain the full finish. The generator refines pilot padding, panel
construction and fixed guns across all 33 models; all stay below 12,000 triangles.
Shared core change: an optional third graphics-quality factory argument, passed
explicitly by live-flight and hangar consumers. No simulation changes.
Matched comparisons are in `docs/screenshots/cockpit-quality/`; method and
scene-specific timings are in `docs/models.md`. Local typecheck, 663 Vitest tests,
8 tool regressions and production build passed (30 gated tests skipped).
Chrome/Metal/M3 Max QA inspected Camel, D.H.4, Albatros and Gotha cockpits,
exercised flights at every preset, and verified mixed-quality material/disposal
isolation with no browser errors. Full Playwright suite was not run.
The hangar now pins animation/gauge time for repeatable captures (F-88).
The user authorized the merge; the PR's associated Actions run and integration
comment record the final merge and deployment status.

- **Merged: bombers and gunner seats, wave 1** (plan and file ownership in
  `docs/bombers.md` "Waves"). All four tracks are on main:
  - **Contracts** (D-086, `src/data/crew.ts`) and **track A, sim** (D-088): combat on crew
    stations, twins, bombs.
  - **Track C, game and UI** (D-090 to D-092): seat picker, gunner view, bombsight, bomb
    results in the debrief.
  - **Track B, data, models and effects** (D-093 to D-096): six bombers (Gotha G.V,
    O/400, AEG G.IV, Breguet 14, D.H.9, Voisin III) calibrated to their sources, falling
    bombs, whistles, bursts, craters.
  - **Track D, campaign and AI** (D-097 to D-099): the quick Bombing raid (no longer
    behind `?bombing`), bomber formations, a gunner per crew member, interceptors from the
    blind spot, escorts that stay with the bombers, career bomb waypoints, a `twoseat`
    fairness set, repeatable seeded careers (F-33). Every A/B within noise; raid survey in
    docs/ai.md "Bombers".
  - Lead fixes on main: `splitSide` and `releaseAIPilot` (track C review).
- **Next work, in order:**
  1. **Done: readiness integration.** PR #4 resolved the low roll-rate floor, twin support
     and engine-hit geometry, and prone ventral crew. F-71 is resolved. Per-engine propeller
     sizing was already correct. Rough/sloped-field and crosswind limits remain unmeasured.
  2. **Done: player-access cutover (PR #5, D-103).** Selection, persistence and live crew
     flows are verified; AI pools remain independent.
  3. **Lead:** replay the user's reports (`playtests/reports/` and the main checkout's
     `playtests/inbox/`) against the defence changes (D-085) with
     `node tools/playtest/replay-report.mjs`, and re-baseline "Current figures" with
     `tools/dev/ab.mjs` now that the bomber tracks have merged.
  4. **Mutual support** (item 4 below); it edits `src/ai/controller.ts`, now free.
  5. **Track D's open questions, for the user with a recommendation:**
     - Gotha wingmen fall about 80 m behind their slots on a long run in: formation speed
       (0.72 of top) sits near the Gotha's loaded minimum. Set it within the band between
       stall and top speed?
     - The career bomber pool includes the O/400 and Gothas, which flew mostly at night or
       against England: day bombers only for career `bomb` flights until night bombing?
     - The Quick Mission enemy list offers bombers as interceptors on a raid: fighters
       only?
     - Interceptors can't catch a lone D.H.4 at 0.8 of top speed (formations fly at 0.72).
- **Needs a user decision (asked 2026-09-28):**
  - **The damage-path flag** (D-089, `SIM_FLAGS.damagePath`): the engine block in path
    order changes no outcome within noise. The lead recommends turning it on (it also
    lowers the combat.test floor).
  - **Bullet-sponge levers:** about 38 hits to kill, 54–58% of victories from tail failure.
    The feel comes from tail damage per hit and tail box size, and from wing damage lowering
    the g limit. Should an agent A/B those levers?
- **Waiting on the user:** 3–5 flights at the default setup (a Camel against 2 veteran
  D.VIIs at 2,500 m) with ratings, and the LICENSE decision.

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
4. **Done (wave 9, D-085, D-087 "Human-like pursuer"): enemies with you on their tail.**
   This answers the first playtest report ("they just fly in circles"). Every design was
   measured against the veteran autoplayer and a new human-like pursuer (`AUTOPLAY_PILOT=
   human`, fitted to the user's flights). Turning stays their best defence; the scissors,
   dive and climb ladder got them shot down 2-4x as often against both pursuers. Shipped:
   - veterans and aces above 500 m throttle back in the turn to make you overshoot, then
     turn on you
   - anyone above novice reverses his turn when you fall into lag behind him
   - nobody but novices jinks with you close behind
   With a human-like pursuer on his tail at 2,000 m a D.VII takes 432 hits instead of 645
   (96 seeds, after the code-review fixes), and 53% of the tail-hold is out of one
   constant-direction turn instead of 41%; at 300 m 62% against 52%, hits within 7%.
   Fairness, quick and career surveys: all within noise. See docs/ai.md "Wave 9: defence"
   and "Human-like pursuer".
   - **Do next: mutual support.** In the report the player took 3 hits in 6 minutes against
     5 aces. The aces who aren't being chased never come to clear a friend's tail. D-070
     dropped this for the autoplayer's mirror fights; re-measure it with the report scene
     (`playtests/reports/2026-09-28-…-low.json`), `AI_SOAK=tailhold AI_TH_SET=low` and
     both pursuers.
   - **Do: refit the human-like pursuer** from the next few human reports, which now carry
     `aim` (the player's accuracy apart from the AI crew's, aim error, firing range, time to
     fire). The current fit is one scene and two usable flights; replays and balloon runs
     don't match it (docs/ai.md "Human-like pursuer"). Over 96 seeds it hits with 9% of its
     fixed rounds in the fitted scene, the low edge of the human's 10-14% (the 12% fit was
     on 24 seeds); fit on 96 seeds next time.
   - **Defer:** low-level defence beyond the reversal. Below 500 m there is no brake turn
     (D-060); revisit if players find low fights too easy after mutual support.
   - **Do: collision care in the attack extension.** AI-against-enemy collisions in the
     quick survey are 7 of 360 missions with or without the escalation, nearly all with both
     aircraft in the *extend* phase after a pass, mostly Camel+2 v 3 Dr.I. The collision
     soak's furballs don't reproduce it (0 in 60), so it needs a scene built from the quick
     survey's cases first. After the review fixes the player's own collisions are 3 → 5
     distinct in the quick survey and 2 → 5 in the career (both within noise), mostly the
     same extension case with the player's aircraft; include those in the scene.
   - **Check:** the SPAD XIII mirror is 33 → 25% player down with the escalation (within
     noise, below the 30-70% band). Re-measure at the next re-baseline.
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
- The six historical Claude worktrees were audited and unregistered on 2026-09-29 after
  cleanup authorization. All six had clean tracked/untracked status, no commits outside
  main or the remote refs, and no observed process using them as its working directory.
  Their directories were moved intact to Trash to preserve ignored scratch scripts,
  screenshots and reports; their branches remain available. Use `git worktree list` for
  the live inventory. The integration owner audits cleanup at each handoff (AGENTS.md).
- Shared instructions now live in root `AGENTS.md`; `CLAUDE.md` is only its import.
  Follow its session-ownership rules for Claude Code and omp. No integration owner
  means a committed task-branch handoff, not permission to merge or push `main`.
- Human play keeps port 5173. Agent servers use explicit strict ports and isolated
  flight-report output; e2e uses a free `E2E_PORT` (for example, `E2E_PORT=5241 pnpm e2e`).
  Ports do not isolate GPU load: coordinate heavy runs rather than launching them together.

### Retained workspace inventory (2026-10-04 UTC)

This is the observed handoff inventory, not cleanup authorization. No existing workspace
was removed; re-audit ownership, dirty/ignored files, unpushed commits and active processes
before any future removal.
The eight registered Git worktrees below were observed during cockpit/quality handoff.
The human's main checkout was left untouched. Earlier harness-worker records are
retained, not fresh filesystem audits; the two new workers were imported into this branch.

| Workspace | Branch / owner | Preservation reason |
|---|---|---|
| `red-baron-2-reloaded` | `main` at `f5e0a1c`; human/integration owner | Human checkout left untouched; this task's base is merged PR #7 at `dc9f085`. |
| `rb2r-bomber-readiness` | `fix/bomber-sim-readiness` at `8aac951`; prior parent omp session | PR #4 squash-merged; preserve original branch and ignored QA evidence pending authorized cleanup. Services stopped. |
| `rb2r-player-aircraft-access` | `feat/player-aircraft-access`; parent omp session | Preserve the PR #5 branch and ignored screenshots/JSON in `tools/dev/scratch/player-access/` pending authorized cleanup. Browser and port 5271 service stopped; Playwright's isolated 5272 server exited. |
| `rb2r-debt-spec` | `fix/spec-cache-identity` at `791da38`; prior spec-cache task | PR #1 squash-merged; retain original branch and workspace pending authorized cleanup. |
| `rb2r-debt-spatial` | `perf/world-spatial-queries` at `aed20d9`; prior spatial task | PR #2 squash-merged; same retention rule. |
| `rb2r-debt-height` | `perf/height-cache-locality` at `4057201`; prior height-cache task | PR #3 squash-merged; same retention rule. |
| `rb2r-pr-integration` | `review/open-pr-integration` at `0ef2f76`; prior parent review | Reviewed integration snapshot/evidence; preserve until authorized cleanup. |
| `rb2r-visual-atmosphere` | `feat/cockpit-quality-refinement`; current parent omp session | Cockpit/quality PR workspace; ignored before/after images, baseline models and flight evidence retained pending authorized cleanup. QA browser and port 5326 server stopped. |
| omp isolated `t18fe94f19/m`, `t761509680/m`, `tb9b8755f9/m` | Completed flight, damage and tooling workers | Retained worker changes/evidence; all owned source changes incorporated into the parent branch. Separate harness workspaces, not entries in the main checkout's worktree registry. |
| omp isolated `te0a804f7d/m`, `t722c9056b/m` | Completed MaterialQuality and CockpitGeometry workers | Commits fetched from the isolated clones and integrated as `ed2fa5b`, `bf7f6eb`, `0eed40e`; retained pending authorized cleanup. No unresolved implementation dependency. |

