/**
 * Simple cascaded autopilot: holds altitude / vertical speed / airspeed, bank
 * or heading. Used by the performance tests and available to AI as a
 * low-level "fly there" controller.
 *
 * Inner loop: flight-path angle (gamma) via stick, with level-flight alpha
 * feed-forward. Outer loops: altitude -> gamma, or airspeed -> gamma.
 */
import type { AircraftEntity, ControlInputs } from '../core/types';
import { airDensityAt } from './atmosphere';
import { getCoefficients } from './coefficients';
import { bankAngle, headingOf, stickForAlpha } from './flightModel';

export interface AutopilotTarget {
  /** Hold this altitude (m ASL). */
  altitude?: number;
  /** Hold this vertical speed (m/s) (ignored if altitude set). */
  verticalSpeed?: number;
  /** Hold this true airspeed (m/s) by pitch (climb/descend to trade speed). Overrides altitude. */
  airspeedByPitch?: number;
  /** Target heading (rad) via bank; else wings level (or `bank`). */
  heading?: number;
  bank?: number;
  throttle?: number;
  /** Max bank used for heading changes, rad. */
  maxBank?: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class Autopilot {
  private gammaInt = 0;
  private speedGamma = 0;
  private lastV = NaN;

  reset(): void {
    this.gammaInt = 0;
    this.speedGamma = 0;
    this.lastV = NaN;
  }

  update(ac: AircraftEntity, t: AutopilotTarget, dt: number, out: ControlInputs = ac.controls): ControlInputs {
    const s = ac.state;
    const co = getCoefficients(ac.spec);
    const V = Math.max(s.airspeed, 5);
    const gamma = Math.asin(clamp(s.velocity.y / Math.max(1, s.velocity.length()), -1, 1));

    // --- outer loop: target flight-path angle
    let gammaT: number;
    if (t.airspeedByPitch !== undefined) {
      const err = V - t.airspeedByPitch;
      const acc = Number.isFinite(this.lastV) ? (V - this.lastV) / dt : 0;
      this.speedGamma = clamp(this.speedGamma + err * dt * 0.003, -0.6, 0.6);
      gammaT = clamp(this.speedGamma + err * 0.04 + acc * 0.06, -0.8, 0.8);
    } else {
      const vsT = t.altitude !== undefined ? clamp((t.altitude - s.position.y) * 0.12, -15, 15) : (t.verticalSpeed ?? 0);
      gammaT = Math.asin(clamp(vsT / V, -0.9, 0.9));
    }
    this.lastV = V;

    // --- inner loop: gamma via stick (alpha feed-forward for the lift needed)
    const bank = bankAngle(s.orientation);
    const rho = airDensityAt(s.position.y);
    const clNeed = (co.weight * Math.cos(gammaT)) / Math.max(0.3, Math.cos(bank)) / (0.5 * rho * V * V * co.wingArea);
    const alphaFF = Math.min(co.alphaStall - 0.02, clNeed / co.clAlpha + co.alpha0);
    const gErr = gammaT - gamma;
    this.gammaInt = clamp(this.gammaInt + gErr * dt * 0.5, -0.25, 0.25);
    out.pitch = clamp(stickForAlpha(co, alphaFF) + gErr * 1.4 + this.gammaInt - s.angularVelocity.x * 0.12, -1, 1);

    // --- roll: bank hold / heading hold
    let bankT = t.bank ?? 0;
    if (t.heading !== undefined) {
      let dh = t.heading - headingOf(s.orientation);
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const mb = t.maxBank ?? 0.6;
      bankT = clamp(dh * 1.5, -mb, mb);
    }
    const p = -s.angularVelocity.z;
    out.roll = clamp((bankT - bank) * 2.5 - p * 0.35, -1, 1);
    if (t.throttle !== undefined) out.throttle = t.throttle;
    return out;
  }
}
