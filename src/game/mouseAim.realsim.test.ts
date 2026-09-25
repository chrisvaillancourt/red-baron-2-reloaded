/**
 * Mouse-aim on the REAL flight model: an idealised mouse user keeps the aim
 * point on the lead-computed position of a manoeuvring AI target, and the
 * instructor must convert that into a fight — tracking the target without
 * stalling, spinning or pulling the wings off.
 *
 * The full per-type table runs with MOUSEAIM_SOAK=1; the default run keeps a
 * representative subset so `pnpm test` stays fast.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftEntity, AircraftId, FlightModelLevel } from '../core/types';
import { GUNS } from '../data/aircraft';
import { SimWorld, runSim, STANDARD_REALISM } from '../ai/testing/realSimHarness';
import { createMouseAimState, mouseAimAssist, mouseAimControls } from './input';

interface Result {
  onTarget3: number; // fraction of in-range time with nose within 3° of the aim
  onTarget6: number;
  inRange: number; // seconds within 600 m
  stalledS: number;
  maxG: number;
  broke: boolean;
  crashed: boolean;
  kills: number;
}

function duel(player: AircraftId, enemy: AircraftId, level: FlightModelLevel, seconds = 120, seed = 1): Result {
  const w = new SimWorld({ realism: { ...STANDARD_REALISM, flightModel: level, invulnerable: true }, seed, ground: () => 60 });
  const p = w.addAircraft({ aircraftId: player, side: 'allied', x: 0, z: 0, alt: 1800, heading: 0, controller: 'player' });
  // Seed 1 is the canonical merge; later seeds vary the start geometry (the sim
  // and AI are otherwise deterministic, so seeds alone would repeat one fight).
  const j = seed - 1;
  const e = w.addAircraft({
    aircraftId: enemy,
    side: 'central',
    x: 150 + ((j * 137) % 400) - (j ? 200 : 0),
    z: -700 - ((j * 211) % 300),
    alt: 1850 + ((j * 53) % 160) - (j ? 80 : 0),
    heading: Math.PI * 0.9 + (j ? (((j * 0.37) % 0.6) - 0.3) : 0),
    skill: 'regular',
  });
  w.addAI(e, 'regular');
  const st = createMouseAimState();
  const aim = new Vector3(0, 0, -1).applyQuaternion(p.state.orientation);
  const mv = GUNS[p.spec.guns[0].type].muzzleVelocity;
  const r: Result = { onTarget3: 0, onTarget6: 0, inRange: 0, stalledS: 0, maxG: 0, broke: false, crashed: false, kills: 0 };
  let n3 = 0;
  let n6 = 0;
  const fwd = new Vector3();
  const script = new Map<number, (ac: AircraftEntity, dt: number) => void>();
  script.set(p.id, (ac, dt) => {
    // Idealised user: aim at the lead point, moving the mouse at a human-ish max rate.
    const rel = e.state.position.clone().sub(ac.state.position);
    const dist = rel.length();
    const tof = dist / (mv + ac.state.airspeed);
    const lead = e.state.position.clone().addScaledVector(e.state.velocity.clone().sub(ac.state.velocity), tof).sub(ac.state.position).normalize();
    const maxStep = 2.5 * dt; // rad/s of mouse movement
    const ang = aim.angleTo(lead);
    if (ang > 1e-4) aim.lerp(lead, Math.min(1, maxStep / ang)).normalize();
    const out = { pitch: 0, roll: 0, yaw: 0 };
    if (ASSIST) mouseAimAssist(ac, aim, st, w, level, dt, out);
    else mouseAimControls(ac, aim, st, dt, out);
    ac.controls.pitch = out.pitch;
    ac.controls.roll = out.roll;
    ac.controls.yaw = out.yaw;
    ac.controls.throttle = 1;
    fwd.set(0, 0, -1).applyQuaternion(ac.state.orientation);
    const err = fwd.angleTo(aim);
    ac.controls.fireGuns = dist < 350 && err < 0.03;
    if (dist < 600 && e.outcome === null) {
      r.inRange += dt;
      if (err < (3 * Math.PI) / 180) n3 += dt;
      if (err < (6 * Math.PI) / 180) n6 += dt;
    }
    if (ac.state.stalled) r.stalledS += dt;
    r.maxG = Math.max(r.maxG, ac.state.gLoad);
  });
  runSim(w, seconds, { scripted: script, aiEvery: 2, onStep: () => e.outcome !== null && w.time > 1 && (r.kills = 1) === 1 });
  r.onTarget3 = r.inRange > 0 ? n3 / r.inRange : 0;
  r.onTarget6 = r.inRange > 0 ? n6 / r.inRange : 0;
  r.broke = p.damage.structuralFailure;
  r.crashed = p.outcome === 'crashed';
  return r;
}

const ASSIST = !(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MOUSEAIM_LEGACY;
const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SOAK = !!ENV.MOUSEAIM_SOAK;
/** MOUSEAIM_PAIRS=fokker_eiii:airco_dh2,... narrows a soak run to chosen matchups. */
const PAIRS = ENV.MOUSEAIM_PAIRS?.split(',').map((p) => p.split(':') as [AircraftId, AircraftId]);
const TYPES: [AircraftId, AircraftId][] = PAIRS ?? (SOAK
  ? [
      ['sopwith_camel', 'albatros_dv'],
      ['se5a', 'albatros_dv'],
      ['spad_xiii', 'fokker_dvii'],
      ['airco_dh2', 'fokker_eiii'],
      ['nieuport_17', 'albatros_diii'],
      ['bristol_f2b', 'albatros_dv'],
      ['fokker_dri', 'sopwith_camel'],
      ['albatros_dv', 'se5a'],
      ['fokker_eiii', 'airco_dh2'],
      ['fokker_dvii', 'spad_xiii'],
    ]
  : [
      ['sopwith_camel', 'albatros_dv'],
      ['fokker_dri', 'sopwith_camel'],
    ]);

const ROWS: string[] = [];
afterAll(async () => {
  if (!SOAK) return;
  const fs = await import('node:fs');
  fs.appendFileSync('test-results/mouseaim-soak.txt', ROWS.sort().join('\n') + '\n');
});

describe('mouse-aim on the real sim', () => {
  for (const [a, b] of TYPES) {
    for (const level of (SOAK ? ['relaxed', 'standard', 'authentic'] : ['standard']) as FlightModelLevel[]) {
      it(`${a} vs ${b} (${level}) tracks without departing`, () => {
        // MOUSEAIM_SEEDS=n averages n seeded duels per row (single duels are noisy).
        const seeds = Math.max(1, Number(ENV.MOUSEAIM_SEEDS ?? 1));
        const runs = Array.from({ length: seeds }, (_, s) => duel(a, b, level, SOAK ? 150 : 90, s + 1));
        const avg = (f: (x: Result) => number) => runs.reduce((t, x) => t + f(x), 0) / runs.length;
        const r: Result = {
          onTarget3: avg((x) => x.onTarget3),
          onTarget6: avg((x) => x.onTarget6),
          inRange: avg((x) => x.inRange),
          stalledS: Math.max(...runs.map((x) => x.stalledS)),
          maxG: Math.max(...runs.map((x) => x.maxG)),
          broke: runs.some((x) => x.broke),
          crashed: runs.some((x) => x.crashed),
          kills: runs.reduce((t, x) => t + x.kills, 0),
        };
        if (SOAK) ROWS.push(`${a.padEnd(16)} vs ${b.padEnd(14)} ${level.padEnd(9)} inRange ${r.inRange.toFixed(0)}s on3 ${(r.onTarget3 * 100).toFixed(0)}% on6 ${(r.onTarget6 * 100).toFixed(0)}% stall ${r.stalledS.toFixed(1)}s maxG ${r.maxG.toFixed(1)} kills ${r.kills}/${seeds} broke ${r.broke} crash ${r.crashed}`);
        expect(r.broke).toBe(false);
        expect(r.crashed).toBe(false);
        expect(r.stalledS).toBeLessThan(6);
        expect(r.onTarget6).toBeGreaterThan(0.3);
      });
    }
  }
});
