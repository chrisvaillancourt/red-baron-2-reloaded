/** Focused probes for tuning (AI_SOAK=probe). */
import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { orientationFrom, getCoefficients, bankAngle, getSimInternal, Autopilot as SimAutopilot } from '../sim';
import { runSim, SimWorld } from './testing/realSimHarness';
import { combatRun, routeFlight } from './testing/realScenarios';
import type { AircraftId, Waypoint } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { getAerodrome } from '../data/aerodromes';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
function report(rows: string[]): void {
  const out = process.env.AI_OUT;
  const text = '\n' + rows.join('\n') + '\n';
  if (out) appendFileSync(out, text);
  else process.stdout.write(text);
}

describe.skipIf(!SOAK.includes('spot'))('probe spotting', () => {
  it('N17 vs D.III head-on start', () => {
    const rows: string[] = [];
    const r = combatRun({ a: 'nieuport_17', sa: 'regular', b: 'albatros_diii', sb: 'regular', n: 1, seed: 1, seconds: 120, tap: (w) => {
      if (Math.round(w.time * 120) % 240 !== 0) return;
      const [a, b] = w.aircraft;
      const ca = w.controllers.get(a.id)!, cb = w.controllers.get(b.id)!;
      rows.push(`t=${w.time.toFixed(0)} d=${a.state.position.distanceTo(b.state.position).toFixed(0)} A(${a.state.position.x.toFixed(0)},${a.state.altitude.toFixed(0)},${a.state.position.z.toFixed(0)} v=${a.state.airspeed.toFixed(0)}) ${ca.debugState} | B(${b.state.position.x.toFixed(0)},${b.state.altitude.toFixed(0)},${b.state.position.z.toFixed(0)} v=${b.state.airspeed.toFixed(0)}) ${cb.debugState}`);
    } });
    rows.push(JSON.stringify(r.outcomes));
    report(rows);
  }, 600_000);
});

describe.skipIf(!SOAK.includes('track'))('probe tracking', () => {
  it('ace chases a scripted turning target', () => {
    const rows: string[] = [];
    for (const [shooterId, targetId] of [['se5a', 'albatros_dv'], ['sopwith_camel', 'albatros_dv'], ['fokker_dri', 'sopwith_camel']] as const) {
      for (const bankDeg of [0, 30, 50, 65]) {
        for (const variant of ['ace', 'veteran', 'regular', 'novice'] as const) {
          const skill = variant;
          const world = new SimWorld({ frontX: 1e9 });
          const tgt = world.addAircraft({ aircraftId: targetId, side: 'central', x: 0, z: -250, alt: 1500, heading: 0, controller: 'none' });
          const ac = world.addAircraft({ aircraftId: shooterId, side: 'allied', nation: 'britain', x: 0, z: 0, alt: 1500, heading: 0 });
          tgt.state.velocity.setLength(ac.state.airspeed);
          const ctl = world.addAI(ac, skill);
          const ap = new SimAutopilot();
          const bank = (bankDeg * Math.PI) / 180;
          let solT = 0, n = 0, errSum = 0, inRange = 0;
          const f = new Vector3(), rel = new Vector3();
          runSim(world, 60, {
            scripted: new Map([[tgt.id, (a, dt) => void ap.update(a, { altitude: 1500, bank, throttle: 1 }, dt)]]),
            onStep: () => {
              n++;
              rel.copy(tgt.state.position).sub(ac.state.position);
              const r = rel.length();
              f.set(0, 0, -1).applyQuaternion(ac.state.orientation);
              if (r < 400) {
                inRange++;
                errSum += f.angleTo(rel);
              }
              return !!tgt.outcome || !!ac.outcome;
            },
          });
          solT = ctl.stats.gunsSolutionTime;
          const hits = world.eventsOf('bullet-hit').filter((h) => h.shooterId === ac.id).length;
          const fired = world.eventsOf('gun-fired').filter((h) => h.shooterId === ac.id).length;
          rows.push(
            `${shooterId}/${variant} vs ${targetId} bank ${bankDeg}: t=${world.time.toFixed(0)} sol=${solT.toFixed(1)}s inRange=${(inRange / 120).toFixed(0)}s meanErr=${((errSum / Math.max(1, inRange)) * 57.3).toFixed(1)}deg fired=${fired} hits=${hits} tgt=${tgt.outcome ?? 'ok'} dmg=${Object.values(tgt.damage.zones).reduce((s, v) => s + v, 0).toFixed(2)} self=${ac.outcome ?? 'ok'} ${ctl.debugState}`,
          );
        }
      }
    }
    report(rows);
  }, 600_000);
});

describe.skipIf(!SOAK.includes('turn'))('probe hard-turn pursuit', () => {
  it('traces a pursuit of a 65 deg banked target', () => {
    const rows: string[] = [];
    const shooterId = (process.env.AI_SHOOTER ?? 'sopwith_camel') as 'sopwith_camel';
    const world = new SimWorld({ frontX: 1e9 });
    const tgt = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 0, z: -250, alt: 1500, heading: 0, controller: 'none' });
    const ac = world.addAircraft({ aircraftId: shooterId, side: 'allied', nation: 'britain', x: 0, z: 0, alt: 1500, heading: 0 });
    tgt.state.velocity.setLength(ac.state.airspeed);
    const ctl = world.addAI(ac, 'ace');
    ctl.autopilot.trace = true;
    const ap = new SimAutopilot();
    const bank = (Number(process.env.AI_BANK ?? 65) * Math.PI) / 180;
    const f = new Vector3(), rel = new Vector3();
    let k = 0;
    runSim(world, 40, {
      scripted: new Map([[tgt.id, (a, dt) => void ap.update(a, { altitude: 1500, bank, throttle: 1 }, dt)]]),
      onStep: () => {
        if (k++ % (Number(process.env.AI_EVERY ?? 30)) === 0) {
          rel.copy(tgt.state.position).sub(ac.state.position);
          f.set(0, 0, -1).applyQuaternion(ac.state.orientation);
          const a = ctl.autopilot;
          rows.push(
            `t=${world.time.toFixed(2)} r=${rel.length().toFixed(0)} err=${(f.angleTo(rel) * 57.3).toFixed(0)} V=${ac.state.airspeed.toFixed(0)}/${tgt.state.airspeed.toFixed(0)} g=${ac.state.gLoad.toFixed(1)}/${tgt.state.gLoad.toFixed(1)} nDes=${a.lastNDes.toFixed(1)} rollErr=${a.lastRollErr.toFixed(2)} bank=${(bankAngle(ac.state.orientation) * 57.3).toFixed(0)} aoa=${(ac.state.aoa * 57.3).toFixed(1)} st=${ac.state.stalled ? 1 : 0} alt=${ac.state.altitude.toFixed(0)} ctl=${ac.controls.pitch.toFixed(2)},${ac.controls.roll.toFixed(2)},${ac.controls.yaw.toFixed(2)},${ac.controls.throttle.toFixed(2)} ${ctl.debugState} | ${a.dbg}`,
          );
        }
        return false;
      },
    });
    report(rows);
  }, 600_000);
});

describe.skipIf(!SOAK.includes('zones'))('probe hit zones', () => {
  it('zone distribution in ace-vs-novice duels', () => {
    const rows: string[] = [];
    const zones: Record<string, number> = {};
    let hitsTotal = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const r = combatRun({ a: 'se5a', sa: 'ace', b: 'albatros_dv', sb: 'novice', n: 1, seed });
      for (const h of r.world.eventsOf('bullet-hit')) {
        if (h.shooterId !== r.A[0].id) continue;
        zones[h.zone] = (zones[h.zone] ?? 0) + 1;
        hitsTotal++;
      }
      const v = r.B[0];
      rows.push(`seed ${seed}: end=${r.endTime.toFixed(0)} victim ${v.outcome} zones=${JSON.stringify(Object.fromEntries(Object.entries(v.damage.zones).map(([k, x]) => [k, +x.toFixed(2)])))} fire=${v.damage.onFire}`);
    }
    rows.push(`total hits ${hitsTotal}: ${JSON.stringify(zones)}`);
    report(rows);
  }, 600_000);
});

describe.skipIf(!SOAK.includes('mission'))('probe full mission', () => {
  it('takeoff -> patrol -> rtb -> land', () => {
    const rows: string[] = [];
    const types = (process.env.AI_TYPES?.split(',') ?? ['se5a', 'sopwith_camel', 'spad_xiii', 'bristol_f2b', 're8', 'albatros_dv', 'fokker_dri', 'fokker_dvii', 'pfalz_diiia', 'nieuport_17']) as AircraftId[];
    for (const id of types) {
      const spec = getAircraft(id);
      const side = spec.nation === 'germany' ? 'central' : 'allied';
      const home = getAerodrome(side === 'central' ? 'douai' : 'filescamp')!;
      const hdg = (home.runwayHeadingDeg * Math.PI) / 180;
      const out = side === 'central' ? -1 : 1; // toward the front at x = 0
      const wps: Waypoint[] = [
        { x: home.x + out * 6000, z: home.z - 2000, altitude: 1500, action: 'fly' },
        { x: home.x + out * 9000, z: home.z + 2000, altitude: 1500, action: 'patrol', duration: 60 },
      ];
      const world = new SimWorld({ flights: [routeFlight('f', side, id, wps)] });
      const lead = world.addAircraft({ aircraftId: id, side, x: home.x, z: home.z, alt: 50, heading: hdg, flightId: 'f', onGround: true });
      const wing = world.addAircraft({ aircraftId: id, side, x: home.x + Math.sin(hdg + 1.57) * 25, z: home.z - Math.cos(hdg + 1.57) * 25, alt: 50, heading: hdg, flightId: 'f', onGround: true });
      const cl = world.addAI(lead, 'regular', { homeAerodromeId: home.id });
      const cw = world.addAI(wing, 'regular', { homeAerodromeId: home.id });
      let airborne = [-1, -1];
      const phases = new Set<string>();
      let formErr = 0, formN = 0;
      runSim(world, 1500, {
        onStep: (t) => {
          if (process.env.AI_TRACE && Math.round(t * 120) % Math.max(1, Math.round(120 * Number(process.env.AI_TRACE))) === 0) for (const [a, c] of [[lead, cl], [wing, cw]] as const) rows.push(`  ${id} #${a.id} t=${t.toFixed(0)} ${c.debugState} stage=${c.landingStage} rel=(${(a.state.position.x - home.x).toFixed(0)},${(a.state.position.z - home.z).toFixed(0)}) agl=${a.state.heightAboveGround.toFixed(0)} V=${a.state.airspeed.toFixed(0)} vy=${a.state.velocity.y.toFixed(1)} g=${a.state.gLoad.toFixed(1)} st=${a.state.stalled ? 1 : 0} ctl=${a.controls.pitch.toFixed(2)},${a.controls.roll.toFixed(2)},${a.controls.throttle.toFixed(2)} pitch=${(Math.asin(new Vector3(0, 0, -1).applyQuaternion(a.state.orientation).y) * 57.3).toFixed(1)} bank=${(bankAngle(a.state.orientation) * 57.3).toFixed(1)} w=(${a.state.angularVelocity.x.toFixed(2)},${a.state.angularVelocity.y.toFixed(2)},${a.state.angularVelocity.z.toFixed(2)}) gnd=${a.state.onGround ? 1 : 0} aoa=${(a.state.aoa * 57.3).toFixed(1)} ${a.outcome ?? ""} ${getSimInternal(a).impactKind ?? ""}`);
          [lead, wing].forEach((a, i) => { if (airborne[i] < 0 && a.state.heightAboveGround > 30) airborne[i] = t; });
          phases.add(cl.phase);
          if (cw.phase === 'formation' && cl.phase !== 'takeoff' && lead.state.heightAboveGround > 300) {
            formErr += wing.state.position.distanceTo(lead.state.position);
            formN++;
          }
          return !!lead.outcome && !!wing.outcome;
        },
      });
      rows.push(`${id.padEnd(16)} lead=${lead.outcome ?? cl.debugState} wing=${wing.outcome ?? cw.debugState} t=${world.time.toFixed(0)} airborne=${airborne.map((a) => a.toFixed(0)).join('/')} phases=${[...phases].join(',')} formDist=${(formErr / Math.max(1, formN)).toFixed(0)} leadPos=(${(lead.state.position.x - home.x).toFixed(0)},${(lead.state.position.z - home.z).toFixed(0)}) wingPos=(${(wing.state.position.x - home.x).toFixed(0)},${(wing.state.position.z - home.z).toFixed(0)}) thr=${[cl, cw].map((c) => { const th = (c as unknown as { landing: { threshold: Vector3 } | null }).landing?.threshold; return th ? `(${(th.x - home.x).toFixed(0)},${(th.z - home.z).toFixed(0)})` : "-"; }).join("/")} ${getSimInternal(wing).impactKind ?? ""}`);
    }
    report(rows);
  }, 600_000);
});

describe.skipIf(!SOAK.includes('straight'))('probe straight target', () => {
  it('ace camel vs straight albatros', () => {
    const rows: string[] = [];
    const world = new SimWorld({ frontX: 1e9, seed: 3 });
    const tgt = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 0, z: 0, alt: 1500, heading: 0, flightId: 't', skill: 'veteran' });
    const att = world.addAircraft({ aircraftId: 'sopwith_camel', side: 'allied', x: 20, z: 450, alt: 1520, heading: 0, flightId: 'a', skill: 'ace' });
    const ctl = world.addAI(att, 'ace', { seed: 5 });
    ctl.autopilot.trace = true;
    let k = 0;
    const rel = new Vector3(), f = new Vector3();
    runSim(world, 120, {
      scripted: new Map([[tgt.id, (ac) => void Object.assign(ac.controls, { pitch: 0, roll: 0, yaw: 0, throttle: 0.7 })]]),
      onStep: (t) => {
        if (k++ % Number(process.env.AI_EVERY ?? 240) === 0) {
          rel.copy(tgt.state.position).sub(att.state.position);
          f.set(0, 0, -1).applyQuaternion(att.state.orientation);
          rows.push(`t=${t.toFixed(0)} r=${rel.length().toFixed(0)} err=${(f.angleTo(rel) * 57.3).toFixed(1)} V=${att.state.airspeed.toFixed(0)}/${tgt.state.airspeed.toFixed(0)} alt=${att.state.altitude.toFixed(0)}/${tgt.state.altitude.toFixed(0)} tgtBank=${(bankAngle(tgt.state.orientation) * 57.3).toFixed(0)} ${ctl.debugState} fire=${att.controls.fireGuns} hits=${world.eventsOf('bullet-hit').length} tgt=${tgt.outcome} g=${att.state.gLoad.toFixed(1)} nDes=${ctl.autopilot.lastNDes.toFixed(1)} aoa=${(att.state.aoa * 57.3).toFixed(1)} st=${att.state.stalled ? 1 : 0} ctl=${att.controls.pitch.toFixed(2)},${att.controls.roll.toFixed(2)},${att.controls.yaw.toFixed(2)},${att.controls.throttle.toFixed(2)} | ${ctl.autopilot.dbg}`);
        }
        return !!tgt.outcome;
      },
    });
    report(rows);
  }, 600_000);
});

describe.skipIf(!SOAK.includes('probe'))('probe', () => {
  it('steep dive onto a low target', () => {
    const rows: string[] = [];
    for (const id of ['sopwith_camel', 'albatros_dv', 'fokker_dri'] as const) {
      const world = new SimWorld({ frontX: 1e9 });
      const ac = world.addAircraft({ aircraftId: id, side: 'allied', nation: 'britain', x: 0, z: 0, alt: 2500, heading: 0, speed: 60 });
      const q = orientationFrom(0, (-80 * Math.PI) / 180, 0.3, new Quaternion());
      ac.state.orientation.copy(q);
      ac.state.velocity.copy(new Vector3(0, 0, -60).applyQuaternion(q));
      const tgt = world.addAircraft({ aircraftId: 'albatros_dv', side: 'central', x: 0, z: -600, alt: 600, heading: 0, controller: 'none' });
      tgt.controls.throttle = 0.8;
      const ctl = world.addAI(ac, 'regular');
      const co = getCoefficients(ac.spec);
      rows.push(`--- ${id} vne=${co.vne.toFixed(0)} gl=${co.gLimit}`);
      let k = 0;
      runSim(world, 25, {
        onStep: () => {
          if (k++ % 24 === 0) {
            const ap = ctl.autopilot;
            rows.push(
              `t=${world.time.toFixed(1)} V=${ac.state.airspeed.toFixed(0)} vy=${ac.state.velocity.y.toFixed(0)} alt=${ac.state.altitude.toFixed(0)} g=${ac.state.gLoad.toFixed(1)} nDes=${ap.lastNDes.toFixed(2)} rollErr=${ap.lastRollErr.toFixed(2)} os=${ap.overspeed.toFixed(2)} ctl=${ac.controls.pitch.toFixed(2)},${ac.controls.roll.toFixed(2)},${ac.controls.throttle.toFixed(2)} ${ac.outcome ?? ''} ${ctl.debugState} sf=${ac.damage.structuralFailure}`,
            );
          }
          return !!ac.outcome;
        },
      });
    }
    report(rows);
  }, 600_000);
});
