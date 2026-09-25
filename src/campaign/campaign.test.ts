import { describe, expect, it } from 'vitest';
import type { CareerPilot } from '../core/campaignTypes';
import type { AircraftId, MissionDefinition, MissionResult, PilotFate, VictoryClaim } from '../core/types';
import { SECTOR_BOUNDS } from '../core/geo';
import { AIRCRAFT } from '../data/aircraft';
import { AERODROMES, getAerodrome } from '../data/aerodromes';
import { ACES, aceVictoriesOn, getAce } from '../data/aces';
import { MEDALS } from '../data/medals';
import { SQUADRONS } from '../data/squadrons';
import { sideOfFrontAt } from '../world/frontline';
import { checkMedals, checkPromotion } from './awards';
import { confirmationChance } from './debrief';
import { addDays } from './dates';
import { createCampaignService, memoryStorage, STORAGE_KEY } from './index';
import { Rng } from './rng';
import { squadronAircraftOn } from './squadronUtil';

const inBounds = (x: number, z: number) => x >= SECTOR_BOUNDS.minX && x <= SECTOR_BOUNDS.maxX && z >= SECTOR_BOUNDS.minZ && z <= SECTOR_BOUNDS.maxZ;

function validateMission(m: MissionDefinition, strictService: boolean) {
  const ids = new Set([...m.flights.map((f) => f.id), ...m.balloons.map((b) => b.id), ...m.groundTargets.map((g) => g.id)]);
  expect(ids.size).toBe(m.flights.length + m.balloons.length + m.groundTargets.length);
  const players = m.flights.flatMap((f) => f.members.filter((x) => x.isPlayer));
  expect(players).toHaveLength(1);
  expect(m.flights[0].role).toBe('player-flight');
  expect(m.flights[0].members[0].isPlayer).toBe(true);
  for (const f of m.flights) {
    const spec = AIRCRAFT[f.aircraftId];
    expect(spec, f.aircraftId).toBeDefined();
    if (strictService) {
      expect(spec.introduced <= m.date && m.date <= spec.retired, `${f.aircraftId} in service ${m.date}`).toBe(true);
    }
    expect(f.members.length).toBeGreaterThan(0);
    expect(inBounds(f.start.x, f.start.z), `${f.id} start in bounds`).toBe(true);
    expect(Number.isFinite(f.start.heading)).toBe(true);
    for (const w of f.waypoints) {
      expect(inBounds(w.x, w.z), `${f.id} waypoint in bounds`).toBe(true);
      for (const t of w.targetIds ?? []) expect(ids.has(t)).toBe(true);
    }
    if (f.escortFlightId) expect(ids.has(f.escortFlightId)).toBe(true);
  }
  for (const b of m.balloons) {
    expect(sideOfFrontAt(b.x, b.z, m.date)).toBe(b.side);
    expect(inBounds(b.x, b.z)).toBe(true);
  }
  for (const g of m.groundTargets) expect(inBounds(g.x, g.z)).toBe(true);
  expect(m.objectives.some((o) => o.primary)).toBe(true);
  for (const o of m.objectives) {
    for (const t of o.targetIds) {
      if (o.kind === 'reach-waypoint' || o.kind === 'patrol-area') {
        const [fid, idx] = t.split(':');
        const f = m.flights.find((x) => x.id === fid);
        expect(f && f.waypoints[Number(idx)]).toBeTruthy();
      } else expect(ids.has(t), `${o.kind} target ${t}`).toBe(true);
    }
  }
  if (m.isCareer) expect(getAerodrome(m.homeAerodromeId)).toBeDefined();
  expect(m.briefing.length).toBeGreaterThan(80);
}

function newService() {
  return createCampaignService(memoryStorage());
}

function randomResult(m: MissionDefinition, rng: Rng, fate?: PilotFate): MissionResult {
  const enemies = m.flights.filter((f) => f.side !== m.flights[0].side);
  const claims: VictoryClaim[] = [];
  const n = rng.int(0, 3);
  for (let i = 0; i < n && enemies.length; i++) {
    const f = rng.pick(enemies);
    const mem = rng.pick(f.members);
    claims.push({ time: 100 * i, victimAircraftId: f.aircraftId, victimName: mem.pilotName ?? AIRCRAFT[f.aircraftId].name, victimAceId: mem.aceId, victimSide: f.side, x: f.start.x, z: f.start.z, witnessed: rng.chance(0.5), shared: false });
  }
  if (m.balloons.length && rng.chance(0.5)) {
    const b = m.balloons[0];
    claims.push({ time: 500, victimAircraftId: 'balloon', victimName: 'Balloon', victimSide: b.side, x: b.x, z: b.z, witnessed: true, shared: false });
  }
  const f = fate ?? rng.weighted<PilotFate>([['returned', 80], ['wounded', 8], ['landed-elsewhere', 5], ['killed', 4], ['captured', 3]]);
  return {
    missionId: m.id,
    playerFate: f,
    playerOutcome: f === 'captured' ? 'landed-enemy' : f === 'killed' ? 'shot-down' : 'landed-friendly',
    endedByPlayer: false,
    claims,
    objectives: m.objectives.map((o) => ({ id: o.id, completed: rng.chance(0.6) })),
    missionSuccess: rng.chance(0.6),
    friendlyLosses: rng.chance(0.2) ? [{ name: m.flights[0].members[1]?.pilotName ?? 'Lt. X', aceId: m.flights[0].members[1]?.aceId, fate: 'killed' }] : [],
    enemyLosses: claims.length,
    flightTimeS: 1800,
    roundsFired: 400,
    hits: 40,
    wingmanClaims: [],
  };
}

describe('campaign data', () => {
  it('squadrons reference real aerodromes active during each base period', () => {
    const cap = '1918-10-09';
    for (const s of SQUADRONS) {
      for (const b of s.bases) {
        const a = getAerodrome(b.aerodromeId);
        expect(a, `${s.id} -> ${b.aerodromeId}`).toBeDefined();
        const side = s.nation === 'germany' ? 'central' : 'allied';
        expect(a!.side, `${s.id} base side`).toBe(side);
        if (b.from > cap) continue;
        expect(a!.activeFrom <= b.from, `${s.id} ${b.aerodromeId} active from ${b.from}`).toBe(true);
        const to = b.to < cap ? b.to : cap;
        expect(to <= a!.activeTo, `${s.id} ${b.aerodromeId} active to ${to}`).toBe(true);
      }
      for (const e of s.equipment) for (const id of e.aircraft) expect(AIRCRAFT[id]?.flyable, `${s.id} ${id}`).toBe(true);
    }
  });

  it('every squadron has a flyable aircraft on each month of its service', () => {
    for (const s of SQUADRONS) {
      for (let d = s.formed; d <= s.disbanded; d = addDays(d, 30)) {
        expect(squadronAircraftOn(s, d).length, `${s.id} ${d}`).toBeGreaterThan(0);
      }
    }
  });

  it('has at least 30 aces with valid references and ascending tallies', () => {
    expect(ACES.length).toBeGreaterThanOrEqual(30);
    for (const a of ACES) {
      for (const s of a.service) {
        if (s.squadronId) expect(SQUADRONS.some((q) => q.id === s.squadronId), `${a.id} ${s.squadronId}`).toBe(true);
        for (const id of s.aircraft) expect(AIRCRAFT[id], id).toBeDefined();
      }
      for (let i = 1; i < a.victories.length; i++) {
        expect(a.victories[i][0] > a.victories[i - 1][0]).toBe(true);
        expect(a.victories[i][1] >= a.victories[i - 1][1]).toBe(true);
      }
    }
  });

  it('medal prerequisites exist', () => {
    for (const m of MEDALS) for (const r of m.requires ?? []) expect(MEDALS.some((x) => x.id === r)).toBe(true);
    expect(AERODROMES.length).toBeGreaterThan(0);
  });

  it('Richthofen has 52 victories at the end of Bloody April and stops at 80', () => {
    const mvr = getAce('mvr')!;
    expect(aceVictoriesOn(mvr, '1917-04-30')).toBe(52);
    expect(aceVictoriesOn(mvr, '1916-09-01')).toBe(0);
    expect(aceVictoriesOn(mvr, '1918-06-01')).toBe(80);
    expect(aceVictoriesOn(getAce('boelcke')!, '1917-06-01')).toBe(40);
  });
});

describe('pilot creation & persistence', () => {
  it('round-trips pilots through storage', () => {
    const storage = memoryStorage();
    const a = createCampaignService(storage);
    const p = a.createPilot({ firstName: 'Werner', lastName: 'Kessler', nation: 'germany', startDate: '1917-04-01', squadronId: 'jasta11', difficulty: 'pilot' });
    expect(p.squadronId).toBe('jasta11');
    expect(p.rankId).toBe('de-ltn');
    const b = createCampaignService(storage);
    expect(b.listPilots().map((s) => s.id)).toEqual([p.id]);
    expect(b.loadPilot(p.id)).toEqual(p);
    b.deletePilot(p.id);
    expect(createCampaignService(storage).listPilots()).toEqual([]);
  });

  it('survives corrupt save data', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    const s = createCampaignService(storage);
    expect(s.listPilots()).toEqual([]);
    s.createPilot({ firstName: 'A', lastName: 'B', nation: 'britain', startDate: '1917-06-01', difficulty: 'pilot' });
    expect(createCampaignService(storage).listPilots()).toHaveLength(1);
  });

  it('moves the start date forward when a nation has no squadrons yet', () => {
    const s = newService();
    const p = s.createPilot({ firstName: 'Tom', lastName: 'Hitchcock', nation: 'usa', startDate: '1915-08-01', difficulty: 'pilot' });
    expect(p.date >= '1916-06-01').toBe(true);
    expect(p.squadronId).toBe('n124');
  });
});

describe('mission generator', () => {
  const cases: [CareerPilot['nation'], string, string?][] = [
    ['germany', '1915-10-01', 'ffa62'],
    ['germany', '1917-04-15', 'jasta11'],
    ['germany', '1918-05-10', 'jasta2'],
    ['britain', '1916-07-10', 'rfc24'],
    ['britain', '1917-04-20', 'rfc60'],
    ['britain', '1917-10-01', 'rnas10'],
    ['britain', '1918-06-15', 'rfc48'],
    ['france', '1916-09-15', 'spa3'],
    ['france', '1918-04-01', 'spa103'],
    ['usa', '1918-08-15', 'us94'],
    ['usa', '1918-09-20', 'us148'],
  ];

  it('produces valid, deterministic missions across nations and dates', () => {
    const s = newService();
    for (const [nation, date, squadronId] of cases) {
      const p = s.createPilot({ firstName: 'Test', lastName: nation, nation, startDate: date, squadronId, difficulty: 'pilot' });
      expect(p.squadronId).toBe(squadronId);
      const seen = new Set<string>();
      for (let i = 0; i < 25; i++) {
        p.missionsFlown = i;
        const m1 = s.generateMission(p);
        const m2 = s.generateMission(p);
        expect(m2).toEqual(m1);
        validateMission(m1, date >= '1917-01-15');
        seen.add(m1.type);
      }
      expect(seen.size, `${nation} ${date} mission variety`).toBeGreaterThanOrEqual(3);
    }
  });

  it('honours an aircraft choice and ground start', () => {
    const s = newService();
    const p = s.createPilot({ firstName: 'A', lastName: 'B', nation: 'germany', startDate: '1917-10-15', squadronId: 'jasta11', difficulty: 'pilot' });
    expect(s.availableAircraft(p)).toContain('fokker_dri');
    const m = s.generateMission(p, 'fokker_dri', { startOnGround: true });
    expect(m.flights[0].aircraftId).toBe('fokker_dri');
    expect(m.flights[0].startOnGround).toBe(true);
    expect(m.flights[0].start.airspeed).toBe(0);
    expect(p.preferredAircraft).toBe('fokker_dri');
  });

  it('puts Jasta 11 aces in the sky over Arras in April 1917', () => {
    const s = newService();
    const p = s.createPilot({ firstName: 'A', lastName: 'B', nation: 'britain', startDate: '1917-04-10', squadronId: 'rfc60', difficulty: 'pilot' });
    const aces = new Set<string>();
    for (let i = 0; i < 60; i++) {
      p.missionsFlown = i;
      for (const f of s.generateMission(p).flights) for (const m of f.members) if (m.aceId && f.role === 'enemy') aces.add(m.aceId);
    }
    expect([...aces].some((a) => ['mvr', 'wolff', 'allmenroder', 'lothar'].includes(a))).toBe(true);
  });

  it('never fields an ace this career has already shot down', () => {
    const s = newService();
    const p = s.createPilot({ firstName: 'A', lastName: 'B', nation: 'britain', startDate: '1917-04-10', squadronId: 'rfc60', difficulty: 'pilot' });
    p.alteredAces = { mvr: { fate: 'killed', date: '1917-04-09' } };
    for (let i = 0; i < 60; i++) {
      p.missionsFlown = i;
      for (const f of s.generateMission(p).flights) for (const m of f.members) expect(m.aceId).not.toBe('mvr');
    }
    const standing = s.aceStandings(p).find((r) => r.aceId === 'mvr')!;
    expect(standing.status).toBe('killed');
    expect(standing.victories).toBe(aceVictoriesOn(getAce('mvr')!, '1917-04-09'));
  });

  it('never flies a squadron mate who was killed or captured', () => {
    const s = newService();
    const p = s.createPilot({ firstName: 'A', lastName: 'B', nation: 'usa', startDate: '1918-06-10', squadronId: 'us94', difficulty: 'pilot' });
    const mateNames = (m: MissionDefinition) => m.flights[0].members.filter((x) => !x.isPlayer && !x.aceId).map((x) => x.pilotName!);
    let m = s.generateMission(p);
    for (let i = 0; i < 4 && mateNames(m).length < 2; i++) (p.missionsFlown += 1), (m = s.generateMission(p));
    const [dead, prisoner] = mateNames(m);
    expect(dead).toBeDefined();
    const r = { ...randomResult(m, new Rng(5), 'returned'), claims: [], friendlyLosses: [{ name: dead, fate: 'killed' as const }, ...(prisoner ? [{ name: prisoner, fate: 'captured' as const }] : [])] };
    s.applyMissionResult(p, m, r);
    for (let i = 0; i < 25; i++) {
      p.missionsFlown += 1;
      const names = mateNames(s.generateMission(p));
      expect(names).not.toContain(dead);
      if (prisoner) expect(names).not.toContain(prisoner);
    }
  });

  it('retires an ace brought down by someone else in the fight (acesDown)', () => {
    const s = newService();
    const p = s.createPilot({ firstName: 'A', lastName: 'B', nation: 'britain', startDate: '1917-04-10', squadronId: 'rfc60', difficulty: 'pilot' });
    const m = s.generateMission(p);
    const rng = new Rng(3);
    const r = { ...randomResult(m, rng, 'returned'), claims: [], acesDown: [{ aceId: 'wolff', side: 'central' as const, fate: 'killed' as const }] };
    const report = s.applyMissionResult(p, m, r);
    expect(p.alteredAces?.wolff?.fate).toBe('killed');
    expect(report.narrative.join(' ')).toMatch(/Wolff/);
    for (let i = 0; i < 30; i++) {
      p.missionsFlown = 10 + i;
      for (const f of s.generateMission(p).flights) for (const x of f.members) expect(x.aceId).not.toBe('wolff');
    }
  });

  it('keeps enemy numbers fightable against the player flight', () => {
    const s = newService();
    for (const [nation, date] of [['britain', '1918-06-01'], ['germany', '1918-06-01'], ['france', '1917-06-01']] as const) {
      const p = s.createPilot({ firstName: 'A', lastName: 'B', nation, startDate: date, difficulty: 'pilot' });
      for (let i = 0; i < 25; i++) {
        p.missionsFlown = i;
        const m = s.generateMission(p);
        const mine = m.flights[0].members.length;
        for (const f of m.flights) if (f.role === 'enemy' && AIRCRAFT[f.aircraftId].role === 'fighter') expect(f.members.length).toBeLessThanOrEqual(mine + 1);
      }
    }
  });

  it('builds every kind of quick mission', () => {
    const s = newService();
    const types = ['dogfight', 'balloon-attack', 'escort', 'intercept', 'ground-attack'] as const;
    const starts = ['head-on', 'advantage', 'disadvantage', 'random'] as const;
    let seed = 1;
    for (const type of types) {
      for (const startPosition of starts) {
        const m = s.buildQuickMission(
          { playerAircraft: 'sopwith_camel', enemyAircraft: 'fokker_dri', enemyCount: 3, wingmen: 2, enemySkill: 'veteran', wingmanSkill: 'regular', altitudeM: 2500, startPosition, timeOfDay: 'afternoon', cloudCover: 0.4, type, enemyAceId: 'mvr' },
          seed++,
        );
        validateMission(m, true);
        expect(m.isCareer).toBe(false);
        expect(m.flights[0].members).toHaveLength(3);
        expect(m.flights[0].side).toBe('allied');
        const enemies = m.flights.filter((f) => f.role === 'enemy' && f.aircraftId === 'fokker_dri');
        expect(enemies[0].members[0].aceId).toBe('mvr');
        expect(enemies.reduce((n, f) => n + f.members.length, 0)).toBe(3);
      }
    }
  });
});

describe('debrief rules', () => {
  const base = (): CareerPilot => ({
    id: 'x', firstName: 'Test', lastName: 'Pilot', nation: 'germany', side: 'central', difficulty: 'pilot', squadronId: 'jasta11', rankId: 'de-ltn',
    date: '1917-06-01', status: 'active', hospitalDays: 0, missionsFlown: 0, victories: [], unconfirmedClaims: 0, medals: [], log: [], fame: 0, rngSeed: 7, createdAt: '', updatedAt: '',
  });
  const victory = (n: number) => ({ number: n, date: '1917-05-01', victim: 'Sopwith Pup', location: 'near Arras', confirmed: true });

  it('witnessed kills over our own lines are likelier to be confirmed', () => {
    const p = base();
    const claim: VictoryClaim = { time: 0, victimAircraftId: 'sopwith_pup' as AircraftId, victimName: '', victimSide: 'allied', x: 30000, z: 0, witnessed: true, shared: false };
    const good = confirmationChance(p, claim, p.date);
    const bad = confirmationChance(p, { ...claim, witnessed: false, x: -40000 }, p.date);
    expect(good).toBeGreaterThan(bad + 0.2);
  });

  it('promotes by victories and awards medals in order', () => {
    const p = base();
    expect(checkMedals(p, p.date, false)).toEqual([]);
    p.victories = [victory(1)];
    expect(checkMedals(p, p.date, false).map((m) => m.medalId)).toEqual(['ek2']);
    p.medals.push({ medalId: 'ek2', date: p.date, citation: '' });
    p.victories = [1, 2, 3].map(victory);
    expect(checkMedals(p, p.date, false).map((m) => m.medalId)).toEqual(['ek1']);
    p.medals.push({ medalId: 'ek1', date: p.date, citation: '' });
    p.victories = Array.from({ length: 16 }, (_, i) => victory(i + 1));
    expect(checkMedals(p, p.date, false).map((m) => m.medalId)).toEqual(['hohenzollern']);
    p.medals.push({ medalId: 'hohenzollern', date: p.date, citation: '' });
    const plm = checkMedals(p, p.date, false).map((m) => m.medalId);
    expect(plm).toContain('plm');
    p.victories = p.victories.slice(0, 15);
    expect(checkMedals(p, p.date, false).map((m) => m.medalId)).not.toContain('plm');
    p.victories = Array.from({ length: 10 }, (_, i) => victory(i + 1));
    expect(checkPromotion(p)).toEqual({ fromRankId: 'de-ltn', toRankId: 'de-oblt' });
  });

  it('respects the DFC institution date for the RAF', () => {
    const p: CareerPilot = { ...base(), nation: 'britain', side: 'allied', rankId: 'gb-2lt', squadronId: 'rfc56', victories: [1, 2, 3, 4, 5].map(victory) };
    expect(checkMedals(p, '1918-05-01', false).map((m) => m.medalId)).toContain('mc');
    expect(checkMedals(p, '1918-07-01', false).map((m) => m.medalId)).toContain('dfc');
    expect(checkMedals(p, '1918-07-01', false).map((m) => m.medalId)).not.toContain('mc');
  });

  it('handles death, capture and wounds', () => {
    const s = newService();
    const p = s.createPilot({ firstName: 'A', lastName: 'B', nation: 'france', startDate: '1917-05-01', squadronId: 'spa3', difficulty: 'pilot' });
    const m = s.generateMission(p);
    const rng = new Rng(3);
    const r = s.applyMissionResult(p, m, randomResult(m, rng, 'wounded'));
    expect(p.status).toBe('hospital');
    expect(r.daysElapsed).toBeGreaterThanOrEqual(p.hospitalDays);
    s.generateMission(p);
    expect(p.status).toBe('active');
    const m2 = s.generateMission(p);
    const r2 = s.applyMissionResult(p, m2, randomResult(m2, rng, 'captured'));
    expect(p.status).toBe('captured');
    expect(r2.careerEnded).toBe(true);
    expect(() => s.generateMission(p)).toThrow();
  });

  it('ends the career at the Armistice', () => {
    const s = newService();
    const p = s.createPilot({ firstName: 'A', lastName: 'B', nation: 'usa', startDate: '1918-10-01', squadronId: 'us94', difficulty: 'pilot' });
    const rng = new Rng(9);
    let ended = false;
    for (let i = 0; i < 60 && !ended; i++) {
      const m = s.generateMission(p);
      ended = s.applyMissionResult(p, m, randomResult(m, rng, 'returned')).careerEnded;
    }
    expect(ended).toBe(true);
    expect(p.status).toBe('war-over');
    expect(p.date).toBe('1918-11-11');
  });

  it('transfers Lafayette pilots to the 103rd Aero', () => {
    const s = newService();
    const p = s.createPilot({ firstName: 'A', lastName: 'B', nation: 'usa', startDate: '1918-02-10', squadronId: 'n124', difficulty: 'pilot' });
    const rng = new Rng(11);
    for (let i = 0; i < 10 && p.squadronId === 'n124'; i++) {
      const m = s.generateMission(p);
      s.applyMissionResult(p, m, randomResult(m, rng, 'returned'));
    }
    expect(p.squadronId).toBe('us103');
  });

  it('survives a 40-mission 1917 career loop with random results', () => {
    const s = newService();
    const rng = new Rng(1917);
    let flown = 0;
    let pilots = 0;
    while (flown < 40) {
      const nation = rng.pick(['germany', 'britain', 'france'] as const);
      const p = s.createPilot({ firstName: 'Loop', lastName: `${pilots++}`, nation, startDate: '1917-01-20', difficulty: rng.pick(['recruit', 'pilot', 'ace'] as const) });
      while (p.status === 'active' || p.status === 'hospital') {
        const choice = rng.pick(s.availableAircraft(p));
        const m = s.generateMission(p, choice);
        validateMission(m, true);
        const report = s.applyMissionResult(p, m, randomResult(m, rng));
        flown++;
        expect(report.narrative.length).toBeGreaterThan(0);
        expect(p.log).toHaveLength(p.missionsFlown);
        if (flown >= 40) break;
      }
      const saved = s.loadPilot(p.id)!;
      expect(saved.missionsFlown).toBe(p.missionsFlown);
      expect(s.aceStandings(saved).some((r) => r.isPlayer)).toBe(true);
    }
  });
});
