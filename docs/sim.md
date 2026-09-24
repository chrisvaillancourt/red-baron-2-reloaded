# Simulation (`src/sim`)

Pure TypeScript (only `three` math classes). Import everything from `src/sim/index.ts`.

| File | Purpose |
|---|---|
| `atmosphere.ts` | ISA density/temperature; `createFlightEnvironment(groundHeightAt, weather)` (wind scaled with height AGL, reference at 1000 m, plus a smooth gust field; call `env.advance(dt)` every fixed step). |
| `coefficients.ts` | Per-type aero/engine/handling coefficients derived from `AircraftSpec` and calibrated to its historical figures. Cached by aircraft id. |
| `flightModel.ts` | `createFlightState`, `stepFlight` (6-DOF), attitude helpers, `getSimInternal`. |
| `combat.ts` | `createCombatSystem(bus, getRealism, opts?)`, `setGunnerTarget`, `aimFlexibleGun`. |
| `hitboxes.ts` | Body-frame damage-zone boxes, ground-target boxes, balloon radius. |
| `entity.ts` | `createAircraftEntity(...)` and fresh controls/damage/gun states. |
| `autopilot.ts` | `Autopilot` — altitude / vertical-speed / airspeed-by-pitch / heading / bank hold. Used by tests; handy for AI and "form up". |

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
* **Moments** (acceleration form, per unit dynamic pressure): the stick commands an angle
  of attack about a hands-off trim (level at ~75% Vmax, 1000 m) — natural speed stability
  and phugoid; roll authority/damping from `rollRate`; weathercock, dihedral, adverse yaw,
  side force. Slipstream over the tail gives elevator/rudder authority on the ground.
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
  A killed pilot slumps on the controls.
* **Ground.** Two wheels + tailskid spring/damper contacts with rolling/lateral/skid friction;
  hard points (wingtips, nose, top, fin). Crash on sink > 4.8 m/s (3.8 authentic, 7 relaxed),
  nose/inverted contact above 9 m/s, wingtip scrape above 22 m/s. Ground height ≤ 0.3 m
  is treated as water → `ditched`. After impact the aircraft is frozen (`getSimInternal(ac).impacted`).
  Takeoff: hold the tail up to level, rotate at ~1.2 Vs (Camel lifts off in ~8 s).
* Cost: ~0.7 µs per aircraft step on an M3 Max.

### Achieved performance (6-DOF, `performance.test.ts`, torque off)

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

Every type still climbs > 1 m/s at 80% of its historical ceiling and < 0.3 m/s at 112%.

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
* **Damage.** Engine (smoke > 0.4, dead at 1, small fire chance), fuel tank (leaks, fire),
  pilot/gunner (not every round in the box finds the man; wounds, deaths), wings/tail/fuselage
  (structural failure at 1), controls, guns (random jam). Fire burns 8–20 s before the aircraft
  is lost; side-slipping helps blow it out. `realism.invulnerable` protects only `controller === 'player'`.
* **Kill credit.** `aircraft-destroyed.killerId` = the last attacker when the loss follows a hit
  within 30 s — including structural failure and crashes/ditching ("forced down"). Collisions
  and flak credit nobody. Outcomes: `pilot-killed`, `shot-down`, `crashed`, `ditched`, `collided`.
  Combat never reports `landed-*` / `disengaged` outcomes; the flight session sets those.
* **Rear gunners** fire automatically on two-seaters: they pick the nearest enemy within range
  (novice 300 m … ace 450 m), lead with relative velocity, respect the field of fire (not forward
  through the propeller, not down through the fuselage, not through the tail), fire in bursts with
  skill-scaled aim error. Override with `setGunnerTarget(ac, id)`; `null` restores auto.
  `aimFlexibleGun(ac, mountIndex, point)` returns the direction and whether it is in arc.
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
