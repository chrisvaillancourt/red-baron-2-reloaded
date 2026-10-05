# Bombers and gunner seats

The wave-1 implementation (D-086–D-099) and simulation-readiness pass (D-101–D-102)
are merged. [PR #5](https://github.com/chrisvaillancourt/red-baron-2-reloaded/pull/5)
merged as `f5e0a1c` and delivered D-103 player access: all 33 aircraft in ordinary
Quick Missions, seven bomb carriers in raids. The original scope/wave plan below
is historical context, not an active schedule; current work is in STATUS.

## Q-08 pacing measurement contract

This is a **measurement-only** cohort. `tools/dev/scenarios/bomber-pacing.mjs`
uses the existing native differential loader and real simulation; it does not change
aircraft cards, coefficients, AI speed caps, tactics, mission placement or test tolerances.
The revisioned measurement below belongs to its explicitly frozen authored tree;
integration/runtime/publication receipts remain distinct in BACKLOG and STATUS.

### Bounded matrix and explicit selection

Bomb carriers are discovered from `AIRCRAFT_LIST` and their stores, not a copied roster,
mass table or bomb-count table. At the implementation base these are the seven shipped
carriers. Select `{"suite":"all"}`, one of `transit`, `reference`, `quick`, `interceptor`,
a nonempty array of those suites, or a nonempty `cases` array of exact case IDs.
Missing/empty, unknown and duplicate selections fail rather than succeeding without
observations. `suite` and `cases` are mutually exclusive; other input keys fail.

| Suite | Cases | Method |
|---|---|---|
| `transit` | Every carrier × full-load/no-bombs × solo/triple × seeds 1/2/3 | Eastbound at 2500 m ASL toward a distant fly waypoint; 240 s cap, separate first 60 s transient and final 180 s steady windows. |
| `reference` | Every carrier × card-altitude/same-altitude | Full bomb load; existing performance-test full-throttle autopilot method, standard flight model, torque off and auto-rudder on; 150 s with final 15 s steady window. Card altitude is clamped to at least 300 m; same-altitude is 2500 m. Initial speed is 0.95 of card speed. |
| `quick` | Every carrier × solo/triple, fixed seed 7000 | Actual production Quick bombing build, veteran AI player/leader, regular wingmen and two regular defenders, no escort, requested 2500 m and clear midday. Real terrain, wind, AA, mission date, raid altitude clamp, delayed spawns and director remain unchanged. End on mission completion or 1500 s cap. |
| `interceptor` | Loaded D.H.4 triple, seed 1, ahead/astern | Controlled transit plus a regular Central D.VII 2500 m ahead or astern, 400 m lateral and 100 m above. Both start eastbound: these are parallel ahead/astern starts, not head-on starts. Real default controller steering/tactics and guns remain enabled. 240 s cap, 60 s warmup. |

Controlled transit/interceptor cases use standard realism with engine torque, flat
50 m ground, no wind/turbulence/weather/AA, initial speed 0.8 of card speed, and
explicit controller seeds derived from case seed and entity ID. They are diagnostic
starts, not historical service-date/career eligibility evidence. Reference cases use
the performance test's different realism and are labeled separately.

`SimWorld.addAircraft` does **not** load bombs. Controlled cases load the selected
stores first, then recreate the trimmed state with `createFlightState` and
`effectiveMass`, matching production's initialization order. No-bombs removes only
the bomb payload from full loaded mass: it is not the aircraft's empty weight.
Production Quick bombing uses `SimCore` and `headlessModules`, including the existing
AI-controller options adapter and real loading/retrim path. Initial/final bomb counts
and effective mass are recorded independently of the requested load.

### Observations and censoring

Every selected case returns a plain JSON-compatible observation with its setup,
aircraft card references, actual date/flight size, initial/final scalar state and actual
aircraft skill, scheduled flight starts/routes/delays/member skills, actual spawn snapshots,
releases/explosions, event counts, per-shooter fire counts, per-shooter/target hit counts and outcomes.
Vector values are copied immediately into numeric arrays. Nonfinite or undefined
results fail; empty accumulators have `count: 0`, `seconds: 0` and null mean/min/max.
There are no NaN placeholders and no dropped unsuccessful cases.

Speed, horizontal speed, altitude error and throttle are sampled every 120 Hz
physics step, with time-weighted mean/min/max and explicit counts/seconds. Stall,
AI-autopilot recovery, throttle saturation and phase dwell are durations. Only live
aircraft contribute flight samples; reduced denominators are reported, not averaged
as successful flight. `lost` uses production `missionDirector.isLost`, also counting
unfinalized destroyed/pilot-killed aircraft: safe landings and disengagement stop
sampling but are not losses. Reference steady speed is available in
m/s; multiply by 3.6 for the card's km/h. The 0.8 solo-cruise and 0.72 formation-cap
fields are **nominal policy references**, not an observed final steering request.

Wingman error uses the existing `slotPosition` geometry and the leader's horizontal
**velocity**, including its low-speed fallback, not attitude heading. Along/cross
and vertical errors are signed target-minus-aircraft components; 3D error is their
norm. Original-vic metrics cease at the first member loss or return/landing phase,
with a censor time: surviving inferred slots or a replacement leader are not silently
compared with the original slots. Startup join-up remains measured. These summaries
do not establish a new formation-error threshold.

Contact means geometric range at or below 3000 m, separately from AI target selection,
first fire and first hit. Range crossings (3000/1800/700/250 m), minimum range and
pair-time-weighted radial closure include only live bomber/enemy pairs; they do not
mean visibility or a firing solution. Closure is zero at exactly zero range.
Absent contact/release times remain null with explicit censor flags. Fixed controlled
caps are the intended observation horizon, not a failure verdict; production cap
censoring is distinct from director completion. Events are copied at emission in
production and after each physics step in the controlled harness.

Completed Quick sorties serialize `missionResult` from the real director's
`buildResult()`: mission identity/success, player outcome/fate, end/abort flags,
flight time and objective identities/completion. Safe player return is independent
of bombing objective success. A capped flight has **no final mission result**:
`objectiveObservation` labels its live progress as censored, retaining objective
definitions, completed/failed identities, station-time/engagement progress and
ground-target mission/entity identities, health and destruction dispositions.
The same objective/target context accompanies completed results. A director end
on the last allowed step is genuine completion, not time-cap censoring.

`node --test tools/dev/bomber-pacing.test.mjs` is an isolated terminal-lifecycle
regression using the native loader and a real production `SimCore` subclass.
After real physics steps its fixture explicitly injects `landed-friendly`,
`disengaged` or `shot-down` world state and lets the production director end the
sortie. It checks loss classification and bombing failure despite safe return;
this injected fixture is **not** proof of naturally flown landings or bombing runs.

Actual Quick **intercept** missions are recon/unloaded; they are intentionally not
part of this loaded bombing cohort and must never be relabeled as loaded evidence.
Likewise, the unchanged historical `interceptors.realsim.test.ts` D.H.4 fixtures do
not load bombs. Keep historical, controlled and production cohorts separate.

### Integration-owner execution and interpretation

Run from the fixed owning checkout, with dependencies unchanged and an explicitly
increased timeout; retain the complete differential JSON in task-owned ignored scratch:

```sh
node tools/dev/differential-probe.mjs --baseline . --candidate . \
  --scenario tools/dev/scenarios/bomber-pacing.mjs \
  --input '{"suite":"all"}' --timeout-ms 3600000
pnpm exec vitest run src/ai/bombers.realsim.test.ts src/ai/interceptors.realsim.test.ts
```

A focused diagnostic selection is, for example,
`{"cases":["transit/dh4/loaded/3/1","reference/dh4/card-altitude","quick/dh4/3","interceptor/dh4/loaded/astern"]}`.
The runner records complete observations, input, scenario hash, both revision/dirty
fingerprints, worker exits and distinct process identities. Equal same-root results
prove reproducibility for these cases, **not** gameplay quality or improved balance.
The owner also runs existing differential-runner tests and full project gates before
integration, and adds actual numbers with exact revision/command/evidence provenance.

Interpret 2500 m AI pacing against the same-altitude loaded power reference before
consulting the separately measured card-altitude reference. A cruise observation is
not a replacement for the existing historical speed tolerance. Never infer a desired
catch rate from a bomber being faster than a particular scout. Human difficulty,
visual formation feel, tuning, historical career eligibility and night-bomber policy
remain separate owner decisions; no Q-08 measurement closes those decisions.

### Measured authored cohort — 2026-10-05 UTC

Base `a91f9b478b964491d1b86f1e493a7969eaab1068`; final staged tree
`9a6d8047dde1b7378829da52cf0574431a959a74`, scenario SHA-256
`fa10f4feb165b51c613779addfb458745c3ea2964c74bd82ef1f010da4ca077c`.
The all-suite command above selected all **114 cases**, with identical complete
observations in distinct processes **83579/87132**. Every case observation also
matched the corrected pre-allocation-hoist report exactly. Standards and Spec
round three were clean; nine focused Node consumer/runner tests passed.
Retained full JSON: `rb2r-workflowz-bomber/tools/dev/scratch/workflowz-q08/pacing-final-report.json`
(4,213,931 bytes); original and corrected pre-hoist reports remain separate.
This proves authored-tree repeatability, not current integrated-tree equivalence.

Controlled **loaded, regular-AI triple**, seeds 1/2/3, calm 2500 m eastbound
transit, 240 s duration, prescribed 60 s startup exclusion. Leader means pool
accepted aircraft-time; slot means pool both original wingmen's accepted
aircraft-time across the three seeds. Maxima are sampled maxima across that cohort,
not percentiles. No losses or stalled samples occurred in these transit rows.

| Aircraft | Leader true airspeed, km/h | Wing slot 3D mean, m | Sampled slot max, m |
|---|---:|---:|---:|
| AEG G.IV | 138.105 | 105.699 | 145.519 |
| Gotha G.V | 124.787 | 0.462 | 0.872 |
| D.H.4 | 165.611 | 4.768 | 10.206 |
| Voisin III | 96.995 | 240.718 | 418.050 |
| Breguet 14 B2 | 126.007 | 15.740 | 26.893 |
| D.H.9 | 131.016 | 12.676 | 22.870 |
| Handley Page O/400 | 118.492 | 1.390 | 3.087 |

The 0.72 fraction caps **requested steering speed**, not actual airspeed. Its
eligibility depends on a live same-flight formation wingman within 800 m.
PI throttle and minimum-speed protection still operate. This sampler does not
record command/cap/floor-active exposure, so it cannot assign causal shares to
excess speed; zero stalled samples do not prove safeguards were inactive.
Voisin and AEG slot errors warrant a separately authorized pacing investigation,
not an automatic airframe or safety retune.

The 14 production Quick cases instead use an actual **veteran player/leader**,
regular wingmen/enemies, no escort and seed 7000. Thirteen ended naturally;
O/400 solo reached the 1500 s cap with a live player and null final result.
Completed mission success and player survival differ: several successful bombing
objectives ended with a lost player. These single-seed sorties establish neither
population catch rates nor human difficulty. Ahead/astern D.H.4 interception is
parallel-heading geometry, not a head-on or all-bomber catch-rate study.
Integrated tree `d2a1788a1865bd83d4ee9d3ffc8fb7c5dfe32ba6` (local main
collision merge `d9008294…` plus staged first-wave changes) also repeated all
114 cases exactly, processes **96580/7161**, using the same scenario hash.
Comparison with the authored report found one changed case, `quick/voisin_iii/3`:
final state, metrics, events and encounter observations differ; termination,
elapsed time and final mission outcome do not. Every other complete case,
including the controlled table above, matched exactly. This is not global
pre/post-collision equivalence. Separate integrated JSON is retained at
`tools/dev/scratch/workflowz-wave-one/pacing-integrated-report.json`.


## Player-access cutover (2026-10-04 UTC)

Base: `f814e2a`, the authorized PR #4 squash merge. GitHub Pages build/deploy succeeded
in run `37174451413`. Integration owner: parent omp session; isolated workspace
`rb2r-player-aircraft-access`, branch `feat/player-aircraft-access`.

- Enabled the 14 previously gated types in `src/data/aircraft.ts`: seven reconnaissance
  two-seaters and seven bombers. All 33 shipped aircraft are now offered in ordinary
  Quick Missions; the seven bomb carriers are offered for bombing raids.
- `quickPlayerAircraft` requires `flyable` for every mission and a bomb load for raids.
  Saved selections and valid crew seats survive mission changes and reloads; incompatible
  choices still use the existing nation/side/service-date fallback and clear missing seats.
- No second UI list, migration shim, AI role-pool change, career squadron addition, shared
  contract change or dependency. The AI-pool regression now inverts and restores original
  availability flags instead of assuming that several types will always remain gated.
- Actual UI on isolated port 5271: selected all 14 unlocked types; Gotha survived
  raid→dogfight→reload with its tunnel seat. Launched through the real briefing into that
  station, then returned to the pilot and exercised roll input. Launched the F.E.2b from
  its nose-gunner choice. Shipped models loaded; screenshots inspected on Chrome/ANGLE
  Metal (Apple M3 Max), gamepads stubbed, no browser errors.
- The existing bombing-raid Playwright regression passed on isolated port 5272: D.H.4
  observer launch with four bombs, debrief, then dogfight with aircraft and seat retained.
  The full Playwright suite was not run.
- Exact fresh-process comparison with `f814e2a`: all 40 sampled AI role/date pools and
  20 nation/date career squadron/equipment selections equal. This is selection-equivalence
  evidence, not a new combat-balance survey.
- `pnpm typecheck`, `pnpm test` (662 Vitest + 8 Node tests passed, 30 gated tests skipped),
  and `pnpm build` passed. Screenshots and JSON remain in ignored
  `tools/dev/scratch/player-access/`; temporary probe removed and QA services stopped.
- Independent read-only Standards and Spec reviews of `a0bbd77` both returned no
  findings. The user subsequently authorized PR #5 integration into main; D-103 records
  the cutover decision. The associated GitHub Actions run records deployment status.

## Simulation-readiness pass (2026-10-04 UTC)

Base: `66518dd`, after the three cache/spatial-query PRs. Integration owner: the parent
omp session, branch `fix/bomber-sim-readiness`. No aircraft unlocks, AI balance changes,
night bombing, damage-path flag changes, or deployment are part of this pass.

Independent ownership:
- **Verification tooling:** `tools/dev/` differential probes and the architecture command
  reference. Use supported TypeScript graph loading and identical scenario histories in
  separate baseline/candidate processes; replace ad-hoc compiler-API and shared-state probes.
- **Flight dynamics:** simulation coefficients and handling regressions. Measure low-rating
  bomber roll response and shipped-model wheel/skid geometry before changing them.
- **Damage geometry:** hit models and their regressions. Measure ventral crew and nacelle
  placement; keep fuselage pusher layout separate from nacelle propeller orientation.
- **Integration:** any shared data contract, decisions, implementation notes, independent
  reviews, combined tests and runtime/browser evidence. Resolve shared geometry once rather
  than copying generator tables into each simulation path.

Acceptance: behavioral regression coverage, actual before/after simulation probes, model
alignment measurements, independent review dispositions, and combined typecheck/test/build
verification. The per-engine propeller formula already exists; verify it, do not replace it.

### Implementation and evidence

- **Roll:** removed the 0.7 rad/s minimum, not the established 2.5× relative-rating
  calibration. At half aileron, 40 m/s, 1,500 m, loaded, torque disabled, the 0.5 s
  absolute roll rates changed Gotha 0.242→0.130, O/400 0.242→0.104, AEG 0.242→0.190
  rad/s. Camel, D.V and SPAD XIII flight states, gear and hitboxes compared exactly equal
  to `66518dd` in fresh processes. These are scenario observations, not historical limits.
- **Ground:** shared `geometry.gearContacts` supplies simulator and generator support
  points. The previous settled wheel penetrations of 0.55–0.99 m are about 0.07 m after
  the fix (intentional spring compression). Regressions cover full loads, rest, rolling
  stops, ground clearance and takeoff without pinning those sampled values.
- **Damage:** shared nacelle dimensions replace inferred twin engine boxes. Explicit
  prone posture replaces the standing-body offset for Gotha/O/400 floor stations.
  Engine-index/occlusion rays, former empty volumes, shared crew occupancy, and shipped
  cowling/fuselage bounds are covered. The old ventral exception list is gone.
- **No speculative fixes:** per-engine propeller-disc sizing was already correct; an
  invariant now protects it. Gotha fuselage `pusher` stays false, while its shared nacelle
  metadata identifies rear-facing propellers. No aircraft is newly player-selectable.
- **Generator parity:** Blender 5.2.2 compared the baseline and migrated generators for
  all three twins: every object transform, mesh vertex and polygon unchanged (maximum
  geometry delta 0 m). No shipped asset regeneration was necessary. Both simulation
  test families now share `src/sim/testing/modelGeometry.ts`, a scene-free GLB reader.
- **Actual game:** isolated port 5269, Chrome/ANGLE Metal on Apple M3 Max, no gamepad,
  zero wind, loaded bombing missions. Inspected all three ground stances and liftoffs,
  spinning propellers, and a Gotha damage-box overlay. Sampled airborne heights were
  Gotha 44.6 m, O/400 51.2 m and AEG 35.5 m, with zero damage. AEG's uncorrected
  throttle-only run stalled; the production AI pilot from the nose station then took
  off at 32.6 m/s without a stall. This does not establish hands-off stability,
  crosswind/sloped-field limits, or full player-selection readiness.
- **Review:** separate read-only reviews covered simulation/generator and tooling.
  No simulation findings. Tool review caught Array-subclass data loss across IPC;
  reproduced via CLI, fixed with a plain-array check and regression, then re-reviewed.
- **Combined gate:** `pnpm typecheck`, `pnpm test` (661 Vitest tests + 8 Node tool tests
  passed; 30 gated Vitest tests skipped), and `pnpm build` passed. No full Playwright
  suite or AI balance re-baseline was run. The actual world differential scenario was
  exactly equal to `66518dd`; expected bomber differences were reported as different.
- **Retained evidence:** ignored `tools/dev/scratch/bomber-readiness/` contains screenshots,
  runtime measurements, generator-parity and bomber-comparison JSON. Temporary probe
  scripts were removed; the automation browser and server were stopped.

This pass was merged as PR #4 (`f814e2a`) and deployed successfully. The player-access
cutover above follows it; AI balance, historical day/night availability and the damage-path
decision remain separate.

## Scope (user decisions, 2026-09-28)
- **New aircraft, all flyable:**
  - Heavy twins: Gotha G.V (Germany; three gunners, including the ventral "Gotha tunnel")
    and Handley Page O/400 (Britain).
  - A smaller German twin: AEG G.IV.
  - Day bombers: Breguet 14 B2 (France), Airco D.H.9 (Britain), and the existing Airco D.H.4,
    which becomes flyable.
  - Early war: Voisin III (French pusher, 1915).
- **Gunner seats in every multi-crew aircraft,** not only bombers. The Bristol F.2b and the
  AI-only two-seaters become flyable: R.E.8, D.H.4, Rumpler C.IV, Halberstadt CL.II,
  Albatros C.III, B.E.2c, F.E.2b and Farman F.40. They have specs and models already. The
  player can take any crew station; the AI flies or mans the rest.
- **Modes:**
  - Wave 1: a "Bombing raid" quick mission with targets, AA, interceptors and an optional
    escort.
  - Wave 2: career bomber squadrons, with raid missions, promotions and medals. Candidates:
    Kagohl/Bogohl 3 (Gotha), 207 and 216 Sqn (O/400), a Breguet escadrille, 55 Sqn (D.H.4)
    and a D.H.9 squadron.
- **Night bombing is deferred** to its own wave. It needs dark lighting, searchlights, target
  fires and navigation aids.

## What exists today (surveyed 2026-09-28)
- **Contracts:**
  - `AircraftRole` already has `'bomber'`, and `EngineType` has `'twin-inline'`, which is
    unused.
  - Only the D.H.4 is a bomber, and it is AI-only.
  - `MissionFlight.task` has `'bomb'`, and `missionGen.twoSeaterFlight` gives bomber flights
    that task. They only fly the route: **there are no bombs at all.** Nothing is released,
    aimed or exploded.
- **Guns:**
  - `GunMount.mount` is `'fixed-*'` or `'flexible'`.
  - The rear gunner's AI lives inside combat (`src/sim/combat.ts` `updateGunner`). It
    supports **one flexible gun per aircraft, and only for `geometry.crew === 2`**, which is
    why D-066 skipped the F.E.2b's second Lewis.
  - The field of fire is `flexibleArc()`, hard-coded as rear-facing, or nose-facing through
    `gunnerFacesForward(spec)` in `src/sim/hitboxes.ts`.
  - `setGunnerTarget` / `gunnerTargets` let the AI pick the gunner's target.
  - `GunState` is per mount (`mountIndex`).
- **Damage:** `DamageState` has one `'gunner'` zone.
- **Controls:** `ControlInputs` is pilot-only (pitch, roll, yaw, throttle, blip, fireGuns,
  clearJam). There are no gunner or bomb inputs.
- **Game layer:** there is no concept of a player crew station. The cameras are cockpit,
  chase, padlock, fly-by and target.
- **Wingman order keys are 1–5,** so crew-station keys need other bindings.

## Contracts (landed, D-086)
The shapes are in `src/core/types.ts` (search "Crew stations and bombs"), and D-086 gives the
reasons. In short:
- `CrewStation { id, label, crewIndex, guns, arcs, eye?, bombAimer? }`, read only through
  `crewStations(spec)` in `src/data/crew.ts`. Stations sharing a `crewIndex` are one man.
  `inFireArcs(arcs, x, y, z)` tests a body-frame direction, and `crewStationProblems(spec)`
  validates a spec (a test runs it over the whole roster).
- `AircraftEntity.stationInputs?` carries the player's aim, fire, bomb release and jam clearing
  at a non-pilot station. The player's aircraft keeps `controller: 'player'`.
- `AircraftSpec.bombs?` (included in `massLoaded`) and `AircraftEntity.bombs?` (left per store);
  `ControlInputs.releaseBomb?`; events `bomb-released` and `bomb-exploded`; `MissionResult`
  `bombsDropped?` and `bombHits?`; waypoint action `'bomb'`; mission and quick type
  `'bombing'`, with `escortCount?` and `escortAircraft?`.
- `performance.engineCount?`, `geometry.nacelleOffsetX?`, `DamageState.engines?` and
  `crewWounds?`; `geometry.crew` is `1 | 2 | 3 | 4` (check `crew >= 2`, never `=== 2`).
- `GunType` `'hotchkiss'`; `AircraftVisual.stationEyes?` and `setStationAim?`, and (track B)
  `setStationView?` to hide the gunner at the camera's station; `Livery.pattern` `'disruptive'`;
  `WorldRenderer.update(…, bombs?)` takes `combat.bombs` to draw the falling bombs.
- The D.H.4 carries four 112 lb bombs as the reference load; it stays AI-only for now.
- **Left to the tracks:** the key bindings (game track: `stationNext` C, `stationPrev` V,
  `stationPilot` F, `releaseBomb` R, `viewBombsight` F6, added with the code that reads them),
  and new ground-target kinds (wave 1 raids use hangars, dumps, trains and batteries).

## Waves
1. **Lead: done** (D-086). The contracts, `src/data/crew.ts` with tests, the D.H.4 reference
   bomb load, and `crew >= 2` outside `src/ai`.
2. **Tracks** (worktree agents). Each owns the files listed and codes against the contracts
   for everything else; a contract it needs beyond D-086 stays additive and goes in its report.
   - **A. sim** (owns `src/sim/**`):
     - combat on crew stations: every flexible gun, per-station arcs through `inFireArcs`,
       an AI gunner per crew member (stations sharing a `crewIndex` fire one at a time), and
       `stationInputs` overriding the AI at the player's station. Keep `setGunnerTarget`
       working, with an optional station argument. Today's two-seaters must fight as before
       (the fairness and career soaks through `tools/dev/ab.mjs --base main`, within noise).
     - hit boxes and wounds per crew member (`crewWounds`), twin nacelle hit boxes.
     - multi-engine thrust split by `engineCount`, per-engine damage and asymmetric thrust
       (yaw), `nacelleOffsetX` for placement.
     - bombs: release from `controls.releaseBomb` or `stationInputs.releaseBomb`, the aircraft
       mass drops as bombs go, ballistics (drag, the aircraft's velocity at release), blast
       damage to ground targets by charge mass and distance, the two events, and the counts the
       mission result needs.
   - **B. data, models and effects** (owns `src/data/aircraft.ts`, `src/data/liveries.ts`,
     `tools/blender/**`, `public/models/**`, `src/render/**`, `src/audio/**`):
     - specs for the Gotha G.V, Handley Page O/400, AEG G.IV, Breguet 14 B2, D.H.9 and
       Voisin III, from references (speed, climb, ceiling, weights, engines, guns and bomb
       loads); calibrate them with the flight-model tests like the existing types.
     - `crewStations` for every multi-crew type whose derived stations are wrong or thin: twin
       Lewis on a Scarff ring, the Gotha's nose, dorsal and tunnel guns, the O/400's positions.
     - models: twin nacelles, big spans, gun rings, the ventral tunnel, bomb racks, and
       `EyePoint_<station>` empties; `stationEyes` and `setStationAim` in the visual.
       Liveries (Gotha lozenge, O/400 PC10). Check the hangar in-engine, not only in Blender.
     - falling bombs, bomb bursts and craters (render), the release clunk, bomb whistle and
       burst (audio), twin-engine sound.
     - set `flyable: true` only in the report's recommendation; the lead flips it when tracks
       A and C have merged.
   - **C. game and UI** (owns `src/game/**`, `src/ui/**`, `src/core/settings.ts` bindings):
     - seat switching (keys above, a seat indicator on the HUD); while the player works a gun,
       an AI controller flies his aircraft, and he gets the pilot's seat back with one key.
     - the gunner view: an eye at the station, mouse aim of the flexible gun with its arc
       shown, the ring sight, and fire, jam and drum controls. Build and test it on the Bristol
       F.2b, which is flyable today.
     - the bombsight view (looking down, with drift and a release cue) and bomb release.
     - the HUD and Flying Manual for gunners and bomb aimers; bomb counts in the debrief.
     - Quick Mission: the "Bombing raid" type and a seat picker, shown only once track D's
       builder exists. Until then, test with a hand-built mission in a `testing/` fixture.
   - **D. campaign and AI** (owns `src/campaign/**`, `src/ai/**`). **Starts after the defence
     track merges,** since both edit `src/ai/controller.ts`:
     - the quick "Bombing raid" builder: targets behind the lines, AA, interceptors, an
       optional escort, the bomb-run waypoint and a destroy-ground objective.
     - AI bombers: formation, the straight and level bomb run, release over the target, and
       the way home; AI escorts and interceptors that go for bombers; per-station gunner
       targeting.
     - **Before the two-seaters become flyable:** `aircraftPool` (`src/campaign/squadronUtil.ts`)
       keeps only non-flyable two-seaters in AI recon and bomber pools (`!a.flyable`).
       Flipping `flyable` on the R.E.8, Rumpler and the rest would empty those pools, so
       separate "the player may fly it" from "the AI flies it" first.
   - **Lead, at the defence merge (done):** change the three `crew === 2` checks in `src/ai`
     (`traits.ts` `isTwoSeater`, and two in `controller.ts`) to `crew >= 2`, before track B
     merges. Track B's bombers enter the career AI pools for bomb-task flights as soon as they
     exist (historically right: Gotha raids to intercept), and until then the AI would treat
     a three-crew Gotha as a single-seater.
3. **Merge, re-baseline and playtest,** then career bomber squadrons (wave 2), then night
   bombing.
