# Simulation (`src/sim`)

Pure TypeScript (only `three` math classes). Import everything from `src/sim/index.ts`.

| File | Purpose |
|---|---|
| `atmosphere.ts` | ISA density/temperature; `createFlightEnvironment(groundHeightAt, weather)` (wind scaled with height AGL, reference at 1000 m, plus a smooth gust field; call `env.advance(dt)` every fixed step). |
| `coefficients.ts` | Per-type aero/engine/handling coefficients derived from `AircraftSpec` and calibrated to its historical figures. Cached by spec object identity. |
| `flightModel.ts` | `createFlightState`, `stepFlight` (6-DOF), attitude helpers, `getSimInternal`. |
| `combat.ts` | `createCombatSystem(bus, getRealism, opts?)`, `setGunnerTarget` / `getGunnerTarget`, `getStationAim`, `aimFlexibleGun`. |
| `bombs.ts` | `loadBombs`, `nextBombStore`, `predictBombImpact` (the bombsight's prediction), bomb ballistics, `blastDamage`, `getBombStats`. Combat releases and bursts the bombs. |
| `hitboxes.ts` | Body-frame damage-zone boxes cached by spec object identity, ground-target boxes, balloon radius. |
| `entity.ts` | `createAircraftEntity(...)` and fresh controls/damage/gun states. |
| `autopilot.ts` | `Autopilot` — altitude / vertical-speed / airspeed-by-pitch / heading / bank hold. Used by tests; handy for AI and "form up". |

Coefficient and hit-model caches use `WeakMap<AircraftSpec, …>`, as crew stations do.
Distinct specs may share an aircraft id without sharing derived data. Treat specs and
cached results as immutable: create a new spec object when changing geometry or performance.

## Flight model

* **Aerodynamics.** One lumped wing: `CL(alpha)` linear to a layout-dependent `CLmax`
  (triplanes and Fokker thick sections higher and gentler), smooth break, flat-plate
  post-stall; parabolic drag `CD0 + k CL^2` with biplane span-efficiency factors, plus
  post-stall, sideslip and damage drag. Wings are rigged at ~2.5° incidence (`alpha0 = -4.5°`
  on the fuselage datum) so the guns sit nearly level in cruise.
* **Engine/propeller.** Power lapses as `sigma^n`; propeller efficiency rises
  parabolically to a design speed and decays beyond it (finite static thrust). Engine
  power lags throttle; rotary **blip** cuts ignition instantly. RPM follows power and
  windmills with airspeed when the engine is dead.
* **Calibration.** For each aircraft three parameters are solved from the spec:
  `cd0` pins max level speed at `maxSpeedAltM`; propeller design speed sets time to
  3000 m; the lapse exponent sets the service ceiling (0.5 m/s RoC). The 6-DOF model
  shares the formulas, so flown performance matches (table below).
  Climb and ceiling are **coupled**, not independent knobs: each propeller or lapse
  adjustment also re-solves `cd0` to keep speed pinned. The solver uses eight alternating
  passes, with `propDesignV / vMax` bounded to `[0.6, 1.8]` and `lapseN` to `[0.55, 2.6]`;
  not every requested speed/climb/ceiling triple is feasible within those bounds.
  In particular, the original Voisin III **52 min** climb estimate cannot satisfy its
  ceiling together with that climb; the lapse exponent saturates at its **0.55** lower
  bound. The shipped **45 min** estimate is documented in D-093.

  The author-validation seam is the all-aircraft historical-figures test in
  `coefficients.test.ts`. It calls `calibrationProblems(spec)` directly from
  `coefficients.ts`: an empty list means acceptance, otherwise the failure details
  include requested/achieved speed, climb and ceiling, signed percentage deviations,
  tolerances and both propeller/lapse bounds with saturation status. Acceptance remains
  **±3% speed / ±10% climb / ±10% ceiling**. Check engine rating, loaded mass, bomb load,
  measurement altitude and physically consistent source figures (or clearly marked
  estimates); correct the source/spec mismatch rather than widening test tolerances.
  A saturated bound is a feasibility clue, not by itself a failed acceptance test.
  This diagnostic is author-only: `getCoefficients` still derives and caches by spec
  identity without validation failures or gameplay warnings, including mass-variant fixtures.
* **Moments** (acceleration form, per unit dynamic pressure): the stick commands an angle
  of attack about a hands-off trim (level at ~75% Vmax, 1000 m) — natural speed stability
  and phugoid; roll authority/damping from `rollRate`; weathercock, dihedral, adverse yaw,
  side force. Slipstream over the tail gives elevator/rudder authority on the ground, and
  in flight the law settles where the *tail* AoA (wing AoA × q̄ / (q̄ + q_slip)) meets the
  command: under power at low speed the wing sits above the commanded AoA by
  `tailPressureRatio(ac, env)`. Controllers inverting `stickForAlpha` must divide their
  desired wing AoA by it (the AI autopilot does); the relaxed stall cap and the relaxed /
  standard g caps are scaled by it internally.
  `rollRate` is a relative handling rating, not rad/s. Its established 2.5× calibration
  has no minimum floor: low-rated twins remain distinct while fighter calibration is
  unchanged. Regression checks fly the actual model rather than pinning coefficient copies.
* **Twins** (`performance.engineCount` > 1). `enginePowerHp` is the total, split evenly, with a
  propeller per engine sized for its share. Each engine has its own damage
  (`damage.engines`, filled in by combat; absent, the `engine` zone stands for all): power
  × (1 − 0.75 × damage), misfiring above 0.5, dead at 1. Thrust and windmilling drag act at
  each nacelle (`engineOffsetX`: spread across ±`nacelleOffsetX`, left first), so with an
  engine out the aircraft yaws toward the dead side. Hands off, the test twin swings about
  35° further toward it over 15 s than with both running. It flies on the other engine,
  sinking slowly at full throttle. The aircraft's engine is dead (`engineDead`,
  `engine-dead`) only when every engine is. Healthy, a twin flies exactly as a
  single-engined aircraft of the same total power.
* **Torque** (`realism.engineTorque`, not in relaxed): reaction roll to the left, gyroscopic
  precession `M = H × ω` (yaw right → nose down; pull up → yaw right), and a rotary
  power-on right-yaw bias. Result: a Camel turns ~12% faster right than left and needs
  left rudder to fly straight.
* **Stall/spin.** Wing drop at the break (sharper for Albatros/Nieuport sections). A latched
  spin mode is entered from a stall with yaw rate — any uncoordinated stall on `authentic`,
  only with pro-spin rudder held on `standard`, never on `relaxed`. Recovery: stick forward
  and opposite rudder for ~1.5 s (authentic) or releasing pro-spin controls (standard).
* **Realism presets.** `relaxed`: stall protection (alpha cap), 5.5 g cap, 1.5× damping,
  auto-coordination, wings-level assist, no spins, sturdier airframe/landings.
  `standard`: g-limited to ~1.08× structural limit. `authentic`: no protections, harder
  landings. `autoRudder` coordinates turns in the air and damps ground loops.
* **Structure.** Failure when load factor exceeds `gLimit = 4 + 5·structuralStrength`
  (halved negative) or airspeed exceeds `Vne = Vmax·(1.2 + 0.65·structuralStrength)`,
  reduced by wing damage, integrated over time. An Albatros D.V sheds a wing in a 45°
  power dive after ~8 s; a SPAD XIII survives it.
* **Damage effects.** Engine damage reduces power (misfiring > 50%); wing damage → lost
  and asymmetric lift + drag; tail/controls damage → reduced authority; failed parts tumble.
  A killed pilot slumps on the controls; a wounded one pulls (−35% × wound) and rolls
  (−25% × wound) less. `pilotGTolerance(ac)` (5.5 g fit → 2.5 g badly wounded) is the
  grey-out limit of the wound-aware g-effect overlay (`stepGEffect`, src/game/gEffect.ts).
* **Ground.** Two wheels + tailskid spring/damper contacts with rolling/lateral/skid friction;
  hard points (wingtips, nose, top, fin). Crash on sink > 4.8 m/s (3.8 authentic, 7 relaxed),
  nose/inverted contact above 9 m/s, wingtip scrape above 22 m/s. Ground height ≤ 0.3 m
  is treated as water → `ditched`. After impact the aircraft is frozen (`getSimInternal(ac).impacted`).
  Takeoff: hold the tail up to level, rotate at ~1.2 Vs (Camel lifts off in ~8 s).
  The three heavy twins use `geometry.gearContacts`, shared with Blender, instead of the
  generic wheel-height heuristic. Three-point pitch and CG height follow those supports.
  Spring compression at rest is about 7 cm; zero penetration is not the contact model.
  `bomberReadiness.test.ts` checks shipped GLB wheel/skid points and mesh clearance, loaded
  ground stops and loaded takeoff. Other aircraft retain their existing support derivation.
* Historical cost recorded at `c87e00c`: ~0.7 µs per aircraft step on an M3 Max; not a current benchmark.

### Historical achieved performance (`c87e00c`, 6-DOF, torque off)

| Aircraft | Vmax km/h (hist) | Climb 3000 m min (hist) |
|---|---|---|
| Fokker E.III | 140 (140) | 28.8 (30) |
| Albatros D.II | 175 (175) | 18.4 (19) |
| Albatros D.III | 175 (175) | 11.5 (12) |
| Albatros D.V | 186 (186) | 11.1 (11.5) |
| Pfalz D.IIIa | 170 (170) | 12.5 (13) |
| Fokker Dr.I | 165 (165) | 8.7 (8.5) |
| Fokker D.VII | 200 (200) | 8.3 (8.5) |
| Fokker D.VIII | 190 (190) | 8.9 (8.5) |
| Halberstadt CL.II | 165 (165) | 14.4 (15) |
| Rumpler C.IV | 170 (170) | 17.5 (18) |
| Airco D.H.2 | 149 (150) | 23.1 (24) |
| Nieuport 11 | 155 (156) | 14.4 (15) |
| Nieuport 17 | 170 (170) | 11.2 (11.5) |
| Sopwith Pup | 179 (179) | 13.8 (14) |
| Sopwith Triplane | 187 (187) | 10.3 (10.5) |
| SPAD VII | 208 (208) | 10.8 (11) |
| SPAD XIII | 218 (218) | 8.9 (9) |
| S.E.5a | 222 (222) | 10.6 (10.8) |
| Sopwith Camel | 185 (185) | 9.8 (10) |
| Nieuport 28 | 196 (196) | 10.8 (11) |
| Bristol F.2b | 198 (198) | 11.3 (11.5) |
| R.E.8 | 163 (164) | 21.3 (22) |
| Airco D.H.4 | 230 (230) | 10.9 (11) |

In that historical sampled roster, every type climbed > 1 m/s at 80% of its historical ceiling and < 0.3 m/s at 112%. Current specs/tests, not this table, define current acceptance.

## Combat

* **Guns.** Fixed guns converge on the sight line (eye 0.8 m above CG) at 150 m with drop
  allowance; synchronised guns fire at `rpmSynchronized` and only while the engine turns;
  over-wing/pusher/flexible guns at `rpmFree`. Dispersion ~0.25°; every 4th round a tracer.
  Heat rises 0.02/round, cools 0.08/s; jam chance `base·(1+8·heat²)·(1+3·gunDamage)` when
  `gunJams`. Each `controls.clearJam = true` is one hammer blow (~5 clear a jam); combat
  **consumes** the flag. Lewis drums change automatically when empty (`drumChangeTime`,
  spare drums counted). `limitedAmmo=false` never decrements rounds.
* **Ballistics.** Gravity + quadratic drag, 3.5 s life. Swept segment tests (relative to the
  target's motion) against body-frame zone boxes; a round passes through fabric and damages
  every zone on its path until the engine stops it. Balloons are 8 m spheres (hits drain
  health; each hit may ignite the hydrogen; ignition = `balloon-destroyed`). Ground targets
  are oriented boxes (`GROUND_TARGET_BOXES`).
* **Hit boxes** (`hitboxes.ts`, body frame). Types with explicit `crewStations` have a gunner
  box per station around its eye point (by default 0.45 m above and 0.35 m behind its first
  gun), tagged with the crew member and station. A man is only in the box of the station
  he is working now, so a round through the Gotha's empty tunnel position finds nobody.
  The pilot's box moves to the pilot station's `eye` when one is given. A station marked
  `posture: 'prone'` puts the crew member horizontally forward of the floor-hatch eye,
  instead of hanging a standing torso below it. This preserves intentional hatch exposure;
  containment is checked against the full fuselage envelope, not every tapered skin section.
  Multi-engine types (`engineCount` > 1 with `nacelleOffsetX`) have one engine box per nacelle
  (left engine 0), no nose engine. Shipped twins read the shared `geometry.nacelle` cowling
  centre and dimensions; decorative bearers and the Gotha's thin 8 cm front cap are not
  engine block. The metadata-free fixture retains generic placement. Fuselage `pusher`
  and nacelle propeller orientation are separate; neither changes the current thrust law.
  * **The engine stops a round.** On multi-engine types the first engine box along the
    path stops it, so a beam shot spares the far engine and everything behind the near one.
    Single-engined types keep the older cut by zone-list order. In a tractor the engine
    comes first in that list, so any round whose path crosses the engine box damages only
    the engine: a shot from astern that passes through the pilot into the engine spares
    the pilot, and the fuel tank and guns too. In the D.H.2 pusher the list puts the
    pilot before the engine, so a round from astern reaches him *through* the engine.
    `traceRound` (hitboxes.ts) holds both rules. `SIM_FLAGS.damagePath` (src/sim/flags.ts,
    env `SIM_DAMAGE_PATH=1`, off by default) applies the path-order cut to every type. It
    was measured but not shipped (D-089): outcomes didn't move beyond noise, because only
    about a fifth of hits arrive from dead astern, and most kills are structural failures.
  * **The `bullet-hit` zone** is the first of `HIT_PRIORITY` among the boxes the round
    crossed, pilot first. It only names the event (sparks, sounds); every zone kept by the
    cut is damaged. So it never hides the pilot, but with the zone-list cut it names him
    for rounds the engine stopped. Under `SIM_FLAGS.damagePath` it names a zone the round
    damaged.
  * **Measuring it:** `SIM_SOAK=zones` in `damagePath.soak.test.ts` traces rounds from every
    approach sector through each type's boxes under both rules, and `SIM_SOAK=kills` flies
    quick dogfights with the flag off and on (hits a victim took before going down, the
    player's hits per kill, how victories came, where hits came from).
* **Damage.** Engine (smoke > 0.4, dead at 1, small fire chance; on twins a hit finds one engine, the zone holds the worst), fuel tank (leaks, fire),
  pilot/gunner (not every round in the box finds the man; each pilot hit adds 0.22 wound and
  kills with probability (0.07 + 0.25 × wounds) × severity, the fifth hit certainly), wings/tail/fuselage
  (structural failure at 1), controls, guns (random jam). Engine/fuel-tank fire chances scale
  with the hit size, so flak/ground-fire splinters start fewer fires than bullets. Fire burns 8–20 s before the aircraft
  is lost; side-slipping helps blow it out. `realism.invulnerable` protects only `controller === 'player'`.
* **Kill credit.** `aircraft-destroyed.killerId` = the last attacker when the loss follows a hit
  within 30 s — including structural failure and crashes/ditching ("forced down"). Collisions
  and flak credit nobody. Outcomes: `pilot-killed`, `shot-down`, `crashed`, `ditched`, `collided`.
  Combat never reports `landed-*` / `disengaged` outcomes; the flight session sets those.
* **Gunners** work every flexible gun from its crew station (`crewStations(spec)`, src/data/crew.ts;
  D-086). There is one AI gunner per crew member who isn't the pilot. Stations that share a
  `crewIndex` are one man: he fires from one of them at a time, staying where he has the
  shot, and otherwise moving to the station with the most guns that bears (1 s to move,
  no fire meanwhile). A station's field of fire is its `FireArc` boxes in the body frame
  (`inFireArcs`), tested on the drop-compensated aim. Gunners pick the nearest enemy within
  range (novice 275 m … ace 425 m, searching out to 1.3×), lead with relative velocity, fire in
  bursts (1.5–2.5 s, pauses 0.8–2.2 s), and have skill-scaled aim error (regular 0.03 rad) that
  grows with their own turn rate, the target's crossing rate, a wounded pilot (+50%) and
  their own wounds (× 1 + wound).
  * **One gunner aboard** (every two-seater): the assigned target, else the nearest enemy,
    and he holds fire while it's out of his arcs. This is the pre-station behaviour, with the
    station arcs in place of the old hard-coded field of fire (the derived observer arcs
    match it over 99.9% of the sphere).
  * **Several gunners:** each watches for the nearest enemy *his* stations bear on. He
    falls back to that one when the aircraft-wide target is out of his arcs, so the nose
    gunner doesn't stare at a fighter on the tail.
  * **Targets:** `setGunnerTarget(ac, id)` assigns every gunner and clears station
    overrides. `setGunnerTarget(ac, id, station)` assigns the man at that station only, and
    he holds to it strictly. `null` restores automatic (with a station: clears that
    override). `getGunnerTarget(ac, station?)` reads it back.
  * **Wounds:** types with explicit `crewStations` track `damage.crewWounds` per crew
    member (combat fills it in on first sight; index 0 mirrors the pilot). A gunner hit
    wounds one man (+0.34, killed at 1 or with 25% chance, the old gunner rule). A killed
    man's stations fall silent. The `gunner` zone is the *least*-wounded gunner's wound,
    so `zones.gunner >= 1` still means "no gunner left", as for a two-seater. For
    per-man logic read `crewWounds`. Types without explicit stations keep the single
    `gunner` zone.
  * **Gunless stations** (a bombsight that shares the nose gunner's `crewIndex`) belong to
    that man too. The player puts him there, and his hit box is live there while he is.
    The AI moves him only between armed stations, and back to a gun when the player
    leaves.
  * **The player at a station** (`ac.stationInputs`, set by the game layer): his `aim`
    (world unit vector) and `fire` drive that station's guns continuously. They fire only
    inside the station's arcs, with the gun's own dispersion (0.0025 rad) and no aim error,
    subject to heat, jams and drums. `stationInputs.clearJam` hammers that station's guns
    and is consumed like `controls.clearJam`. His other stations (the same man) are silent,
    and the other crew stay AI.
  * `aimFlexibleGun(ac, mountIndex, point)` returns the direction and whether it is in the
    gun's station arcs. `getStationAim(ac, station)` is where a station's guns are laid this
    step (the AI solution or the player's aim), null when idle or out of the fight, for the renderer's
    `setStationAim`. `gun-fired.mountIndex` says which gun fired.
* **Bombs** (`bombs.ts`, combat). `spec.bombs` is the load, and `ac.bombs` the count left per store.
  * **Loading:** the game layer calls `loadBombs(ac)` for a sortie that carries bombs. An
    aircraft whose `bombs` stays unset carries none. `massLoaded` includes the full load,
    so the flight model subtracts every bomb not aboard. `effectiveMass(ac)` /
    `effectiveWeight(ac)` give it: use them, not `FlightCoefficients.mass` / `weight` (the
    full loaded figures, used only for calibration), wherever the aircraft's weight
    matters. The flight model, the ground contact and the sim autopilot's lift
    feed-forward do. `createFlightState(…, massKg?)` trims for `massKg` (default the full
    load), and `createAircraftEntity({ …, bombs })` sets the load and trims for it. A
    D.H.4 without a bomb load is 204 kg lighter than its loaded weight.
  * **Release:** both `controls.releaseBomb` (the pilot or an AI bomb aimer) and
    `stationInputs.releaseBomb` (at the `bombAimer` station) are *held* inputs. The sim
    releases one bomb per false-to-true change and never resets them, unlike `clearJam`.
    Holding either releases one bomb.
  * **Who can release:** the station release needs the bomb aimer alive. The controls
    release needs the pilot alive. Unless the player himself is in the pilot's seat, it
    also needs the aimer alive: an AI crew, or the AI flying while the player works a
    gun, can't release for a dead aimer. There is no release on the ground or below 5 m
    above it. The heaviest store with bombs left goes first (ties
    to the lower index). The bomb leaves from the CG with the aircraft's world velocity,
    and emits `bomb-released`.
  * **Ballistics:** gravity plus quadratic drag relative to the air, so the wind drifts it.
    k = ½ ρ C_d A / m with C_d 0.25 and a 0.2 m body for 50 kg (diameter ∝ mass^⅓), about
    1·10⁻⁴ /m for a 50 kg bomb at sea level (terminal speed about 320 m/s). The ground is `env.groundHeightAt`.
    `predictBombImpact(ac, env, store?)` runs the same integrator and returns the burst
    point and fall time, within about a metre of the real fall. A bomb still falling after
    120 s is discarded without a burst, where the prediction returns null. `combat.bombs`
    (`BombView[]`) lists the bombs in flight for the renderer.
  * **Blast:** Hopkinson-Cranz scaling on Z = r / W^⅓ (r to the target box's nearest face,
    W the charge). A target is destroyed inside Z_kill, and damage falls as the square of
    the way out to Z_zero. Soft targets (lorry, tent hangar, AA gun) are 3.5 / 10, a trench
    MG 3 / 8, a hangar, dump or train 2.5 / 7, and a battery 2 / 6. So a 20 kg charge
    destroys a lorry within 9.5 m and a hangar within 7 m of its walls. Damage goes through
    the strafing path (`ground-destroyed` with the bomber's kill credit), then
    `bomb-exploded` (the targets reached, of any side) and `explosion` (size 0.6 W^⅓, at
    most 4). Blast doesn't touch aircraft or balloons.
  * **Counts:** `getBombStats(ac)` returns `{ dropped, hits }` for `MissionResult.bombsDropped` /
    `bombHits`. A hit is a bomb that damaged at least one ground target of the other side.
* **Archie.** Aircraft above 500 m AGL over enemy ground draw bursts: every 4–7 s within ~5 km of
  the front, 10–18 s deeper, 1.5–3 s near an enemy balloon (and more accurate), faster near live
  enemy `aa-gun` ground targets. Shells arrive after 2 s + altitude/700; aim error ~75 m + 2% of
  altitude. Fragments damage aircraft within 30 m. **Small-arms fire** from the ground hits
  aircraft below 250 m over enemy ground (up to 5%/s). Disable with `{ flak: false, groundFire: false }`.
* **Collisions** (`midairCollisions`): aircraft collision spheres; > 12 m/s closing destroys both
  (`collided`), slower scrapes damage a wing. Flying into a balloon destroys the aircraft and fires
  the balloon.

## Using it from the flight session

```ts
import { createCombatSystem, createFlightEnvironment, createAircraftEntity, stepFlight, SIM_DT } from '../sim';

const env = createFlightEnvironment(terrainHeightAt, mission.weather);
const combat = createCombatSystem(bus, () => settings.realism);
const ac = createAircraftEntity({ id, spec, nation, livery, callsign, skill, flightId, controller, env,
  start: flight.start, onGround: flight.startOnGround });

// fixed step (1/120 s):
for (const a of aircraft) stepFlight(a, env, settings.realism, SIM_DT); // also accepts larger dt (sub-steps)
combat.update(world, SIM_DT);      // world: WorldQuery; world.time must advance
env.advance(SIM_DT);
// renderer: combat.bullets (BulletView[]) for tracers
```

* `start.heading` is radians, clockwise from north.
* `isStoppedOnGround(ac)` tells the session an aircraft has landed and stopped; decide
  `landed-friendly` / `landed-enemy` with `sideOfFrontAt` and set `ac.outcome` yourself.
* `getSimInternal(ac)` exposes `spinning`, `failedPart`, `impacted`, `impactKind`, `powerFrac`.
* `getCoefficients(spec)` gives `vStallSL`, `vBestClimbSL`, `vMax`, `vne`, `gLimit` for AI and HUD.
