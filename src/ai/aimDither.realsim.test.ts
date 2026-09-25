/**
 * Mouse-aim fine tracking on slow-rolling types: with the aim point a few degrees
 * off the nose (or drifting slowly, like a user tracking a distant target), the
 * instructor must settle onto it without the wings rocking back and forth.
 * Regression for the Fokker E.III dithering +/-20 deg of bank on a 3-7 deg error.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftId, FlightModelLevel } from '../core/types';
import { createMouseAimState, mouseAimAssist } from '../game/input';
import { SimWorld, runSim, STANDARD_REALISM } from './testing/realSimHarness';
import { Autopilot } from './autopilot';
import { dirFromHeading } from './math';

interface DitherResult {
  /** Peak-to-peak bank over the settled window, deg. */
  bankSwing: number;
  /** Count of bank-rate sign reversals per second over the window (rocking). */
  reversalsPerS: number;
  /** Mean nose-to-aim error over the window, deg. */
  meanErr: number;
}

/** Aim `offsetDeg` right of the start heading, drifting right at `driftDegS`. */
function track(aircraft: AircraftId, level: FlightModelLevel, offsetDeg: number, driftDegS: number, seconds = 40): DitherResult {
  const w = new SimWorld({ realism: { ...STANDARD_REALISM, flightModel: level }, ground: () => 60 });
  const ac = w.addAircraft({ aircraftId: aircraft, side: 'allied', x: 0, z: 0, alt: 1500, heading: 0, controller: 'player' });
  const st = createMouseAimState();
  const fwd = new Vector3();
  const window = seconds / 2;
  let lo = Infinity;
  let hi = -Infinity;
  let reversals = 0;
  let prevRate = 0;
  let errSum = 0;
  let n = 0;
  let prevBank = 0;
  const script = new Map<number, (a: typeof ac, dt: number) => void>();
  script.set(ac.id, (a, dt) => {
    const hdg = ((offsetDeg + driftDegS * w.time) * Math.PI) / 180;
    const aim = dirFromHeading(hdg).setY(0).normalize();
    const out = { pitch: 0, roll: 0, yaw: 0 };
    mouseAimAssist(a, aim, st, w, level, dt, out);
    a.controls.pitch = out.pitch;
    a.controls.roll = out.roll;
    a.controls.yaw = out.yaw;
    a.controls.throttle = 0.85;
    const bank = (Autopilot.bankAngle(a) * 180) / Math.PI;
    if (w.time > seconds - window) {
      lo = Math.min(lo, bank);
      hi = Math.max(hi, bank);
      const rate = (bank - prevBank) / Math.max(dt, 1e-3);
      if (Math.abs(rate) > 2 && Math.sign(rate) !== Math.sign(prevRate) && prevRate !== 0) reversals++;
      if (Math.abs(rate) > 2) prevRate = rate;
      fwd.set(0, 0, -1).applyQuaternion(a.state.orientation);
      errSum += (fwd.angleTo(aim) * 180) / Math.PI;
      n++;
    }
    prevBank = bank;
  });
  runSim(w, seconds, { scripted: script, aiEvery: 2 });
  return { bankSwing: hi - lo, reversalsPerS: reversals / window, meanErr: errSum / Math.max(1, n) };
}

describe('mouse-aim fine tracking (slow-rolling types)', () => {
  for (const level of ['relaxed', 'standard'] as FlightModelLevel[]) {
    it(`Fokker E.III settles on a 5 deg offset without rocking (${level})`, () => {
      const r = track('fokker_eiii', level, 5, 0);
      expect(r.bankSwing).toBeLessThan(10);
      expect(r.meanErr).toBeLessThan(3);
    });
    it(`Fokker E.III tracks a slowly drifting aim point smoothly (${level})`, () => {
      const r = track('fokker_eiii', level, 4, 1.5);
      expect(r.bankSwing).toBeLessThan(14);
      expect(r.reversalsPerS).toBeLessThan(0.5);
      expect(r.meanErr).toBeLessThan(4);
    });
  }
  it('an agile type (Camel) is unaffected: settles on a 5 deg offset', () => {
    const r = track('sopwith_camel', 'standard', 5, 0);
    expect(r.bankSwing).toBeLessThan(10);
    expect(r.meanErr).toBeLessThan(3);
  });
});

export interface DuelDither {
  /** Bank-rate reversals per second while the aim error is 2-8 deg (rocking on a near-solution). */
  reversalsPerS: number;
  /** Mean |bank rate| in that window, deg/s. */
  meanBankRate: number;
  /** Seconds in that window. */
  window: number;
  /** Fraction of in-range time with the nose within 3 / 6 deg of the aim. */
  on3: number;
  on6: number;
}

/**
 * Idealised mouse user duelling an AI (as in src/game/mouseAim.realsim.test.ts): the aim
 * point rides the lead-computed position of a manoeuvring target.
 */
export function duelDither(player: AircraftId, enemy: AircraftId, level: FlightModelLevel, seed = 1, seconds = 120, trace?: string[]): DuelDither {
  const w = new SimWorld({ realism: { ...STANDARD_REALISM, flightModel: level, invulnerable: true }, seed, ground: () => 60 });
  const p = w.addAircraft({ aircraftId: player, side: 'allied', x: 0, z: 0, alt: 1800, heading: 0, controller: 'player' });
  const j = seed - 1;
  const e = w.addAircraft({
    aircraftId: enemy,
    side: 'central',
    x: 150 + ((j * 137) % 400) - (j ? 200 : 0),
    z: -700 - ((j * 211) % 300),
    alt: 1850 + ((j * 53) % 160) - (j ? 80 : 0),
    heading: Math.PI * 0.9 + (j ? ((j * 0.37) % 0.6) - 0.3 : 0),
    skill: 'regular',
  });
  w.addAI(e, 'regular');
  const st = createMouseAimState();
  const aim = new Vector3(0, 0, -1).applyQuaternion(p.state.orientation);
  const mv = 870;
  const fwd = new Vector3();
  let prevBank = 0;
  let prevRate = 0;
  let reversals = 0;
  let win = 0;
  let rateSum = 0;
  let inRange = 0;
  let n3 = 0;
  let n6 = 0;
  const script = new Map<number, (a: typeof p, dt: number) => void>();
  script.set(p.id, (ac, dt) => {
    const rel = e.state.position.clone().sub(ac.state.position);
    const dist = rel.length();
    const tof = dist / (mv + ac.state.airspeed);
    const lead = e.state.position.clone().addScaledVector(e.state.velocity.clone().sub(ac.state.velocity), tof).sub(ac.state.position).normalize();
    const ang = aim.angleTo(lead);
    if (ang > 1e-4) aim.lerp(lead, Math.min(1, (2.5 * dt) / ang)).normalize();
    const out = { pitch: 0, roll: 0, yaw: 0 };
    mouseAimAssist(ac, aim, st, w, level, dt, out);
    ac.controls.pitch = out.pitch;
    ac.controls.roll = out.roll;
    ac.controls.yaw = out.yaw;
    ac.controls.throttle = 1;
    fwd.set(0, 0, -1).applyQuaternion(ac.state.orientation);
    const err = (fwd.angleTo(aim) * 180) / Math.PI;
    const bank = (Autopilot.bankAngle(ac) * 180) / Math.PI;
    const rate = (bank - prevBank) / Math.max(dt, 1e-3);
    prevBank = bank;
    if (dist < 600 && e.outcome === null) {
      inRange += dt;
      if (err < 3) n3 += dt;
      if (err < 6) n6 += dt;
    }
    if (trace && Math.round(w.time * 120) % 15 === 0 && dist < 900)
      trace.push(`t=${w.time.toFixed(2)} d=${dist.toFixed(0)} err=${err.toFixed(1)} bank=${bank.toFixed(0)} roll=${ac.controls.roll.toFixed(2)} yaw=${ac.controls.yaw.toFixed(2)} pitch=${ac.controls.pitch.toFixed(2)} g=${ac.state.gLoad.toFixed(1)} V=${ac.state.airspeed.toFixed(0)} rec=${st.pilot?.recovering} nDes=${st.pilot?.lastNDes.toFixed(2)} rErr=${((st.pilot?.lastRollErr ?? 0) * 57.3).toFixed(0)} gnd=${st.pilot?.groundEmergency} ov=${st.pilot?.overspeed.toFixed(2)} stall=${ac.state.stalled}`);
    if (err > 2 && err < 8 && dist < 800 && Math.abs(rate) < 400) {
      win += dt;
      rateSum += Math.abs(rate) * dt;
      if (Math.abs(rate) > 4) {
        if (prevRate !== 0 && Math.sign(rate) !== Math.sign(prevRate)) reversals++;
        prevRate = rate;
      }
    }
  });
  runSim(w, seconds, { scripted: script, aiEvery: 2, onStep: () => e.outcome !== null && w.time > 1 });
  return { reversalsPerS: win > 0 ? reversals / win : 0, meanBankRate: win > 0 ? rateSum / win : 0, window: win, on3: inRange ? n3 / inRange : 0, on6: inRange ? n6 / inRange : 0 };
}

/** Diagnostic table (AI_SOAK=dither). */
describe.skipIf(!(process.env.AI_SOAK ?? '').split(',').includes('dither'))('dither table', () => {
  it('prints', () => {
    const rows: string[] = [];
    const pairs: [AircraftId, AircraftId][] = [
      ['fokker_eiii', 'airco_dh2'],
      ['fokker_eiii', 'nieuport_11'],
      ['bristol_f2b', 'albatros_dv'],
      ['spad_xiii', 'fokker_dvii'],
      ['sopwith_camel', 'albatros_dv'],
    ];
    const seeds = Number(process.env.AI_SEEDS ?? 4);
    for (const [a, b] of pairs)
      for (const level of ['relaxed', 'standard', 'authentic'] as FlightModelLevel[]) {
        let rev = 0, rate = 0, win = 0, on3 = 0, on6 = 0;
        for (let s = 1; s <= seeds; s++) {
          const r = duelDither(a, b, level, s);
          rev += r.reversalsPerS * r.window;
          rate += r.meanBankRate * r.window;
          win += r.window;
          on3 += r.on3 / seeds;
          on6 += r.on6 / seeds;
        }
        rows.push(`${a.padEnd(14)} vs ${b.padEnd(13)} ${level.padEnd(9)}: near-aim ${win.toFixed(0)}s rev/s ${(rev / win).toFixed(2)} |bank rate| ${(rate / win).toFixed(1)} deg/s  on3 ${(on3 * 100).toFixed(0)}% on6 ${(on6 * 100).toFixed(0)}%`);
      }
    process.stdout.write('\n' + rows.join('\n') + '\n');
  }, 600_000);
});

describe.skipIf(!(process.env.AI_SOAK ?? '').split(',').includes('dithertrace'))('dither trace', () => {
  it('prints', () => {
    const t: string[] = [];
    duelDither('fokker_eiii', 'airco_dh2', 'standard', Number(process.env.AI_SEED ?? 1), 120, t);
    process.stdout.write('\n' + t.slice(0, 160).join('\n') + '\n');
  }, 600_000);
});
