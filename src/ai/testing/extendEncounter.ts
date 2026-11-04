import { Quaternion, Vector3 } from 'three';
import { SimWorld } from './realSimHarness';

export interface ExtendEncounter {
  /** Lateral offset (m, world x) of the second aircraft's track. */
  offsetX?: number;
  /** Height of the second aircraft above the first (m). */
  offsetY?: number;
  /** Roll (rad) applied to both aircraft about their own nose axis. */
  roll?: number;
  /** Each aircraft's start distance from the midpoint (m). */
  halfRange?: number;
  seconds?: number;
}

/**
 * Two regular Camels head-on with real flight, combat and pilot updates, close enough that
 * both break into `extend` straight away. With the default knife-edge roll each has the
 * other on its own lift side. Returns collisions and the minimum separation.
 */
export function runExtendEncounter(o: ExtendEncounter = {}) {
  const halfRange = o.halfRange ?? 49.5;
  const w = new SimWorld({ seed: 1 });
  const a = w.addAircraft({ id: 1, aircraftId: 'sopwith_camel', side: 'allied', x: 0, z: halfRange, alt: 2000, heading: 0, speed: 45 });
  const b = w.addAircraft({
    id: 2, aircraftId: 'sopwith_camel', side: 'central', x: o.offsetX ?? 12, z: -halfRange,
    alt: 2000 + (o.offsetY ?? 0), heading: Math.PI, speed: 45,
  });
  const roll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), o.roll ?? -Math.PI / 2);
  for (const ac of [a, b]) ac.state.orientation.multiply(roll);
  const pilots = [w.addAI(a, 'regular', { seed: 1 }), w.addAI(b, 'regular', { seed: 2 })];
  let minSeparation = Infinity;
  let bothExtended = false;
  const steps = Math.round((o.seconds ?? 4) * 120);
  for (let i = 0; i < steps; i++) {
    w.step(i % 4 === 0, 1 / 30);
    if (pilots.every((p) => p.phase === 'extend')) bothExtended = true;
    minSeparation = Math.min(minSeparation, a.state.position.distanceTo(b.state.position));
    if (w.eventsOf('collision').length) break;
  }
  return { collisions: w.eventsOf('collision').length, minSeparation, bothExtended };
}
