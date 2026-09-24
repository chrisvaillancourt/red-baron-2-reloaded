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
});

// Each AI tick, before stepFlight for that aircraft. 30 Hz is the tested
// default (it is also fine at the full 120 Hz sim rate):
ai.update(ac, world, dtSinceLastAiUpdate);

// Wingman orders from the player (keys 1-5):
ai.command('attack-my-target', playerTargetId);   // or 'engage-at-will' | 'form-up' | 'cover-me' | 'return-home'
```

Extra read-only state on the returned `AIPilot` (not in the `AIController` interface):

| Field | Use |
|---|---|
| `phase` | `'landed'` means the aircraft has stopped on a friendly field: despawn it with outcome `'landed-friendly'`. `'out'` = dead/removed. |
| `debugState` | e.g. `engage #12`, `defend break`, `rtb`, `landing`, plus `recover` / `pull-up` flags. |
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

Skill is continuous (`skill.ts`): novice → ace changes spotting, reaction
delay, aim noise, lead error, fire range and cone, burst discipline, g
tolerance, target fixation and check-six frequency.

## Tests

The AI was developed against `testing/pointMassModel.ts`, a small
rate-limited-roll / commanded-load-factor model, via `testing/testWorld.ts`
(`TestWorld` + `runScenario`). Scenario tests cover waypoints, formation (mean
slot error < 30 m), ace-vs-novice gunnery, defensive survival, low-level
terrain, RTB, landing, balloon and ground attack, escort, a 4v4 furball, the
rear-gunner hook, wingman orders, and robustness to deliberately mismatched
flight models (soft/hot elevator with trim error, sluggish/twitchy roll).

## Retuning against the real flight model (wave 2)

Gains live in `defaultGains()` (autopilot.ts). Expect to revisit:

- `gFeedForward` / `gKp` / `gKi`: stick-to-g mapping of the real model.
- `rollKp` / `rollKd`: the real roll response and adverse yaw; rotary torque
  will show up as a steady roll bias the PD must fight.
- `stallAoa` and the CLmax used for `stallSpeed` in `traits.ts`: set them from
  the sim's actual coefficients (or read them from src/sim if it exports them).
- `slipK`: sign and size depend on how the sim computes sideslip (the AI
  computes its own β from velocity and orientation, so only the size should
  need changing).
- Scenario thresholds in the tests were set on the point-mass model; rerun the
  same scenarios on `stepFlight` and adjust.
