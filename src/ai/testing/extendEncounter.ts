import { Quaternion, Vector3 } from 'three';
import { SimWorld } from './realSimHarness';

export interface ExtendEncounter {
  /** Lateral offset (m, world x) of the second aircraft's track. */
  offsetX?: number;
  /** Height of the second aircraft above the first (m). */
  offsetY?: number;
  /** Roll (rad) of the first aircraft about its own nose axis (and of the second without `rollB`). */
  roll?: number;
  /** Roll (rad) of the second aircraft, when it differs. */
  rollB?: number;
  /** Each aircraft's start distance from the midpoint (m). */
  halfRange?: number;
  /** Add a third Camel (allied, another flight) behind the first, at x = third * 22 m. */
  third?: number;
  /** The second aircraft is a player machine with no pilot (it won't dodge). */
  lone?: boolean;
  seconds?: number;
}

/**
 * Two regular Camels head-on with real flight, combat and pilot updates, close enough that
 * both break into `extend` straight away. With the default knife-edge roll each has the
 * other on its own lift side. Returns any collision and the pair's minimum separation.
 */
export function runExtendEncounter(o: ExtendEncounter = {}) {
  const halfRange = o.halfRange ?? 49.5;
  const roll = o.roll ?? -Math.PI / 2;
  const w = new SimWorld({ seed: 1 });
  const a = w.addAircraft({ id: 1, aircraftId: 'sopwith_camel', side: 'allied', x: 0, z: halfRange, alt: 2000, heading: 0, speed: 45 });
  const b = w.addAircraft({
    id: 2, aircraftId: 'sopwith_camel', side: 'central', x: o.offsetX ?? 12, z: -halfRange,
    alt: 2000 + (o.offsetY ?? 0), heading: Math.PI, speed: 45, controller: o.lone ? 'player' : 'ai',
  });
  const rollAbout = (r: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), r);
  a.state.orientation.multiply(rollAbout(roll));
  b.state.orientation.multiply(rollAbout(o.rollB ?? roll));
  const pilots = [w.addAI(a, 'regular', { seed: 1 })];
  if (!o.lone) pilots.push(w.addAI(b, 'regular', { seed: 2 }));
  if (o.third !== undefined) {
    const c = w.addAircraft({
      id: 3, aircraftId: 'sopwith_camel', side: 'allied', x: o.third * 22, z: halfRange + 30, alt: 2010,
      heading: 0, speed: 45, flightId: 'other-allied',
    });
    c.state.orientation.multiply(rollAbout(-roll));
    w.addAI(c, 'regular', { seed: 3 });
  }
  let minSeparation = Infinity;
  let bothExtended = false;
  const steps = Math.round((o.seconds ?? 4) * 120);
  for (let i = 0; i < steps; i++) {
    w.step(i % 4 === 0, 1 / 30);
    if (pilots.length === 2 && pilots.every((p) => p.phase === 'extend')) bothExtended = true;
    minSeparation = Math.min(minSeparation, a.state.position.distanceTo(b.state.position));
    if (w.eventsOf('collision').length) break;
  }
  return { collisions: w.eventsOf('collision').length, minSeparation, bothExtended };
}

/** Named encounter grids for `extendGrid.soak.test.ts` (D-117 evidence). */
export function extendGrids(): Record<string, ExtendEncounter[]> {
  const g: Record<string, ExtendEncounter[]> = {};
  const add = (k: string, e: ExtendEncounter) => (g[k] ??= []).push(e);
  // Mixed rolls (knife-edge both ways, steep, inverted): 495 cases.
  for (const roll of [-Math.PI / 2, Math.PI / 2, (-2 * Math.PI) / 3, -Math.PI / 3, Math.PI])
    for (const offsetY of [-10, 0, 10]) for (let offsetX = 0; offsetX <= 40; offsetX += 4)
      for (const halfRange of [49.5, 70, 90]) add('mixed', { offsetX, offsetY, roll, halfRange });
  // Hard: each on the other's lift side: 750 cases.
  for (const roll of [-1.2, -1.4, -1.57, -1.75, -1.95]) for (const offsetY of [-4, 0, 4])
    for (let offsetX = 2; offsetX <= 30; offsetX += 3) for (const halfRange of [55, 62, 75, 85, 100])
      add('hard', { offsetX, offsetY, roll, halfRange });
  // The round-2 review grids: 840 + 81 + 243 + 243 cases.
  for (const roll of [-1.1, -1.3, -1.5, -Math.PI / 2, -1.7, -1.9, -2.1]) for (const offsetX of [4, 8, 12, 16, 20, 24])
    for (const offsetY of [-12, -6, 0, 6, 12]) for (const halfRange of [40, 49.5, 60, 75])
      add('review-pair', { offsetX, offsetY, roll, halfRange });
  const small = (f: (roll: number, offsetX: number, offsetY: number, halfRange: number) => void) => {
    for (const roll of [-1.3, -Math.PI / 2, -1.9]) for (const offsetX of [8, 12, 20]) for (const offsetY of [-6, 0, 6])
      for (const halfRange of [49.5, 60, 75]) f(roll, offsetX, offsetY, halfRange);
  };
  small((roll, offsetX, offsetY, halfRange) => add('review-lone', { offsetX, offsetY, roll, halfRange, lone: true }));
  small((roll, offsetX, offsetY, halfRange) => {
    for (const third of [-1, 0, 1]) add('review-three', { offsetX, offsetY, roll, halfRange, third });
  });
  for (const roll of [-1.1, -1.5, -1.9]) for (const rollB of [-1.2, -1.6, -2]) for (const offsetX of [8, 12, 20])
    for (const offsetY of [-6, 0, 6]) for (const halfRange of [49.5, 60, 75])
      add('review-unequal', { offsetX, offsetY, roll, rollB, halfRange });
  return g;
}
