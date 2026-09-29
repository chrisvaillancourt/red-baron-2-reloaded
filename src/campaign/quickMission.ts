/** Quick / single mission builder (instant action; not recorded in a career). */
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { AircraftId, MissionDefinition, MissionFlight, MissionFlightMember, MissionType, Nation, Side, Waypoint, Weather } from '../core/types';
import { NATION_SIDE } from '../core/types';
import { AIRCRAFT, servedTogether } from '../data/aircraft';
import { aceNamesOn, getAce } from '../data/aces';
import type { AerodromeWorld } from '../data/aerodromes';
import { composeLivery } from '../data/liveries';
import { terrainHeightAt } from '../world/terrain';
import { CloudField, SIGHT_MIN_TRANSMITTANCE } from '../world/clouds';
import { midDate } from './dates';
import {
  addBalloon,
  addBombTargets,
  addFlight,
  BOMB_TARGET_SETS,
  addGround,
  addObjective,
  centroid,
  cruiseSpeed,
  ensureSide,
  jitter,
  meetDelay,
  nearestAerodrome,
  newCtx,
  twoSeaterFlight,
  type GenCtx,
} from './missionGen';
import { add, clampToSector, describeLocation, dist, enemyDirection, frontAnchor, heading, pointOnSide, type FrontPoint, type XZ } from './placement';
import { seedFrom } from './rng';
import { aircraftPool, nationForAircraft } from './squadronUtil';
import { describeWeather } from './weather';

/** Quick ground attack: defenders' scramble point beyond the target (m) and cruise height (m AGL). */
const GA_DEFENDER_RANGE = 7000;
const GA_DEFENDER_AGL = 350;
/** Seconds after the player reaches the target that the lead element arrives, and the gap to the next. */
const GA_FIRST_ARRIVAL = 150;
const GA_ELEMENT_GAP = 90;
/** Head-on dogfights: the line between the flights must let this much light through at the start, and the search step along the front (m). */
const CLEAR_START_TRANSMITTANCE = Math.max(0.5, SIGHT_MIN_TRANSMITTANCE);
const CLEAR_START_STEP_M = 2000;

/** Bombing raids: the target's depth behind the lines and the start's behind ours (m). */
const RAID_TARGET_DEPTH_M = 6000;
const RAID_START_M = 4000;
/** Bombing raids: the lowest bombing height (m), and the ceiling fraction a bomber cruises at. */
const RAID_MIN_ALT_M = 1000;
const RAID_CEILING_FRACTION = 0.8;
/** Interceptors: where they start beyond the target, and where they meet the raid (m before / after the target). */
const RAID_INTERCEPTOR_RANGE_M = 7000;
const RAID_FIRST_MEET_M = 2500;
const RAID_SECOND_MEET_M = 500;
/** Seconds the second element arrives after the bombers pass its meeting point. */
const RAID_SECOND_EXTRA_S = 30;
/** Distances (m) short of the target from which the bomb aimer must see it on the run. */
const RAID_SIGHT_BACK_M = [1000, 2000, 3000];

/** Flak round the target: metres along the run and to the right. */
const RAID_AA: readonly (readonly [number, number])[] = [[-300, 350], [200, -400]];
const RAID_COUNT_WORDS = ['none', 'one', 'two', 'three', 'four', 'five'];

interface RaidPlan {
  fp: FrontPoint;
  /** Target centre, the start, and the run's direction and its right. */
  c: XZ;
  start: XZ;
  dir: XZ;
  right: XZ;
  /** Bombing height, m ASL. */
  altitude: number;
}

/**
 * Where a raid goes: a target 6 km behind the enemy lines and a start 4 km behind ours,
 * opposite it. The bomb aimer must see the target from the run-in (1-3 km short, when the
 * formation gets there, with the clouds drifted), so a blocked run slides along the front in
 * 2 km steps like a head-on dogfight's start (D-082). No random draws: a clear raid is where
 * it would have been. Under a solid overcast nothing is clear, and the raid stays put.
 */
function planRaid(ctx: GenCtx, o: QuickMissionOptions, a: { side: Side; enemySide: Side; frontShift: number; weather: Weather }): RaidPlan {
  const spec = AIRCRAFT[o.playerAircraft];
  const altitude = Math.round(Math.min(Math.max(o.altitudeM, RAID_MIN_ALT_M), spec.performance.ceilingM * RAID_CEILING_FRACTION));
  const v = cruiseSpeed(o.playerAircraft);
  const clouds = new CloudField(a.weather);
  const plan = (k: number): RaidPlan => {
    const fp = frontAnchor({ x: 0, z: 0 }, ctx.date, a.frontShift + k * CLEAR_START_STEP_M);
    const c = pointOnSide(fp, a.enemySide, RAID_TARGET_DEPTH_M, ctx.date);
    const start = pointOnSide(fp, a.side, RAID_START_M, ctx.date);
    const n = dist(start, c) || 1;
    const dir = { x: (c.x - start.x) / n, z: (c.z - start.z) / n };
    return { fp, c, start, dir, right: { x: -dir.z, z: dir.x }, altitude };
  };
  const clear = (r: RaidPlan) => {
    const n = dist(r.start, r.c);
    const gy = terrainHeightAt(r.c.x, r.c.z);
    return RAID_SIGHT_BACK_M.every((back) => {
      const p = add(r.c, r.dir, -back);
      return clouds.transmittance(p.x, altitude, p.z, r.c.x, gy + 5, r.c.z, Math.max(0, n - back) / v) >= CLEAR_START_TRANSMITTANCE;
    });
  };
  const first = plan(0);
  if (clear(first)) return first;
  for (const k of [1, -1, 2, -2, 3, -3, 4, -4]) {
    const r = plan(k);
    if (clear(r)) return r;
  }
  return first;
}

function escortLine(f: MissionFlight | undefined): string {
  if (!f) return '';
  const n = f.members.length;
  return `${n} ${AIRCRAFT[f.aircraftId].name}${n > 1 ? 's' : ''} fly as your escort.`;
}

/** A fighter of the player's side in service on the date, his own nation's if it flies one. */
function escortFighter(ctx: GenCtx, side: Side, nation: Nation): AircraftId {
  const pool = aircraftPool(side, 'fighter', ctx.date);
  const own = pool.filter((id) => AIRCRAFT[id].nation === nation || AIRCRAFT[id].alsoUsedBy.includes(nation));
  return ctx.rng.pick(own.length ? own : pool);
}

/** Mid-way through the types' shared service; if they never met, mid-way through the player's (the Quick Mission screen says so). */
function quickDate(a: AircraftId, b: AircraftId): string {
  const A = AIRCRAFT[a];
  const B = AIRCRAFT[b];
  if (!servedTogether(A, B)) return midDate(A.introduced, A.retired);
  const from = A.introduced > B.introduced ? A.introduced : B.introduced;
  const to = A.retired < B.retired ? A.retired : B.retired;
  return midDate(from, to);
}

function landAt(home: AerodromeWorld | undefined): Waypoint[] {
  return home ? [{ x: Math.round(home.x), z: Math.round(home.z), altitude: Math.round(terrainHeightAt(home.x, home.z) + 300), action: 'land', label: home.name }] : [];
}

function quickWeather(o: QuickMissionOptions, rng: GenCtx['rng']): Weather {
  const weather: Weather = {
    cloudCover: Math.max(0, Math.min(1, o.cloudCover)),
    cloudBaseM: 1500 + Math.round(rng.range(0, 800)),
    cloudTopM: 2600 + Math.round(rng.range(0, 800)),
    wind: [4, 0, -1],
    visibilityM: 30000,
    turbulence: 0.15,
  };
  weather.cloudTopM = Math.max(weather.cloudTopM, weather.cloudBaseM + 400);
  return weather;
}

function members(ctx: GenCtx, n: number, aircraftId: AircraftId, nation: Nation, skill: MissionFlightMember['skill'], playerFirst: boolean): MissionFlightMember[] {
  return Array.from({ length: n }, (_, i) => ({
    ...(playerFirst && i === 0 ? { isPlayer: true, pilotName: 'You' } : {}),
    // The player's own skill only matters to the autoplayer; match career missions (veteran).
    skill: playerFirst && i === 0 ? 'veteran' : skill,
    livery: composeLivery({ aircraftId, nation, date: ctx.date, marking: String(i + 1) }),
  }));
}

export function buildQuickMission(o: QuickMissionOptions, seed = Math.floor(Math.random() * 2 ** 31)): MissionDefinition {
  const playerSpec = AIRCRAFT[o.playerAircraft];
  const side: Side = o.playerSide ?? NATION_SIDE[playerSpec.nation];
  const enemySide: Side = side === 'allied' ? 'central' : 'allied';
  const date = o.date ?? quickDate(o.playerAircraft, o.enemyAircraft);
  const nation = nationForAircraft(o.playerAircraft, side);
  const enemyNation = nationForAircraft(o.enemyAircraft, enemySide);
  const ctx = newCtx(seedFrom(seed, 'quick'), date, side, nation, 'pilot');
  ctx.playerAircraft = o.playerAircraft; // meetDelay paces enemy arrivals off the player's cruise speed
  const rng = ctx.rng;
  const alt = Math.max(300, o.altitudeM);
  const enemyCount = Math.max(1, Math.min(8, Math.round(o.enemyCount)));
  const wingmen = Math.max(0, Math.min(3, Math.round(o.wingmen)));

  // Fight over the lines near Arras, somewhere along a 40 km stretch.
  const frontShift = rng.range(-20000, 20000);
  const fp = frontAnchor({ x: 0, z: 0 }, date, frontShift);
  const eDir = enemyDirection(fp, side);
  const along = fp.tangent;
  const back = { x: -eDir.x, z: -eDir.z };

  const startMode = o.startPosition === 'random' ? rng.pick(['head-on', 'advantage', 'disadvantage'] as const) : o.startPosition;
  // Instant action: a head-on dogfight merges in ~25 s (flights start ~2.6 km apart), as in RB2.
  // Other quick types start further back so there is a run-in to the target.
  const runIn = o.type === 'dogfight' ? 1300 : 2500;
  let pStart: XZ = pointOnSide(fp, side, runIn, date);
  let pAlt = alt;
  let eStart: XZ = pointOnSide(fp, enemySide, runIn, date);
  let eAlt = alt;
  let pHeading = heading(pStart, eStart);
  let eHeading = heading(eStart, pStart);
  if (o.type === 'dogfight' && startMode !== 'head-on') {
    const centre: XZ = { x: fp.x, z: fp.z };
    const lead = add(centre, along, 800);
    const trail = add(centre, along, -800);
    const h = heading(trail, lead);
    if (startMode === 'advantage') {
      eStart = lead;
      pStart = trail;
      pAlt = alt + 500;
    } else {
      pStart = lead;
      eStart = trail;
      eAlt = alt + 500;
    }
    pHeading = h;
    eHeading = h;
  }

  const aceId = o.enemyAceId && getAce(o.enemyAceId) ? o.enemyAceId : undefined;
  const enemyMembers = members(ctx, enemyCount, o.enemyAircraft, enemyNation, o.enemySkill, false);
  if (aceId) {
    const ace = getAce(aceId)!;
    enemyMembers[0] = { pilotName: aceNamesOn(ace, date).short, aceId, skill: 'ace', livery: composeLivery({ aircraftId: o.enemyAircraft, nation: enemyNation, date, aceId }) };
  }
  let home = nearestAerodrome(ctx, side, pStart);
  let homeWp = landAt(home);

  const playerFlightWps: MissionDefinition['flights'][number]['waypoints'] = [];
  let type: MissionType = o.type;
  let title = '';
  let orders = '';

  const playerMembers = members(ctx, 1 + wingmen, o.playerAircraft, nation, o.wingmanSkill, true);
  if (o.playerStation && o.playerStation !== 'pilot') playerMembers[0].station = o.playerStation;
  let raidWeather: Weather | undefined;

  switch (o.type) {
    case 'bombing': {
      raidWeather = quickWeather(o, rng);
      const r = planRaid(ctx, o, { side, enemySide, frontShift, weather: raidWeather });
      const { c, dir, right } = r;
      const at = (along: number, lat: number): XZ => ({ x: c.x + dir.x * along + right.x * lat, z: c.z + dir.z * along + right.z * lat });
      const runHeading = heading(r.start, c);
      const layout = BOMB_TARGET_SETS[rng.int(0, BOMB_TARGET_SETS.length - 1)];
      const ids = addBombTargets(ctx, layout, c, dir, enemySide, r.fp);
      for (const [along, lat] of RAID_AA) addGround(ctx, 'aa-gun', enemySide, ensureSide(ctx, at(along, lat), enemySide, r.fp), runHeading);
      pStart = r.start;
      pAlt = r.altitude;
      pHeading = runHeading;
      // Home by another way: turn off the target for the lines a few kilometres along the front.
      const rally = pointOnSide(r.fp, side, 1500, date, (rng.chance(0.5) ? 1 : -1) * 3500);
      home = nearestAerodrome(ctx, side, rally);
      homeWp = landAt(home);
      playerFlightWps.push(
        { x: Math.round(c.x), z: Math.round(c.z), altitude: Math.round(r.altitude), action: 'bomb', targetIds: ids, label: 'Target' },
        { x: Math.round(rally.x), z: Math.round(rally.z), altitude: Math.round(r.altitude), action: 'fly', label: 'Rally' },
      );

      // Interceptors are called up when the raid crosses the lines. They climb in from deep
      // behind the target: the first element meets the formation on its run-in, the second
      // over the target, so the bombers have the lines and most of the run-in to themselves.
      const n = enemyMembers.length;
      const elements = n >= 2 ? [enemyMembers.slice(0, Math.ceil(n / 2)), enemyMembers.slice(Math.ceil(n / 2))] : [enemyMembers];
      const eDirR = enemyDirection(r.fp, side);
      const vBomber = cruiseSpeed(o.playerAircraft);
      const vEnemy = cruiseSpeed(o.enemyAircraft);
      elements.forEach((mem, i) => {
        const meet = i === 0 ? at(-RAID_FIRST_MEET_M, 0) : at(RAID_SECOND_MEET_M, 0);
        const from = clampToSector(add(add(c, eDirR, RAID_INTERCEPTOR_RANGE_M + i * 1500), r.fp.tangent, (i ? -1 : 1) * 1500));
        const tBombers = dist(r.start, meet) / vBomber;
        const delay = Math.round(Math.max(0, tBombers + i * RAID_SECOND_EXTRA_S - dist(from, meet) / vEnemy + rng.range(0, 30)));
        addFlight(ctx, { role: 'enemy', side: enemySide, nation: enemyNation, aircraftId: o.enemyAircraft, members: mem, start: from, altitude: r.altitude + 200, waypoints: [{ x: Math.round(meet.x), z: Math.round(meet.z), altitude: Math.round(r.altitude + 200), action: 'patrol', duration: 600 }], task: 'defend', spawnDelay: delay, idPrefix: 'enemy' });
      });

      const escorts = Math.max(0, Math.min(4, Math.round(o.escortCount ?? 0)));
      if (escorts > 0) {
        const escortType = o.escortAircraft && AIRCRAFT[o.escortAircraft]?.role === 'fighter' ? o.escortAircraft : escortFighter(ctx, side, nation);
        const escortNation = nationForAircraft(escortType, side);
        const back = { x: -dir.x, z: -dir.z };
        addFlight(ctx, {
          role: 'friendly', side, nation: escortNation, aircraftId: escortType,
          members: members(ctx, escorts, escortType, escortNation, o.wingmanSkill, false),
          start: add(add(r.start, back, 450), right, 150), altitude: r.altitude + 300, startHeading: runHeading,
          waypoints: homeWp.slice(), task: 'escort', escortFlightId: 'player-1', idPrefix: 'friendly',
        });
      }
      const flightSize = 1 + wingmen;
      addObjective(ctx, { kind: 'destroy-ground', description: `Destroy at least ${RAID_COUNT_WORDS[Math.min(ids.length, Math.max(1, Math.ceil(flightSize / 2)))]} of the ${layout.what}.`, targetIds: ids, count: Math.min(ids.length, Math.max(1, Math.ceil(flightSize / 2))), primary: true });
      addObjective(ctx, { kind: 'destroy-ground', description: `Destroy all of the ${layout.what}.`, targetIds: ids, count: ids.length, primary: false });
      title = `Bombing Raid ${describeLocation(c)}`;
      orders = `Bomb the enemy ${layout.name} ${describeLocation(c)} and bring the formation home. Hold formation: enemy scouts will come up to meet you${escorts ? ', and your escort will try to keep them off' : ''}.`;
      break;
    }
    case 'dogfight': {
      addFlight(ctx, { role: 'enemy', side: enemySide, nation: enemyNation, aircraftId: o.enemyAircraft, members: enemyMembers, start: eStart, altitude: eAlt, startHeading: eHeading, waypoints: [{ x: Math.round(pStart.x), z: Math.round(pStart.z), altitude: Math.round(alt), action: 'patrol', duration: 900 }], task: 'fighter-sweep', idPrefix: 'enemy' });
      playerFlightWps.push({ x: Math.round(eStart.x), z: Math.round(eStart.z), altitude: Math.round(alt), action: 'patrol', duration: 900, label: 'Engagement' });
      addObjective(ctx, { kind: 'destroy-aircraft', description: `Destroy all ${enemyCount} enemy aircraft.`, targetIds: ['enemy-1'], count: enemyCount, primary: true });
      title = `Dogfight: ${playerSpec.shortName} vs ${enemyCount} ${AIRCRAFT[o.enemyAircraft].shortName}`;
      orders = startMode === 'head-on' ? 'The enemy is closing head-on.' : startMode === 'advantage' ? 'You have the height and the enemy has not seen you. Dive!' : 'The enemy is above and behind you - break!';
      break;
    }
    case 'balloon-attack': {
      const bs = [0, 1, 2].map((i) => addBalloon(ctx, enemySide, pointOnSide(fp, enemySide, 4000, date, (i - 1) * 2000)));
      for (const b of bs) addGround(ctx, 'aa-gun', enemySide, ensureSide(ctx, jitter(ctx, b, 300), enemySide, fp));
      const c = centroid(bs);
      pStart = pointOnSide(fp, side, 3000, date);
      pHeading = heading(pStart, c);
      // Defenders scramble when the attack is seen: they take off behind the balloon line and
      // climb in to arrive ~40 s after you, rather than waiting above to bounce you.
      const dStart = add(c, eDir, 4000);
      const gyC = terrainHeightAt(c.x, c.z);
      addFlight(ctx, { role: 'enemy', side: enemySide, nation: enemyNation, aircraftId: o.enemyAircraft, members: enemyMembers, start: dStart, altitude: terrainHeightAt(dStart.x, dStart.z) + 500, waypoints: [{ x: Math.round(c.x), z: Math.round(c.z), altitude: Math.round(gyC + 1200), action: 'patrol', duration: 900 }], task: 'defend', spawnDelay: meetDelay(ctx, [pStart], c, dStart, 40, [0, 30]), idPrefix: 'enemy' });
      playerFlightWps.push({ x: Math.round(c.x), z: Math.round(c.z), altitude: Math.round(terrainHeightAt(c.x, c.z) + 1000), action: 'attack-balloon', targetIds: bs.map((b) => b.id), label: 'Balloons' });
      addObjective(ctx, { kind: 'destroy-balloons', description: 'Flame at least one enemy balloon.', targetIds: bs.map((b) => b.id), count: 1, primary: true });
      addObjective(ctx, { kind: 'destroy-balloons', description: 'Destroy all three balloons.', targetIds: bs.map((b) => b.id), count: bs.length, primary: false });
      title = `Balloon Attack ${describeLocation(c)}`;
      orders = 'Three observation balloons hang over the enemy lines. Flame them.';
      break;
    }
    case 'escort': {
      const target = pointOnSide(fp, enemySide, 7000, date);
      const ts = twoSeaterFlight(ctx, { side, role: 'friendly', count: 3, start: add(pStart, eDir, 300), altitude: alt - 200, preferNation: nation, waypoints: [{ x: Math.round(target.x), z: Math.round(target.z), altitude: Math.round(alt - 200), action: 'patrol', duration: 90 }, ...homeWp], task: 'recon' });
      addFlight(ctx, { role: 'enemy', side: enemySide, nation: enemyNation, aircraftId: o.enemyAircraft, members: enemyMembers, start: add(target, eDir, 5000), altitude: alt + 300, waypoints: [{ x: Math.round(target.x), z: Math.round(target.z), altitude: Math.round(alt), action: 'patrol', duration: 600 }], task: 'defend', spawnDelay: 60, idPrefix: 'enemy' });
      pStart = add(pStart, back, 800);
      pHeading = heading(pStart, target);
      playerFlightWps.push({ x: Math.round(target.x), z: Math.round(target.z), altitude: Math.round(alt), action: 'fly', label: 'Objective' });
      addObjective(ctx, { kind: 'protect-flight', description: 'Bring at least two of the two-seaters home.', targetIds: [ts.id], count: 2, primary: true });
      title = `Escort ${describeLocation(target)}`;
      orders = `Escort three ${AIRCRAFT[ts.aircraftId].shortName}s to their objective and back.`;
      break;
    }
    case 'intercept': {
      // Both flights run about 4.5 km to the intercept point, so they meet there in a
      // minute and a half rather than the player orbiting for two minutes first.
      const tgt = pointOnSide(fp, side, 3000, date);
      const two = AIRCRAFT[o.enemyAircraft].role !== 'fighter';
      addFlight(ctx, { role: 'enemy', side: enemySide, nation: enemyNation, aircraftId: o.enemyAircraft, members: enemyMembers, start: pointOnSide(fp, enemySide, 1500, date), altitude: alt, waypoints: [{ x: Math.round(tgt.x), z: Math.round(tgt.z), altitude: Math.round(alt), action: 'patrol', duration: 300 }], task: two ? 'recon' : 'fighter-sweep', idPrefix: 'enemy' });
      pStart = pointOnSide(fp, side, 7500, date);
      pAlt = Math.max(300, alt - 300);
      pHeading = heading(pStart, tgt);
      playerFlightWps.push({ x: Math.round(tgt.x), z: Math.round(tgt.z), altitude: Math.round(alt), action: 'patrol', duration: 300, label: 'Intercept' });
      addObjective(ctx, { kind: 'destroy-aircraft', description: 'Intercept and destroy the intruders.', targetIds: ['enemy-1'], count: Math.ceil(enemyCount / 2), primary: true });
      title = `Interception ${describeLocation(tgt)}`;
      orders = `Enemy ${AIRCRAFT[o.enemyAircraft].shortName}s are crossing the lines. Stop them.`;
      break;
    }
    case 'ground-attack':
    default: {
      type = 'ground-attack';
      const c = pointOnSide(fp, enemySide, 2500, date);
      const ids = [
        addGround(ctx, 'artillery', enemySide, c).id,
        addGround(ctx, 'artillery', enemySide, ensureSide(ctx, add(c, along, 120), enemySide, fp)).id,
        addGround(ctx, 'truck', enemySide, ensureSide(ctx, add(c, eDir, 600), enemySide, fp)).id,
        addGround(ctx, 'truck', enemySide, ensureSide(ctx, add(c, eDir, 640), enemySide, fp)).id,
        addGround(ctx, 'trench-mg', enemySide, pointOnSide(fp, enemySide, 700, date)).id,
      ];
      addGround(ctx, 'aa-gun', enemySide, ensureSide(ctx, add(c, along, -500), enemySide, fp));
      pStart = pointOnSide(fp, side, 4000, date);
      pAlt = Math.min(alt, 1200);
      pHeading = heading(pStart, c);
      // Scouts are called down on the strafers once the attack is seen. They scramble in
      // elements from behind the target and climb in low, so they arrive with no height to
      // spare: the lead element about when a quick attack is finished, the rest a minute and
      // a half later. Fight the first pair or run for the lines before the second arrives.
      const gyC = terrainHeightAt(c.x, c.z);
      const elements = enemyCount >= 2 ? [enemyMembers.slice(0, Math.ceil(enemyCount / 2)), enemyMembers.slice(Math.ceil(enemyCount / 2))] : [enemyMembers];
      elements.forEach((mem, i) => {
        const dStart = add(c, eDir, GA_DEFENDER_RANGE + i * 1500);
        addFlight(ctx, { role: 'enemy', side: enemySide, nation: enemyNation, aircraftId: o.enemyAircraft, members: mem, start: add(dStart, along, (i ? -1 : 1) * 800), altitude: terrainHeightAt(dStart.x, dStart.z) + GA_DEFENDER_AGL, waypoints: [{ x: Math.round(c.x), z: Math.round(c.z), altitude: Math.round(gyC + GA_DEFENDER_AGL), action: 'patrol', duration: 600 }], task: 'fighter-sweep', spawnDelay: meetDelay(ctx, [pStart], c, dStart, GA_FIRST_ARRIVAL + i * GA_ELEMENT_GAP, [0, 30]), idPrefix: 'enemy' });
      });
      playerFlightWps.push({ x: Math.round(c.x), z: Math.round(c.z), altitude: Math.round(terrainHeightAt(c.x, c.z) + 300), action: 'attack-ground', targetIds: ids, label: 'Targets' });
      addObjective(ctx, { kind: 'destroy-ground', description: 'Destroy at least three ground targets.', targetIds: ids, count: 3, primary: true });
      title = `Ground Attack ${describeLocation(c)}`;
      orders = 'Strafe the enemy battery and its transport.';
    }
  }
  playerFlightWps.push(...homeWp);

  const playerFlight = {
    id: 'player-1',
    role: 'player-flight' as const,
    side,
    nation,
    aircraftId: o.playerAircraft,
    members: playerMembers,
    start: { x: Math.round(pStart.x), z: Math.round(pStart.z), altitude: Math.round(pAlt), heading: pHeading, airspeed: Math.round(cruiseSpeed(o.playerAircraft)) },
    waypoints: playerFlightWps,
    task: (o.type === 'escort' ? 'escort' : o.type === 'balloon-attack' ? 'balloon-attack' : o.type === 'ground-attack' ? 'ground-attack' : o.type === 'bombing' ? 'bomb' : 'fighter-sweep') as MissionDefinition['flights'][number]['task'],
    ...(o.type === 'escort' ? { escortFlightId: ctx.flights.find((f) => f.role === 'friendly')?.id } : {}),
  };

  // A raid drew its weather first, to find a clear bomb run; the other types keep their draw order.
  const weather: Weather = raidWeather ?? quickWeather(o, rng);

  // Instant action merges in ~25 s, so a head-on dogfight must not start with a cloud between
  // the flights: both would fly through it blind and wander apart (9 in 96 default fights went
  // more than 30 s with no sight of the enemy). Slide the fight along the front until the line
  // is clear. No random draws, so a start that was already clear is unchanged. Under a solid
  // overcast at the flights' height nothing is clear, and the start stays where it was.
  if (o.type === 'dogfight' && startMode === 'head-on') {
    const clouds = new CloudField(weather);
    const clearLine = (a: XZ, b: XZ) => clouds.transmittance(a.x, pAlt, a.z, b.x, eAlt, b.z, 0) >= CLEAR_START_TRANSMITTANCE;
    const enemyFlight = ctx.flights.find((f) => f.role === 'enemy');
    if (enemyFlight && !clearLine(pStart, eStart)) {
      for (const k of [1, -1, 2, -2, 3, -3, 4, -4]) {
        const f2 = frontAnchor({ x: 0, z: 0 }, date, frontShift + k * CLEAR_START_STEP_M);
        const p2 = pointOnSide(f2, side, runIn, date);
        const e2 = pointOnSide(f2, enemySide, runIn, date);
        if (!clearLine(p2, e2)) continue;
        Object.assign(playerFlight.start, { x: Math.round(p2.x), z: Math.round(p2.z), heading: heading(p2, e2) });
        Object.assign(enemyFlight.start, { x: Math.round(e2.x), z: Math.round(e2.z), heading: heading(e2, p2) });
        Object.assign(enemyFlight.waypoints[0], { x: Math.round(p2.x), z: Math.round(p2.z) });
        Object.assign(playerFlightWps[0], { x: Math.round(e2.x), z: Math.round(e2.z) });
        break;
      }
    }
  }

  const ace = aceId ? getAce(aceId) : undefined;
  const briefing = [
    orders,
    ace ? `Your opponent: ${aceNamesOn(ace, date).display}${ace.nickname ? ` - "${ace.nickname}"` : ''}. ${ace.bio}` : '',
    `You fly the ${playerSpec.name}${wingmen ? ` with ${wingmen} wingm${wingmen > 1 ? 'en' : 'an'}` : ''} against ${enemyCount} ${AIRCRAFT[o.enemyAircraft].name}${enemyCount > 1 ? 's' : ''}.`,
    escortLine(ctx.flights.find((f) => f.role === 'friendly' && f.task === 'escort' && f.escortFlightId === 'player-1')),
    `Weather: ${describeWeather(weather, nation === 'britain' || nation === 'usa')}`,
  ].filter(Boolean);

  return {
    id: `q-${seed.toString(36)}`,
    type,
    title,
    briefing: briefing.join('\n\n'),
    date,
    timeOfDay: o.timeOfDay,
    weather,
    flights: [playerFlight, ...ctx.flights],
    balloons: ctx.balloons,
    groundTargets: ctx.groundTargets,
    objectives: ctx.objectives,
    homeAerodromeId: home?.id ?? '',
    isCareer: false,
  };
}
