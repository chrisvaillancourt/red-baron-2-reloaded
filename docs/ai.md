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
  setGunnerTarget: combat.setGunnerTarget,  // src/sim gunner hook: (ac, targetId | null, station?) => void
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
   the light that gets through; below 0.3 (~100 m of core) nothing is seen at
   any range (D-081). A regular sees a D.V diving straight out of the
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
   for the nearest cloud and circles its core for 25–40 s. Veterans and aces turn up
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
   `attack-balloon`, `attack-ground`, `bomb` (see "Bombers"), `land`), vic formation keeping, escort
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

## Bombers (`bombing.ts`, bombers wave 1)

A flight tasked `bomb` is a bomber formation. The game layer loads its bombs (`loadBombs`,
src/sim); the AI only releases them, through the held `controls.releaseBomb` (one bomb per
false-to-true change; it sets the flag for one AI tick and clears it the next).

- **The bomb run** (`'bomb'` waypoint, phase `bomb-run`). The leader, or a bomber alone,
  approaches at the waypoint's height and aims at one of the live enemy ground targets within
  1.5 km of it (flak only when nothing else is left). He picks the target whose stick puts
  the most of his formation's tracks within blast reach of a target: each bomber that
  releases on him passes a fixed distance to his side, so the pick is scored over those
  offsets, ties going to the least correction (`chooseAimTarget`). From 5 km out
  (`RUN_START_M`) he flies straight and level: heading corrections of at most about 11°, at
  most 1.4 g, holding the height, to lay the predicted impact (`predictBombImpact`) onto the
  target.
- **Release.** He starts his stick when the predicted impact is half a stick short of the
  target, so the stick straddles it: all his bombs, 0.25 s apart (rounded up to whole AI
  ticks, about 13 m apart at a D.H.4 formation's speed). More than 35 m off to one side, he
  goes round (4.5 km back along the run, in banked turns) for another run; on the third he
  releases anyway.
- **The formation releases on its leader**, as crews did. A bomber keeping station sees his
  leader's first bomb go (`getBombStats(leader).dropped`, so a human leader works the same
  way), notes where it falls, and starts his own stick when his own predicted impact comes
  abreast of it (at most 4 s later). His speed and his place in the vic change how far his
  bombs are thrown, so he times it on his own sight rather than a fixed delay. The quick
  raid's targets are laid out 45-50 m apart across the run for this reason.
- **Straight and level, and together.** A bomber in formation (a leader or a flight-mate
  within 600 m, not going home alone) holds it under attack: no defensive manoeuvres, and a
  hurt man ('wounded', 'airframe damaged') keeps his place instead of going home alone. His
  gunner does the fighting. Nobody jinks on the run. A bomber alone defends himself like a
  two-seater, and a failing engine, fire or fuel still sends a man home
  (`TACTICS_FLAGS.bomberFormation`, on).
- **Leading.** A formation's leader flies at 0.72 of his top speed (a lone machine cruises at
  0.8), so the formation can keep station, on the run and on the way home. Wingmen keep his
  place on the route, so if he falls the next man leads on from there. Bombers with bombs
  still aboard don't follow a leader who turns for home hurt before bombing: the next man
  takes them on to the target.
- **Nothing to drop** (no bombs aboard, or the bomb aimer dead: the sim refuses a release
  without him): the `'bomb'` waypoint is flown over like a `'fly'` one.
- **Home.** After the run the formation flies on over the target, to the next waypoint and
  home (the quick raid's rally point, then its aerodrome).
- **Gunners, one per crew member.** On a type with one gunner (every two-seater, the D.H.4)
  the AI keeps the old choice: the nearest enemy within 650 m in the 115° cone his gun
  faces, one attacking us counting at half the range, set with `setGunnerTarget(ac, id)`.
  On a type with several (explicit `crewStations`: the Gotha, the O/400) each live man
  (`crewWounds`) takes the enemy his own stations bear on (`inFireArcs`), nearest first,
  one attacking us at half the range and one attacking a formation-mate within 400 m at 0.7
  of it. It is set with `setGunnerTarget(ac, id, station)` at the station that bears. With
  nothing in his arcs, or dead, his override is cleared and the sim's own choice stands
  (docs/sim.md "Gunners"). `stationGunners.test.ts` checks it on the sim's twin fixture.

### Fighters against bombers

- **Interceptors go for the bombers.** A `defend`-tasked fighter (the quick raid's
  interceptors, career defenders) scores a bomber (`role: 'bomber'`, or bombs aboard) +0.9
  instead of the +0.5 any other two-seater gets, and an escort fighter that isn't attacking
  him or his flight −0.3. An escort that comes at him is fought as before (+0.4), and
  defence (D-085) is unchanged.
- **From the blind spot** (`steerBlindSpot`, `TACTICS_FLAGS.blindSpot`, on). A pilot above
  novice attacking a bomber from 250 m to 1.8 km first works round to where the fewest of
  its live gunners can bear (`blindSpot`): candidate directions below and behind, below the
  beam and ahead and below, tested against the station arcs (`inFireArcs`, dead men left
  out). Of the least covered he takes the one nearest his present bearing, with ahead of the
  beam costing 150° more, so below and behind wins for every type whose tail it leaves open
  (every two-seater and the D.H.4). He flies to a point 300-600 m out along it, never below
  the ground margin, and once inside a 25° cone of it (or inside 250 m) the ordinary pursuit
  takes over.
- **Escorts stay with the bombers.** A bombers' escort (`escort` task on a `bomb` flight)
  goes only for a scout coming at a bomber (`isAttacking` within 1.5 km) or at itself
  within 700 m, and keeps its target only while he stays within 1.2 km of a bomber. It lets a
  shadower or a runner go and returns to its station 300 m above and 250 m behind the
  leading bomber. Escorts of recon two-seaters keep the older rule (anything within 1.8 km of
  them).

`interceptors.realsim.test.ts` (CI, ~3 s): a veteran D.VII meeting a pair of D.H.4s from
ahead, 8 seeds, with the blind-spot approach off and on: within 700 m it spends 57% and 87%
of the time outside the bombers' gunner arcs, and takes 33 and 5 hits from them, for about
the same hits on the bombers (347 and 341). An interceptor picks the bombers 2.5 km off over
an escort crossing 250 m away. An escort Camel doesn't chase a D.V shadowing its bombers
1.3 km off and stays within 700 m of them, and it engages a D.V that attacks them.

`bombers.realsim.test.ts` (CI, ~4 s): three D.H.4s bomb a depot of three dumps 45 m apart.
All 12 bombs go, at least 7 burst within blast range (about 19 m from a dump's walls), the
wingmen release after the leader, the run's last 20 s are within 12° of bank and 80 m of
height, and the formation then heads for its rally point together. Under attack by two
veteran D.VIIs (3 seeds), nobody breaks off to defend while a flight-mate flies beside him,
the wingmen hold their slots within 60 m on average up to the release, and the leader bombs
every time.

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

**A/B measurement.** Use `node tools/dev/ab.mjs` rather than hand-launching paired soaks.
It runs a soak with a tactic off and on (`--flag <TACTICS_FLAGS name>`), or at another
commit (`--base <ref>`), on the same seeds and in parallel. It prints both sides with 95%
intervals and a "within noise" or "differs" verdict. For example:
`node tools/dev/ab.mjs --soak career --flag stalk` runs 3 seed sets per side, and
`node tools/dev/ab.mjs --soak fairness --set default,mirror --reps 48 --flag stalk`. The
career and quick surveys end with a `RATES` line: killed or captured and collisions per 100
missions, both with intervals. Collisions count every event; `playerColl` is the player's.

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
  `TACTICS_FLAGS` in the fairness, gundiag, ambush and autoplay soaks.
- `AI_SOAK=ambush AI_AMBUSH_REPS=14 pnpm vitest run src/ai/ambush.soak.test.ts`: attack entry
  by skill where stalking can apply (the stalk test's geometry, 7 start bearings), for
  novice, regular, veteran, ace and a stalker-signature ace: first passes from above,
  up-sun and unseen. It takes ~4 min.
- `AI_SOAK=tailhold AI_TH_SET=default,mirror,energy,low AI_TH_REPS=12 pnpm vitest run
  src/ai/tailhold.soak.test.ts` (~3 min): for each defender type and side, how long an
  enemy held its tail (inside 400 m, within 60° of astern), and meanwhile its circling
  share, bank, height change, AI states, and hits taken per state. It also counts crashes.
  `low` is the wave-9 playtest report's setup.
  The tail-hold lines also give the visible variety: `varied` (the share of held time not
  in a constant-direction turn) and `kinds/episode` (distinct AI states per tail-hold of
  3 s or more). `AUTOPLAY_PILOT=human` flies the player with the human-like aim, and the
  `vs player` lines count only tail-holds by the player.
- `defence.realsim.test.ts` (CI, ~7 s): an enemy parked 200 m behind a veteran D.VII at
  2,000 m and an ace D.VII at 300 m, 24 seeds, with escalating defence on and off, against
  both the veteran autoplayer and the human-like pursuer. With it on he takes no more hits
  (fewer at height), is shot down no more often, nobody flies into the ground untouched, at
  height he spends more of the fight attacking, and against the human-like pursuer less of
  the tail-hold is one constant-direction turn. `DEFENCE_AB=off,brake,ladder,mix` prints
  each defence instead (with `AUTOPLAY_PILOT=human` for the human-like pursuer), and
  `DEFENCE_TRACE=1` hits per second by state.
- In-engine proof: `node tools/playtest/ai-depth-shots.mjs <out> <port> sun|cloud|defence`
  (dev server, seeded with `SEED=n`) logs each shot's AI state, range, sun angle and cloud
  density, and for the `defence` scene the wingman's state, range and both speeds. The
  browser fight isn't deterministic, so `WHEN=<regex>` shoots only while the enemy's AI
  state matches (e.g. `WHEN=reversal`); `SHOTS=from:to:step` and `CAMS=` override the
  scene's times and cameras.
- `humanAim.test.ts` (CI): the human-like aim's lag, reaction delay and fire discipline.
  `src/game/aimStats.test.ts`: the gunnery telemetry's split by mount and its histograms.
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
| Camel mirror re-run (lead, 48 each) | 44% | 35% |
| Camel v D.VII / D.VII v Camel (24) | 29 / 71% | 8 / 88% |
| Dr.I v SPAD / SPAD v Dr.I (24) | 8 / 83% | 8 / 83% |
| Dr.I v S.E.5a / S.E.5a v Dr.I (24) | 4 / 88% | 4 / 83% |
| Quick default dogfight (autoplay, 24): success / killed+captured | 96% / 0% | 100% / 0% |
| Quick default ground attack (autoplay, 24): success / killed+captured | 96% / 8% | 96% / 8% |
| Collisions in those 48 quick missions | 0 | 0 |
| Enemy entries from above or up-sun, head-on quick fight (`gundiag`, 24): regular / novice / ace D.V | 7 / 7 / 16% | 11 / 5 / 19% |
| Stalker ace v unaware patrol, low sun (`stalk.realsim`, 5 seeds): entries up-sun / unseen | 0 / 0 of 5 | 5 / 5 of 5, 2–4° off the sun (after the lead's constant-bearing fix; 5 / 3 before) |
| First passes from above or up-sun where stalking can apply (`AI_SOAK=ambush`, 14 each): novice / regular / veteran / ace / stalker ace | 0 / 0 / 43 / 38 / 38% | 0 / 0 / 57 / 62 / 100% |
| Same, unseen by the target: stalker ace | 0% | 100% |
| Wounded pilot, cumulus 900 m ahead (`cloudEscape.realsim`, 6 seeds): s in cloud / s out of pursuer's sight / hits taken | 46 / 57 / 213 | 126 / 151 / 227 |
| Veteran career killed+captured (`AUTOPLAY_MISSIONS=10`) | 24% (19 of 78 missions) | 16% (15 of 91); 21% (17 of 80) after the constant-bearing fix |
| Career collisions per 100 missions | 5.1 (4 of 78) | 3.3 (3 of 91); 3.8 (3 of 80) after the fix |

The mirror swings (Camel 33→13%, D.V 21→38%, Dr.I 25→42%) go both ways and sit inside
the noise for 24 runs of a 2v2. Read them as no net change. A 48-run re-run of the Camel
mirror put it at 35% on against 44% off, inside the 30–70% target. None of the quick setups tests
stalking. In the head-on start both flights see each other before 2.6 km, so a stalker is
spotted before he can set up and the entry shares barely move. The stalk and cloud effects
show in the real-sim tests, and should show in career patrols and intercepts, where
flights meet beyond spotting range, and in a quick dogfight with
`startPosition: 'disadvantage'` (enemy 1.6 km behind and 500 m above, in the player's
blind cone) against a named ace in a low sun.

In-engine proof (`tools/playtest/ai-depth-shots.mjs`):
- `docs/screenshots/ai-out-of-the-sun.jpg` (seed 3): René Fonck (stalker signature) comes
  down the sun line at a crossing D.V. He holds 3–4° off the sun from 2.3 km to 800 m. In the
  victim's view there is only glare, with no HUD box or threat cue. From behind the victim he
  is a speck beside the sun disc. The HUD first boxes him at 540 m.
- `docs/screenshots/ai-cloud-escape.jpg` (seed 1): a wounded D.V heading home with a Camel
  1.3 km behind turns into a cumulus at his own height. He is inside the core (density
  1.0) for about 15 s and comes out 2 km further on.

The career survey (`AUTOPLAY=career AUTOPLAY_MISSIONS=10 AUTOPLAY_OUT=<scratch>/career.txt
pnpm vitest run src/game/autoplay.soak.test.ts`, off with the `AI_TACTICS=...` prefix) is
one run each. A pilot's career ends when he is killed, so the two runs fly different
missions (78 against 91), and the gap is about ±5%. Read it as "no worse", not as a gain.
Run `career` and `quick` as separate invocations: both write to `AUTOPLAY_OUT` from the
start, so a combined run keeps only the quick table.

### Wave 9: default quick fight (D-078)

The Quick Mission default changed from 2 regular Albatros D.Vs to 2 veteran Fokker D.VIIs.
The player still flies a Camel with one regular wingman, head-on at 2,500 m. Results from
`AI_SOAK=fairness` with `AI_FAIR_SET=dvii`, `dviiground` and `dviitypes`. "Player down" counts
killed, captured and wounded, shown in brackets as killed/captured/wounded.

| Dogfight (96 runs each) | Win | Player down |
|---|---|---|
| Camel+1 v 2 regular D.VII | 92% | 7% (5/2/0) |
| **Camel+1 v 2 veteran D.VII (new default)** | 74% | **28% (22/3/2)** |
| Camel+novice wingman v 2 regular D.VII | 80% | 19% (10/2/6) |
| Camel alone v 2 regular D.VII | 5% | 89% (79/2/4) |
| Camel+1 v 3 regular D.VII (48 runs) | 23% | 75% (31/1/4) |

The wingman is the big lever: without one, a Camel against 2 regular D.VIIs goes down 89%
of the time. The veteran pair is the only setup inside the 20–40% target.

The defaults apply to every quick type (48 runs each), so the other types got harder too:

| Type | Old default: 2 regular D.V | New default: 2 veteran D.VII | 2 regular D.VII |
|---|---|---|---|
| Balloon attack | 13% (2/2/2) | 46% (15/0/7) | 15% (3/0/4) |
| Escort | 0% | 35% (5/4/8) | 8% (1/0/3) |
| Intercept | 4% (2/0/0) | 13% (5/0/1) | 10% (2/2/1) |
| Ground attack | 35% (6/0/11) | 29% (7/1/6) | 31% (7/2/6) |

Autoplay quick survey on the new defaults (24 runs of each type, `AUTOPLAY=quick
AUTOPLAY_QUICK_SETUPS=default`), success / killed / captured:
- dogfight 83% / 8% / 4%
- balloon attack 100% / 42% / 0%
- escort 96% / 4% / 4%
- intercept 88% / 17% / 0%
- ground attack 92% / 17% / 0%

There were no collisions in the 120 missions. Balloon attacks are the outlier: the D.VII
defenders scramble onto a Camel that is committed to its run. A quick-mission death ends
only that flight, so this was accepted. If playtests find it punishing, make the
first-visit enemy skill depend on the mission type.

### Wave 9: cloud cuts hits (D-081)

Instrumenting `cloudEscape.realsim` (per-hit: in cloud or not, seen or not) showed 162 of
the wounded pilot's 196 hits landing inside cloud, all with the pursuer seeing him: sight was
`range × transmittance`, so 4 km × 0.25 still reached 110 m into a core, and inside 350 m the
pursuer steered (and aimed) at his true position. Now below a transmittance of 0.3 (~100 m
of core) nothing is seen at any range. Memory pursuit also applies close in when cloud hides
the target, the gun gate skips a target cloud hides, and the refuge circles the core for
25–40 s instead of 12–20 s.

| Measure (6 seeds unless noted) | Refuge off | Refuge on |
|---|---|---|
| Hits taken, before (re-measured on `main`) | 213 | 196 (162 inside cloud) |
| Hits taken, after | 195 | 28 (none while unseen) |
| s in cloud / s out of the pursuer's sight, after | 79 / 124 | 273 / 350 |
| Old quick default (2 regular D.V), player down (24 runs) | | 4%, unchanged |
| Camel+1 v 2 regular D.VII, player down (24 runs) | | 8% (wave 8: 8%) |
| Veteran career, 3 seed sets: killed+captured / collisions per 100 missions (before → after) | | 19.7% → 22.4% / 3.4 → 5.5 (264 and 237 missions; within noise) |

A pursuer already 30–80 m behind as he enters still sees him (as a player would on screen),
so one seed that reaches cloud with the pursuer on him still takes 27 hits.

### Wave 9 re-baseline (commit f84cb16: D.VII default, D-078; cloud, D-081)

These were all measured on one commit after the wave-9 merges, with the veteran autoplayer
and the default tactics flags. They supersede earlier figures wherever the two differ.
- **Fairness** (`AI_SOAK=fairness`), player down (killed/captured/wounded):
  - `AI_FAIR_SET=default`, 96 runs: 28% (21/3/3), unchanged by the cloud work. With clear
    head-on starts (D-082) it is 30% (21/2/6), within noise.
  - `mirror`, 48 runs each: Camel 38%, D.V 52%, Dr.I 44%, SPAD XIII 31%, D.VII 23%.
- **Quick survey** (`AUTOPLAY=quick AUTOPLAY_QUICK_REPS=24 AUTOPLAY_QUICK_BY_SETUP=1`),
  success / killed / captured:

  | Type | Default (Camel+1 v 2 vet D.VII) | Camel+2 v 3 Dr.I, random start | D.VII+1 v 2 vet SPAD XIII |
  |---|---|---|---|
  | Dogfight | 83 / 8 / 4% | 38 / 38 / 17% | 33 / 63 / 4% |
  | Balloon attack | 100 / 42 / 0% | 96 / 21 / 17% | 96 / 46 / 8% |
  | Escort | 92 / 4 / 8% | 92 / 25 / 8% | 96 / 33 / 0% |
  | Intercept | 88 / 17 / 0% | 33 / 38 / 0% | 63 / 38 / 0% |
  | Ground attack | 92 / 17 / 0% | 88 / 25 / 0% | 96 / 63 / 0% |

  The second and third setups are hard by construction (see "Known weaknesses"). There
  were 15 collision events in the 360 missions, and 4 of them involved the player.
- **Career survey** (`AUTOPLAY=career AUTOPLAY_MISSIONS=10`, with `AUTOPLAY_SEED_BASE` 0,
  1000 and 2000 run as separate invocations): 245 missions, 21.6% killed or captured
  (48 killed, 5 captured, 30 wounded). There were 4 collision events (1.6 per 100
  missions) and none involved the player. Loss causes: enemy fire 34, flak or ground 13,
  self 6.
- **Ambush** (`AI_SOAK=ambush AI_AMBUSH_REPS=14`), first passes from above or up-sun:
  novice 0%, regular 0%, veteran 57%, ace 62%, stalker ace 100% (all unseen).

"Collisions per 100 missions" counts every collision event in the survey's `COLLISIONS`
line, whichever aircraft were involved. Collisions involving the player are the
`player-*` entries.

### Wave 9: defence (D-085)

**The complaint.** The first human playtest report
(`playtests/reports/2026-09-28-chris-brisfit-v-5-ace-dvii-low.json`) was a Bristol and 3
novice wingmen against 5 ace D.VIIs, head-on at 300 m. It was rated too easy: "enemy pilots
just fly in circles when you get into position behind them, there's no evasive maneuvers".
The player fired 1,035 rounds, hit 104 times and took only 3 hits in 375 s of combat.

**What the defenders did.** `AI_SOAK=tailhold` (`src/ai/testing/tailHold.ts`) records what
a defender does while an enemy holds his tail (inside 400 m, within 60° of dead astern):
- how much of that time he spends circling (turning the same way as 3 s earlier)
- his bank and height change
- his AI state, and the hits he takes in each state

With 12 runs per setup, defenders circled for 43–61% of their tail-held time. Every
manoeuvre that turns (break, spiral, climbing turn) turns toward the attacker. The attacker
sits inside the turn on the same side, so the choices chain into one circle. On the 300 m
report setup the aces had only the level break (D-060), and one ace had an enemy on his
tail for 63 s straight.

**The ladder the brief proposed, measured first.** The brief proposed escalating after a
failed break: scissors, a dive and zoom, a climbing spiral or a split-S, chosen by airframe.
It was built and tried in the real sim (`src/ai/defence.realsim.test.ts`, 8 seeds, a
veteran Camel starting 200 m behind). It made the defender worse every time:

| Version (D.VII defender, 8 seeds) | Hits taken, off → on | Shot down, off → on |
|---|---|---|
| Scissors, dive-and-zoom and climb ladder, Camel at 2,000 m | 151 → 282 | 3 → 7 |
| The same ladder, Bristol at 300 m | 53 → 173 | 0 → 3 |

**Why: hits taken per second of each state while the tail is held.** Real sim, D.VII,
Camel behind, 2,000 m:

| State | Hits/s |
|---|---|
| Spiral | 0.07 |
| Break | 0.16–0.23 |
| Climbing turn | 0.40–0.81 |
| Jink | 2.65 |

Across the soak setups the jink was consistently the worst (0.34–1.87 hits/s). Anything
that stops turning hands the pursuer an easy deflection. The circling is therefore the
right defence here, and the problem was that it was passive.

**What shipped (`TACTICS_FLAGS.escalateDefence`, on).** It applies once the same attacker
has survived a manoeuvre, to pilots above novice:
- **Brake turn** (veterans and aces, above 500 m, attacker inside 300 m and closing): the
  break with the throttle back and the nose a touch high. He overshoots, and the defender's
  existing counter-attack turns onto him.
- **Otherwise:**
  - a spiral, only above 1,500 m and never two in a row
  - else the break
- **No jinks** for pilots above novice with an enemy within 400 m.
- **Not on the way home.** With escalation there, a hurt pilot's spiral dropped him out of
  the bottom of his refuge cloud (D-081's cloud-escape test failed), so RTB keeps the old
  choices. He flies each one to its end; before round 3 an RTB pilot re-picked every tick.

The low-level rules are unchanged. The first version spiralled from 700 m and chained
spirals. That took fights down about 2.6 km a run, and quick-survey ground and flak losses
rose from 29 to 47. The 1,500 m, no-repeat gate brought them back to 31.

**Results, off → on, same seeds, final version (the escalation-off figures are
`AI_TACTICS=escalateDefence=0` on the same commit):**
- **Real sim** (8 seeds):
  - Camel on a veteran D.VII's tail at 2,000 m: hits taken 151 → 62, shot down 3 → 0, time
    spent attacking 134 → 257 s
  - Bristol on an ace D.VII's tail at 300 m: 53 → 57 hits, 0 → 0 down (no brake turn this
    low)
- **Tail-hold soak** (12 runs), hits the defender takes per run with an enemy on his tail:
  - the default fight's D.VIIs 58 → 43
  - D.VII mirror 54 → 29
  - Camel mirror 41 → 30
  - D.VIIs against a Camel player 69 → 48
  - the report's aces 35 → 32; their longest single tail-hold 63 → 33 s
  - circling share unchanged (31–64%)
- **Fairness**, player down:
  - default (96 runs): 30 → 26%, inside the 20–40% target (D-078)
  - mirrors (48 each): Camel 38 → 38%, D.V 46 → 38%, Dr.I 42 → 27%, SPAD XIII 31 → 10%,
    D.VII 25 → 25%. The brake turn is for veterans and aces, and in these mirrors the
    veteran autoplayer flies against regulars, so it helps the player's side. The SPAD
    mirror falls well below the 30–70% band.
  - energy set (24 each): the player's D.VII against Camels 96 → 58%, S.E.5a against Dr.I
    96 → 83%; the other four within one run of off
- **Quick survey** (360 missions):
  - enemy-fire losses 93 → 99
  - flak and ground plus self-crash losses 29 → 32
  - collisions 15 → 19; the player was involved in 4 → 3
  - AI-against-enemy collisions 7 → 14
    - nearly all happen with both aircraft in the attack code's *extend* phase, in the
      busy Camel+2 v 3 Dr.I setup
    - the same kind already happened 6 times with escalation off; more counter-attacks
      mean more mutual passes
    - (ending the brake turn early once the attacker is ahead was tried; it made no
      difference: 8 head-on)
  - self-crashes on the way home 1 → 4
- **Career survey** (3 seed sets, `AUTOPLAY_SEED_BASE` 0, 1000 and 2000):
  - killed or captured 21.2% (241 missions) → 20.4% (255)
  - collisions 5.8 → 6.3 per 100 missions (involving the player: 4 → 2)
  - self-crash losses 4 → 5
  - Careers after `f84cb16` draw different squadrons from the same seeds (Jasta 5 against
    Jasta 10 on the second mission), so career figures are only comparable within one
    commit.

**In game** (`tools/playtest/ai-depth-shots.mjs … defence`, seed 1): a veteran D.VII has
the player's ace Camel wingman 230 m behind at 2,000 m.
- t = 9–24 s: he brake-turns. It slows him at first; as the nose drops it becomes a
  descending turn, and his speed climbs from 44 to 77 m/s.
- The Camel closes to 65–100 m but can't hold the turn inside him.
- t = 28 s: he extends away 350 m clear.
- The frame at t = 12 s, the D.VII banked hard with the Camel 66 m behind, is
  `docs/screenshots/ai-defence-brake-turn.jpg`.

**Round 2: re-measured against a human-like pursuer.** Every figure above was against the
veteran autoplayer, which aims with a computed lead and near-instant reactions (FRICTION
F-23), so a change of direction may be punished harder than any human would. The four
designs were measured again against the human-like pursuer ("Human-like pursuer" below):
(a) `off`, main before wave 9; (b) `brake`, the brake turn without the reversal; (c)
`ladder`, `TACTICS_FLAGS.defenceLadder` (scissors, dive and zoom, climbing spiral, split-S
by airframe); (d) `final`, the brake turn plus a reversal (shipped).

Real sim (`DEFENCE_AB`, 24 seeds, 60 s each). *Varied* is the share of tail-hold time not
in a constant-direction turn. The 300 m hits include the Bristol observer's; its pilot's
fixed-gun hits are in brackets:

| Case, pursuer | (a) off | (b) brake | (c) ladder | (d) final |
|---|---|---|---|---|
| 2,000 m, human-like: hits / down / varied | 172 / 0 / 37% | 99 / 0 / 40% | 399 / 6 / 48% | 128 / 0 / 54% |
| 2,000 m, veteran | 441 / 7 / 39% | 227 / 3 / 41% | 647 / 14 / 40% | 193 / 2 / 45% |
| 300 m, human-like | 150 (51) / 1 / 55% | 155 (51) / 1 / 54% | 305 (216) / 5 / 49% | 176 (65) / 1 / 63% |
| 300 m, veteran | 160 (44) / 0 / 53% | 156 (40) / 0 / 53% | 488 (359) / 8 / 59% | 162 (48) / 0 / 62% |

Tail-hold soak, tail-holds by the player only (`vs player`, 36 runs each), hits the enemy
takes per run / varied / longest single tail-hold:

| Setup, player | (a) off | (b) brake | (c) ladder | (d) final |
|---|---|---|---|---|
| default, human-like | 11.1 / 31% / 289 s | 8.8 / 35% / 179 s | 15.4 / 61% / 175 s | 10.4 / 45% / 476 s |
| report 300 m, human-like | 12.5 / 51% / 182 s | 9.9 / 51% / 182 s | 12.6 / 51% / 124 s | 11.1 / 56% / 74 s |
| default, veteran | 31.6 / 42% / 73 s | 31.3 / 37% / 100 s | 33.1 / 66% / 279 s | 29.3 / 35% / 305 s |
| report 300 m, veteran | 17.4 / 54% / 63 s | 16.1 / 54% / 39 s | 24.8 / 48% / 90 s | 12.5 / 53% / 120 s |

Fairness default (96 runs), player down / enemies lost: veteran player (a) 30% / 161,
(b) 26% / 157, (c) 24% / 148, (d) 32% / 160; human-like player (a) 64% / 76, (b) 56% / 87,
(c) 39% / 83, (d) 48% / 87. `ab.mjs` calls every (a)-(d) pair here within noise.

What the human-like pursuer changes, and what it doesn't:
- **The ladder is still the worst in a one-on-one**, against either pursuer: 2-4x the hits
  and 5-14 of 24 shot down. Its climbing turn (the D.VII out-climbs the Camel) never shakes
  him (0.23 hits/s, 873 s of it at 2,000 m), and the jink is again the worst state (0.34
  hits/s low down). The human-like pursuer's reaction delay doesn't rescue a manoeuvre that
  stops turning. In the default fight it looks different: D.VIIs climb out of the fight, so
  both sides lose less (39% player down against the human-like player, enemy losses about
  the same). It disengages; it doesn't evade.
- **The brake turn is still the cheapest escape**: against the human-like pursuer the D.VII
  at 2,000 m takes 99 hits against 172. But it leaves the circle as it was (varied 37 → 40%).
- **A reversal breaks up the circle.** Flown whenever a third manoeuvre came up, it doubled
  the hits per second of tail-hold in the default fight against the human-like player
  (0.106 against 0.051). Gated on the attacker lagging (his nose more than 10° off and
  behind the defender, so no shot is on), from the second failed manoeuvre, it costs
  nothing measurable and raises *varied* in every setup: 37 → 54% at 2,000 m and 55 → 63%
  at 300 m in the real sim, 31 → 45% and 51 → 56% against the human-like player in the
  soak, where the report's longest single tail-hold falls from 182 to 74 s. That is (d).
- **The distinct-manoeuvres count barely moves** (1.7-2.7 per episode in every design):
  episodes are short, and a reversal is one more state, not a new repertoire.

Other checks of (d), `ab.mjs --flag escalateDefence` (A: off, B: final):
- fairness mirrors (48 runs each): all within noise; SPAD XIII 31 → 29%, back inside the
  30-70% band (the brake turn alone had taken it to 10-17%)
- energy set: all within noise (the player's D.VII against Camels 79 → 81%)
- quick survey (360 missions): killed or captured 35.8 → 34.7%, collisions 4.2 → 3.6 per
  100 missions (within noise); player collisions 4 → 4; AI-against-enemy 7 → 7, nearly all
  still both aircraft in *extend* after a pass; self-crashes on the way home 1 → 3
- career (3 seed sets): killed or captured 21.3 → 25.1%, collisions 4.9 → 5.5 per 100
  missions, both within noise

**Round 3: after the code-review fixes.** Five of the review's fixes change behaviour:
- RTB re-picked a defensive manoeuvre every tick, in every design including (a). It now
  flies each one to its end.
- The streak window is measured from the end of the last manoeuvre, not its start.
- The streak keeps the last manoeuvre's kind and side itself.
- The reversal turns against the side the last manoeuvre actually flew.
- The human-like pursuer no longer starts a burst on a shot the line-of-fire check blocks.

The human-like pursuer also changed in two smaller ways. It takes up a target from the nose,
not the flight path, and its noise now comes from `src/sim/rng`'s gaussian, which draws a
different stream.

Only (a) and (d) were re-run. At 24 seeds the real-sim rows swing by a third with the noise
stream alone: the 2,000 m human-like case went from 124 to 179 hits on the RNG change only.
So the real sim is now quoted at 96 seeds, before (`100350f`) → after:

| Case, pursuer (96 seeds) | (a) off | (d) final |
|---|---|---|
| 2,000 m, human-like: hits / down / varied | 770 / 9 / 37% → 645 / 0 / 41% | 619 / 4 / 51% → 432 / 1 / 53% |
| 2,000 m, veteran | 1,904 / 37 / 43% → 1,842 / 33 / 43% | 1,070 / 17 / 47% → 995 / 10 / 45% |
| 300 m, human-like | 628 (204) / 1 / 50% → 662 (211) / 1 / 52% | 716 (272) / 2 / 61% → 709 (275) / 0 / 62% |
| 300 m, veteran | 640 (151) / 2 / 55% → 632 (152) / 3 / 54% | 674 (211) / 1 / 61% → 641 (190) / 2 / 62% |

Tail-hold soak (`vs player`, 36 runs), hits per run / varied / longest single tail-hold,
round 2 → round 3:

| Setup, player | (a) off | (d) final |
|---|---|---|
| default, human-like | 11.1 / 31% / 289 s → 11.0 / 27% / 340 s | 10.4 / 45% / 476 s → 9.7 / 39% / 345 s |
| report 300 m, human-like | 12.5 / 51% / 182 s → 8.9 / 50% / 86 s | 11.1 / 56% / 74 s → 8.8 / 58% / 37 s |
| default, veteran | 31.6 / 42% / 73 s → 31.6 / 40% / 113 s | 29.3 / 35% / 305 s → 27.1 / 40% / 188 s |
| report 300 m, veteran | 17.4 / 54% / 63 s → 15.9 / 50% / 80 s | 12.5 / 53% / 120 s → 11.7 / 54% / 145 s |

`ab.mjs --flag escalateDefence`, (a) → (d); every row is within noise:
- **Fairness, default (96 runs):** player down 25.0 → 33.3% (veteran player) and 47.9 →
  46.9% (human-like player). In round 2 the human-like player's (a) was 64%. The pursuer
  fixes make the human-like player survive more whatever the defence.
- **Mirrors (48 each):**
  - Camel 48 → 46%, D.V 48 → 42%, Dr.I 35 → 33%, D.VII 31 → 25%.
  - SPAD XIII 33 → 25%, below the 30–70% band again (round 2: 29%).
- **Energy set:** D.VII against Camels 79 → 83%, S.E.5a against Dr.I 88 → 83%.
- **Quick survey (360 missions):**
  - killed or captured 30.8 → 36.4%
  - collisions 3.6 → 5.3 per 100 missions
  - player collisions 3 → 8. Four of the eight are one D.VII-v-SPAD dogfight, which
    repeats identically in reps 3, 4, 16 and 19 (the only mission of 360 that repeats), so 3
    → 5 distinct.
  - The Camel-v-Dr.I ones are both aircraft in the attack extension, the pre-existing
    weakness below. Watch this in the next wave.
- **Career (3 seed sets):**
  - killed or captured 22.6 → 20.9%
  - collisions 5.7 → 7.4 per 100 missions
  - player collisions 2 → 5

**(d) still wins.**
- **Real sim:** at 2,000 m it takes a third to a half fewer hits than (a) against both
  pursuers, and against the veteran 10 of 96 are shot down against 33 (1 against 0 with the
  human-like pursuer). At 300 m the hits are within 7% of (a) either way, and the tail-hold
  time out of a constant turn is 8–10 points higher.
- **Tail-hold soak:** (d) takes fewer hits than (a) in all four setups. It is as varied or
  more in all four; in the default fight against the human-like player it is 39% against
  (a)'s 27%.

**In game** (`WHEN=reversal`, seed 1): the veteran D.VII, with the ace Camel wingman 73 m
behind at 2,000 m, reverses at t = 13.5-15 s and the Camel is left rolling after him
(`docs/screenshots/ai-defence-reversal.jpg`, two frames side by side). The in-game
wingman aims like the AI, not the human-like pilot.

### Human-like pursuer (`src/ai/humanAim.ts`)

`AIControllerOptions.human` (the autoplayer's `pilot: 'human'`, or `AUTOPLAY_PILOT=human`
for any soak, the replay and `defence.realsim`) keeps the AI pilot's tactics but aims and
fires like a mouse-aim player. The parameters are `HUMAN_PILOT`:
- reads the target's motion 0.35 s late and extrapolates, so a reversal goes unnoticed that long
- holds 85% of the lead (the standard flight model has no lead marker)
- a slowly drifting misjudgement of the lead (0.42° 1-sigma, 3 s) and hand jitter (0.21°, 0.25 s)
- a 0.3 s first-order lag from where the nose pointed when he took up the target
- opens fire inside 380 m when the nose is within 3° plus the target's size of where he
  *believes* the lead is, in 0.9-2.1 s bursts, holding through misses inside 6°; no snap
  shots at other aircraft

`AUTOPLAY_HUMAN=aimLagS=0.4,biasDeg=1,...` overrides any field for sweeps.

**Calibration against the user's mouse-aim flights**, fixed guns only:
- `outcome.hits` counts the Bristol observer's AI-aimed Lewis with the pilot's Vickers. The
  Vickers carries 500 rounds, so the tracked report's 1,035 rounds include at least 535 from
  the Lewis (at most 679). At the Lewis's replayed accuracy (5.6-8.2%), the pilot hit with
  10-14% of his own rounds (10-20% if the Lewis did anywhere from 5 to 10%). The inbox
  8-D.VII dogfight (35 hits of 399) is about 9% whatever the split, because the total is
  near the Lewis's own rate.
- The same scene in `defence.realsim` is a Bristol behind an ace D.VII at 300 m. The fit
  was made on its first 24 seeds, where the veteran autoplayer and the shipped human-like
  values both hit 12%; with bias and jitter at 1, 0.6 and 0.35x the shipped values the
  human-like pilot got 6, 8 and 12%. Over 96 seeds both pursuers get 9% (the human-like 10%
  before the round-3 fixes), so the shipped values sit at the low edge of the human's
  10–14%. At 2,000 m behind a D.VII in a Camel the human-like pilot gets 7% against the
  veteran's 20%.
- **Replays don't fit.** Replaying the reports (`replay.soak`, 8 runs) the human-like pilot
  hits with 5% (tracked report) and 1% (inbox dogfight) of 38 and 17 fixed rounds a run. The
  human fired 356-500. The autoplayer's tactics never give it the human's firing
  geometry: it defends against the aces while the human sat behind circling ones. So the fit
  is to the tail-chase scene, and it is loose: two usable flights, a split that is only
  bounded, and one scene.
- **Balloons don't fit either**: the human hit 2 of 97 rounds (triplane, N.11), the
  human-like pilot 49-56% on the autoplayer's steady diving runs, the veteran 69-75%. Aim
  error can't explain that; the human's approach and firing range probably can, and the new
  telemetry records the range.
- **Future refits:** reports now carry `aim` (docs/game.md "Flight report"): the player's
  and the AI crew's rounds and hits, the aim error while his fixed guns fire, the firing range, and the
  time from a target entering the 10° cone to the first shot. Replaying a report prints the
  same figures for the autoplayer (`CALIB` line), so the next human flights can be compared
  directly.

### Known weaknesses

- **The D.V can't threaten a Camel.** This is why the default quick dogfight changed in
  wave 9 (D-078): it is now against 2 veteran D.VIIs, 28% player down over 96 runs. See
  "Wave 9: default quick fight" below. Against 2 regular D.Vs the player went down 4% of
  the time (24 runs), and no AI tactic moved it. The D.V can't out-turn a Camel (44 against 31 kg/m²), can't out-dive it
  (`AI_SOAK=energy`: 74 against 80 m/s, a low `vne` from structural strength 0.55) and
  can't out-zoom it (net −221 against −247 m after a dive and zoom). Boom-and-zoom made
  every matchup worse (DECISIONS "Boom-and-zoom measured and rejected"). Making the D.V
  itself dangerous would take a flight-model change.
- **Stalking only fires where the attacker starts unseen.** In head-on quick fights both
  sides spot each other first, so entries from above or up-sun stay near 10% for regulars
  (19% for aces). Where it can apply (`AI_SOAK=ambush`), aces enter 62% of first passes from
  above or up-sun against novices' 0%, and a stalker ace 100%, all unseen. Generic veterans
  and aces (no signature) are never unseen at the merge. Their patience (≤ 60 s) runs out
  before they reach the sun line, so only signature stalkers, leaders and calculated
  pilots really ambush.
- **Cloud escape only saves a pilot who gets in with some room** (fixed in wave 9, above:
  28 hits against 195). A pursuer already within 30–80 m as he enters still sees him.
- **The sun only helps against an unaware target.** Glare is a spotting penalty. A pilot
  who already has you in sight keeps you through the sun. That matches perception's
  contact model, but it means sun tactics never help in a turning fight.
- Quick ground attacks against *veteran* scouts remain very dangerous (63% killed or
  captured, wave 6).
- **Defenders still turn most of the time, by design.** Measured against both the veteran
  autoplayer and the human-like pursuer, the hard break, the spiral and the brake turn are
  the best defences in this flight model; everything that stops turning gets him hit more
  (see "Wave 9: defence"). What changed in wave 9: a veteran brake-turns to make you
  overshoot, and anyone above novice reverses when you fall into lag, so about half the
  tail-hold is out of one constant-direction turn (45-63%, from 31-55%). The count of
  distinct manoeuvres per tail-hold barely moved (about 2), and equal turn fights between
  regulars can still go on for minutes. The high yo-yo was measured with no effect in
  wave 7 and was not rebuilt.
- **Low down there is no new manoeuvre.** Below 500 m (D-060) there is no brake turn; the
  level break and now the reversal are all there is, because climbing breaks and jinks
  measured worse. The report's setup is still the one the user called too easy: what it
  lacks is threat from the aces nobody is chasing (mutual support), not evasion.
- **The human-like pursuer is a stand-in, fitted loosely** (see "Human-like pursuer"): one
  scene, two usable flights, and replays whose firing geometry doesn't match the human's.
  In the default fight it goes down about 47% of the time against the veteran's 25-33%, so
  judge fairness targets on the veteran and use the human-like pilot for relative
  comparisons.
  In the wave-9 playtest report (5 ace D.VIIs at 300 m), the aces spend nearly half their
  tail-held time in breaks either way. They take fewer hits with the jinks gone.
- The old survey setups (Camel+2 v 3 Dr.I at random start, D.VII+1 v 2 veteran SPADs)
  put the player down 83% and 50%. Both are hard by construction.
- Wingman formation keeping for the slowest types (Dr.I, Nieuport 17) can lag by
  a few hundred metres after a long climb; it holds < 40 m once joined.
- Landing uses the aerodrome's runway heading, not the wind.
