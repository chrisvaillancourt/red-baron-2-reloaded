/**
 * The engine-block rule, measured (SIM_FLAGS.damagePath; docs/sim.md "Hit boxes"). Skipped
 * unless SIM_SOAK names a survey:
 *
 *   SIM_SOAK=zones pnpm exec vitest run src/sim/damagePath.soak.test.ts
 *   SIM_SOAK=kills SIM_KILLS_REPS=24 [AUTOPLAY_PILOT=human] pnpm exec vitest run src/sim/damagePath.soak.test.ts
 *
 * `zones` (geometry only, a few seconds): rounds from a sphere of approach directions, aimed with
 * a Gaussian spread about the CG, traced through each type's boxes (`traceRound`). For each
 * sector (astern, rear quarter, beam, front quarter, head-on, by the angle between the line to
 * the shooter and the tail) it gives the share of hits that damage the pilot, fuel tank, engine
 * and guns under today's zone-list cut and under path order, and how often today's `bullet-hit`
 * event names the pilot. SIM_ZONES_SIGMA (m, default 0.6) is the spread;
 * SIM_ZONES_WEIGHTS=astern:w,rear:w,beam:w,front:w,headon:w weights the mix row (default: where
 * the hits came from in `kills`, all five setups, veteran autoplayer, flag off).
 *
 * `kills`: seeded quick dogfights flown with the autoplayer, each twice, flag off and on, on the
 * same seeds. Per rule: hits a victim took before going down (mean with a 95% interval, and the
 * median), the player's hits per player kill, how the victories came (pilot killed, fire,
 * structural failure, forced down), and where the hits came from. AUTOPLAY_PILOT=human flies the
 * player with the human-like aim. SIM_KILLS_SETS=default,camel,spad,dvii,bristol,brisfit picks setups (brisfit only when named).
 */
import { describe, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { WorldQuery } from '../core/interfaces';
import type { AircraftId, DamageZone, GameEvent } from '../core/types';
import type { QuickMissionOptions } from '../core/campaignTypes';
import { buildQuickMission } from '../campaign';
import { getAircraft } from '../data/aircraft';
import { QUICK_DEFAULTS } from '../data/quickDefaults';
import { headlessModules, runAutoplay } from '../game/autoplay';
import { wilsonInterval } from '../game/testing/stats';
import { createCombatSystem } from './combat';
import { SIM_FLAGS } from './flags';
import { getHitModel, priorityZone, traceRound } from './hitboxes';
import { createRng, gaussian } from './rng';

const SOAK = (process.env.SIM_SOAK ?? '').split(',');
const out = (lines: string[]) => process.stdout.write(lines.join('\n') + '\n');
const pc = (k: number, n: number) => `${((100 * k) / Math.max(1, n)).toFixed(1)}%`;
const pci = (k: number, n: number) => {
  const [lo, hi] = wilsonInterval(k, n);
  return `${pc(k, n)} (${(100 * lo).toFixed(0)}–${(100 * hi).toFixed(0)})`;
};

const SECTORS = ['astern', 'rear', 'beam', 'front', 'headon'] as const;
type Sector = (typeof SECTORS)[number];
/** Sector of a direction toward the shooter, body frame (tail +Z): its angle from the tail. */
function sectorOf(x: number, y: number, z: number): Sector {
  const deg = (Math.acos(Math.max(-1, Math.min(1, z / Math.hypot(x, y, z)))) * 180) / Math.PI;
  return deg < 30 ? 'astern' : deg < 60 ? 'rear' : deg < 120 ? 'beam' : deg < 150 ? 'front' : 'headon';
}

// ------------------------------------------------------------------------------ zones
const ZONE_TYPES: AircraftId[] = ['sopwith_camel', 'spad_xiii', 'albatros_dv', 'fokker_dvii', 'fokker_dri', 'bristol_f2b', 'airco_dh2'];
const WATCH: DamageZone[] = ['pilot', 'gunner', 'fuelTank', 'engine', 'guns', 'tail', 'fuselage'];

interface ZoneTally {
  hits: number;
  crossed: Record<string, number>;
  today: Record<string, number>;
  path: Record<string, number>;
  eventPilot: number;
}
const tally = (): ZoneTally => ({ hits: 0, crossed: {}, today: {}, path: {}, eventPilot: 0 });
const bump = (r: Record<string, number>, k: string) => (r[k] = (r[k] ?? 0) + 1);

function zoneSurvey(id: AircraftId, sigma: number, perSector: number): Record<Sector, ZoneTally> {
  const hm = getHitModel(getAircraft(id));
  const rng = createRng(0x5eed);
  const res = Object.fromEntries(SECTORS.map((s) => [s, tally()])) as Record<Sector, ZoneTally>;
  const done: Record<Sector, number> = { astern: 0, rear: 0, beam: 0, front: 0, headon: 0 };
  const f = new Vector3();
  const u = new Vector3();
  const v = new Vector3();
  const all = () => true;
  const reach = hm.radius + 2;
  while (SECTORS.some((s) => done[s] < perSector)) {
    // A uniform direction toward the shooter; rounds travel along -f.
    f.set(gaussian(rng), gaussian(rng), gaussian(rng)).normalize();
    const s = sectorOf(f.x, f.y, f.z);
    if (done[s] >= perSector) continue;
    done[s]++;
    u.set(0, 1, 0);
    if (Math.abs(f.y) > 0.9) u.set(1, 0, 0);
    u.cross(f).normalize();
    v.copy(f).cross(u);
    const ox = gaussian(rng) * sigma;
    const oy = gaussian(rng) * sigma;
    const c = { x: u.x * ox + v.x * oy, y: u.y * ox + v.y * oy, z: u.z * ox + v.z * oy };
    const a = { x: c.x + f.x * reach, y: c.y + f.y * reach, z: c.z + f.z * reach };
    const b = { x: c.x - f.x * reach, y: c.y - f.y * reach, z: c.z - f.z * reach };
    const today = traceRound(hm, a, b, all, false);
    if (!today) continue;
    const path = traceRound(hm, a, b, all, true)!;
    const t = res[s];
    t.hits++;
    for (const z of new Set(today.crossed.map((h) => h.zone))) bump(t.crossed, z);
    for (const z of new Set(today.damaged.map((h) => h.zone))) bump(t.today, z);
    for (const z of new Set(path.damaged.map((h) => h.zone))) bump(t.path, z);
    if (priorityZone(today.crossed) === 'pilot') t.eventPilot++;
  }
  return res;
}

function parseWeights(s: string | undefined): Record<Sector, number> {
  // Default: where hits came from in SIM_SOAK=kills (all five setups, veteran autoplayer, flag off, 2026-09-28).
  const w: Record<Sector, number> = { astern: 0.22, rear: 0.41, beam: 0.18, front: 0.07, headon: 0.11 };
  for (const kv of (s ?? '').split(',').filter(Boolean)) {
    const [k, x] = kv.split(':');
    if (k in w) w[k as Sector] = Number(x);
  }
  const sum = SECTORS.reduce((a, k) => a + w[k], 0);
  for (const k of SECTORS) w[k] /= sum;
  return w;
}

describe.skipIf(!SOAK.includes('zones'))('engine block: zones by approach sector', () => {
  it('reports the zones a hit damages, today and in path order', () => {
    const sigma = Number(process.env.SIM_ZONES_SIGMA ?? 0.6);
    const per = Number(process.env.SIM_ZONES_N ?? 20000);
    const w = parseWeights(process.env.SIM_ZONES_WEIGHTS);
    const lines = [
      `zones sigma=${sigma} m, ${per} rounds a sector; share of hits (rounds that cross any box) that damage each zone, today -> path order`,
      `mix weights: ${SECTORS.map((s) => `${s} ${w[s].toFixed(2)}`).join(', ')}`,
      `type | sector | hit% | ${WATCH.join(' | ')} | event says pilot (today) | pilot box crossed`,
    ];
    for (const id of ZONE_TYPES) {
      const r = zoneSurvey(id, sigma, per);
      const row = (label: string, share: (f: (t: ZoneTally) => number) => number, hitShare: number) => {
        const cells = WATCH.map((z) => `${(100 * share((t) => t.today[z] ?? 0)).toFixed(1)} -> ${(100 * share((t) => t.path[z] ?? 0)).toFixed(1)}`);
        lines.push(`${id} | ${label} | ${(100 * hitShare).toFixed(0)} | ${cells.join(' | ')} | ${(100 * share((t) => t.eventPilot)).toFixed(1)} | ${(100 * share((t) => t.crossed.pilot ?? 0)).toFixed(1)}`);
      };
      for (const s of SECTORS) row(s, (f) => f(r[s]) / Math.max(1, r[s].hits), r[s].hits / per);
      // The mix: each sector's per-hit shares weighted by its share of hits in combat.
      row('mix', (f) => SECTORS.reduce((a, s) => a + (w[s] * f(r[s])) / Math.max(1, r[s].hits), 0), SECTORS.reduce((a, s) => a + (w[s] * r[s].hits) / per, 0));
    }
    out(lines);
  }, 600_000);
});

// ------------------------------------------------------------------------------ kills
type Setup = QuickMissionOptions & { label: string };
const q = (label: string, player: AircraftId, enemy: AircraftId, extra: Partial<QuickMissionOptions> = {}): Setup => ({
  ...QUICK_DEFAULTS,
  enemySkill: 'regular',
  label,
  playerAircraft: player,
  enemyAircraft: enemy,
  ...extra,
});
const KILL_SETS: Record<string, Setup> = {
  default: { ...QUICK_DEFAULTS, label: 'default (camel+1 v 2 vet d.vii)' },
  camel: q('camel+1 v 2 reg dr.i', 'sopwith_camel', 'fokker_dri'),
  spad: q('spad+1 v 2 reg d.vii', 'spad_xiii', 'fokker_dvii'),
  dvii: q('d.vii+1 v 2 reg camel', 'fokker_dvii', 'sopwith_camel'),
  bristol: q('bristol+1 v 2 reg d.v', 'bristol_f2b', 'albatros_dv'),
  // The playtest report behind "104 hits for one kill" (playtests/reports/2026-09-28-chris-brisfit-v-5-ace-dvii-low.json).
  brisfit: q('bristol+3 nov v 5 ace d.vii low', 'bristol_f2b', 'fokker_dvii', {
    wingmen: 3,
    wingmanSkill: 'novice',
    enemyCount: 5,
    enemySkill: 'ace',
    altitudeM: 300,
    timeOfDay: 'dusk',
    cloudCover: 0.2,
  }),
};

interface KillStats {
  victories: number;
  /** Hits each victim took before it went down (every shooter). */
  hitsToKill: number[];
  playerHits: number;
  playerKills: number;
  playerHitsOnKills: number[];
  how: Record<string, number>;
  sectors: Record<Sector, number>;
  hits: number;
  /** Sum over victims of each zone's damage when it went down (divide by victories for the mean). */
  zonesAtDeath: Record<string, number>;
  playerDown: number;
  missions: number;
}
const newStats = (): KillStats => ({
  victories: 0,
  hitsToKill: [],
  playerHits: 0,
  playerKills: 0,
  playerHitsOnKills: [],
  how: {},
  sectors: { astern: 0, rear: 0, beam: 0, front: 0, headon: 0 },
  hits: 0,
  zonesAtDeath: {},
  playerDown: 0,
  missions: 0,
});

function merge(into: KillStats, s: KillStats) {
  into.victories += s.victories;
  into.hitsToKill.push(...s.hitsToKill);
  into.playerHits += s.playerHits;
  into.playerKills += s.playerKills;
  into.playerHitsOnKills.push(...s.playerHitsOnKills);
  for (const [k, n] of Object.entries(s.how)) into.how[k] = (into.how[k] ?? 0) + n;
  for (const k of SECTORS) into.sectors[k] += s.sectors[k];
  into.hits += s.hits;
  for (const [k, x] of Object.entries(s.zonesAtDeath)) into.zonesAtDeath[k] = (into.zonesAtDeath[k] ?? 0) + x;
  into.playerDown += s.playerDown;
  into.missions += s.missions;
}

/** One quick mission, tapping the combat events (hits by victim and shooter, how each went down). */
function flyTapped(setup: Setup, seed: number, st: KillStats) {
  let world: WorldQuery | null = null;
  const hitsOn = new Map<number, number>();
  const playerHitsOn = new Map<number, number>();
  const burned = new Set<number>();
  const broke = new Map<number, string>();
  const down = new Set<number>();
  let playerId = -1;
  const q = new Quaternion();
  const d = new Vector3();
  const modules = {
    ...headlessModules,
    createCombatSystem: (bus: Parameters<typeof createCombatSystem>[0], getRealism: Parameters<typeof createCombatSystem>[1]) => {
      const sys = createCombatSystem(bus, getRealism);
      const update = sys.update.bind(sys);
      sys.update = (w, dt) => {
        world = w;
        update(w, dt);
      };
      bus.onAny((e: GameEvent) => {
        if (!world) return;
        if (playerId < 0) playerId = world.aircraft.find((a) => a.controller === 'player')?.id ?? -1;
        if (e.type === 'bullet-hit') {
          const t = world.getEntity(e.targetId);
          if (!t || t.kind !== 'aircraft' || down.has(t.id)) return;
          hitsOn.set(t.id, (hitsOn.get(t.id) ?? 0) + 1);
          st.hits++;
          if (e.shooterId === playerId) {
            st.playerHits++;
            playerHitsOn.set(t.id, (playerHitsOn.get(t.id) ?? 0) + 1);
          }
          const s = e.shooterId !== null ? world.getEntity(e.shooterId) : undefined;
          if (s && s.kind === 'aircraft') {
            q.copy(t.state.orientation).invert();
            d.copy(s.state.position).sub(t.state.position).applyQuaternion(q);
            st.sectors[sectorOf(d.x, d.y, d.z)]++;
          }
        } else if (e.type === 'fire-started') burned.add(e.aircraftId);
        else if (e.type === 'structural-failure') {
          // A fuselage shot through (zones.fuselage at 1) fails as the tail: tell the two apart.
          const a = world.getEntity(e.aircraftId);
          const fus = a?.kind === 'aircraft' && a.damage.zones.fuselage >= 1;
          broke.set(e.aircraftId, fus ? 'fuselage' : e.part);
        }
        else if (e.type === 'aircraft-destroyed') {
          down.add(e.victimId);
          if (e.victimId === playerId) st.playerDown++;
          if (e.killerId === null || e.outcome === 'collided') return;
          st.victories++;
          st.hitsToKill.push(hitsOn.get(e.victimId) ?? 0);
          const victim = world.getEntity(e.victimId);
          if (victim?.kind === 'aircraft') for (const [k, x] of Object.entries(victim.damage.zones)) st.zonesAtDeath[k] = (st.zonesAtDeath[k] ?? 0) + x;
          const how =
            e.outcome === 'pilot-killed'
              ? 'pilot killed'
              : broke.has(e.victimId)
                ? `structural ${broke.get(e.victimId)}`
                : burned.has(e.victimId)
                  ? 'fire'
                  : e.outcome === 'shot-down'
                    ? 'shot down (other)'
                    : 'forced down';
          st.how[how] = (st.how[how] ?? 0) + 1;
          if (e.killerId === playerId) {
            st.playerKills++;
            st.playerHitsOnKills.push(playerHitsOn.get(e.victimId) ?? 0);
          }
        }
      });
      return sys;
    },
  };
  runAutoplay(buildQuickMission(setup, seed), { maxTime: 1500, modules });
  st.missions++;
}

function meanCI(xs: number[]): string {
  if (xs.length === 0) return '-';
  const m = xs.reduce((a, x) => a + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
  const h = (1.96 * sd) / Math.sqrt(xs.length);
  const sorted = [...xs].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  return `${m.toFixed(1)} (${(m - h).toFixed(1)}–${(m + h).toFixed(1)}) med ${med}`;
}
const meanInterval = (xs: number[]): [number, number] => {
  const m = xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
  const h = (1.96 * sd) / Math.sqrt(Math.max(1, xs.length));
  return [m - h, m + h];
};
const overlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];

describe.skipIf(!SOAK.includes('kills'))('engine block: hits to kill', () => {
  it('flies quick dogfights with the rule off and on', () => {
    const reps = Number(process.env.SIM_KILLS_REPS ?? 24);
    const sets = (process.env.SIM_KILLS_SETS ?? 'default,camel,spad,dvii,bristol').split(',').filter((s) => s in KILL_SETS);
    const saved = SIM_FLAGS.damagePath;
    const lines = [`kills reps=${reps} pilot=${process.env.AUTOPLAY_PILOT ?? 'ai'}; each setup flown with SIM_FLAGS.damagePath off, then on, same seeds`];
    const total = { off: newStats(), on: newStats() };
    const report = (label: string, rule: string, s: KillStats) => {
      const how = Object.entries(s.how)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${pc(n, s.victories)}`)
        .join(', ');
      const sec = SECTORS.map((k) => `${k} ${pc(s.sectors[k], s.hits)}`).join(' ');
      const zones = (['fuselage', 'tail', 'leftWing', 'rightWing', 'pilot', 'engine', 'fuelTank'] as const)
        .map((k) => `${k} ${((s.zonesAtDeath[k] ?? 0) / Math.max(1, s.victories)).toFixed(2)}`)
        .join(' ');
      lines.push(
        `${label} | ${rule} | missions ${s.missions} | victories ${s.victories} | hits to kill ${meanCI(s.hitsToKill)} | player hits/kill ${(s.playerHits / Math.max(1, s.playerKills)).toFixed(1)} (${s.playerHits}/${s.playerKills}) | player down ${pci(s.playerDown, s.missions)} | pilot-kill share ${pci(s.how['pilot killed'] ?? 0, s.victories)} | ${how} | hits from: ${sec} | victim zones at death: ${zones}`,
      );
    };
    try {
      for (const key of sets) {
        const setup = KILL_SETS[key];
        const per = { off: newStats(), on: newStats() };
        for (const rule of ['off', 'on'] as const) {
          SIM_FLAGS.damagePath = rule === 'on';
          for (let r = 0; r < reps; r++) flyTapped(setup, 5000 + r * 131, per[rule]);
          merge(total[rule], per[rule]);
        }
        report(setup.label, 'off', per.off);
        report(setup.label, 'on', per.on);
      }
    } finally {
      SIM_FLAGS.damagePath = saved;
    }
    report('ALL', 'off', total.off);
    report('ALL', 'on', total.on);
    const htk = overlaps(meanInterval(total.off.hitsToKill), meanInterval(total.on.hitsToKill)) ? 'within noise' : 'differs';
    const pk = (s: KillStats) => wilsonInterval(s.how['pilot killed'] ?? 0, s.victories);
    const pkv = overlaps(pk(total.off), pk(total.on)) ? 'within noise' : 'differs';
    lines.push(`verdict: hits to kill ${htk}; pilot-kill share ${pkv}`);
    out(lines);
  }, 7_200_000);
});
