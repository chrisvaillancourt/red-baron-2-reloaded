# AI pilots (`src/ai`)

One `AIPilot` per AI-controlled aircraft. It writes `ac.controls` (stick, rudder,
throttle, `fireGuns`, `clearJam`) and nothing else, so it works with any flight
model that honours the `ControlInputs` sign conventions in `src/core/types.ts`.

## Using it from the flight session

```ts
import { createAIController } from '../ai';

const ai = createAIController(ac, {
  role: flight.role,            // 'player-flight' | 'friendly' | 'enemy'
  task: flight.task,            // 'fighter-sweep' | 'escort' | 'recon' | 'bomb' | ...
  skill: member.skill,
  leaderId,                     // flight leader's entity id (omit for the leader; the player for wingmen)
  formationSlot,                // 1-based vic slot; odd = right, even = left
  realism: settings.realism,    // enemySkillBias shifts enemy skill
  homeAerodromeId: mission.homeAerodromeId, // friendly flights; enemies fall back to nearest field
  setGunnerTarget: combat.setGunnerTarget,  // src/sim rear-gun hook: (ac, targetId | null) => void
  // controlLaw: 'sim' (default: inverts src/sim's stick laws) | 'generic' (model-agnostic PID)
});
// Create the controller after the entity (createAircraftEntity): an aircraft parked
// on a field (startOnGround) is detected at construction and starts in phase 'takeoff'.

// Each AI tick, before stepFlight for that aircraft. 30 Hz is the tested
// default (it is also fine at the full 120 Hz sim rate):
ai.update(ac, world, dtSinceLastAiUpdate);

// Wingman orders from the player (keys 1-5):
ai.command('attack-my-target', playerTargetId);   // or 'engage-at-will' | 'form-up' | 'cover-me' | 'return-home'
```

Extra read-only state on the returned `AIPilot` (not in the `AIController` interface):

| Field | Use |
|---|---|
| `phase` | `'takeoff'` while rolling/climbing out; `'landed'` means the aircraft has stopped on a friendly field: despawn it with outcome `'landed-friendly'` (or use src/sim `isStoppedOnGround`). `'out'` = dead/removed. |
| `debugState` | e.g. `engage #12`, `defend break`, `rtb`, `landing`, `takeoff roll`, plus `recover` / `pull-up` flags. |
| `targetId` | Current air target (HUD "wingman is attacking X"). |
| `homeReason` | Why it went home: `'out of ammunition'`, `'engine damaged'`, `'mission complete'`… |
| `stats` | `gunsSolutionTime`, `firingTime`, `defendTime` (tests/tuning). |

`getAIPilot(ac)` returns the controller for an entity (wingmen use it to see what
their leader is doing).

## Layers

1. **Autopilot** (`autopilot.ts`). Input is a `SteerCommand`: desired direction,
   speed, and flags (`aim`, `maxG`, `minAgl`, `lowLevel`, `maxPerformance`).
   Bank-to-turn: the commanded turn (P on heading error plus feed-forward of the
   line-of-sight rotation) plus gravity compensation gives the lift vector; roll
   places it, a PI loop on measured `gLoad` sets its size, rudder nulls
   sideslip (and fine-points the nose when aiming), PI throttle holds speed.
   Protection: available-g cap from the stall-speed estimate (adapts downward
   each time the real model stalls), AoA margin, stall recovery with anti-spin
   rudder, an energy floor that flattens unsustainable climbs, and terrain
   protection (6 s look-ahead plus a dive-recovery emergency pull-up).
2. **Tactics** (`controller.ts`, `perception.ts`, `gunnery.ts`, `maneuvers.ts`).
   Visual perception with range, a rear blind cone, memory and skill-based
   sweep rate; threat = range × enemy nose-on × our aspect. Target scoring
   prefers enemies attacking friends, damaged enemies, two-seaters for
   intercepts, and spreads targets across a flight. Pursuit: intercept → pure →
   lead (with target acceleration) → lag when overshooting, range-hold on the
   six. Energy fighters (SPAD, S.E.5a, D.VII, Pfalz…) extend and zoom after a
   pass; turners stay in the turn. Aces climb for height before engaging and
   approach two-seaters from below. Defence: break, climbing turn, spiral,
   split-S, jinking, extension, chosen by skill, type and height.
3. **Mission** (`navigation.ts`). Waypoints (`fly`, `patrol`, `rendezvous`,
   `attack-balloon`, `attack-ground`, `land`), vic formation keeping, escort
   station 300 m above and behind the escorted flight, balloon and strafing
   runs, RTB (damage, fuel, ammo, orders, route complete) and a full landing
   approach (approach point, 5° final, flare, rollout). With no route and no
   home field (quick combat), a flight loiters where it started.

   Attack runs, tuned with the autoplayer (see DECISIONS.md "Low-level attack runs keep
   their energy"):
   - **Balloons:** fire from 480 m and break sideways at 160 m in a near-level turn. Every
     AI steers clear of balloon envelopes.
   - **Re-attacks:** the approach for the next run uses low-level terrain rules, caps its
     climb by the airspeed margin and its g at 80% of the accelerated-stall load, and
     reverses onto the target in banked turns of at most 40° heading demand.
   - **Scouts:** attackers fight scouts within 1.5 km unless already committed to a close
     run. A tried "run home when outnumbered low" rule made things worse (fleeing with a
     scout on your tail is deadlier than turning with him), so it was dropped.

Skill is continuous (`skill.ts`): novice → ace changes spotting, reaction
delay, aim noise, lead error, fire range and cone, burst discipline, g
tolerance, target fixation and check-six frequency.

## Control law on the real flight model

`createAIController` uses `controlLaw: 'sim'` by default: the autopilot inverts
src/sim's stick laws with its coefficients (`getCoefficients`), which schedules
every gain with dynamic pressure automatically.

- **Pitch.** The sim's stick commands an angle of attack about the hands-off trim,
  so the stick for a load factor n is `stickForAlpha(alpha0 + n·W/(q·S·CLα))`. A
  small integral on g error (expressed as an AoA correction) absorbs thrust and
  damage. In a sustained pull the airframe settles short of the commanded AoA by
  `pitchDamping·ρ·V·q / (pitchStiffness·q̄)`; the expected flight-path rotation
  rate is fed forward to cancel that lag. The stall margin (2.2° novice → 1° ace)
  protects the *settled* AoA.
- **Roll.** Steady roll rate is `rollSteady·(V/vRef)·stick`, so the aileron is
  `p_cmd / (K·V)` with `K = rollAuthority / (2·rollDamping)`, plus a roll-rate loop
  on the measured rate and a small integral (frozen during large bank changes)
  that trims rotary torque.
- **Aim gain.** When pointing the nose, the nose leads the flight path by the AoA,
  which grows with g (`dα/dn = W/(q·S·CLα)`); a nose-error loop therefore feeds
  back through the AoA. Its gain is capped so that loop stays below ~0.5, which
  removed a porpoising oscillation that was the main cause of poor gunnery.
- **Push, don't roll over.** Small corrections that need the lift vector below the
  wings (nose drifted a few degrees high) use negative g with the wings where they
  are; only large ones roll the lift vector over.
- `controlLaw: 'generic'` keeps the original model-agnostic PID law (used with the
  point-mass test model).

### Safety layers

- **Structural envelope** from the sim's `vne` / `gLimit` (reduced by wing damage
  exactly as the sim does): commanded g never exceeds ~0.85 × the limit; a dive
  governor caps the dive angle (72°) and closes it toward level as airspeed nears
  Vne, throttling back first; above ~45% into the governor band an explicit
  dive-recovery mode rolls the lift vector into the vertical plane and pulls.
  Novices react later (`diveCaution` = skill), so they can still overstress.
- **Ground.** Dive-recovery prediction includes the roll-out time (roll angle /
  available roll rate), the speed gained meanwhile and ~85% of the usable g.
- **Energy.** The throttle never idles below the speed floor (1.4 Vs; 1.65 Vs near
  the ground), so a range-hold behind a slow target cannot bleed a scout into a
  stall at low level. Landing approaches (`steer.landing`) are exempt.

### Take-off and landing

- Aircraft that start parked (`onGround`, speed < 5 m/s) begin in phase
  `takeoff`: full throttle, wings level, rudder holds the runway heading, the stick
  holds the fuselage level (tail up) until 1.2 Vs, then rotates; climb-out at best
  climb speed to 120 m AGL. Wingmen wait 6 s per formation slot.
- Landing: if the flight arrives from the far side of the field or misaligned, it
  flies a right-hand **pattern** base point outside the approach gate first; the
  gate only hands over to **final** when aligned. Final at 1.35 → 1.25 Vs, power-off
  **flare** that holds heavier types level until 1.2 Vs, **rollout** with aileron
  and rudder (a dropped wingtip at speed is a crash in the sim). Flight members
  land in lanes 40 m apart.

## Tests

- `realsim.test.ts` (CI, ~13 s): scenario tests on the real `stepFlight` +
  `createCombatSystem`, standard realism, engine torque on — every type flies a
  route/patrol; vic formation < 40 m; take-off → mission → RTB → landing for seven
  types; ace beats novice; regular furballs produce kills with zero self-inflicted
  losses; defensive survival vs an ace; rear gunners punish a careless attacker;
  balloon busting under archie; RTB when out of ammo / damaged; low-level
  dogfight over hills with no terrain strikes.
- `testing/realSimHarness.ts` — `SimWorld` (WorldQuery over flat/stub terrain or
  a custom ground function, simple `frontX` or the real `sideOfFrontAt`), real
  combat with an event log, `addAircraft` / `addAI` / `addBalloon` /
  `addGroundTarget`, `runSim(world, seconds, hooks)`. Wrecks keep falling until
  they hit the ground; aircraft that stop on the ground after flying become
  `landed-friendly` / `landed-enemy`.
- `testing/realScenarios.ts` — `combatRun` (head-on group fights with per-side
  stats), `routeFlight`, `historyTap` (state history before self-inflicted losses).
- Soak / probe runs (skipped unless enabled):
  `AI_SOAK=route,combat,struct,terrain AI_SEEDS=6 AI_OUT=/tmp/x.txt pnpm vitest run src/ai/tuning.soak.test.ts`
  and `AI_SOAK=track|turn|straight|mission|zones|spot|probe pnpm vitest run src/ai/probe.soak.test.ts`.
- The point-mass tests (`scenarios`, `furball`, `robustness`, `autopilot`) use
  `controlLaw: 'generic'` and cover mission logic cheaply; combat outcomes and
  landing are tested on the real sim only.

## Tuning results (real sim, standard realism, torque on)

Route + 60–90 s patrol, all 23 types, regular: no crashes, ≤ 0.2 s stalled, min
AGL > 950 m. Take-off → patrol → RTB → landing, leader + wingman, 10 types:
20/20 landed at home (lift-off 12–28 s). Low-level 4v4 over hills, 16 types mixed
skill, 30 min simulated: 0 uncredited ground impacts.

Combat matrix (6 seeds, head-on start 3 km apart, 600 s max; "hit" = rounds that
struck an aircraft):

| Matchup | Result (A–B–draw) | First kill (mean) | Hit % A / B | Self-inflicted losses |
|---|---|---|---|---|
| S.E.5a ace v Albatros D.V novice | 6–0–0 | 116 s | 47 / 2 | 0 |
| Albatros D.V ace v S.E.5a novice | 5–1–0 | 289 s | 42 / 11 | 0 |
| Camel v Dr.I (regular) | 2–1–3 | 388 s | 16 / 17 | 0 |
| SPAD XIII v D.VII (veteran) | 2–2–2 | 243 s | 16 / 22 | 0 |
| Nieuport 17 v Albatros D.III (regular) | 3–3–0 | 240 s | 30 / 25 | 0 |
| D.H.2 v Fokker E.III (regular) | 5–0–1 | 261 s | 16 / 6 | 0 |
| 2v2 S.E.5a v D.V (regular) | 3–3–0, 12 kills | 165 s | 16 / 20 | 0 |
| 4v4 Camel v D.V (regular) | 3–0–3, 22 kills | 94 s | 17 / 9 | 0 |
| 4v4 SPAD XIII v D.VII (regular) | 1–4–1, 27 kills | 117 s | 13 / 17 | 0 |

Kills need ~50–100 hits because ~70% of hits land on the wings (0.018 damage per
hit in src/sim); pilot and engine hits end fights quickly. That, not the AI, sets
the length of 1v1 fights between equal pilots (4–7 min); balance it in
`ZONE_DAMAGE` (src/sim/combat.ts) if fights should be shorter.

### Known weaknesses

- Aces don't exploit the vertical (yo-yos, zoom climbs) beyond energy-fighter
  extensions; equal turn fights between regulars can circle for minutes.
- No use of sun or cloud.
- Wingman formation keeping for the slowest types (Dr.I, Nieuport 17) can lag by
  a few hundred metres after a long climb; it holds < 40 m once joined.
- Landing uses the aerodrome's runway heading, not the wind.
