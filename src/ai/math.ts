/**
 * Small vector/angle helpers and a deterministic RNG for the AI.
 * Frames follow DECISIONS.md D-004: world +X east, +Y up, -Z north;
 * body forward -Z, up +Y, right +X.
 */
import { Quaternion, Vector3 } from 'three';

export const G = 9.81;
export const WORLD_UP: Readonly<Vector3> = new Vector3(0, 1, 0);
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export function forwardOf(q: Quaternion, out = new Vector3()): Vector3 {
  return out.set(0, 0, -1).applyQuaternion(q);
}

export function upOf(q: Quaternion, out = new Vector3()): Vector3 {
  return out.set(0, 1, 0).applyQuaternion(q);
}

export function rightOf(q: Quaternion, out = new Vector3()): Vector3 {
  return out.set(1, 0, 0).applyQuaternion(q);
}

/** Heading (0 = north, clockwise) of a world-frame direction. */
export function headingOf(v: Vector3): number {
  const h = Math.atan2(v.x, -v.z);
  return h < 0 ? h + 2 * Math.PI : h;
}

/** Unit horizontal direction for a heading. */
export function dirFromHeading(h: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(h), 0, -Math.cos(h));
}

/** Angle between two vectors (radians), safe for zero-length input. */
export function angleBetween(a: Vector3, b: Vector3): number {
  const la = a.length();
  const lb = b.length();
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(clamp(a.dot(b) / (la * lb), -1, 1));
}

/** Mulberry32: small deterministic PRNG so scenarios are reproducible. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
