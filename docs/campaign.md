# Campaign

`src/campaign` implements `CampaignService` (src/core/interfaces.ts). Pure TS;
no scene code. Entry point:

```ts
import { createCampaignService } from './campaign';
const campaign = createCampaignService(); // localStorage, or memoryStorage() in tests
```

## Data (`src/data`)

| File | Contents |
|---|---|
| `squadrons.ts` | 29 squadrons (DE/GB/FR/US) with dated bases (aerodrome ids) and equipment; `SQUADRON_SUCCESSORS` for disbandments (FFA 62 → Jasta 2, Lafayette → 103rd Aero). |
| `aces.ts` | 43 historical aces: service periods by squadron/aircraft, dated victory milestones (linear between points, frozen at fate), fate. `aceVictoriesOn`, `aceServiceOn`. A gap between service periods (hospital, a home posting) shows as `'away'` in the ace standings (`standings.ts`). |
| `ranks.ts` | Rank ladders per nation; `requires` = victories OR missions to be promoted into a rank. |
| `medals.ts` | Decorations with criteria (thresholds may depend on date, e.g. Pour le Mérite 8/16/20). |
| `liveries.ts` | Factory finishes, squadron markings, ace colours, national insignia by date. `composeLivery()` layers them. |
| `history.ts` | Timeline of battles for briefing text and mission weighting. |

## Mission generation

`generateMission(pilot, aircraftChoice?, { startOnGround? })` is deterministic
for a pilot state (seed = pilot seed + missions flown + date). Flow: squadron
base → front anchor near the base → weighted mission type (side, year,
aircraft role, historical event emphasis) → plan (waypoints, enemy/friendly
flights, balloons, ground targets, objectives) → player flight (player leads;
historical aces serving in the squadron may fly as wingmen; generic mates from
a quarterly roster, `names.ts`; the Lafayette's Americans carry French ranks) → weather/time
of day → period-voice briefing.

Enemy fighters are drawn from real enemy squadrons based within 70 km, and
their aces appear with a probability scaled by the historical event's
intensity. Aces the career has killed/captured (`pilot.alteredAces`) never
reappear.

Default start: airborne `START_BEHIND_LINES_M` (3.5 km) behind the lines at
patrol altitude, lined up laterally with the point where the flight crosses
them (intercepts start 3 km behind the interception area instead). The long
ferry from the aerodrome is the `startOnGround` option.

**Pacing and odds** (tuned with the autoplayer, docs/game.md). Patrol lines
are 8 km long with the near end at the crossing point, targets sit 2.5–7 km
from the lines, and enemy flights start 3.5–7 km out with a `meetDelay` spawn
delay so they reach the player's first patrol point, escort target,
interception area or balloon line about when he does. First contact is
typically 1.5–2.5 sim minutes in. Balloon- and ground-attack defenders take
off low (~500 m above ground) rather than waiting above the targets.
Balloon defenders arrive ~40 s after the attackers; ground-attack defenders
arrive ~2 min after them, which leaves time for two or three strafing passes.
The player's
flight size is rolled before planning (`ctx.playerFlightSize`) and
`enemyCount` never exceeds it by more than one (two on 'ace' difficulty).
Generic enemy skill is mostly novice/regular on 'pilot'; named aces lead a
flight with probability ~0.22 × event intensity (×0.5 recruit, ×1.3 ace).
`startOnGround` parks the flight on the home aerodrome's runway heading.

**AI aircraft pools** (`aircraftPool` in `squadronUtil.ts`). Generic AI flights
(fighters with no squadron nearby, two-seater recon and bomber flights) draw a type of
their side and role in service on the date, or the earliest one when none is yet. Recon
flights fly two-seaters, and bomber flights fly bombers or two-seaters. The pools don't
read `flyable`, which only says the player may fly a type: they leave out only the
fighter two-seaters the AI flies as fighters (`AI_FIGHTER_TWO_SEATERS`, the Bristol
F.2b). So making a two-seater or bomber flyable doesn't change any AI flight
(`squadronUtil.test.ts`).

### Objective `targetIds`

| kind | targetIds refer to |
|---|---|
| destroy-aircraft, protect-flight | `MissionFlight.id` (count = members) |
| destroy-balloons, protect-balloons | `MissionBalloon.id` (protect: count must survive) |
| destroy-ground | `MissionGroundTarget.id` |
| reach-waypoint | `"<flightId>:<waypointIndex>"` |
| patrol-area | `["<flightId>:<wpA>", "<flightId>:<wpB>"]`, the patrol line's ends (one entry = a patrol point); `count` = seconds on station within 3 km (`PATROL_STATION_S` = 150) |

Patrols use `patrol-area` as the primary objective: hold the line for
`count` seconds **or** engage the enemy (5 hits or a kill by the player's
flight). The director fails objectives as soon as they can't be met: an
escort with too few charges left, an intercept whose targets are down or got
away (> 15 km, over their own lines), too few friendly balloons. An escort
completes early once its charges have crossed the lines and every survivor is
back over ours.

Flight ids: `player-1` for the player's flight, then `enemy-N` / `friendly-N`.
Waypoint `altitude` is metres ASL; balloon `altitude` is metres above ground.
`start.heading` is radians (0 = north, clockwise).

## Debrief (`applyMissionResult`)

1. Aerial claims (aircraft/balloons; ground claims ignored) confirmed with
   probability by difficulty, +witness, +wreck on own side, +balloon.
2. Victories, fame, altered aces (victim ace killed, or captured if downed on
   our side).
3. Fate: killed/captured end the career (`landed-enemy` → captured); wounds →
   `status: 'hospital'`, `hospitalDays`, date advanced past the stay (next
   `generateMission` returns the pilot to duty); a fourth serious wound
   invalids him out.
4. One promotion step and ≤2 medals per debrief (prerequisites must already be
   held). Personal colours at 5 (German) / 10 (Allied) victories.
5. Date advances 1–3 days (more in winter), capped at the Armistice →
   `status: 'war-over'`. Disbanded squadron → successor transfer. Historical
   ace deaths in the interval appear as mess news.
6. Logbook entry; narrative paragraphs + newspaper headline for milestones.

## Quick missions

`buildQuickMission(opts, seed?)` honours every `QuickMissionOptions` field;
the date defaults to the midpoint of both aircraft's overlapping service
(`servedTogether` in `src/data/aircraft.ts`), or of the player's own type when the two never
met; the Quick Mission screen says so beside To the briefing.

A head-on dogfight starts with the flights about 2.6 km apart, so they merge in about 25 s.
If the cloud field (`CloudField` in `src/world/clouds.ts`, built from the mission weather)
puts a cloud on the line between the two flights, the builder slides the fight along the
front in 2 km steps until that line lets through at least half the light (D-082). The
search makes no random draws, so a start that was already clear is built exactly as before.
Under a solid overcast at the flights' height no line is clear, and the start stays where
it was.

### Bombing raid (`type: 'bombing'`)

The player's flight (his bomber and `wingmen` more of the same type, task `bomb`) flies
from 4 km behind our lines to a target 6 km behind the enemy's, at `altitudeM` (at least
1,000 m and at most 80% of the bomber's ceiling), and home by another way:

- **Route:** a `'bomb'` waypoint over the targets (its `targetIds` are the targets), a
  rally point 1.5 km behind our lines and 3.5 km along the front, and the nearest
  aerodrome's `'land'` waypoint.
- **Targets:** one of four sets, laid out on the run line with rows 45-50 m apart (the
  formation's spacing, so each bomber of a vic that releases on its leader passes over one):
  a supply depot (three dumps and two lorries), hangars (three and a tent hangar), a
  railhead (a train lying across the run and two dumps), or an artillery park (four guns
  and their dump). Two AA guns stand 400-500 m off.
- **Objectives:** destroy at least half the flight's size (rounded up, at most every
  target), and, secondary, all of them.
- **Interceptors:** `enemyCount` fighters of `enemyAircraft`, task `defend`, in one or two
  elements that start 7-8.5 km beyond the target. Their spawn delay (from their own cruise
  speed) brings the first element to a point 2.5 km short of the target as the bombers get
  there, and the second over the target 30 s after them, each up to 30 s late.
- **Escort:** `escortCount` fighters (0-4, default none) of `escortAircraft`, or a fighter of
  the player's side in service on the date (his own nation's if it flies one), task
  `escort` on `player-1`, starting 450 m behind and 300 m above the bombers.
- **Station:** the player's member carries `playerStation` as `station` (absent for the
  pilot's seat).
- **A clear bomb run:** the builder checks the bomb aimer's view of the target from 1, 2
  and 3 km short of it, with the clouds drifted to when the formation gets there. If any
  view lets through less than half the light, the raid slides along the front in 2 km steps
  (±1 … ±4) as a head-on dogfight's start does (D-082). The search makes no random draws;
  under a solid overcast the raid stays where it was.

A raid draws its weather before its layout, to run that check; every other type keeps its
old draw order, so their missions are unchanged for a seed.
