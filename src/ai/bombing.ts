/**
 * Bombers and the fighters that meet them (docs/ai.md "Bombers"): who can still bomb, where
 * a formation leader aims, and where an attacker finds a bomber's blind spot. Pure helpers;
 * the controller (controller.ts) flies them.
 */
import { Vector3 } from 'three';
import type { AircraftEntity, CrewStation, GroundTargetEntity } from '../core/types';
import { crewStations, inFireArcs } from '../data/crew';
import { blastDamage, nextBombStore } from '../sim/bombs';
import { GROUND_TARGET_BOXES } from '../sim/hitboxes';
import { DEG } from './math';

/** Seconds between the bombs of one aircraft's stick (about 13 m apart at a D.H.4's cruise). */
export const STICK_INTERVAL_S = 0.25;
/** The run proper starts this far (m, horizontally) from the aim point: straight and level from here. */
export const RUN_START_M = 5000;
/** Largest cross-track miss (m) at which the leader still releases, on his first two runs. */
export const RELEASE_CROSS_M = 35;
/** Runs over the target before the leader releases whatever the cross-track miss. */
export const MAX_RUNS = 3;
/** Ground targets further than this (m) from the 'bomb' waypoint are not its targets. */
export const TARGET_AREA_M = 1500;

/** Bombs aboard, over every store. */
export function bombsAboard(ac: AircraftEntity): number {
  let n = 0;
  for (const b of ac.bombs ?? []) n += b;
  return n;
}

/** Has bombs aboard and a live bomb aimer to release them (the sim refuses a release without one). */
export function canBomb(ac: AircraftEntity): boolean {
  if (nextBombStore(ac) < 0) return false;
  const aimer = crewStations(ac.spec).find((s) => s.bombAimer)?.crewIndex ?? 0;
  return crewAlive(ac, aimer);
}

/**
 * Is crew member `i` alive? The pilot by `pilotKilled`; on types with explicit stations each
 * man by `crewWounds` (docs/sim.md "Gunners"), else the single `gunner` zone.
 */
export function crewAlive(ac: AircraftEntity, i: number): boolean {
  if (i === 0) return !ac.damage.pilotKilled;
  const cw = ac.spec.crewStations ? ac.damage.crewWounds : undefined;
  if (cw) return (cw[i] ?? 0) < 1;
  return ac.damage.zones.gunner < 1;
}

/** The armed stations of each gunner (crew members other than the pilot), by crew index. */
export function gunnersOf(ac: AircraftEntity): Map<number, CrewStation[]> {
  const out = new Map<number, CrewStation[]>();
  for (const s of crewStations(ac.spec)) {
    if (s.crewIndex === 0 || s.guns.length === 0 || s.arcs.length === 0) continue;
    out.set(s.crewIndex, [...(out.get(s.crewIndex) ?? []), s]);
  }
  return out;
}

/** Body-frame direction (unit) from `from` toward `p`. */
export function bodyDirection(from: AircraftEntity, p: Vector3, out = new Vector3()): Vector3 {
  out.copy(p).sub(from.state.position);
  return out.applyQuaternion(from.state.orientation.clone().invert()).normalize();
}

/** The first of `stations` whose field of fire holds body-frame direction `d`, if any. */
export function stationBearing(stations: readonly CrewStation[], d: Vector3): CrewStation | undefined {
  return stations.find((s) => inFireArcs(s.arcs, d.x, d.y, d.z));
}

const reachCache = new Map<string, number>();

/**
 * How far (m) from a target's centre a burst still does it real harm (a quarter of the
 * damage that destroys it): its larger half-size plus that blast distance for the charge
 * (src/sim blastDamage, docs/sim.md "Blast").
 */
export function blastReach(t: GroundTargetEntity, explosiveKg: number): number {
  const key = `${t.type}:${explosiveKg}`;
  let r = reachCache.get(key);
  if (r === undefined) {
    let d = 0;
    while (d < 100 && blastDamage(t.type, d, explosiveKg) >= 0.25) d += 0.5;
    const b = GROUND_TARGET_BOXES[t.type];
    r = Math.max(b.hx, b.hz) + d;
    reachCache.set(key, r);
  }
  return r;
}

/**
 * The target a formation leader aims his stick at. Each bomber of his formation releases on
 * his signal and passes a fixed distance to his side, so every candidate is scored by how
 * many of the formation's tracks then pass within blast reach of a live target
 * (`lateral`: each member's offset to the leader's right, m, his own 0 included), ties going
 * to the least correction off the current track.
 */
export function chooseAimTarget(
  targets: readonly GroundTargetEntity[],
  lateral: readonly number[],
  pos: Vector3,
  dir: Vector3,
  explosiveKg: number,
): GroundTargetEntity | null {
  const right = { x: -dir.z, z: dir.x };
  let best: GroundTargetEntity | null = null;
  let bestScore = -Infinity;
  for (const t of targets) {
    let score = 0;
    for (const off of lateral) {
      const tx = t.position.x + right.x * off;
      const tz = t.position.z + right.z * off;
      if (targets.some((u) => Math.abs((u.position.x - tx) * right.x + (u.position.z - tz) * right.z) < blastReach(u, explosiveKg) && Math.abs((u.position.x - t.position.x) * dir.x + (u.position.z - t.position.z) * dir.z) < 80)) score++;
    }
    // Less correction off the track wins a tie (at most 1 point: the angle in radians / pi).
    const hx = t.position.x - pos.x;
    const hz = t.position.z - pos.z;
    const off = Math.abs(Math.atan2(hx * right.x + hz * right.z, hx * dir.x + hz * dir.z)) / Math.PI;
    if (score - off > bestScore) {
      bestScore = score - off;
      best = t;
    }
  }
  return best;
}

/**
 * Candidate attack directions against a bomber, in its body frame (azimuth clockwise from the
 * nose, elevation above the wings, degrees): below and behind first, then below the beam,
 * then ahead and below. Most two-seaters and bombers can't depress a gun far below the tail
 * or the nose (src/data/crew.ts arcs).
 */
const BLIND_CANDIDATES: readonly (readonly [number, number])[] = [
  [180, -20], [160, -25], [-160, -25], [180, -35], [135, -35], [-135, -35], [110, -45], [-110, -45], [0, -30], [30, -30], [-30, -30],
];
/** Ahead of the beam costs this much more than astern: from below and behind he gets a long shot, not a head-on pass. */
const FRONT_PENALTY = 150 * DEG;

/**
 * The world direction from `target` in which an attacker is covered by the fewest of its live
 * gunners' fields of fire, preferring the one nearest the attacker's present bearing (and
 * astern of the beam, where he gets a long shot rather than a head-on pass). `covered` is
 * how many gunners bear there (0 = a true blind spot).
 */
export function blindSpot(target: AircraftEntity, attackerPos: Vector3, out = new Vector3()): { dir: Vector3; covered: number } {
  const gunners = [...gunnersOf(target)].filter(([i]) => crewAlive(target, i)).map(([, st]) => st);
  const now = bodyDirection(target, attackerPos, new Vector3());
  let best = -1;
  let bestCovered = Infinity;
  let bestCost = Infinity;
  const d = new Vector3();
  for (let k = 0; k < BLIND_CANDIDATES.length; k++) {
    const [az, el] = BLIND_CANDIDATES[k];
    bodyVector(az, el, d);
    let covered = 0;
    for (const st of gunners) if (stationBearing(st, d)) covered++;
    const cost = d.angleTo(now) + (Math.abs(az) < 90 ? FRONT_PENALTY : 0);
    if (covered < bestCovered || (covered === bestCovered && cost < bestCost)) {
      best = k;
      bestCovered = covered;
      bestCost = cost;
    }
  }
  const [az, el] = BLIND_CANDIDATES[Math.max(0, best)];
  bodyVector(az, el, out).applyQuaternion(target.state.orientation);
  return { dir: out, covered: bestCovered };
}

/** Body-frame unit vector for a FireArc azimuth and elevation (degrees). */
export function bodyVector(azDeg: number, elDeg: number, out = new Vector3()): Vector3 {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}

/** A bomber, for the fighters that meet it: its role, or bombs aboard. */
export function isBomber(ac: AircraftEntity): boolean {
  return ac.spec.role === 'bomber' || bombsAboard(ac) > 0;
}

/** Is `p` inside any live gunner's field of fire from `target`? */
export function inGunnersArcs(target: AircraftEntity, p: Vector3): boolean {
  const d = bodyDirection(target, p, new Vector3());
  for (const [i, st] of gunnersOf(target)) if (crewAlive(target, i) && stationBearing(st, d)) return true;
  return false;
}
