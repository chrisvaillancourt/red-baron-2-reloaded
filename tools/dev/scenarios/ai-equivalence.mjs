// Exact AI/sim trace for refactor equivalence (docs/ai.md "Refactor equivalence").
// Each case returns a time-ordered trace, so the probe's first differing path names
// the case, sample (tick), aircraft and field where the two checkouts diverged.
// No golden constants: equality is always baseline-vs-candidate on the same Node.
export default async function aiEquivalence({ load, input }) {
  const { SimWorld, STANDARD_REALISM, runSim } = await load('src/ai/testing/realSimHarness.ts');
  const { combatRun, lowLevelRun, routeFlight } = await load('src/ai/testing/realScenarios.ts');
  const sim = await load('src/sim/index.ts');
  const { buildQuickMission } = await load('src/campaign/quickMission.ts');
  const { SimCore } = await load('src/game/simCore.ts');
  const { headlessModules } = await load('src/game/autoplay.ts');

  const SAMPLE_EVERY = 12; // physics steps (120 Hz) between samples: 10 Hz
  const cases = [
    ...[1, 2, 3].map((seed) => ({ id: `furball/4v4/${seed}`, kind: 'furball', seed, seconds: 60, suites: ['default'] })),
    // Long enough for a kill (aircraft-destroyed and its aftermath enter the trace).
    { id: 'furball/4v4-veteran/1', kind: 'furball', seed: 1, seconds: 85, skills: ['veteran', 'regular'], suites: ['default'] },
    { id: 'raid/escorted/1', kind: 'raid', seed: 1, seconds: 40, suites: ['default'] },
    { id: 'low-level/bounce/1', kind: 'low-level', seed: 1, seconds: 30, suites: ['default'] },
    { id: 'quick/dogfight/7000', kind: 'quick', seed: 7000, seconds: 30, suites: ['default'] },
    // Longer variants for a heavier refactor check; not part of the CI default.
    ...[4, 5, 6].map((seed) => ({ id: `furball/4v4/${seed}/long`, kind: 'furball', seed, seconds: 150, suites: ['long'] })),
    { id: 'quick/bombing/7001/long', kind: 'quick-bombing', seed: 7001, seconds: 120, suites: ['long'] },
  ];

  // Selection is required, like bomber-pacing: an accidental invocation must not run a suite.
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must explicitly select suite or cases');
  if (Object.keys(input).some((k) => !['suite', 'cases'].includes(k))) throw new Error('Only suite and cases selections are supported');
  if (input.suite !== undefined && input.cases !== undefined) throw new Error('Select suite OR cases, not both');
  let selected;
  if (input.suite !== undefined) {
    const suites = Array.isArray(input.suite) ? input.suite : [input.suite];
    if (!suites.length || suites.some((s) => !['all', 'default', 'long'].includes(s)) || new Set(suites).size !== suites.length) throw new Error('Invalid or empty suite selection');
    selected = cases.filter((c) => suites.includes('all') || c.suites.some((s) => suites.includes(s)));
  } else if (Array.isArray(input.cases) && input.cases.length) {
    if (new Set(input.cases).size !== input.cases.length || input.cases.some((id) => !cases.some((c) => c.id === id))) throw new Error('Unknown or duplicate case selection');
    selected = cases.filter((c) => input.cases.includes(c.id));
  } else throw new Error('Input must explicitly select a nonempty suite or cases');
  if (!selected.length) throw new Error('Selection contains no cases');

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

  function aircraftSample(ac, ctl) {
    return {
      id: ac.id,
      position: plain(ac.state.position),
      quaternion: plain(ac.state.orientation),
      velocity: plain(ac.state.velocity),
      angularVelocity: plain(ac.state.angularVelocity),
      controls: plain(ac.controls),
      phase: ctl?.phase ?? null,
      targetId: ctl?.targetId ?? null,
      ai: ctl?.debugState ?? null,
      outcome: ac.outcome,
    };
  }

  // One tracer per case: called after every physics step with the events emitted in it.
  function tracer(controllers) {
    const samples = [];
    const tally = { steps: 0, aircraft: 0, events: {} };
    let pending = [];
    return {
      samples,
      tally,
      events(list) {
        for (const e of list) {
          tally.events[e.type] = (tally.events[e.type] ?? 0) + 1;
          pending.push(plain(e, e.type));
        }
      },
      step(world) {
        tally.steps++;
        tally.aircraft = Math.max(tally.aircraft, world.aircraft.length);
        if (tally.steps % SAMPLE_EVERY !== 0) return;
        samples.push({
          aircraft: world.aircraft.map((ac) => aircraftSample(ac, controllers().get(ac.id))),
          events: pending,
          step: tally.steps,
          t: world.time,
        });
        pending = [];
      },
      finish(world) {
        // Events after the last sample still count: keep them in a final sample.
        if (pending.length) samples.push({ aircraft: world.aircraft.map((ac) => aircraftSample(ac, controllers().get(ac.id))), events: pending, step: tally.steps, t: world.time });
        pending = [];
      },
    };
  }

  // SimWorld cases: the harness keeps every event in world.events.
  function harnessTap(tr) {
    let seen = 0;
    return (world) => {
      tr.events(world.events.slice(seen));
      seen = world.events.length;
      tr.step(world);
    };
  }

  const EAST = Math.PI / 2;
  const far = [{ x: 1000000, z: 0, altitude: 2500, action: 'fly' }];
  const observations = [];
  for (const c of selected) {
    let world = null;
    const tr = tracer(() => world.controllers);
    if (c.kind === 'furball') {
      const tap = harnessTap(tr);
      const run = combatRun({ a: 'se5a', sa: c.skills?.[0] ?? 'regular', b: 'albatros_dv', sb: c.skills?.[1] ?? 'regular', n: 4, seed: c.seed, seconds: c.seconds, tap: (w) => { world = w; tap(w); } });
      world = run.world;
    } else if (c.kind === 'low-level') {
      const tap = harnessTap(tr);
      let last = null;
      lowLevelRun({ a: 'se5a', sa: 'regular', b: 'fokker_dvii', sb: 'veteran', n: [2, 2], seed: c.seed, seconds: c.seconds, kind: 'bounce', tap: (w) => { world = last = w; tap(w); } });
      world = last;
    } else if (c.kind === 'raid') {
      world = new SimWorld({ seed: c.seed, frontX: -100000, realism: STANDARD_REALISM });
      world.addFlight(routeFlight('b', 'allied', 'dh4', far, { task: 'bomb' }));
      world.addFlight(routeFlight('x', 'allied', 'sopwith_camel', far, { task: 'escort', escortFlightId: 'b' }));
      world.addFlight(routeFlight('e', 'central', 'albatros_dv', [], { task: 'defend' }));
      const lead = world.addAircraft({ aircraftId: 'dh4', side: 'allied', x: 0, z: 0, alt: 2500, heading: EAST, flightId: 'b' });
      const wing = world.addAircraft({ aircraftId: 'dh4', side: 'allied', x: -36, z: 45, alt: 2506, heading: EAST, flightId: 'b' });
      world.addAI(lead, 'regular', { role: 'friendly', task: 'bomb', seed: c.seed * 100 + lead.id });
      world.addAI(wing, 'regular', { role: 'friendly', task: 'bomb', leaderId: lead.id, formationSlot: 1, seed: c.seed * 100 + wing.id });
      const camel = world.addAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: -250, z: 0, alt: 2800, heading: EAST, flightId: 'x' });
      world.addAI(camel, 'regular', { role: 'friendly', task: 'escort', seed: c.seed * 100 + camel.id });
      for (let i = 0; i < 2; i++) {
        const dv = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 2200 + i * 80, z: 300 - i * 120, alt: 2700 + i * 40, heading: -EAST, flightId: 'e', skill: 'veteran' });
        world.addAI(dv, 'veteran', { role: 'enemy', task: 'defend', seed: c.seed * 100 + dv.id });
      }
      const tap = harnessTap(tr);
      runSim(world, c.seconds, { onStep: () => void tap(world) });
    } else {
      // The integrated game path: production mission build, SimCore stepping, event bus.
      const mission = c.kind === 'quick'
        ? buildQuickMission({ type: 'dogfight', playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', wingmen: 2, enemyCount: 3, wingmanSkill: 'regular', enemySkill: 'regular', altitudeM: 2000, startPosition: 'head-on', timeOfDay: 'midday', cloudCover: 0 }, c.seed)
        : buildQuickMission({ type: 'bombing', playerAircraft: 'dh4', enemyAircraft: 'fokker_dvii', wingmen: 2, enemyCount: 2, wingmanSkill: 'regular', enemySkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'midday', cloudCover: 0, escortCount: 2 }, c.seed);
      const core = new SimCore(headlessModules, mission, () => STANDARD_REALISM, { aiPlayer: true });
      const coreTracer = tracer(() => core.ai);
      const unsubscribe = core.bus.onAny((e) => coreTracer.events([e]));
      try {
        const steps = Math.round(c.seconds / sim.SIM_DT);
        for (let i = 0; i < steps && !core.director.ended; i++) {
          core.step(sim.SIM_DT);
          coreTracer.step(core.world);
        }
        coreTracer.finish(core.world);
      } finally {
        unsubscribe();
        core.dispose();
      }
      observations.push({ id: c.id, kind: c.kind, samples: coreTracer.samples, seed: c.seed, tally: coreTracer.tally });
      continue;
    }
    tr.finish(world);
    observations.push({ id: c.id, kind: c.kind, samples: tr.samples, seed: c.seed, tally: tr.tally });
  }
  return {
    schema: 'ai-equivalence/1',
    sampleEverySteps: SAMPLE_EVERY,
    selectedCaseIds: selected.map((c) => c.id),
    availableCaseIds: cases.map((c) => c.id),
    // Array order is the comparison order: the first differing case, then sample, wins.
    cases: observations,
  };
}
