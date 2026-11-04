// Generated-mission equivalence: career and quick missions for a fixed grid of inputs.
// Run it against a baseline checkout before and after a campaign refactor; 'equal' means
// the generated missions match for these inputs (an rng draw added or reordered after the
// last one that shapes output changes nothing and correctly stays equal).
//
// Input: { suite?: 'career' | 'quick' | 'all' (default 'all'), seed?: number (default 12345) }.
// Coverage (F-115), per generated suite: missions built without error, distinct mission
// types, missions with ground targets (and balloons, career) and with two or more flights.
import { requireCoverage } from './coverage.mjs';

// Seed 12345 builds 1670 career missions (8 types, 473 with ground targets, 183 with
// balloons, 1586 with 2+ flights) and 108 quick (6 types, 72 with ground targets, all
// with 2+ flights) without error (2026-11-04). Floors sit near half or below.
const MINIMUMS = {
  career: { missions: 800, types: 6, 'with-ground-targets': 150, 'with-balloons': 50, 'with-two-flights': 800 },
  quick: { missions: 54, types: 4, 'with-ground-targets': 24, 'with-two-flights': 54 },
};

function missionCounts(missions) {
  const built = missions.filter((m) => !m.error);
  return {
    missions: built.length,
    types: new Set(built.map((m) => m.type)).size,
    'with-ground-targets': built.filter((m) => m.groundTargets?.length > 0).length,
    'with-balloons': built.filter((m) => m.balloons?.length > 0).length,
    'with-two-flights': built.filter((m) => m.flights?.length >= 2).length,
  };
}

const CAREER_CASES = [
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
const SIDE = { germany: 'central', britain: 'allied', france: 'allied', usa: 'allied' };
const DIFFICULTIES = ['recruit', 'pilot', 'ace'];
const QUICK_TYPES = ['dogfight', 'balloon-attack', 'escort', 'intercept', 'ground-attack', 'bombing'];
const STARTS = ['head-on', 'advantage', 'disadvantage', 'random'];
const QUICK_SEEDS = [1, 77, 5000];

// A literal pilot: CareerService.createPilot reads Math.random and Date.now.
function pilot(nation, date, squadronId, difficulty, missionsFlown, rngSeed, extra = {}) {
  return {
    id: 'probe', firstName: 'Probe', lastName: nation, nation, side: SIDE[nation], difficulty, squadronId,
    rankId: 'r', date, status: 'active', hospitalDays: 0, missionsFlown, victories: [], unconfirmedClaims: 0,
    medals: [], log: [], fame: 0, rngSeed, createdAt: '', updatedAt: '', ...extra,
  };
}

// A newly thrown case shows up as a difference rather than failing the run.
function attempt(fn) {
  try { return fn(); } catch (e) { return { error: String(e?.message ?? e) }; }
}

// The probe rejects undefined as lossy JSON; missions carry undefined fields
// (e.g. members[].livery.marking), so encode them explicitly.
function encode(v) {
  if (v === undefined) return { $undefined: true };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

export default async function ({ load, input }) {
  const suite = input?.suite ?? 'all';
  const seed = input?.seed ?? 12345;
  if (!['career', 'quick', 'all'].includes(suite)) throw new Error(`unknown suite ${suite}`);
  const out = {};

  if (suite !== 'quick') {
    const { generateCareerMission } = await load('src/campaign/missionGen.ts');
    const career = [];
    for (const [nation, date, squadronId] of CAREER_CASES) {
      for (const difficulty of DIFFICULTIES) {
        for (const startOnGround of [false, true]) {
          for (let i = 0; i < 25; i++) {
            const p = pilot(nation, date, squadronId, difficulty, i, seed + i);
            career.push(attempt(() => generateCareerMission(p, undefined, { startOnGround })));
          }
        }
      }
    }
    // Altered aces and an aircraft preference take other branches of roster and type choice.
    for (let i = 0; i < 10; i++) {
      const altered = pilot('britain', '1917-04-20', 'rfc60', 'pilot', i, seed + 100 + i, {
        alteredAces: { mvr: { fate: 'killed', date: '1917-04-09' }, wolff: { fate: 'captured', date: '1917-04-10' } },
      });
      career.push(attempt(() => generateCareerMission(altered, undefined, {})));
      const preferred = pilot('germany', '1918-05-10', 'jasta2', 'pilot', i, seed + 200 + i, { preferredAircraft: 'fokker_dvii' });
      career.push(attempt(() => generateCareerMission(preferred, undefined, {})));
    }
    out.career = career;
  }

  if (suite !== 'career') {
    const { buildQuickMission } = await load('src/campaign/quickMission.ts');
    const quick = [];
    for (const type of QUICK_TYPES) {
      const bombing = type === 'bombing';
      // Bombing also varies escorts and cloud so the D-082 clear-run search and escort paths run.
      const variants = bombing
        ? [[0, 0], [0, 0.5], [2, 0], [2, 0.5]]
        : [[undefined, 0.4]];
      for (const [escortCount, cloudCover] of variants) {
        for (const startPosition of STARTS) {
          for (const s of QUICK_SEEDS) {
            const o = {
              playerAircraft: bombing ? 'dh4' : 'spad_xiii', enemyAircraft: 'fokker_dvii', enemyCount: 3, wingmen: 1,
              enemySkill: 'veteran', wingmanSkill: 'veteran', altitudeM: 2500, startPosition, timeOfDay: 'midday',
              cloudCover, type, date: '1918-06-01',
              ...(escortCount === undefined ? {} : { escortCount }),
            };
            quick.push(attempt(() => buildQuickMission(o, seed + s)));
          }
        }
      }
    }
    out.quick = quick;
  }

  const scopes = {};
  for (const name of ['career', 'quick']) if (out[name]) scopes[name] = { counts: missionCounts(out[name]), minimums: MINIMUMS[name] };
  return { ...encode(out), tally: requireCoverage('mission-equivalence', scopes) };
}
