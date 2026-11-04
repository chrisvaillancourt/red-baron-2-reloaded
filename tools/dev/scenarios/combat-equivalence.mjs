// Exact combat trace for refactor equivalence in src/sim/combat.ts (docs/ai.md
// "Refactor equivalence"). Bullets vs aircraft (gunner stations included), ground
// targets, flak and ground fire, with aircraft forced `impacted` partway through so the
// skip path runs. Each case returns a 10 Hz time-ordered trace, so the probe's first
// differing path names the case, sample, aircraft and field. No golden constants.
//   pnpm exec node tools/dev/differential-probe.mjs --baseline <dir> --candidate . \
//     --scenario tools/dev/scenarios/combat-equivalence.mjs --input '{"seeds":[3,7,11]}'
// Coverage (F-115), per case: aircraft hits, impacted aircraft, and flak bursts, ground
// impacts and damaged ground targets (strafe) or gunner hits and kills (columns). Ground
// fire emits no event, so it has no count.
import { countEvents, requireCoverage } from './coverage.mjs';

// Seeds 3, 7 and 11 (2026-11-04). strafe-flak: 87-103 hits, 18-21 flak bursts, 124-179
// ground impacts, 1-4 ground targets damaged, 4-5 impacted, and no gunner hits, so the
// gunner path rests on columns-16: 793-836 hits, 3-8 gunner hits, 7-8 kills, 4 impacted.
// Floors guard against zero and near-zero; they are not pinned figures.
const MINIMUMS = {
  'strafe-flak': { 'bullet-hit': 20, 'flak-burst': 5, 'bullet-impact-ground': 25, 'ground-damaged': 1, impacted: 2 },
  'columns-16': { 'bullet-hit': 150, 'gunner-hit': 1, 'aircraft-destroyed': 2, impacted: 2 },
};

export default async function combatEquivalence({ load, input }) {
  const { scenario, aimAt } = await load('src/sim/testing/scenario.ts');
  const { orientationFrom, getSimInternal, SIM_DT } = await load('src/sim/flightModel.ts');

  if (input !== null && (typeof input !== 'object' || Array.isArray(input))) throw new Error('Input must be an object or null');
  if (input && Object.keys(input).some((k) => !['seed', 'seeds'].includes(k))) throw new Error('Only seed or seeds is supported');
  const seeds = input?.seeds ?? (input?.seed !== undefined ? [input.seed] : [3, 7, 11]);
  if (!Array.isArray(seeds) || !seeds.length || seeds.some((s) => !Number.isSafeInteger(s))) throw new Error('seeds must be a nonempty integer list');

  const SAMPLE_EVERY = Math.round(0.1 / SIM_DT); // 10 Hz

  // Lossless plain copy: three math objects become arrays, Sets/Maps become arrays.
  function plain(value, path = 'value') {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
    if (value === undefined) return null;
    if (typeof value !== 'object') throw new Error(`${path}: cannot record ${typeof value}`);
    if (value.isVector3) return [value.x, value.y, value.z];
    if (value.isQuaternion) return [value.x, value.y, value.z, value.w];
    if (value instanceof Set) return [...value].map((v, i) => plain(v, `${path}[${i}]`));
    if (value instanceof Map) return [...value].map(([k, v], i) => [plain(k, `${path}[${i}]`), plain(v, `${path}[${i}]`)]);
    if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value, (v, i) => plain(v, `${path}[${i}]`));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v, `${path}.${k}`)]));
  }

  function trace(s, seconds, each, fly) {
    const samples = [];
    let seen = 0;
    let steps = 0;
    const sample = () => {
      samples.push({
        step: steps,
        events: s.events.slice(seen).map((e) => plain(e, e.type)),
        aircraft: s.aircraft.map((ac) => ({
          id: ac.id,
          position: plain(ac.state.position),
          quaternion: plain(ac.state.orientation),
          velocity: plain(ac.state.velocity),
          damage: plain(ac.damage),
          impacted: !!getSimInternal(ac).impacted,
        })),
        ground: s.groundTargets.map((g) => [g.id, g.health, g.destroyed]),
        bullets: s.combat.bullets.length,
      });
      seen = s.events.length;
    };
    s.step(seconds, () => {
      if (steps > 0 && steps % SAMPLE_EVERY === 0) sample();
      steps++;
      each?.(steps);
    }, fly);
    sample();
    return samples;
  }

  // Counted from the trace, so the tally sees exactly what the comparison sees.
  function coverage(s, samples) {
    const flexible = new Map(s.aircraft.map((ac) => [ac.id, ac.spec.guns.map((g) => g.mount === 'flexible')]));
    const events = samples.flatMap((sm) => sm.events);
    const last = samples[samples.length - 1];
    return {
      ...countEvents(events),
      'gunner-hit': events.filter((e) => e.type === 'bullet-hit' && flexible.get(e.shooterId)?.[e.mountIndex]).length,
      'ground-damaged': last.ground.filter(([, health]) => health < 1).length,
      impacted: last.aircraft.filter((ac) => ac.impacted).length,
    };
  }

  const cases = [];
  const scopes = {};
  for (const seed of seeds) {
    // Strafers over flak/ground fire plus a two-seater high furball, full physics.
    {
      const s = scenario({ seed, flak: true, groundFire: true, sideOfFront: (x) => (x > 200 ? 'central' : 'allied') });
      for (let i = 0; i < 12; i++) {
        const strafer = i >= 6;
        const ac = strafer
          ? s.add(i + 1, 'sopwith_camel', (i - 6) * 30, 0, 150, 0)
          : s.add(i + 1, i % 2 ? 'sopwith_camel' : 'bristol_f2b', 3000, -i * 70, 1000, 0);
        if (strafer) orientationFrom(0, -0.35, 0, ac.state.orientation);
        ac.controller = 'ai';
      }
      for (let g = 0; g < 40; g++) s.addGround(1000 + g, g % 3 ? 'truck' : 'aa-gun', (g % 8) * 30, -200 - Math.floor(g / 8) * 40);
      const samples = trace(s, 20, (t) => {
        for (const ac of s.aircraft) {
          ac.controls.fireGuns = true;
          if (t > 300 && (ac.id === 2 || ac.id === 9 || ac.id === 4)) getSimInternal(ac).impacted = true;
        }
      }, true);
      cases.push({ id: `strafe-flak/${seed}`, samples });
      scopes[`strafe-flak/${seed}`] = { counts: coverage(s, samples), minimums: MINIMUMS['strafe-flak'] };
    }
    // 16 aircraft in four columns of four, kinematic. Each rank aims at the one ahead, so
    // rounds that miss (or pass an impacted aircraft) carry on to the ranks in front.
    {
      const s = scenario({ seed });
      const types = ['bristol_f2b', 'sopwith_camel', 'albatros_dv', 'se5a'];
      const grid = [];
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          const ac = s.add(c * 4 + r + 1, types[(c + r) % 4], c * 120, r * 140 + c * 15, 1500 + r * 6, 0);
          ac.controller = 'ai';
          grid.push({ ac, ahead: r ? c * 4 + r : null });
        }
      }
      const samples = trace(s, 8, (t) => {
        for (const { ac, ahead } of grid) {
          ac.controls.fireGuns = ahead !== null;
          if (ahead !== null) aimAt(ac, s.aircraft[ahead - 1]);
          if (t === 360 && ac.id % 4 === 2) getSimInternal(ac).impacted = true;
        }
      }, 'kinematic');
      cases.push({ id: `columns-16/${seed}`, samples });
      scopes[`columns-16/${seed}`] = { counts: coverage(s, samples), minimums: MINIMUMS['columns-16'] };
    }
  }
  const hits = cases.map((c) => [c.id, c.samples.reduce((n, sm) => n + sm.events.filter((e) => e.type === 'bullet-hit').length, 0)]);
  return { seeds, hits, cases, tally: requireCoverage('combat-equivalence', scopes) };
}
