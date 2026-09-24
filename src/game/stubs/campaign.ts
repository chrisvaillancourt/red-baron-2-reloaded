/**
 * STUB campaign: only buildQuickMission works (a dogfight over Arras). Career
 * methods return empty data. Replaced by src/campaign.
 */
import type { CampaignService } from '../../core/interfaces';
import type { CareerPilot, QuickMissionOptions } from '../../core/campaignTypes';
import type { Livery, MissionDefinition, MissionFlight, Nation, Side } from '../../core/types';
import { NATION_SIDE } from '../../core/types';
import { getAircraft } from '../../data/aircraft';

export const STUB_LIVERIES: Record<Nation, Livery> = {
  germany: { fuselage: '#8a6a44', wingTop: '#5d6b3a', wingBottom: '#9fb3c8', tail: '#e8e0d0', cowling: '#9a9a9a', accent: '#c0302a', insignia: 'iron-cross-patee' },
  britain: { fuselage: '#6b5a3a', wingTop: '#5a5236', wingBottom: '#d8ceb0', tail: '#e8e0d0', cowling: '#8a8a8a', accent: '#20305a', insignia: 'roundel-rfc' },
  france: { fuselage: '#c8c0a0', wingTop: '#b8b090', wingBottom: '#d8d0b8', tail: '#e8e0d0', cowling: '#aaaaaa', accent: '#20305a', insignia: 'roundel-france' },
  usa: { fuselage: '#b8ac88', wingTop: '#a8a080', wingBottom: '#d8d0b8', tail: '#e8e0d0', cowling: '#aaaaaa', accent: '#aa2222', insignia: 'roundel-usa' },
};

export function stubBuildQuickMission(o: QuickMissionOptions): MissionDefinition {
  const pSpec = getAircraft(o.playerAircraft);
  const eSpec = getAircraft(o.enemyAircraft);
  const pSide: Side = o.playerSide ?? NATION_SIDE[pSpec.nation];
  const alt = o.altitudeM;
  // Allies west of the line (x < 0), Central Powers east.
  const west = pSide === 'allied' ? -1 : 1;
  const pos = o.startPosition === 'random' ? (['head-on', 'advantage', 'disadvantage'] as const)[Math.floor(Math.random() * 3)] : o.startPosition;
  const pHeading = west < 0 ? Math.PI / 2 : (Math.PI * 3) / 2;
  const eHeading = pHeading + Math.PI;
  let px = west * 2500, pAlt = alt, ex = -west * 2500, eAlt = alt, eHead = eHeading;
  if (pos === 'advantage') {
    pAlt = alt + 400;
    px = west * 1800;
    ex = -west * 200;
    eHead = pHeading;
  } else if (pos === 'disadvantage') {
    eAlt = alt + 400;
    ex = west * 3200;
    px = west * 1400;
    eHead = pHeading;
  }
  const player: MissionFlight = {
    id: 'player',
    role: 'player-flight',
    side: pSide,
    nation: pSpec.nation,
    aircraftId: pSpec.id,
    members: [
      { pilotName: 'You', skill: 'veteran', livery: STUB_LIVERIES[pSpec.nation], isPlayer: true },
      ...Array.from({ length: o.wingmen }, (_, i) => ({ pilotName: `Wingman ${i + 1}`, skill: o.wingmanSkill, livery: STUB_LIVERIES[pSpec.nation] })),
    ],
    start: { x: px, z: 0, altitude: pAlt, heading: pHeading, airspeed: pSpec.performance.maxSpeedKmh / 3.6 * 0.8 },
    waypoints: [{ x: 0, z: 0, altitude: alt, action: 'patrol', duration: 600 }],
    task: 'fighter-sweep',
  };
  const enemy: MissionFlight = {
    id: 'enemy',
    role: 'enemy',
    side: pSide === 'allied' ? 'central' : 'allied',
    nation: eSpec.nation,
    aircraftId: eSpec.id,
    members: Array.from({ length: o.enemyCount }, (_, i) => ({ pilotName: `${eSpec.shortName} ${i + 1}`, skill: o.enemySkill, livery: STUB_LIVERIES[eSpec.nation] })),
    start: { x: ex, z: 300, altitude: eAlt, heading: eHead, airspeed: eSpec.performance.maxSpeedKmh / 3.6 * 0.8 },
    waypoints: [{ x: 0, z: 0, altitude: alt, action: 'patrol', duration: 600 }],
    task: 'fighter-sweep',
  };
  return {
    id: `quick-${Date.now()}`,
    type: 'dogfight',
    title: 'Quick Dogfight',
    briefing: 'Enemy scouts reported over Arras. Engage and destroy them.',
    date: o.date ?? '1917-09-15',
    timeOfDay: o.timeOfDay,
    weather: { cloudCover: o.cloudCover, cloudBaseM: 1800, cloudTopM: 2400, wind: [3, 0, 1], visibilityM: 15000, turbulence: 0.1 },
    flights: [player, enemy],
    balloons: [],
    groundTargets: [],
    objectives: [
      { id: 'kill', kind: 'destroy-aircraft', description: 'Destroy the enemy flight', targetIds: ['enemy'], count: o.enemyCount, primary: true },
      { id: 'live', kind: 'survive', description: 'Survive', targetIds: [], count: 1, primary: false },
    ],
    homeAerodromeId: pSide === 'allied' ? 'filescamp' : 'douai',
    isCareer: false,
  };
}

export function stubCreateCampaignService(): CampaignService {
  const unsupported = (): never => {
    throw new Error('Career mode is not available in the stub campaign');
  };
  return {
    listPilots: () => [],
    createPilot: unsupported,
    loadPilot: () => null,
    savePilot: () => {},
    deletePilot: () => {},
    squadronsFor: () => [],
    getSquadron: () => undefined,
    availableAircraft: (p: CareerPilot) => [p.preferredAircraft ?? 'sopwith_camel'],
    generateMission: unsupported,
    applyMissionResult: unsupported,
    aceStandings: () => [],
    buildQuickMission: stubBuildQuickMission,
  };
}
