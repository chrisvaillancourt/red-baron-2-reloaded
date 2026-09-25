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
| `aces.ts` | 43 historical aces: service periods by squadron/aircraft, dated victory milestones (linear between points, frozen at fate), fate. `aceVictoriesOn`, `aceServiceOn`. |
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
a quarterly roster) → weather/time of day → period-voice briefing.

Enemy fighters are drawn from real enemy squadrons based within 70 km, and
their aces appear with a probability scaled by the historical event's
intensity. Aces the career has killed/captured (`pilot.alteredAces`) never
reappear.

Default start: airborne 2–5 km short of the lines at patrol altitude.

**Pacing and odds** (tuned with the autoplayer, docs/game.md). Enemy flights
get a `meetDelay` spawn delay so they reach the player's first patrol point,
escort target, interception area or balloon line about when he does (first
contact typically 3–4 sim minutes in, ~30 s real time at x8). The player's
flight size is rolled before planning (`ctx.playerFlightSize`) and
`enemyCount` never exceeds it by more than one (two on 'ace' difficulty).
Generic enemy skill is mostly novice/regular on 'pilot'; named aces lead a
flight with probability ~0.22 × event intensity (×0.5 recruit, ×1.3 ace).
`startOnGround` parks the flight on the home aerodrome's runway heading.

### Objective `targetIds`

| kind | targetIds refer to |
|---|---|
| destroy-aircraft, protect-flight | `MissionFlight.id` (count = members) |
| destroy-balloons, protect-balloons | `MissionBalloon.id` (protect: count must survive) |
| destroy-ground | `MissionGroundTarget.id` |
| reach-waypoint | `"<flightId>:<waypointIndex>"` |

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
the date defaults to the midpoint of both aircraft's overlapping service.
