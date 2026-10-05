// Measurement only: no policy overrides, calibration assertions or new runner.
export default async function bomberPacing({ load, input }) {
  const { AIRCRAFT_LIST } = await load('src/data/aircraft.ts');
  const { SimWorld, STANDARD_REALISM } = await load('src/ai/testing/realSimHarness.ts');
  const { routeFlight } = await load('src/ai/testing/realScenarios.ts');
  const { formationOffset, slotPosition } = await load('src/ai/navigation.ts');
  const sim = await load('src/sim/index.ts');
  const { buildQuickMission } = await load('src/campaign/quickMission.ts');
  const { SimCore } = await load('src/game/simCore.ts');
  const { headlessModules } = await load('src/game/autoplay.ts');
  const { isLost } = await load('src/game/missionDirector.ts');
  const bombers = AIRCRAFT_LIST.filter((s) => s.bombs?.some((b) => b.count > 0));
  const dt = sim.SIM_DT;
  const cases = [];
  for (const spec of bombers) {
    for (const loaded of [true, false]) for (const count of [1, 3]) for (const seed of [1, 2, 3]) {
      cases.push({ id: `transit/${spec.id}/${loaded ? 'loaded' : 'no-bombs'}/${count}/${seed}`, suite: 'transit', spec, loaded, count, seed, altitude: 2500, duration: 240, warmup: 60 });
    }
    for (const reference of ['card-altitude', 'same-altitude']) cases.push({ id: `reference/${spec.id}/${reference}`, suite: 'reference', spec, loaded: true, count: 1, seed: 1, altitude: reference === 'card-altitude' ? Math.max(300, spec.performance.maxSpeedAltM) : 2500, duration: 150, warmup: 135 });
    for (const count of [1, 3]) cases.push({ id: `quick/${spec.id}/${count}`, suite: 'quick', spec, loaded: true, count, seed: 7000, duration: 1500, warmup: 0 });
  }
  const dh4 = bombers.find((s) => s.id === 'dh4');
  if (!dh4) throw new Error('Shipped D.H.4 is required for the labeled interceptor comparison');
  for (const geometry of ['ahead', 'astern']) cases.push({ id: `interceptor/dh4/loaded/${geometry}`, suite: 'interceptor', spec: dh4, loaded: true, count: 3, seed: 1, altitude: 2500, duration: 240, warmup: 60, geometry });
  // Selection is deliberately required: an accidental invocation must not start a large run.
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must explicitly select suite or cases');
  if (Object.keys(input).some((k) => !['suite', 'cases'].includes(k))) throw new Error('Only suite and cases selections are supported');
  if (input.suite !== undefined && input.cases !== undefined) throw new Error('Select suite OR cases, not both');
  let selected;
  if (input.suite !== undefined) {
    const suites = Array.isArray(input.suite) ? input.suite : [input.suite];
    if (!suites.length || suites.some((s) => !['all', 'transit', 'reference', 'quick', 'interceptor'].includes(s)) || new Set(suites).size !== suites.length) throw new Error('Invalid or empty suite selection');
    selected = cases.filter((c) => suites.includes('all') || suites.includes(c.suite));
  } else if (Array.isArray(input.cases) && input.cases.length) {
    if (new Set(input.cases).size !== input.cases.length || input.cases.some((id) => !cases.some((c) => c.id === id))) throw new Error('Unknown or duplicate case selection');
    selected = cases.filter((c) => input.cases.includes(c.id));
  } else throw new Error('Input must explicitly select a nonempty suite or cases');
  if (!selected.length) throw new Error('Selection contains no cases');

  const xyz = (v) => [v.x, v.y, v.z];
  const live = (ac) => ac.outcome === null && !ac.damage.destroyed && !ac.damage.pilotKilled;
  const bombs = (ac) => (ac.bombs ?? []).reduce((a, b) => a + b, 0);
  const snapshot = (ac) => ({ id: ac.id, aircraft: ac.spec.id, flightId: ac.flightId, side: ac.side, skill: ac.skill, positionM: xyz(ac.state.position), velocityMps: xyz(ac.state.velocity), airspeedMps: ac.state.airspeed, altitudeM: ac.state.position.y, bombCount: bombs(ac), effectiveMassKg: sim.effectiveMass(ac), outcome: ac.outcome });
  function accumulator() {
    return { count: 0, seconds: 0, sum: 0, min: null, max: null };
  }
  function add(a, value, seconds) {
    if (!Number.isFinite(value)) throw new Error('Nonfinite measurement');
    a.count++; a.seconds += seconds; a.sum += value * seconds;
    a.min = a.min === null ? value : Math.min(a.min, value);
    a.max = a.max === null ? value : Math.max(a.max, value);
  }
  function summarize(a) {
    return { count: a.count, seconds: a.seconds, mean: a.seconds ? a.sum / a.seconds : null, min: a.min, max: a.max };
  }
  function meter() {
    return { speedMps: accumulator(), horizontalSpeedMps: accumulator(), altitudeErrorM: accumulator(), throttle: accumulator(), slot3dM: accumulator(), alongM: accumulator(), crossM: accumulator(), verticalM: accumulator(), stalledSeconds: 0, recoverySeconds: 0, throttleSaturatedSeconds: 0, phaseSeconds: {} };
  }
  function finish(m) {
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v && typeof v === 'object' && 'sum' in v ? summarize(v) : v]));
  }
  const observations = [];
  const returningPhases = ['rtb', 'landing', 'landed'];
  const rangeThresholds = [3000, 1800, 700, 250];
  for (const c of selected) {
    const side = c.spec.nation === 'germany' ? 'central' : 'allied';
    const enemySide = side === 'allied' ? 'central' : 'allied';
    const opponent = side === 'allied' ? 'fokker_dvii' : 'se5a';
    let world, controllers, core = null, actors, mission = null;
    if (c.suite === 'quick') {
      mission = buildQuickMission({ type: 'bombing', playerAircraft: c.spec.id, enemyAircraft: opponent, wingmen: c.count - 1, enemyCount: 2, wingmanSkill: 'regular', enemySkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'midday', cloudCover: 0, escortCount: 0 }, c.seed);
      core = new SimCore(headlessModules, mission, () => STANDARD_REALISM, { aiPlayer: true });
      world = core.world; controllers = core.ai;
      actors = world.aircraft.filter((a) => a.flightId === world.player.flightId);
    } else {
      const flight = routeFlight('measurement-bombers', side, c.spec.id, [{ x: 1000000, z: 0, altitude: c.altitude, action: 'fly' }], { task: 'bomb', nation: c.spec.nation });
      world = new SimWorld({ flights: [flight], seed: c.seed, date: '1918-09-01', realism: c.suite === 'reference' ? { ...STANDARD_REALISM, engineTorque: false, autoRudder: true } : STANDARD_REALISM });
      controllers = world.controllers;
      actors = [];
      for (let slot = 0; slot < c.count; slot++) {
        const offset = formationOffset(slot);
        const start = { x: -offset.z, z: offset.x, altitude: c.altitude + offset.y, heading: Math.PI / 2, airspeed: c.spec.performance.maxSpeedKmh / 3.6 * (c.suite === 'reference' ? 0.95 : 0.8) };
        const ac = world.addAircraft({ id: slot + 1, aircraftId: c.spec.id, side, nation: c.spec.nation, flightId: flight.id, x: start.x, z: start.z, alt: start.altitude, heading: start.heading, speed: start.airspeed, controller: c.suite === 'reference' ? 'none' : 'ai', skill: 'regular' });
        if (c.loaded) sim.loadBombs(ac);
        ac.state = sim.createFlightState(ac.spec, start, world.env, false, sim.effectiveMass(ac));
        actors.push(ac);
        if (c.suite !== 'reference') world.addAI(ac, 'regular', { task: 'bomb', seed: c.seed * 1000 + ac.id, ...(slot ? { leaderId: actors[0].id, formationSlot: slot } : {}) });
      }
      if (c.suite === 'interceptor') {
        const scout = world.addAircraft({ aircraftId: opponent, side: enemySide, x: c.geometry === 'ahead' ? 2500 : -2500, z: 400, alt: c.altitude + 100, heading: Math.PI / 2, flightId: 'measurement-interceptor', skill: 'regular' });
        world.addAI(scout, 'regular', { seed: c.seed * 1000 + scout.id });
      }
    }
    const initial = actors.map(snapshot);
    const durationSteps = Math.round(c.duration / dt);
    const warmupSteps = Math.round(c.warmup / dt);
    const actorAltitudes = actors.map((ac) => c.altitude ?? mission.flights.find((f) => f.id === ac.flightId).start.altitude);
    const actorIds = new Set(actors.map((ac) => ac.id));
    const metrics = actors.map(() => ({ transient: meter(), steady: meter() }));
    const slotOffsets = actors.map((_, i) => formationOffset(i));
    const slotTarget = actors[0].state.position.clone();
    const events = { counts: {}, releases: [], explosions: [], fireByShooter: {}, hitsByPair: {}, firstFireS: null, firstHitS: null };
    const spawns = [];
    const seen = new Set();
    const encounter = { firstContactS: null, firstSelectedBomberS: null, minimumRangeM: null, closureMps: accumulator(), rangeCrossingsS: { 3000: null, 1800: null, 700: null, 250: null } };
    let eventIndex = 0, fixedLeaderValid = true, slotCensoredAtS = null;
    const onEvent = (e) => {
      events.counts[e.type] = (events.counts[e.type] ?? 0) + 1;
      if (e.type === 'gun-fired' && events.firstFireS === null) events.firstFireS = world.time;
      if (e.type === 'bullet-hit' && events.firstHitS === null) events.firstHitS = world.time;
      if (e.type === 'gun-fired') events.fireByShooter[e.shooterId] = (events.fireByShooter[e.shooterId] ?? 0) + 1;
      if (e.type === 'bullet-hit') {
        const pair = `${e.shooterId}->${e.targetId}`;
        events.hitsByPair[pair] = (events.hitsByPair[pair] ?? 0) + 1;
      }
      if (e.type === 'bomb-released') {
        const ac = world.getEntity(e.aircraftId);
        events.releases.push({ timeS: world.time, aircraftId: e.aircraftId, storeIndex: e.storeIndex, positionM: xyz(e.position), airspeedMps: ac.state.airspeed, bankRad: sim.bankAngle(ac.state.orientation), bombsRemaining: bombs(ac), effectiveMassKg: sim.effectiveMass(ac) });
      }
      if (e.type === 'bomb-exploded') events.explosions.push({ timeS: world.time, shooterId: e.shooterId, positionM: xyz(e.position), explosiveKg: e.explosiveKg, damagedTargetIds: [...e.damagedTargetIds] });
    };
    const unsubscribe = core ? core.bus.onAny(onEvent) : null;
    const ap = c.suite === 'reference' ? new sim.Autopilot() : null;
    const referenceTarget = ap ? { altitude: c.altitude, throttle: 1 } : null;
    const observeSpawn = () => {
      for (const ac of world.aircraft) if (!seen.has(ac.id)) { seen.add(ac.id); spawns.push({ timeS: world.time, ...snapshot(ac) }); }
    };
    observeSpawn();
    let steps = 0;
    try {
      for (; steps < durationSteps; steps++) {
        if (core) core.step(dt);
        else {
          if (ap) ap.update(actors[0], referenceTarget, dt);
          world.step(steps % 4 === 0, dt * 4);
          while (eventIndex < world.events.length) onEvent(world.events[eventIndex++]);
          // The harness retains events; observations above copied all needed scratch values.
          world.events.length = 0; eventIndex = 0;
        }
        observeSpawn();
        // Censor the entire original vic on loss or return: inferred surviving slots can change.
        // Startup join-up and ordinary combat phases alone do not replace the leader.
        if (fixedLeaderValid) {
          for (const ac of actors) {
            if (!live(ac) || returningPhases.includes(controllers.get(ac.id)?.phase)) {
              fixedLeaderValid = false; slotCensoredAtS = world.time;
              break;
            }
          }
        }
        for (let i = 0; i < actors.length; i++) {
          const ac = actors[i], ctl = controllers.get(ac.id);
          const m = metrics[i][steps < warmupSteps ? 'transient' : 'steady'];
          if (!live(ac)) continue;
          add(m.speedMps, ac.state.airspeed, dt);
          add(m.horizontalSpeedMps, Math.hypot(ac.state.velocity.x, ac.state.velocity.z), dt);
          add(m.altitudeErrorM, ac.state.position.y - actorAltitudes[i], dt);
          add(m.throttle, ac.controls.throttle, dt);
          if (ac.state.stalled) m.stalledSeconds += dt;
          if (ctl?.autopilot?.recovering) m.recoverySeconds += dt;
          if (ac.controls.throttle >= 0.99) m.throttleSaturatedSeconds += dt;
          const phase = ctl?.phase ?? 'full-throttle-reference';
          m.phaseSeconds[phase] = (m.phaseSeconds[phase] ?? 0) + dt;
          if (i && fixedLeaderValid) {
            slotPosition(actors[0], slotOffsets[i], slotTarget);
            const dx = slotTarget.x - ac.state.position.x, dy = slotTarget.y - ac.state.position.y, dz = slotTarget.z - ac.state.position.z;
            const v = actors[0].state.velocity, h = Math.hypot(v.x, v.z);
            const fx = h >= 1 ? v.x / h : 0, fz = h >= 1 ? v.z / h : -1;
            add(m.slot3dM, Math.hypot(dx, dy, dz), dt); add(m.alongM, dx * fx + dz * fz, dt); add(m.crossM, -dx * fz + dz * fx, dt); add(m.verticalM, dy, dt);
          }
        }
        for (const scout of world.aircraft) if (scout.side !== side && live(scout)) {
          if (actorIds.has(controllers.get(scout.id)?.targetId) && encounter.firstSelectedBomberS === null) encounter.firstSelectedBomberS = world.time;
          for (const ac of actors) if (live(ac)) {
            const p = ac.state.position, q = scout.state.position;
            const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, range = Math.hypot(dx, dy, dz);
            encounter.minimumRangeM = encounter.minimumRangeM === null ? range : Math.min(encounter.minimumRangeM, range);
            for (const threshold of rangeThresholds) if (range <= threshold && encounter.rangeCrossingsS[threshold] === null) encounter.rangeCrossingsS[threshold] = world.time;
            if (range <= 3000 && encounter.firstContactS === null) encounter.firstContactS = world.time;
            const a = ac.state.velocity, b = scout.state.velocity;
            add(encounter.closureMps, range > 0 ? -(dx * (b.x - a.x) + dy * (b.y - a.y) + dz * (b.z - a.z)) / range : 0, dt);
          }
        }
        if (core && core.director.ended) { steps++; break; }
      }
    } finally { if (typeof unsubscribe === 'function') unsubscribe(); core?.dispose(); }
    const missionEnded = core?.director.ended ?? false;
    const capReached = !missionEnded && steps >= durationSteps;
    // buildResult performs final objective evaluation: never invoke it for a capped flight.
    const completedResult = missionEnded ? core.director.buildResult() : null;
    const missionResult = completedResult ? {
      missionId: completedResult.missionId, missionSuccess: completedResult.missionSuccess,
      playerOutcome: completedResult.playerOutcome, playerFate: completedResult.playerFate,
      endedByPlayer: completedResult.endedByPlayer, aborted: completedResult.aborted ?? false,
      flightTimeS: completedResult.flightTimeS,
      objectives: completedResult.objectives.map((o) => ({ id: o.id, completed: o.completed })),
    } : null;
    const objectiveObservation = core ? {
      status: missionEnded ? 'completed-sortie' : 'censored-live-progress',
      censored: !missionEnded, observedAtS: world.time,
      definitions: mission.objectives.map((o) => ({
        id: o.id, kind: o.kind, description: o.description,
        targetIds: [...o.targetIds], count: o.count, primary: o.primary,
      })),
      completedObjectiveIds: [...core.director.completedObjectives],
      failedObjectiveIds: [...core.director.failedObjectives],
      progress: {
        stationTimeS: Object.fromEntries(core.director.progress().stationTime),
        engaged: core.director.progress().engaged,
      },
      groundTargets: mission.groundTargets.map((g) => {
        const entityId = world.missionIdToEntity.get(g.id);
        const target = entityId === undefined ? null : world.getEntity(entityId);
        return {
          missionTargetId: g.id, entityId: entityId ?? null, type: g.type, side: g.side,
          positionM: target ? xyz(target.position) : [g.x, null, g.z],
          headingRad: target?.heading ?? g.heading,
          health: target?.health ?? null, destroyed: target?.destroyed ?? null,
        };
      }),
    } : null;
    observations.push({
      id: c.id, suite: c.suite, seed: c.seed, geometry: c.geometry ?? null,
      opponent: c.suite === 'quick' || c.suite === 'interceptor' ? opponent : null,
      requestedFlightSize: c.count, actualFlightSize: actors.length,
      date: world.date, realism: { ...(world.realism ?? STANDARD_REALISM) },
      weather: mission ? { ...mission.weather, wind: [...mission.weather.wind] } : { wind: [0, 0, 0], turbulence: 0, groundM: 50, flak: false, groundFire: false },
      initialization: core ? 'production-buildWorld-loading-and-retrim' : 'load-then-createFlightState-effectiveMass',
      card: {
        maxSpeedKmh: c.spec.performance.maxSpeedKmh, maxSpeedAltM: c.spec.performance.maxSpeedAltM,
        massLoadedKg: c.spec.performance.massLoaded,
        bombCount: c.spec.bombs.reduce((n, b) => n + b.count, 0),
        payloadKg: c.spec.bombs.reduce((n, b) => n + b.count * b.massKg, 0),
        nominalSoloCruiseMps: 0.8 * c.spec.performance.maxSpeedKmh / 3.6,
        nominalFormationCapMps: 0.72 * c.spec.performance.maxSpeedKmh / 3.6,
      },
      altitudeM: c.altitude ?? null, warmupS: c.warmup, capS: c.duration,
      elapsedS: world.time, steps, termination: capReached ? 'time-cap' : 'mission-ended',
      censored: capReached, firstReleaseS: events.releases[0]?.timeS ?? null,
      releaseCensored: !events.releases.length, contactCensored: encounter.firstContactS === null,
      initial, final: actors.map(snapshot),
      metrics: metrics.map((m, i) => ({
        aircraftId: actors[i].id, slotCensoredAtS,
        lost: isLost(actors[i]) || (actors[i].outcome === null && (actors[i].damage.destroyed || actors[i].damage.pilotKilled)), transient: finish(m.transient), steady: finish(m.steady),
      })),
      spawns,
      scheduledFlights: mission ? mission.flights.map((f) => ({
        id: f.id, side: f.side, aircraft: f.aircraftId, task: f.task,
        count: f.members.length, spawnDelayS: f.spawnDelay ?? 0, start: { ...f.start },
        members: f.members.map((m) => ({ pilotName: m.pilotName ?? null, skill: m.skill, isPlayer: m.isPlayer ?? false })),
        waypoints: f.waypoints.map((w) => ({ x: w.x, z: w.z, altitude: w.altitude, action: w.action })),
      })) : [],
      events, encounter: { ...encounter, closureMps: summarize(encounter.closureMps) },
      outcomes: world.aircraft.map((a) => ({ id: a.id, side: a.side, flightId: a.flightId, outcome: a.outcome })),
      missionEnded, missionResult, objectiveObservation,
    });
  }
  function finiteTree(value, path = 'result') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Nonfinite result at ${path}`);
    if (value === undefined) throw new Error(`Undefined result at ${path}`);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finiteTree(child, `${path}.${key}`);
  }
  const result = { schema: 'bomber-pacing/1', units: { time: 's', speed: 'm/s', distance: 'm', mass: 'kg' }, shippedBombCarriers: bombers.map((s) => s.id), selectedCaseIds: selected.map((c) => c.id), availableCaseIds: cases.map((c) => c.id), cases: observations, interpretation: 'Measurements, not calibration or catch-rate acceptance; Quick intercept remains recon/unloaded and is not part of this bombing cohort.' };
  finiteTree(result);
  return result;
}
