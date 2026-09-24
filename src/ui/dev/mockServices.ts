/**
 * Mock GameServices for developing and screenshotting the UI in isolation
 * (dev/ui.html). Not used by the real game.
 */
import type {
  AceStanding,
  CareerPilot,
  DebriefReport,
  NewPilotOptions,
  PilotSummary,
  QuickMissionOptions,
  SquadronInfo,
} from '../../core/campaignTypes';
import type { AudioEngine, CampaignService, FlightLauncher, GameServices } from '../../core/interfaces';
import { loadSettings, saveSettings } from '../../core/settings';
import { NATION_SIDE, type AircraftId, type GameSettings, type Livery, type MissionDefinition, type MissionResult, type Nation } from '../../core/types';
import { getAerodrome } from '../../data/aerodromes';
import { AIRCRAFT } from '../../data/aircraft';
import { createHud } from '../hud/hud';
import type { HudView } from '../hud/types';
import { missionMapView } from '../map/mapRenderer';
import { resolveUnits } from '../format';
import { h } from '../dom';

const liv = (fuselage: string, accent: string, insignia: Livery['insignia'], tail = fuselage): Livery => ({
  fuselage,
  wingTop: fuselage,
  wingBottom: '#cfc6a8',
  tail,
  cowling: accent,
  accent,
  insignia,
});

export const MOCK_SQUADRONS: SquadronInfo[] = [
  {
    id: 'jasta11', name: 'Jagdstaffel 11', shortName: 'Jasta 11', nation: 'germany', formed: '1916-09-28', disbanded: '1918-11-11',
    bases: [{ from: '1916-09-28', to: '1917-06-01', aerodromeId: 'la-brayelle' }, { from: '1917-06-02', to: '1918-11-11', aerodromeId: 'marcke' }],
    equipment: [{ from: '1916-09-28', to: '1917-06-30', aircraft: ['albatros_diii'] }, { from: '1917-07-01', to: '1917-10-15', aircraft: ['albatros_dv'] }, { from: '1917-10-16', to: '1918-05-31', aircraft: ['fokker_dri', 'albatros_dv'] }, { from: '1918-06-01', to: '1918-11-11', aircraft: ['fokker_dvii'] }],
    livery: liv('#b3261e', '#e8e0cc', 'iron-cross-patee'), notableAces: ['richthofen', 'voss'], motto: 'Jagdstaffel Richthofen',
    description: 'Richthofen\'s own Jasta, the core of the "Flying Circus". Red noses and tails for all; the Rittmeister\'s machine red all over.',
  },
  {
    id: 'jasta2', name: 'Jagdstaffel 2 "Boelcke"', shortName: 'Jasta 2', nation: 'germany', formed: '1916-08-10', disbanded: '1918-11-11',
    bases: [{ from: '1916-08-10', to: '1917-03-10', aerodromeId: 'bertincourt' }, { from: '1917-03-11', to: '1918-11-11', aerodromeId: 'pronville' }],
    equipment: [{ from: '1916-08-10', to: '1917-01-31', aircraft: ['albatros_dii'] }, { from: '1917-02-01', to: '1917-07-31', aircraft: ['albatros_diii'] }, { from: '1917-08-01', to: '1918-11-11', aircraft: ['albatros_dv', 'fokker_dri'] }],
    livery: liv('#2a2a2a', '#f2ede0', 'iron-cross-patee', '#f2ede0'), notableAces: ['boelcke'], motto: 'Jasta Boelcke',
    description: 'Oswald Boelcke\'s hand-picked Jasta, the first true fighter squadron. Black and white tails honour its fallen founder.',
  },
  {
    id: 'rfc56', name: 'No. 56 Squadron RFC', shortName: '56 Sqn', nation: 'britain', formed: '1916-06-08', disbanded: '1918-11-11',
    bases: [{ from: '1917-04-07', to: '1917-05-31', aerodromeId: 'vert-galand' }, { from: '1917-06-01', to: '1918-11-11', aerodromeId: 'estree-blanche' }],
    equipment: [{ from: '1917-04-01', to: '1918-11-11', aircraft: ['se5a'] }],
    livery: liv('#6b6a45', '#c9c3a4', 'roundel-rfc'), notableAces: ['mccudden', 'ball'], motto: 'Quid si coelum ruat',
    description: 'The elite S.E.5 squadron of McCudden, Ball and Rhys Davids — "the finest squadron in the RFC".',
  },
  {
    id: 'rfc24', name: 'No. 24 Squadron RFC', shortName: '24 Sqn', nation: 'britain', formed: '1915-09-01', disbanded: '1918-11-11',
    bases: [{ from: '1916-02-01', to: '1918-11-11', aerodromeId: 'bertangles' }],
    equipment: [{ from: '1916-02-01', to: '1917-06-01', aircraft: ['airco_dh2'] }, { from: '1917-06-02', to: '1918-11-11', aircraft: ['se5a'] }],
    livery: liv('#6b6a45', '#c9c3a4', 'roundel-rfc'), notableAces: ['hawker'], motto: 'In omnia parati',
    description: 'Lanoe Hawker\'s D.H.2 squadron, the first single-seat fighter squadron of the RFC.',
  },
  {
    id: 'spa3', name: 'Escadrille SPA 3 "Les Cigognes"', shortName: 'SPA 3', nation: 'france', formed: '1914-09-01', disbanded: '1918-11-11',
    bases: [{ from: '1916-06-01', to: '1917-05-31', aerodromeId: 'cachy' }, { from: '1917-06-01', to: '1918-11-11', aerodromeId: 'bierne' }],
    equipment: [{ from: '1916-01-01', to: '1916-12-31', aircraft: ['nieuport_17'] }, { from: '1917-01-01', to: '1917-08-31', aircraft: ['spad_vii'] }, { from: '1917-09-01', to: '1918-11-11', aircraft: ['spad_xiii'] }],
    livery: liv('#d8d2bd', '#2b3f8f', 'roundel-france'), notableAces: ['guynemer'], motto: 'Les Cigognes',
    description: 'The storks of Guynemer: the most famous escadrille de chasse of the Aéronautique Militaire.',
  },
  {
    id: 'us94', name: '94th Aero Squadron', shortName: '94th Aero', nation: 'usa', formed: '1917-08-20', disbanded: '1918-11-11',
    bases: [{ from: '1918-03-01', to: '1918-11-11', aerodromeId: 'allonville' }],
    equipment: [{ from: '1918-03-01', to: '1918-07-31', aircraft: ['nieuport_28'] }, { from: '1918-08-01', to: '1918-11-11', aircraft: ['spad_xiii'] }],
    livery: liv('#d8d2bd', '#b3202a', 'roundel-usa'), notableAces: ['rickenbacker', 'lufbery'], motto: 'Hat in the Ring',
    description: 'Uncle Sam\'s top hat tossed into the ring: the first American squadron to fight, home of Rickenbacker.',
  },
];

const RANKS: Record<Nation, string[]> = {
  germany: ['vizefeldwebel', 'leutnant', 'oberleutnant', 'rittmeister'],
  britain: ['second-lieutenant', 'lieutenant', 'captain', 'major'],
  france: ['sergent', 'adjudant', 'sous-lieutenant', 'lieutenant', 'capitaine'],
  usa: ['second-lieutenant', 'first-lieutenant', 'captain', 'major'],
};

function iso(): string {
  return new Date().toISOString();
}

function seedPilots(): CareerPilot[] {
  const base = (o: Partial<CareerPilot> & Pick<CareerPilot, 'id' | 'firstName' | 'lastName' | 'nation' | 'squadronId' | 'rankId' | 'date'>): CareerPilot => ({
    side: NATION_SIDE[o.nation],
    difficulty: 'pilot',
    status: 'active',
    hospitalDays: 0,
    missionsFlown: 0,
    victories: [],
    unconfirmedClaims: 0,
    medals: [],
    log: [],
    fame: 0,
    rngSeed: 42,
    createdAt: iso(),
    updatedAt: iso(),
    ...o,
  });
  const vics = (n: number, victims: string[], from: string) =>
    Array.from({ length: n }, (_, i) => ({
      number: i + 1,
      date: new Date(Date.parse(from) + i * 3 * 86_400_000).toISOString().slice(0, 10),
      victim: victims[i % victims.length],
      location: ['near Arras', 'over Monchy-le-Preux', 'east of Vimy', 'near Douai', 'over Lens'][i % 5],
      confirmed: i % 6 !== 5,
    }));
  return [
    base({
      id: 'p-hartmann', firstName: 'Karl', lastName: 'Hartmann', nation: 'germany', squadronId: 'jasta11', rankId: 'leutnant', date: '1917-04-22',
      missionsFlown: 34, fame: 58, unconfirmedClaims: 3,
      victories: vics(14, ['Sopwith Pup', 'B.E.2c', 'Nieuport 17', 'Sopwith 1½ Strutter', 'SPAD VII', 'Balloon'], '1917-01-28'),
      medals: [
        { medalId: 'iron-cross-2', date: '1917-02-10', citation: 'For bravery in the face of the enemy.' },
        { medalId: 'iron-cross-1', date: '1917-03-18', citation: 'For five aerial victories.' },
        { medalId: 'hohenzollern', date: '1917-04-14', citation: 'For ten victories.' },
      ],
      log: [
        { date: '1917-04-20', missionType: 'patrol', missionTitle: 'Barrier patrol, Arras sector', aircraftId: 'albatros_diii', outcome: 'returned', claims: 1, confirmed: 1, notes: 'Pup destroyed near Monchy' },
        { date: '1917-04-21', missionType: 'intercept', missionTitle: 'Intercept artillery flyers', aircraftId: 'albatros_diii', outcome: 'returned', claims: 2, confirmed: 1, notes: 'B.E.2 flamed; second unconfirmed' },
        { date: '1917-04-22', missionType: 'balloon-defense', missionTitle: 'Protect the Drachen at Vitry', aircraftId: 'albatros_diii', outcome: 'wounded', claims: 0, confirmed: 0, notes: 'Grazed by an observer\'s bullet' },
      ],
    }),
    base({ id: 'p-ashworth', firstName: 'Cecil', lastName: 'Ashworth', nation: 'britain', squadronId: 'rfc56', rankId: 'captain', date: '1917-09-14', missionsFlown: 61, fame: 44, status: 'killed', victories: vics(9, ['Albatros D.V', 'DFW C.V', 'Albatros D.III'], '1917-05-10'), medals: [{ medalId: 'military-cross', date: '1917-07-01', citation: 'For conspicuous gallantry.' }] }),
    base({ id: 'p-lefevre', firstName: 'René', lastName: 'Lefèvre', nation: 'france', squadronId: 'spa3', rankId: 'adjudant', date: '1917-06-30', missionsFlown: 12, fame: 12, status: 'hospital', hospitalDays: 9, victories: vics(2, ['Albatros D.III'], '1917-06-10') }),
  ];
}

function mockMission(p: { date: string; nation: Nation; squadronId?: string }, aircraftId: AircraftId, career: boolean, title?: string): MissionDefinition {
  const sq = MOCK_SQUADRONS.find((s) => s.id === p.squadronId);
  const baseId = sq?.bases.find((b) => b.from <= p.date && p.date <= b.to)?.aerodromeId ?? (NATION_SIDE[p.nation] === 'central' ? 'douai' : 'filescamp');
  const home = getAerodrome(baseId)!;
  const side = NATION_SIDE[p.nation];
  const dir = side === 'central' ? -1 : 1;
  const wps = [
    { x: home.x + dir * 6000, z: home.z - 3000, altitude: 2500, action: 'fly' as const, label: 'Climb' },
    { x: home.x + dir * 14000, z: home.z - 1000, altitude: 3000, action: 'patrol' as const, duration: 600, label: 'Patrol line' },
    { x: home.x + dir * 12000, z: home.z + 7000, altitude: 3000, action: 'patrol' as const, duration: 300 },
    { x: home.x, z: home.z, altitude: 400, action: 'land' as const, label: 'Home' },
  ];
  const livery = sq?.livery ?? liv('#6b6a45', '#c9c3a4', side === 'central' ? 'iron-cross-patee' : 'roundel-rfc');
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    type: 'patrol',
    title: title ?? 'Offensive patrol over Monchy-le-Preux',
    briefing:
      'The enemy has been active over the Scarpe since dawn. Artillery flyers are directing heavy fire onto our batteries east of Arras, and his scouts are reported in strength at 3,000 metres.\n\nYou will lead a flight of three along the lines between Monchy and Vimy Ridge. Engage any enemy machines you find; the artillery flyers are your first concern.\n\nKeep your height, watch the sun, and do not follow a beaten man down over his own archie.',
    date: p.date,
    timeOfDay: 'morning',
    weather: { cloudCover: 0.35, cloudBaseM: 1800, cloudTopM: 2400, wind: [7, 0, -2], visibilityM: 12000, turbulence: 0.2 },
    flights: [
      {
        id: 'player', role: 'player-flight', side, nation: p.nation, aircraftId, squadronId: sq?.id,
        members: [
          { isPlayer: true, skill: 'veteran', livery },
          { pilotName: side === 'central' ? 'Vzfw. Weber' : 'Lt. Bellamy', skill: 'regular', livery },
          { pilotName: side === 'central' ? 'Ltn. Krüger' : '2/Lt. Pemberton', skill: 'novice', livery },
        ],
        start: { x: home.x + dir * 2000, z: home.z, altitude: 1500, heading: side === 'central' ? Math.PI * 1.5 : Math.PI / 2, airspeed: 45 },
        waypoints: wps, task: 'fighter-sweep',
      },
    ],
    balloons: [
      { id: 'b1', side: side === 'central' ? 'allied' : 'central', x: home.x + dir * 19000, z: home.z + 2000, altitude: 900 },
    ],
    groundTargets: [],
    objectives: [
      { id: 'o1', kind: 'destroy-aircraft', description: 'Destroy enemy artillery flyers over the lines', targetIds: ['enemy'], count: 1, primary: true },
      { id: 'o2', kind: 'survive', description: 'Return to the aerodrome', targetIds: [], count: 1, primary: false },
    ],
    homeAerodromeId: baseId,
    isCareer: career,
  };
}

export interface MockOptions {
  /** Mock flight duration before auto-ending (ms), 0 = only manual end. */
  autoEndMs?: number;
}

export function createMockServices(opts: MockOptions = {}): GameServices {
  let pilots = seedPilots();
  let settings: GameSettings = loadSettings();

  const summary = (p: CareerPilot): PilotSummary => ({
    id: p.id,
    name: `${p.firstName} ${p.lastName}`,
    nation: p.nation,
    rankAbbrev: p.rankId === 'leutnant' ? 'Ltn.' : p.rankId === 'captain' ? 'Capt.' : p.rankId === 'adjudant' ? 'Adj.' : p.rankId,
    squadronName: MOCK_SQUADRONS.find((s) => s.id === p.squadronId)?.shortName ?? p.squadronId,
    date: p.date,
    victories: p.victories.filter((v) => v.confirmed).length,
    status: p.status,
  });

  const campaign: CampaignService = {
    listPilots: () => pilots.map(summary),
    returnToDuty(p) {
      p.status = 'active';
      p.hospitalDays = 0;
      campaign.savePilot(p);
    },
    createPilot(o: NewPilotOptions) {
      const sq = o.squadronId ? MOCK_SQUADRONS.find((s) => s.id === o.squadronId)! : MOCK_SQUADRONS.find((s) => s.nation === o.nation)!;
      const p: CareerPilot = {
        id: `p-${Math.random().toString(36).slice(2, 8)}`,
        firstName: o.firstName, lastName: o.lastName, nation: o.nation, side: NATION_SIDE[o.nation], difficulty: o.difficulty,
        squadronId: sq.id, rankId: RANKS[o.nation][0], date: o.startDate, status: 'active', hospitalDays: 0, missionsFlown: 0,
        victories: [], unconfirmedClaims: 0, medals: [], log: [], fame: 0, rngSeed: 7, createdAt: iso(), updatedAt: iso(),
      };
      pilots.push(p);
      return p;
    },
    loadPilot: (id) => structuredClone(pilots.find((p) => p.id === id) ?? null),
    savePilot(p) {
      pilots = pilots.map((x) => (x.id === p.id ? structuredClone(p) : x));
    },
    deletePilot(id) {
      pilots = pilots.filter((p) => p.id !== id);
    },
    squadronsFor: (nation, date) => MOCK_SQUADRONS.filter((s) => s.nation === nation && s.formed <= date && date <= s.disbanded && s.equipment.some((e) => e.from <= date && date <= e.to)),
    getSquadron: (id) => MOCK_SQUADRONS.find((s) => s.id === id),
    availableAircraft(p) {
      const sq = MOCK_SQUADRONS.find((s) => s.id === p.squadronId);
      const e = sq?.equipment.find((r) => r.from <= p.date && p.date <= r.to) ?? sq?.equipment[0];
      return e?.aircraft ?? ['sopwith_camel'];
    },
    generateMission(p, choice) {
      return mockMission(p, choice ?? campaign.availableAircraft(p)[0], true);
    },
    applyMissionResult(p, mission, result): DebriefReport {
      const claims = result.claims.map((c, i) => ({ ...c, confirmed: i % 3 !== 2 }));
      p.missionsFlown++;
      p.log.push({ date: mission.date, missionType: mission.type, missionTitle: mission.title, aircraftId: mission.flights[0].aircraftId, outcome: result.playerFate, claims: claims.length, confirmed: claims.filter((c) => c.confirmed).length, notes: '' });
      const n = p.victories.length;
      claims.forEach((c, i) => p.victories.push({ number: n + i + 1, date: mission.date, victim: c.victimName, location: 'near Arras', confirmed: c.confirmed }));
      const ranks = RANKS[p.nation];
      const ri = ranks.indexOf(p.rankId);
      const promotion = ri >= 0 && ri < ranks.length - 1 ? { fromRankId: p.rankId, toRankId: ranks[ri + 1] } : null;
      if (promotion) p.rankId = promotion.toRankId;
      const medals = [{ medalId: p.nation === 'germany' ? 'pour-le-merite' : p.nation === 'britain' ? 'victoria-cross' : p.nation === 'france' ? 'legion-honneur' : 'dsc-us', date: mission.date, citation: 'For sixteen victories over the enemy in the air, and for conspicuous gallantry in leading his flight against superior numbers.' }];
      p.medals.push(...medals);
      if (result.playerFate === 'killed') p.status = 'killed';
      pilots = pilots.map((x) => (x.id === p.id ? structuredClone(p) : x));
      return {
        missionTitle: mission.title,
        pilotFate: result.playerFate,
        missionSuccess: result.missionSuccess,
        claims,
        promotion,
        medals,
        narrative: [
          'The flight crossed the lines at 3,000 metres and found a formation of five enemy scouts below the cloud near Monchy. You led the attack out of the sun.',
          'Your first burst sent an Albatros down in flames; a second was seen to spin away and is credited to the flight. The squadron commander is pleased with the morning\'s work.',
        ],
        newspaperHeadline: 'Daring Airman Downs Two Over Arras',
        daysElapsed: 1,
        careerEnded: result.playerFate === 'killed' || result.playerFate === 'captured',
      };
    },
    aceStandings(p): AceStanding[] {
      const list: AceStanding[] = [
        { name: 'Manfred von Richthofen', aceId: 'richthofen', nation: 'germany', victories: 52, isPlayer: false, status: 'active' },
        { name: 'Georges Guynemer', aceId: 'guynemer', nation: 'france', victories: 45, isPlayer: false, status: 'active' },
        { name: 'Albert Ball', aceId: 'ball', nation: 'britain', victories: 44, isPlayer: false, status: 'killed' },
        { name: 'Werner Voss', aceId: 'voss', nation: 'germany', victories: 28, isPlayer: false, status: 'active' },
        { name: 'Billy Bishop', aceId: 'bishop', nation: 'britain', victories: 22, isPlayer: false, status: 'active' },
        { name: `${p.firstName} ${p.lastName}`, nation: p.nation, victories: p.victories.filter((v) => v.confirmed).length, isPlayer: true, status: p.status === 'killed' ? 'killed' : 'active' },
        { name: 'Kurt Wolff', nation: 'germany', victories: 29, isPlayer: false, status: 'active' },
      ];
      return list.sort((a, b) => b.victories - a.victories);
    },
    buildQuickMission(o: QuickMissionOptions) {
      const nation = AIRCRAFT[o.playerAircraft].nation;
      return { ...mockMission({ date: o.date ?? AIRCRAFT[o.playerAircraft].introduced, nation }, o.playerAircraft, false, 'Quick mission: dogfight'), type: 'dogfight', timeOfDay: o.timeOfDay };
    },
  };

  const audio: AudioEngine = {
    resume: async () => {},
    setVolumes: () => {},
    playMusic: (cue) => console.debug('[mock audio] music', cue),
    playUi: () => {},
    updateFlight: () => {},
    handleEvent: () => {},
    stopFlight: () => {},
  };

  const launcher: FlightLauncher = {
    fly(mission, s, container) {
      return new Promise<MissionResult>((resolve) => {
        const sky = h('div', { style: 'position:absolute;inset:0;background:linear-gradient(#7ea2c4,#c9d7df 55%,#8a8a64 56%,#5d6a3a)' });
        container.append(sky);
        const hud = createHud(container, s);
        const view = fakeHudView(mission, 0);
        let t = 0;
        let raf = 0;
        let mapOpen = false;
        const loop = () => {
          t += 1 / 60;
          const v = fakeHudView(mission, t);
          Object.assign(view, v);
          hud.update(view);
          hud.setGEffect(Math.max(0, Math.sin(t * 0.4) * 0.5 - 0.25));
          if (mapOpen) hud.showMap({ ...missionMapView(mission, resolveUnits(s.units, view.nation).system), markers: [{ kind: 'aircraft', x: mission.flights[0].start.x + t * 40, z: mission.flights[0].start.z, heading: view.heading, side: mission.flights[0].side, isPlayer: true }] });
          raf = requestAnimationFrame(loop);
        };
        loop();
        hud.showMessage('Flight airborne. Climbing to patrol height.', { kind: 'info' });
        setTimeout(() => hud.showMessage('Enemy scouts, two o\'clock high!', { from: 'Weber', kind: 'radio' }), 1500);
        setTimeout(() => hud.showMessage('Albatros D.V destroyed!', { kind: 'victory' }), 3000);
        setTimeout(() => hud.setDamageFlash(0.8), 2500);
        const finish = (fate: MissionResult['playerFate']) => {
          cancelAnimationFrame(raf);
          window.removeEventListener('keydown', onKey);
          hud.dispose();
          resolve(fakeResult(mission, fate));
        };
        const onKey = (e: KeyboardEvent) => {
          if (hud.menuOpen) return;
          if (e.code === 'KeyN') hud.showEndFlightPrompt({ safe: true, onConfirm: () => finish('returned'), onCancel: () => {} });
          if (e.code === 'KeyK') hud.showEndFlightPrompt({ safe: false, reason: 'Enemy aircraft within 2 km.', onConfirm: () => finish('killed'), onCancel: () => {} });
          if (e.code === 'Escape') hud.showPauseMenu({ onResume: () => {}, onEndFlight: () => finish('returned'), onQuit: () => finish('returned') });
          if (e.code === 'KeyM') {
            mapOpen = !mapOpen;
            if (!mapOpen) hud.showMap(null);
          }
          if (e.code === 'KeyO') hud.showWingmanMenu(!container.querySelector('.hud-orders'));
        };
        window.addEventListener('keydown', onKey);
        if (opts.autoEndMs) setTimeout(() => finish('returned'), opts.autoEndMs);
      });
    },
  };

  return {
    campaign,
    audio,
    launcher,
    getSettings: () => settings,
    saveSettings(s) {
      settings = s;
      saveSettings(s);
    },
  };
}

export function fakeResult(mission: MissionDefinition, fate: MissionResult['playerFate']): MissionResult {
  return {
    missionId: mission.id, playerFate: fate, playerOutcome: fate === 'killed' ? 'shot-down' : 'landed-friendly', endedByPlayer: true,
    claims: [
      { time: 312, victimAircraftId: 'albatros_dv', victimName: 'Albatros D.V', victimSide: 'central', x: 0, z: 0, witnessed: true, shared: false },
      { time: 420, victimAircraftId: 'albatros_dv', victimName: 'Albatros D.V', victimSide: 'central', x: 0, z: 0, witnessed: false, shared: false },
      { time: 505, victimAircraftId: 'balloon', victimName: 'Observation balloon', victimSide: 'central', x: 0, z: 0, witnessed: false, shared: false },
    ],
    objectives: mission.objectives.map((o, i) => ({ id: o.id, completed: i === 0 })),
    missionSuccess: fate !== 'killed', friendlyLosses: [{ name: '2/Lt. Pemberton', fate: 'captured' }], enemyLosses: 2, flightTimeS: 1834, roundsFired: 612, hits: 57, wingmanClaims: [],
  };
}

export function fakeHudView(mission: MissionDefinition, t: number): HudView {
  const f = mission.flights[0];
  const spec = AIRCRAFT[f.aircraftId];
  const guns = spec.guns.map((g, i) => ({
    label: `${g.type === 'spandau' ? 'Spandau' : g.type === 'vickers' ? 'Vickers' : g.type === 'lewis' ? 'Lewis' : 'Parabellum'}${spec.guns.length > 1 && g.mount !== 'flexible' ? (i === 0 ? ' L' : ' R') : ''}`,
    roundsLeft: Math.max(0, g.rounds - Math.floor(t * 12) - i * 37),
    capacity: g.rounds,
    spares: g.spareDrums,
    jammed: i === 1 && t % 10 > 5,
    jamClearProgress: ((t % 10) - 5) / 5,
    reloading: 0,
    heat: Math.abs(Math.sin(t)) * 0.6,
    observer: g.mount === 'flexible',
  }));
  return {
    nation: f.nation,
    view: 'chase',
    showInstruments: true,
    airspeed: 48 + Math.sin(t * 0.7) * 6,
    altitude: 2400 + Math.sin(t * 0.3) * 200,
    heightAboveGround: 2350,
    verticalSpeed: 1.5,
    heading: (t * 0.15) % (Math.PI * 2),
    gLoad: 1 + Math.abs(Math.sin(t * 0.6)) * 2.2,
    rpm: 1150 + Math.sin(t) * 60,
    maxRpm: 1250,
    throttle: 0.85,
    blip: false,
    engineType: spec.performance.engineType,
    fuelL: spec.performance.fuelCapacityL * 0.62,
    fuelCapacityL: spec.performance.fuelCapacityL,
    stalled: false,
    onGround: false,
    guns,
    damage: { engine: 0.2, fuselage: 0.1, leftWing: 0.45, rightWing: 0, tail: 0.75, controls: 0, fuelTank: 0, onFire: false, smoking: true, fuelLeak: true, engineDead: false, pilotWounded: false },
    target: {
      name: 'Ltn. W. Voss',
      type: 'Fokker Dr.I',
      kind: 'aircraft',
      friendly: false,
      range: 420 - Math.sin(t) * 120,
      closure: 8,
      aspectDeg: 20,
      screen: { x: 0.56 + Math.sin(t * 0.8) * 0.08, y: 0.42 + Math.cos(t * 0.6) * 0.05, onScreen: true },
      damage: 0.35,
      isAce: true,
    },
    padlock: { active: true, name: 'Ltn. W. Voss' },
    threats: [
      { angle: Math.PI * 0.8, distance: 900, danger: true },
      { angle: -Math.PI * 0.4, distance: 1600, danger: false },
    ],
    wingmen: [
      { name: 'Weber', status: 'engaged' },
      { name: 'Krüger', status: 'damaged' },
    ],
    waypoint: { index: 1, total: 4, label: 'Patrol line', distance: 5400, screen: { x: 0.5, y: 0.5, onScreen: false, edgeAngle: -1.2 } },
    gunReticle: { x: 0.5, y: 0.47, onScreen: true },
    timeCompression: 1,
    missionTime: 300 + t,
    hint: t < 8 ? 'Press P to padlock the nearest enemy; the view will follow the target as you manoeuvre.' : null,
  };
}
