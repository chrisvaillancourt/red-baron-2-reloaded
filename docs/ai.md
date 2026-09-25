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
   sweep rate; threat = range × enemy nose-on × our aspect. Sight is impaired
   by the sun and by cloud (`perception.ts`; DECISIONS "Perception: sun glare,
   cloud and memory"): within 15° of the sun (full inside 5°, ramping in as the
   sun climbs from 2° to 6° and gone when cloud hides it) the spotting range
   falls to 12% (novice) – 30% (ace), and cloud on the line of sight
   (`WorldQuery.cloudTransmittance`, the clouds the renderer draws) scales it by
   the light that gets through. A regular sees a D.V diving straight out of the
   sun at ~600 m instead of ~3.4 km (`perception.realsim.test.ts`). Contacts keep
   the last-seen position and velocity and a `visible` flag; an enemy in cloud
   is forgotten after `memory` s. `likelySpottedBy(self, watcher)` estimates
   whether a watcher has seen us (an AI's real contacts, or for the player a
   veteran's range, a 35° blind cone below the tail, sun and cloud). Target scoring
   prefers enemies attacking friends, damaged enemies, two-seaters for
   intercepts, and spreads targets across a flight. Pursuit: intercept → pure →
   lead (with target acceleration, and bullet drag in the time of flight:
   `leadSolution` inverts the sim's quadratic round drag, `BULLET_DRAG_K`) → lag
   when overshooting, range-hold on the six. Energy fighters (SPAD, S.E.5a, D.VII, Pfalz…) extend and zoom after a
   pass; turners stay in the turn. Aces climb for height before engaging and
   approach two-seaters from below. Tactical character (`tactics.ts`; DECISIONS
   "Tactics: stalking out of the sun…") adds patience, a preferred height advantage,
   sun use, straggler and two-seater bias, burst and range scale and a disengage
   threshold, from skill and from a named ace's signature (`Ace.tactics`:
   stalker, lone-hunter, leader, brawler, two-seater-hunter, calculated). A patient
   pilot who hasn't been spotted *stalks*: he works round to the sun's bearing from
   the target 1.5–3 km out, closes level at his height, then comes down the sun
   line so the glare hides him. A pursuer who loses a target more than 350 m away
   flies to where it was heading. A pilot going home hurt with a scout near makes
   for the nearest cloud and wanders inside for 12–20 s. Veterans and aces turn up
   into a bounce from above (Dicta Boelcke). Boom-and-zoom by matchup was built and
   measured worse, so it is off (`TACTICS_FLAGS`; DECISIONS "Boom-and-zoom…").
   Defence: break, climbing turn, spiral,
   split-S, jinking, extension, chosen by skill, type and height. Below 350 m
   AGL (`LOW_AGL`) everything is flown level: level breaks, flat jinks, and
   energy fighters with a lead extend along the deck toward home. Flat scissors
   were tried and measured worse (DECISIONS.md "Low-level defence").
   Collision avoidance covers airborne wrecks as well as live aircraft (~4 s /
   450 m look-ahead). It gives the player, who won't dodge for the AI, and a
   flight-mate on the same target a 45 m radius (32 m otherwise), and a real
   conflict lifts the manoeuvre's g cap. A closing pass is broken off 1.8 s out
   (not at 55 m) with a committed 0.8 s escape: away from the closest-approach
   point, or up the lift line when dead ahead (DECISIONS.md "Collision avoidance:
   early committed head-on break").
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
   - **Target choice:** AA guns count 4 km further away, so flak is strafed only when
     nothing else is left (it is never an objective).
   - **Leaving the target:** at most 3 ground / 4 balloon passes, and the attack ends with
     45% (ground) / 20% (balloon) fixed-gun ammunition left for the fight home. Between
     runs, after at least one pass, an enemy scout within 3.5 km ends the attack: the
     flight leaves at speed instead of zooming up for another slow pass. Strafing keeps
     1.6–1.7 Vs through the approach and pull-out and sets up 250 m above the target.
   - **Fighting back on the way home:** after a voluntary RTB (ordered home, mission or
     escort complete), a fit fighter (undamaged, > 20% ammo) engages a scout within
     1.2 km that is attacking it or its leader, then resumes the RTB.

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
  rate is fed forward to cancel that lag. The law settles where the *tail* AoA meets
  the command, and propeller slipstream lowers the tail AoA at low speed under power,
  so the desired wing AoA is divided by `tailPressureRatio(ac, env)` (src/sim) before
  inverting; without it the wing overshot by 10–30% and "safe" commands stalled. A
  wounded pilot's reduced pull (`1 − 0.35·wounds`) is compensated the same way. The
  stall margin (2.2° novice → 1° ace) protects the *settled* AoA; `stallMarginDeg`
  overrides it (the mouse-aim instructor presets: relaxed 3.2°, standard 1.8°,
  authentic 1.3°) independently of `diveCaution`.
- **Energy-aware g.** Usable g tapers toward 1 as true airspeed approaches ~1.12 Vs
  (full at ~1.4 Vs), so a scout flies out of a bleeding turn instead of stalling.
  Stall recovery exits at 1.15 Vs below 400 m AGL (1.25 Vs higher) once the AoA is
  back inside the margin, holding up to 1 g near the ground.
- **Fine aim.** Within 10° of an aim point the lateral proportional demand is softened
  (more for slow rollers such as the E.III) and a proportional, yaw-damped rudder takes
  up the rest, which stopped wing-rocking on a near solution. A demand that cancels
  gravity at large errors (target behind and below) rolls into a 75° descending turn
  instead of sitting wings-level.
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
  Wave-5 surveys: `AI_SOAK=lowlevel AI_SEEDS=16 AI_OUT=… pnpm vitest run src/ai/lowlevel.soak.test.ts`
  (low-altitude fights: losses, ground impacts, stalled time, recovery share of engage
  time); `AI_SOAK=dither|dithertrace` in `aimDither.realsim.test.ts` (mouse-aim bank
  activity near the aim); `AI_SOAK=lossdiag` (how the veteran autoplayer dies in career
  missions) and `AI_SOAK=quickdiag AI_Q=dvii|camel AI_QSEED=n` (5 s trace of a quick
  ground attack; `AI_Q=default` is the Quick Mission screen's setup).
  Wave-6 surveys: `AI_SOAK=collision AI_SEEDS=150` (`collision.soak.test.ts`: 4v4 furballs,
  the same with a human stand-in leader without avoidance, a 5-ship vic; collisions by pair
  and geometry, plus kills and first-kill time) and `AI_SOAK=fairness AI_FAIR_SET=default|mirror|matrix|camel|survey|vet|even
  AI_FAIR_REPS=24` (`fairness.soak.test.ts`: quick-dogfight win %, player losses, exchange).
  Wave 7: `AI_SOAK=gundiag AI_GD_SET=default|reverse|mirror AI_GD_REPS=8 [AI_GD_TRACE=200]`
  (`gundiag.soak.test.ts`: per type and side, seconds within 500 m, nose within 30°/10°,
  guns-solution and firing time, rounds, hits split head-on/tail, hit %, stalled and
  defending time; logs every structural failure with its damage; optional 2 s trace).
- `gunnery.test.ts` (CI): the lead solution against a target in a 35°/s level turn puts a
  sim-integrated round (drag, gravity) within 1 / 1.5 / 2.5 m at 150 / 250 / 400 m for
  both muzzle velocities; dropping the acceleration term misses by 3× more; a 400 m
  Vickers round takes 0.55-0.7 s.
- `perception.test.ts` (CI): glare by skill and sun angle, glare gone under overcast or
  with a low sun, cloud occlusion and memory expiry, `likelySpottedBy`, and the cost of a
  16-aircraft sweep round in cumulus (~0.4 ms; strict budget 1.5 ms under PERF_STRICT=1).
  `perception.realsim.test.ts`: a regular spots a D.V out of the sun at ~600 m against
  ~3.4 km with the sun behind it (6 seeds).
- `stalk.realsim.test.ts` (CI, < 1 s): a stalker-signature D.V ace against an unaware
  patrolling Nieuport in a low November sun, 5 start bearings, against stalking off:
  entries inside 600 m up-sun (< 16°) and unseen in at least 3 of 5, and more than
  without. `cloudEscape.realsim.test.ts` (CI, < 1 s): a wounded D.V with a veteran Camel
  1.3 km behind and a cumulus 900 m ahead, 6 seeds, against escape and memory pursuit
  off: > 30 s more in cloud and > 1.5× the time out of the pursuer's sight.
- `AI_SOAK=energy pnpm vitest run src/ai/energy.soak.test.ts`: each fighter dives 800 m
  from cruise and zooms back; top speed and net height (the D.V's dive limit is why
  boom-and-zoom loses). `gundiag` also reports entry geometry per side: passes, share
  from above (> 100 m), up-sun (< 15°), unseen (not in the target's contacts), height
  advantage, and time in a sustained flat turn. `AI_TACTICS=stalk=0,...` flips
  `TACTICS_FLAGS` in the fairness, gundiag and autoplay soaks.
- `collision.realsim.test.ts` (CI, ~15 s): 20 4v4 furballs with a leader who doesn't dodge;
  at most one collision involving him. `strafe.test.ts`: strafers pick the battery over
  the flak gun at the waypoint.
- `aimDither.realsim.test.ts` and `instructorMargin.realsim.test.ts` (CI): E.III and
  Camel settle on a mouse-aim point without wing-rocking; the instructor presets order
  their stall margins relaxed > standard > authentic and relaxed never stalls a Camel or
  D.V in a sustained maximum turn.
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

### Wave 5: low-level fights and survivability

| Measure | Before | After |
|---|---|---|
| Low-level survey, 16 seeds × 5 matchups: low flight / attackers lost | 46 / 84 of 160 | 40 / 59 of 160 |
| Ground impacts in that survey | 19 | 5 |
| Stall-recovery share of engage time (A / B) | 11.4% / 11.6% | 5.4% / 3.9% |
| Seconds stalled | 1,880 | ~590 |
| Veteran autoplayer career deaths | 31% (13/42) | 18% (10/56) |
| Quick ground attack (veteran defenders): killed + captured / returned | 88% / 13% | 75% / 25% |
| E.III mouse-aim bank rate near the aim (standard) | ~20°/s | ~14°/s |

### Wave 6: quick-mission balance and collisions

| Measure | Before | After |
|---|---|---|
| Quick ground attack, screen default (24 seeds): success / killed+captured | 38% / 21% | 100% / 13% |
| Quick ground attack, Camel v 3 Dr.I | 42% / 46% | 92% / 29% |
| Quick ground attack, D.VII v 2 veteran SPADs | 88% / 71% | 96% / 63% |
| Collision soak, human stand-in leader: collisions per 100 fights / leader lost | 21 / 35 of 150 | 4 / 6 of 150 |
| Career survey collisions per 100 missions | 8.5 (353 missions) | 3.5 (719) |
| Career player losses to collision | 2.5% | 1.0% |
| Career killed+captured (veteran autoplayer) | 25.2% | 25.0% |
| Quick dogfight, screen default (Camel+1 v 2 regular D.V): player down | — | 4% |

### Wave 7 results (drag-aware lead)

Fairness runs: 16 seeds per setup, veteran autoplayer plus one regular wingman against
two enemies; ±12% noise.

| Measure | Before | After |
|---|---|---|
| Default dogfight (Camel+1 v 2 regular D.V): player down | 0% | 6% (0–6% over three runs) |
| Same, veteran D.Vs | 13% | 6% |
| Camel v 2 veteran Dr.I | 56% | 69% |
| Mirror fights, player down (Camel / D.V / Dr.I / SPAD XIII / D.VII) | 44 / 56 / 44 / 19 / 44% | 56 / 25 / 13 / 38 / 25% |
| Quick ground attack, screen default (24 seeds): success / killed+captured | 100% / 13% (wave 6) | 96% / 8% |
| Career killed+captured, veteran autoplayer | 25% (719 missions, wave 6) | 29% (113 missions, ±4%) |
| Hits within the fight, D.V / veteran Camel / regular Camel (`gundiag`, 8 runs) | 38 / 277 / 417 | 27 / 270 / 220 |

### Wave 8 results (tactics: stalking, cloud refuge, memory pursuit, ace signatures)

"Off" is the same code with `AI_TACTICS=stalk=0,cloudEscape=0,meetBounce=0,memoryPursuit=0`,
on the same seeds (boom-and-zoom is off in both; DECISIONS "Boom-and-zoom measured and
rejected"). Veteran autoplayer plus one regular wingman against two enemies; 24 runs per
setup, about ±10% noise.

| Measure | Off | On |
|---|---|---|
| Default dogfight (Camel+1 v 2 regular D.V): player down (fairness, 24) | 4% | 4% |
| Mirror, player down (Camel / D.V / Dr.I / SPAD XIII / D.VII; 24 each) | 33 / 21 / 25 / 29 / 29% | 13 / 38 / 42 / 29 / 21% |
| Camel v D.VII / D.VII v Camel (24) | 29 / 71% | 8 / 88% |
| Dr.I v SPAD / SPAD v Dr.I (24) | 8 / 83% | 8 / 83% |
| Dr.I v S.E.5a / S.E.5a v Dr.I (24) | 4 / 88% | 4 / 83% |
| Quick default dogfight (autoplay, 24): success / killed+captured | 96% / 0% | 100% / 0% |
| Quick default ground attack (autoplay, 24): success / killed+captured | 96% / 8% | 96% / 8% |
| Collisions in those 48 quick missions | 0 | 0 |
| Enemy entries from above or up-sun, head-on quick fight (`gundiag`, 24): regular / novice / ace D.V | 7 / 7 / 16% | 11 / 5 / 19% |
| Stalker ace v unaware patrol, low sun (`stalk.realsim`, 5 seeds): entries up-sun / unseen | 0 / 0 of 5 | 5 / 3 of 5 |
| Wounded pilot, cumulus 900 m ahead (`cloudEscape.realsim`, 6 seeds): s in cloud / s out of pursuer's sight / hits taken | 46 / 57 / 213 | 126 / 151 / 227 |
| Veteran career killed+captured (`AUTOPLAY_MISSIONS=10`) | 24% (19 of 78 missions) | 16% (15 of 91) |
| Career collisions per 100 missions | 5.1 (4 of 78) | 3.3 (3 of 91) |

The mirror swings (Camel 33→13%, D.V 21→38%, Dr.I 25→42%) go both ways and sit inside
the noise for 24 runs of a 2v2. Read them as no net change. None of the quick setups tests
stalking. In the head-on start both flights see each other before 2.6 km, so a stalker is
spotted before he can set up and the entry shares barely move. The stalk and cloud effects
show in the real-sim tests, and should show in career patrols and intercepts, where
flights meet beyond spotting range, and in a quick dogfight with
`startPosition: 'disadvantage'` (enemy 1.6 km behind and 500 m above, in the player's
blind cone) against a named ace in a low sun.

The career survey (`AUTOPLAY=career AUTOPLAY_MISSIONS=10 AUTOPLAY_OUT=<scratch>/career.txt
pnpm vitest run src/game/autoplay.soak.test.ts`, off with the `AI_TACTICS=...` prefix) is
one run each. A pilot's career ends when he is killed, so the two runs fly different
missions (78 against 91), and the gap is about ±5%. Read it as "no worse", not as a gain.
Run `career` and `quick` as separate invocations: both write to `AUTOPLAY_OUT` from the
start, so a combined run keeps only the quick table.

### Known weaknesses

- **The default quick dogfight stays lopsided** (Camel+1 v 2 regular D.V: player down 4%,
  24 runs). The target of 20–40% with no flight-model changes was not reachable, and it
  is reset here. The D.V can't out-turn a Camel (44 against 31 kg/m²), can't out-dive it
  (`AI_SOAK=energy`: 74 against 80 m/s, a low `vne` from structural strength 0.55) and
  can't out-zoom it (net −221 against −247 m after a dive and zoom). Boom-and-zoom made
  every matchup worse (DECISIONS "Boom-and-zoom measured and rejected"). Changing it takes
  a flight-model change or a different default enemy (D-071).
- **Stalking only fires where the attacker starts unseen.** In head-on quick fights both
  sides spot each other first, so entries from above or up-sun stay near 10% for regulars
  (19% for aces). The acceptance metric needs a setup where flights meet beyond spotting
  range (see Wave 8).
- **Cloud escape hides a pilot but doesn't save him.** A pursuer within ~200 m still sees
  into cloud (perception's `range × transmittance` model is lenient at short range), and
  the refuge lasts 12–20 s before he heads home again. A wounded pilot takes as many hits
  as without it.
- **The sun only helps against an unaware target.** Glare is a spotting penalty. A pilot
  who already has you in sight keeps you through the sun. That matches perception's
  contact model, but it means sun tactics never help in a turning fight.
- Quick ground attacks against *veteran* scouts remain very dangerous (63% killed or
  captured, wave 6).
- Equal turn fights between regulars can still circle for minutes (up to 24% of a
  Camel-mirror fight in a sustained flat turn, `gundiag`). The high yo-yo was measured with
  no effect in wave 7 and was not rebuilt.
- The old survey setups (Camel+2 v 3 Dr.I at random start, D.VII+1 v 2 veteran SPADs)
  put the player down 83% and 50%. Both are hard by construction.
- Wingman formation keeping for the slowest types (Dr.I, Nieuport 17) can lag by
  a few hundred metres after a long climb; it holds < 40 m once joined.
- Landing uses the aerodrome's runway heading, not the wind.
