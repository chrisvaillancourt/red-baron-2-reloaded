/** Quick / single mission builder (instant action; not recorded in a career). */
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { AircraftId, MissionDefinition, MissionFlightMember, MissionType, Nation, Side, Weather } from '../core/types';
import { NATION_SIDE } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import { getAce } from '../data/aces';
import { composeLivery } from '../data/liveries';
import { terrainHeightAt } from '../world/terrain';
import { midDate } from './dates';
import {
  addBalloon,
  addFlight,
  addGround,
  addObjective,
  centroid,
  cruiseSpeed,
  ensureSide,
  jitter,
  nearestAerodrome,
  newCtx,
  twoSeaterFlight,
  type GenCtx,
} from './missionGen';
import { add, describeLocation, enemyDirection, frontAnchor, heading, pointOnSide, type XZ } from './placement';
import { seedFrom } from './rng';
import { nationForAircraft } from './squadronUtil';
import { describeWeather } from './weather';

function quickDate(a: AircraftId, b: AircraftId): string {
  const A = AIRCRAFT[a];
  const B = AIRCRAFT[b];
  const from = A.introduced > B.introduced ? A.introduced : B.introduced;
  const to = A.retired < B.retired ? A.retired : B.retired;
  return from <= to ? midDate(from, to) : midDate(A.introduced, A.retired);
}

function members(ctx: GenCtx, n: number, aircraftId: AircraftId, nation: Nation, skill: MissionFlightMember['skill'], playerFirst: boolean): MissionFlightMember[] {
  return Array.from({ length: n }, (_, i) => ({
    ...(playerFirst && i === 0 ? { isPlayer: true, pilotName: 'You' } : {}),
    skill,
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
  const rng = ctx.rng;
  const alt = Math.max(300, o.altitudeM);
  const enemyCount = Math.max(1, Math.min(8, Math.round(o.enemyCount)));
  const wingmen = Math.max(0, Math.min(3, Math.round(o.wingmen)));

  // Fight over the lines near Arras, somewhere along a 40 km stretch.
  const fp = frontAnchor({ x: 0, z: 0 }, date, rng.range(-20000, 20000));
  const eDir = enemyDirection(fp, side);
  const along = fp.tangent;
  const back = { x: -eDir.x, z: -eDir.z };

  const startMode = o.startPosition === 'random' ? rng.pick(['head-on', 'advantage', 'disadvantage'] as const) : o.startPosition;
  let pStart: XZ = pointOnSide(fp, side, 2500, date);
  let pAlt = alt;
  let eStart: XZ = pointOnSide(fp, enemySide, 2500, date);
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
    enemyMembers[0] = { pilotName: ace.shortName, aceId, skill: 'ace', livery: composeLivery({ aircraftId: o.enemyAircraft, nation: enemyNation, date, aceId }) };
  }
  const home = nearestAerodrome(ctx, side, pStart);
  const homeWp = home ? [{ x: Math.round(home.x), z: Math.round(home.z), altitude: Math.round(terrainHeightAt(home.x, home.z) + 300), action: 'land' as const, label: home.name }] : [];

  const playerFlightWps: MissionDefinition['flights'][number]['waypoints'] = [];
  let type: MissionType = o.type;
  let title = '';
  let orders = '';

  const playerMembers = members(ctx, 1 + wingmen, o.playerAircraft, nation, o.wingmanSkill, true);

  switch (o.type) {
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
      addFlight(ctx, { role: 'enemy', side: enemySide, nation: enemyNation, aircraftId: o.enemyAircraft, members: enemyMembers, start: add(c, eDir, 3000), altitude: 1800, waypoints: [{ x: Math.round(c.x), z: Math.round(c.z), altitude: 1800, action: 'patrol', duration: 900 }], task: 'defend', spawnDelay: 45, idPrefix: 'enemy' });
      pStart = pointOnSide(fp, side, 5000, date);
      pHeading = heading(pStart, c);
      playerFlightWps.push({ x: Math.round(c.x), z: Math.round(c.z), altitude: Math.round(terrainHeightAt(c.x, c.z) + 1000), action: 'attack-balloon', targetIds: bs.map((b) => b.id), label: 'Balloons' });
      addObjective(ctx, { kind: 'destroy-balloons', description: 'Destroy the enemy balloons.', targetIds: bs.map((b) => b.id), count: bs.length, primary: true });
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
      const tgt = pointOnSide(fp, side, 5000, date);
      const two = AIRCRAFT[o.enemyAircraft].role !== 'fighter';
      addFlight(ctx, { role: 'enemy', side: enemySide, nation: enemyNation, aircraftId: o.enemyAircraft, members: enemyMembers, start: pointOnSide(fp, enemySide, 3000, date), altitude: alt, waypoints: [{ x: Math.round(tgt.x), z: Math.round(tgt.z), altitude: Math.round(alt), action: 'patrol', duration: 300 }], task: two ? 'recon' : 'fighter-sweep', idPrefix: 'enemy' });
      pStart = pointOnSide(fp, side, 9000, date);
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
      if (enemyCount > 0) addFlight(ctx, { role: 'enemy', side: enemySide, nation: enemyNation, aircraftId: o.enemyAircraft, members: enemyMembers, start: add(c, eDir, 6000), altitude: alt, waypoints: [{ x: Math.round(c.x), z: Math.round(c.z), altitude: Math.round(alt), action: 'patrol', duration: 600 }], task: 'fighter-sweep', spawnDelay: 90, idPrefix: 'enemy' });
      pStart = pointOnSide(fp, side, 4000, date);
      pAlt = Math.min(alt, 1200);
      pHeading = heading(pStart, c);
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
    task: (o.type === 'escort' ? 'escort' : o.type === 'balloon-attack' ? 'balloon-attack' : o.type === 'ground-attack' ? 'ground-attack' : 'fighter-sweep') as MissionDefinition['flights'][number]['task'],
    ...(o.type === 'escort' ? { escortFlightId: ctx.flights.find((f) => f.role === 'friendly')?.id } : {}),
  };

  const weather: Weather = {
    cloudCover: Math.max(0, Math.min(1, o.cloudCover)),
    cloudBaseM: 1500 + Math.round(rng.range(0, 800)),
    cloudTopM: 2600 + Math.round(rng.range(0, 800)),
    wind: [4, 0, -1],
    visibilityM: 30000,
    turbulence: 0.15,
  };
  weather.cloudTopM = Math.max(weather.cloudTopM, weather.cloudBaseM + 400);

  const ace = aceId ? getAce(aceId) : undefined;
  const briefing = [
    orders,
    ace ? `Your opponent: ${ace.displayName}${ace.nickname ? ` - "${ace.nickname}"` : ''}. ${ace.bio}` : '',
    `You fly the ${playerSpec.name}${wingmen ? ` with ${wingmen} wingm${wingmen > 1 ? 'en' : 'an'}` : ''} against ${enemyCount} ${AIRCRAFT[o.enemyAircraft].name}${enemyCount > 1 ? 's' : ''}.`,
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
