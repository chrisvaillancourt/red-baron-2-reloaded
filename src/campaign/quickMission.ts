/** Quick / single mission builder (instant action; not recorded in a career). */
import type { QuickMissionOptions } from '../core/campaignTypes';
import type { AircraftId, MissionDefinition, MissionFlightMember, MissionType, Nation, Side, Weather } from '../core/types';
import { NATION_SIDE } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import { aceNamesOn, getAce } from '../data/aces';
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
  meetDelay,
  nearestAerodrome,
  newCtx,
  twoSeaterFlight,
  type GenCtx,
} from './missionGen';
import { add, describeLocation, enemyDirection, frontAnchor, heading, pointOnSide, type XZ } from './placement';
import { seedFrom } from './rng';
import { nationForAircraft } from './squadronUtil';
import { describeWeather } from './weather';

/** Quick ground attack: defenders' scramble point beyond the target (m) and cruise height (m AGL). */
const GA_DEFENDER_RANGE = 7000;
const GA_DEFENDER_AGL = 350;
/** Seconds after the player reaches the target that the lead element arrives, and the gap to the next. */
const GA_FIRST_ARRIVAL = 150;
const GA_ELEMENT_GAP = 90;

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
  const fp = frontAnchor({ x: 0, z: 0 }, date, rng.range(-20000, 20000));
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
    ace ? `Your opponent: ${aceNamesOn(ace, date).display}${ace.nickname ? ` - "${ace.nickname}"` : ''}. ${ace.bio}` : '',
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
