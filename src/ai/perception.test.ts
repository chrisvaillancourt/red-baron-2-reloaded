import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { Weather } from '../core/types';
import { CloudField } from '../world/clouds';
import { DEG } from './math';
import { glareFactor, likelySpottedBy, Perception, sightFactor, sunAngle } from './perception';
import { makeSkillProfile } from './skill';
import { makeAircraft, TestWorld } from './testing/testWorld';

const SUN_E30 = new Vector3(Math.cos(30 * DEG), Math.sin(30 * DEG), 0); // east, 30° up
const NO_CHECK_SIX = () => 0.99;
const EAST = Math.PI / 2;

/** An observer at 2 km heading east and an enemy `r` metres away along `dir`. */
function pair(world: TestWorld, r: number, dir: Vector3, observerSkill = 0.35) {
  const self = makeAircraft({ side: 'allied', x: 0, z: 0, alt: 2000, heading: EAST });
  const p = dir.clone().normalize().multiplyScalar(r).add(self.state.position);
  const enemy = makeAircraft({ side: 'central', x: p.x, z: p.z, alt: p.y, heading: -EAST });
  world.aircraft.push(self, enemy);
  const per = new Perception(makeSkillProfile(observerSkill), self);
  return { self, enemy, per };
}

function spotted(r: number, dir: Vector3, t: number, sun?: Vector3, weather?: Weather): boolean {
  const world = new TestWorld({ sunDirection: sun, weather });
  const { enemy, self, per } = pair(world, r, dir, t);
  per.sweep(self, world, NO_CHECK_SIX);
  return per.contact(enemy.id)?.visible ?? false;
}

describe('sun glare', () => {
  it('shortens spotting range close to the sun, less for aces', () => {
    // Out of the sun, a regular (3.4 km) and an ace (5 km) see a 2 km enemy.
    expect(spotted(2000, SUN_E30, 0.35)).toBe(true);
    expect(spotted(2000, SUN_E30, 1)).toBe(true);
    // Straight out of the sun: the regular's range drops to ~0.18 × 3.4 km, the ace's to 0.3 × 5 km.
    expect(spotted(2000, SUN_E30, 0.35, SUN_E30)).toBe(false);
    expect(spotted(2000, SUN_E30, 1, SUN_E30)).toBe(false);
    expect(spotted(1200, SUN_E30, 1, SUN_E30)).toBe(true);
    expect(spotted(1200, SUN_E30, 0.35, SUN_E30)).toBe(false);
    expect(spotted(500, SUN_E30, 0.35, SUN_E30)).toBe(true);
  });

  it('fades out 15° from the sun and with the sun near the horizon', () => {
    const off20 = SUN_E30.clone().applyAxisAngle(new Vector3(0, 1, 0), 20 * DEG);
    expect(spotted(2000, off20, 0.35, SUN_E30)).toBe(true);
    const low = new Vector3(Math.cos(1 * DEG), Math.sin(1 * DEG), 0);
    expect(spotted(2000, low, 0.35, low)).toBe(true);
    expect(glareFactor(0, 1, 0)).toBeCloseTo(0.12);
    expect(glareFactor(0, 1, 1)).toBeCloseTo(0.3);
    expect(glareFactor(10 * DEG, 1, 0)).toBeGreaterThan(0.12);
    expect(glareFactor(10 * DEG, 1, 0)).toBeLessThan(1);
    expect(glareFactor(16 * DEG, 1, 0)).toBe(1);
  });

  it('measures the angle to the sun, Infinity with no sun or a set sun', () => {
    const w = new TestWorld({ sunDirection: SUN_E30 });
    const o = new Vector3(0, 1000, 0);
    expect(sunAngle(o, o.clone().add(SUN_E30), w)).toBeCloseTo(0);
    expect(sunAngle(o, o.clone().add(new Vector3(0, 1, 0)), w)).toBeCloseTo(60 * DEG);
    expect(sunAngle(o, o.clone().add(SUN_E30), new TestWorld())).toBe(Infinity);
    expect(sunAngle(o, o.clone().add(SUN_E30), new TestWorld({ sunDirection: new Vector3(1, -0.1, 0).normalize() }))).toBe(Infinity);
  });

  it('is gone when the observer is under a solid overcast', () => {
    const overcast: Weather = { cloudCover: 0.95, cloudBaseM: 2600, cloudTopM: 3400, wind: [0, 0, 0], visibilityM: 20_000, turbulence: 0 };
    // 1.2 km out of the sun, both below the deck (2 km + 600 m = 2.6 km: just under it).
    const dir = new Vector3(Math.cos(20 * DEG), Math.sin(20 * DEG), 0);
    expect(spotted(1500, dir, 0.35, dir)).toBe(false);
    expect(spotted(1500, dir, 0.35, dir, overcast)).toBe(true);
  });
});

const CUMULUS: Weather = { cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 2300, wind: [0, 0, 0], visibilityM: 25_000, turbulence: 0 };

/** A cloud core big enough to hide in near the origin, in world coordinates at t = 0. */
function aCloud() {
  const c = new CloudField(CUMULUS).nearestCloud(0, 1800, 0, 0, 12_000);
  if (!c) throw new Error('no cloud');
  return c;
}

describe('cloud line of sight and memory', () => {
  it('loses an enemy behind a cloud, then forgets it after `memory` s', () => {
    const c = aCloud();
    const world = new TestWorld({ weather: CUMULUS });
    const profile = makeSkillProfile(0.35);
    // Observer 2.5 radii west of the core, enemy east of it at the same height.
    const self = makeAircraft({ side: 'allied', x: c.x - c.radius * 2.5, z: c.z, alt: c.y, heading: EAST });
    // A clear line of sight within a regular's range, for before and after.
    const field = new CloudField(CUMULUS);
    const sx = c.x - c.radius * 2.5;
    let clear: Vector3 | null = null;
    for (let k = 0; k < 72 && !clear; k++) {
      const a = (k / 72) * Math.PI * 2;
      const q = new Vector3(sx + Math.cos(a) * 2500, c.y, c.z + Math.sin(a) * 2500);
      if (field.transmittance(sx, c.y, c.z, q.x, q.y, q.z, 0) === 1) clear = q;
    }
    if (!clear) throw new Error('no clear line of sight');
    const enemy = makeAircraft({ side: 'central', x: clear.x, z: clear.z, alt: clear.y, heading: -EAST });
    world.aircraft.push(self, enemy);
    const per = new Perception(profile, self);
    // In clear air: seen.
    per.sweep(self, world, NO_CHECK_SIX);
    expect(per.contact(enemy.id)?.visible).toBe(true);
    const seenAt = per.contact(enemy.id)!.position.clone();
    // It slips behind the cloud.
    enemy.state.position.set(c.x + c.radius * 2.5, c.y, c.z);
    for (let t = 1; t <= 2; t++) {
      world.time = t;
      per.sweep(self, world, NO_CHECK_SIX);
    }
    const ct = per.contact(enemy.id);
    expect(ct).toBeDefined();
    expect(ct!.visible).toBe(false);
    expect(ct!.position.distanceTo(seenAt)).toBe(0);
    expect(per.knownEnemies(world)).toContain(enemy);
    // Past memory: forgotten.
    world.time = profile.memory + 1;
    per.sweep(self, world, NO_CHECK_SIX);
    expect(per.contact(enemy.id)).toBeUndefined();
    expect(per.knownEnemies(world)).not.toContain(enemy);
    // It comes out of the cloud: seen again.
    enemy.state.position.copy(clear);
    world.time += 2;
    per.sweep(self, world, NO_CHECK_SIX);
    expect(per.contact(enemy.id)?.visible).toBe(true);
  });

  it('scales sight by the light that gets through', () => {
    const c = aCloud();
    const world = new TestWorld({ weather: CUMULUS });
    const a = makeAircraft({ side: 'allied', x: c.x - c.radius * 2.5, z: c.z, alt: c.y, heading: EAST });
    const b = makeAircraft({ side: 'central', x: c.x + c.radius * 2.5, z: c.z, alt: c.y, heading: -EAST });
    expect(sightFactor(a, b, world, 0.5)).toBeLessThan(0.05);
    b.state.position.y = c.y + 2000; // well above the tops
    a.state.position.y = c.y + 2000;
    expect(sightFactor(a, b, world, 0.5)).toBe(1);
  });

  it('notice() without an entity fills in the position from the world', () => {
    const world = new TestWorld();
    const { enemy, per } = pair(world, 3000, new Vector3(-1, 0, 0)); // dead astern
    per.notice(enemy.id, 0);
    expect(per.contact(enemy.id)?.visible).toBe(true);
    expect(per.knownEnemies(world)).toContain(enemy);
    expect(per.contact(enemy.id)!.position.distanceTo(enemy.state.position)).toBe(0);
  });
});

describe('likelySpottedBy', () => {
  it('estimates what the player can see: ahead yes, low astern or in the sun no', () => {
    const world = new TestWorld({ sunDirection: SUN_E30 });
    const player = makeAircraft({ side: 'allied', x: 0, z: 0, alt: 2000, heading: EAST, controller: 'player' });
    world.aircraft.push(player);
    const at = (dir: Vector3, r: number) => {
      const p = dir.clone().normalize().multiplyScalar(r).add(player.state.position);
      return makeAircraft({ side: 'central', x: p.x, z: p.z, alt: p.y, heading: -EAST });
    };
    expect(likelySpottedBy(at(new Vector3(1, 0.1, 0.3), 2500), player, world)).toBe(true);
    expect(likelySpottedBy(at(new Vector3(-1, -0.3, 0), 1000), player, world)).toBe(false); // low astern
    expect(likelySpottedBy(at(new Vector3(-1, -0.3, 0), 300), player, world)).toBe(true); // too close to miss
    expect(likelySpottedBy(at(SUN_E30, 2500), player, world)).toBe(false); // out of the sun
    expect(likelySpottedBy(at(new Vector3(1, 0.1, 0.3), 6000), player, world)).toBe(false); // too far
  });

  it('trusts an AI watcher’s real contacts', () => {
    const world = new TestWorld();
    const { self: watcher, enemy: stalker, per } = pair(world, 4500, new Vector3(1, 0.05, 0), 0.35);
    // 4.5 km is past a regular's 3.4 km: not seen and not about to be.
    expect(likelySpottedBy(stalker, watcher, world)).toBe(false);
    per.notice(stalker.id, 0, stalker);
    expect(likelySpottedBy(stalker, watcher, world)).toBe(true);
  });
});

// ---- cost ---------------------------------------------------------------------

const PERF_STRICT = typeof process !== 'undefined' && !!process.env.PERF_STRICT;

describe('perception cost', () => {
  it('a full 16-aircraft sweep round in cumulus with the sun up stays cheap', () => {
    const world = new TestWorld({ weather: CUMULUS, sunDirection: SUN_E30 });
    const pers: Perception[] = [];
    for (let i = 0; i < 16; i++) {
      const side = i < 8 ? 'allied' : 'central';
      // A furball spread over 3 km inside the cloud band.
      const ac = makeAircraft({ side, x: (i % 4) * 900 - 1300, z: Math.floor(i / 4) * 800 - 1200, alt: 1600 + (i % 5) * 150, heading: (i * 1.3) % 6.28 });
      world.aircraft.push(ac);
      pers.push(new Perception(makeSkillProfile(1), ac));
    }
    const rng = () => 0.99;
    const round = () => {
      world.time += 1; // every perception sweeps
      for (let i = 0; i < 16; i++) pers[i].sweep(world.aircraft[i], world, rng);
    };
    for (let i = 0; i < 20; i++) round(); // warm-up
    const times: number[] = [];
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) round();
      times.push((performance.now() - t0) / 20);
    }
    times.sort((a, b) => a - b);
    const ms = times[3];
    const budget = 1.5; // ms for 16 sweeps (256 pairs); an aircraft sweeps every 0.2-0.9 s
    console.info(`[perf] perception round, 16 aircraft in cumulus: ${(ms * 1000).toFixed(0)} µs (budget ${budget * 1000} µs${PERF_STRICT ? ', strict' : ', 3x headroom'})`);
    expect(ms).toBeLessThan(PERF_STRICT ? budget : budget * 3);
  }, 60_000); // ~70 ms of work locally; slow CI runners need headroom over Vitest's 5 s default
});
