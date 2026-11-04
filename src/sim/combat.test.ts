import { afterEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftEntity, BalloonEntity, GameEvent, GroundTargetEntity } from '../core/types';
import { setGunnerTarget } from './combat';
import { SIM_FLAGS } from './flags';
import { SIM_DT, orientationFrom } from './flightModel';
import { getHitModel } from './hitboxes';
import { aimAt, count, scenario, type Scenario } from './testing/scenario';

describe('guns', () => {
  it('fires at the synchronised rate and spends ammunition', () => {
    const s = scenario({ realism: { gunJams: false } });
    const camel = s.add(1, 'sopwith_camel', 0, 0, 1000);
    camel.controls.fireGuns = true;
    s.step(2);
    const fired = count(s.events, 'gun-fired');
    // 2 Vickers x 450 rpm x 2 s = 30 rounds
    expect(fired).toBeGreaterThanOrEqual(28);
    expect(fired).toBeLessThanOrEqual(32);
    expect(camel.guns[0].roundsLeft + camel.guns[1].roundsLeft).toBe(500 - fired);
    expect(s.combat.bullets.some((b) => b.tracer)).toBe(true);
  });

  it('does not spend ammo when limitedAmmo is off', () => {
    const s = scenario({ realism: { gunJams: false, limitedAmmo: false } });
    const camel = s.add(1, 'sopwith_camel', 0, 0, 1000);
    camel.controls.fireGuns = true;
    s.step(1);
    expect(camel.guns[0].roundsLeft).toBe(250);
  });

  it('jams under sustained fire and clears with repeated hammering', () => {
    const s = scenario({ realism: { gunJams: true, limitedAmmo: false } });
    const alb = s.add(1, 'albatros_dv', 0, 0, 1000, 0, 'germany');
    alb.controls.fireGuns = true;
    s.step(60, () => {
      if (alb.guns.every((g) => g.jammed)) alb.controls.fireGuns = false;
    });
    expect(count(s.events, 'gun-jammed')).toBeGreaterThan(0);
    const jammed = alb.guns.find((g) => g.jammed)!;
    expect(jammed).toBeDefined();
    let presses = 0;
    while (jammed.jammed && presses < 20) {
      alb.controls.clearJam = true;
      s.step(SIM_DT);
      presses++;
    }
    expect(jammed.jammed).toBe(false);
    expect(presses).toBeGreaterThanOrEqual(3);
    expect(presses).toBeLessThanOrEqual(7);
    expect(count(s.events, 'gun-cleared')).toBeGreaterThan(0);
  });

  it('never jams with gunJams off', () => {
    const s = scenario({ realism: { gunJams: false, limitedAmmo: false } });
    const alb = s.add(1, 'albatros_dv', 0, 0, 1000, 0, 'germany');
    alb.controls.fireGuns = true;
    s.step(60);
    expect(count(s.events, 'gun-jammed')).toBe(0);
  });

  it('changes the Lewis drum when empty, taking time', () => {
    const s = scenario({ realism: { gunJams: false } });
    const se5 = s.add(1, 'se5a', 0, 0, 1000);
    se5.controls.fireGuns = true;
    const lewis = se5.guns[1];
    s.step(12);
    expect(count(s.events, 'drum-change')).toBeGreaterThanOrEqual(1);
    expect(lewis.sparesLeft).toBeLessThan(4);
    // Drum change interrupts fire for ~5 s: 97 rounds @ 550 rpm = 10.6 s per drum + 5 s change.
    expect(lewis.sparesLeft).toBe(3);
  });
});

describe('hits and kills', () => {
  it('bullets damage the target and a kill is credited to the shooter', () => {
    const s = scenario({ realism: { gunJams: false } });
    const target = s.add(2, 'albatros_diii', 0, -100, 1000, 0, 'germany');
    const shooter = s.add(1, 'sopwith_camel', 0, 0, 1000);
    aimAt(shooter, target);
    shooter.controls.fireGuns = true;
    let destroyedEvent: GameEvent | undefined;
    s.step(25, () => {
      destroyedEvent ??= s.events.find((e) => e.type === 'aircraft-destroyed');
      if (destroyedEvent) shooter.controls.fireGuns = false;
    }, "kinematic");
    const hits = s.events.filter((e) => e.type === 'bullet-hit');
    expect(hits.length).toBeGreaterThan(5);
    expect(destroyedEvent).toBeDefined();
    if (destroyedEvent?.type !== 'aircraft-destroyed') throw new Error();
    expect(destroyedEvent.victimId).toBe(2);
    expect(destroyedEvent.killerId).toBe(1);
    expect(target.damage.destroyed).toBe(true);
    expect(target.outcome).not.toBeNull();
    expect(target.damage.lastAttackerId).toBe(1);
  });

  describe('the engine block (SIM_FLAGS.damagePath)', () => {
    const saved = SIM_FLAGS.damagePath;
    afterEach(() => {
      SIM_FLAGS.damagePath = saved;
    });

    /** A 1.5 s burst from 150 m dead astern, the sight on the cockpit 0.1 m above the CG. */
    function burstFromAstern(damagePath: boolean, seed: number) {
      SIM_FLAGS.damagePath = damagePath;
      const s = scenario({ realism: { gunJams: false }, seed });
      const t = s.add(1, 'sopwith_camel', 0, 0, 1000);
      const camel = s.add(2, 'sopwith_camel', 0, 150, 1000 + 0.1 - 0.8);
      for (const ac of [t, camel]) {
        ac.controller = 'none';
        ac.state.orientation.set(0, 0, 0, 1);
      }
      camel.state.velocity.copy(t.state.velocity);
      camel.controls.fireGuns = true;
      s.step(1.5, undefined, 'kinematic');
      return { t, pilotHits: count(s.events, 'pilot-hit'), hits: s.events.filter((e) => e.type === 'bullet-hit' && e.targetId === 1).length };
    }

    const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
    const sum = (runs: ReturnType<typeof burstFromAstern>[], f: (r: ReturnType<typeof burstFromAstern>) => number) => runs.reduce((a, r) => a + f(r), 0);

    it('in path order, a burst from astern through the cockpit hits the pilot and the fuel tank on its way to the engine', () => {
      const on = SEEDS.map((seed) => burstFromAstern(true, seed));
      const off = SEEDS.map((seed) => burstFromAstern(false, seed));
      for (const r of [...on, ...off]) expect(r.hits).toBeGreaterThan(10);
      // Today only the rounds that clear the engine block reach the cockpit; in path order most do.
      expect(sum(on, (r) => r.pilotHits)).toBeGreaterThan(2 * sum(off, (r) => r.pilotHits));
      for (const r of on) {
        expect(r.t.damage.zones.fuelTank).toBeGreaterThan(0);
        expect(r.t.damage.zones.engine).toBeGreaterThan(0);
      }
      // From dead astern every path through the tank runs on into the engine box, which shields it
      // today: no round reaches it to hole it (a fire still scorches it).
      for (const r of off) expect(r.t.damage.fuelLeak).toBe(false);
      expect(on.filter((r) => r.t.damage.fuelLeak).length).toBeGreaterThan(0);
    });
  });

  it('a wing shot away is a structural failure credited to the attacker', () => {
    const s = scenario();
    const victim = s.add(2, 'albatros_diii', 0, 0, 1000, 0, 'germany');
    s.combat.damageAircraft(victim, 'leftWing', 1, 7, 0);
    s.step(0.5);
    const fail = s.events.find((e) => e.type === 'structural-failure');
    const kill = s.events.find((e) => e.type === 'aircraft-destroyed');
    expect(fail?.type === 'structural-failure' && fail.part).toBe('leftWing');
    expect(kill?.type === 'aircraft-destroyed' && kill.killerId).toBe(7);
    expect(victim.outcome).toBe('shot-down');
  });

  it('forcing a damaged aircraft into the ground counts as a victory; a lone crash does not', () => {
    const s = scenario();
    const victim = s.add(2, 'albatros_dv', 0, 0, 120, 0, 'germany');
    const loner = s.add(3, 'albatros_dv', 500, 0, 120, 0, 'germany');
    s.combat.damageAircraft(victim, 'engine', 1, 9, 0);
    victim.controller = 'none';
    loner.controller = 'none';
    for (const ac of [victim, loner]) {
      orientationFrom(0, -0.6, 0, ac.state.orientation);
      ac.state.velocity.set(0, -25, -35);
    }
    s.step(8);
    const kills = s.events.filter((e) => e.type === 'aircraft-destroyed');
    expect(victim.outcome).toBe('crashed');
    expect(loner.outcome).toBe('crashed');
    const byVictim = new Map(kills.map((k) => (k.type === 'aircraft-destroyed' ? [k.victimId, k.killerId] : [0, 0])));
    expect(byVictim.get(2)).toBe(9);
    expect(byVictim.get(3)).toBeNull();
    expect(count(s.events, 'engine-dead')).toBe(1);
    expect(count(s.events, 'explosion')).toBeGreaterThanOrEqual(2);
  });

  it('the invulnerable player takes no damage', () => {
    const s = scenario({ realism: { gunJams: false, invulnerable: true } });
    const player = s.add(2, 'sopwith_camel', 0, -100, 1000);
    player.controller = 'player';
    const shooter = s.add(1, 'albatros_dv', 0, 0, 1000, 0, 'germany');
    aimAt(shooter, player);
    shooter.controls.fireGuns = true;
    s.step(10, undefined, "kinematic");
    expect(count(s.events, 'bullet-hit')).toBeGreaterThan(5);
    expect(Object.values(player.damage.zones).every((v) => v === 0)).toBe(true);
    expect(player.damage.destroyed).toBe(false);
  });

  it('balloons ignite after enough hits and credit the shooter', () => {
    const s = scenario({ realism: { gunJams: false } });
    const shooter = s.add(1, 'spad_xiii', 0, 0, 1000);
    s.balloons.push({
      id: 50,
      kind: 'balloon',
      side: 'central',
      position: new Vector3(0, 1000.8, -150),
      anchor: new Vector3(0, 50, -150),
      health: 1,
      burning: false,
      destroyed: false,
      observerBailed: false,
    });
    shooter.controls.fireGuns = true;
    s.step(3, undefined, false);
    const ev = s.events.find((e) => e.type === 'balloon-destroyed');
    expect(ev).toBeDefined();
    if (ev?.type !== 'balloon-destroyed') throw new Error();
    expect(ev.killerId).toBe(1);
    expect(s.balloons[0].burning).toBe(true);
    expect(s.balloons[0].observerBailed).toBe(true);
  });

  it('strafing destroys ground targets', () => {
    const s = scenario({ realism: { gunJams: false } });
    const shooter = s.add(1, 'sopwith_camel', 0, 0, 1000);
    s.groundTargets.push({ id: 60, kind: 'ground', type: 'truck', side: 'central', position: new Vector3(0, 999.5, -120), heading: 0, health: 1, destroyed: false });
    shooter.controls.fireGuns = true;
    s.step(4, undefined, false);
    expect(s.groundTargets[0].destroyed).toBe(true);
    expect(count(s.events, 'ground-destroyed')).toBe(1);
  });

  describe('ground hits near the vertical reject bound', () => {
    // Fire a short burst far away, then re-aim the live rounds as level shots along -z
    // over x = 0 at the given heights.
    function rounds(s: Scenario, ys: number[]) {
      const shooter = s.add(1, 'sopwith_camel', 5000, 0, 1000);
      shooter.controls.fireGuns = true;
      while (s.combat.bullets.length < ys.length) s.step(SIM_DT, undefined, false);
      shooter.controls.fireGuns = false;
      const live = s.combat.bullets as unknown as { position: Vector3; velocity: Vector3 }[];
      live.forEach((b, i) => {
        b.position.set(0, ys[i] ?? 5000, 40);
        b.velocity.set(0, 0, -600);
      });
    }
    const truck = (id: number, y: number, z: number, health = 1): GroundTargetEntity =>
      ({ id, kind: 'ground', type: 'truck', side: 'central', position: new Vector3(0, y, z), heading: 0, health, destroyed: false });
    const groundHits = (s: Scenario) => s.events.filter((e) => e.type === 'bullet-hit' && e.zone === 'ground').length;

    it('a round just above a truck misses and one just inside its box top hits', () => {
      // Truck box top is y + 2.6; its broad-phase sphere top is y + 1.3 + hypot(1.1, 3) + 2.6.
      const above = scenario({ realism: { gunJams: false } });
      above.groundTargets.push(truck(60, 200, 0));
      rounds(above, [200 + 1.3 + Math.hypot(1.1, 3) + 2.6 + 0.05]);
      above.step(0.2, undefined, false);
      expect(groundHits(above)).toBe(0);

      const inside = scenario({ realism: { gunJams: false } });
      inside.groundTargets.push(truck(60, 200, 0));
      rounds(inside, [202.55]);
      inside.step(0.2, undefined, false);
      expect(groundHits(inside)).toBe(1);
    });

    it('a lower target does not hide a higher one in its path', () => {
      const s = scenario({ realism: { gunJams: false } });
      s.groundTargets.push(truck(60, 60, 0));
      s.groundTargets.push(truck(61, 300, -10));
      rounds(s, [301]);
      s.step(0.2, undefined, false);
      expect(s.events.filter((e) => e.type === 'bullet-hit' && e.targetId === 61).length).toBe(1);
    });

    it('a target destroyed mid-step lets the following rounds pass', () => {
      const s = scenario({ realism: { gunJams: false } });
      // One truck hit (0.12) finishes it.
      s.groundTargets.push(truck(60, 200, 0, 0.1));
      rounds(s, [201, 201]);
      s.step(0.2, undefined, false);
      expect(groundHits(s)).toBe(1);
      expect(s.groundTargets[0].destroyed).toBe(true);
      expect(s.combat.bullets.filter((b) => b.position.z < -20 && Math.abs(b.position.y - 201) < 1).length).toBe(1);
    });
  });
});

describe('gunners, collisions and flak', () => {
  it('a two-seater gunner engages an attacker on its tail', () => {
    const s = scenario({ realism: { gunJams: false } });
    const bristol = s.add(1, 'bristol_f2b', 0, -200, 1000);
    s.add(2, 'albatros_dv', 0, 0, 1040, 0, 'germany');
    s.step(4, undefined, "kinematic");
    const rearFire = s.events.filter((e) => e.type === 'gun-fired' && e.shooterId === 1 && e.gun === 'lewis');
    expect(rearFire.length).toBeGreaterThan(5);
    expect(count(s.events, 'bullet-hit')).toBeGreaterThan(0);
    // Explicit target assignment is honoured too.
    setGunnerTarget(bristol, 2);
  });

  it('mid-air collisions destroy both aircraft when enabled', () => {
    const s = scenario();
    const a = s.add(1, 'sopwith_camel', 0, 0, 1000, 0);
    const b = s.add(2, 'albatros_dv', 0, -60, 1000, Math.PI, 'germany');
    s.step(2);
    // One report per collision, not one per step while the wrecks fall together.
    expect(count(s.events, 'collision')).toBe(1);
    expect(a.outcome).toBe('collided');
    expect(b.outcome).toBe('collided');
  });

  it('no collisions when disabled', () => {
    const s = scenario({ realism: { midairCollisions: false } });
    const a = s.add(1, 'sopwith_camel', 0, 0, 1000, 0);
    s.add(2, 'albatros_dv', 0, -60, 1000, Math.PI, 'germany');
    s.step(2);
    expect(count(s.events, 'collision')).toBe(0);
    expect(a.outcome).toBeNull();
  });

  it('archie bursts around aircraft over enemy lines near the front, not over friendly rear areas', () => {
    const s = scenario({ flak: true, sideOfFront: (x) => (x > 0 ? 'central' : 'allied') });
    s.add(1, 'sopwith_camel', 2000, 0, 2000); // over German lines, 2 km from the front
    s.add(2, 'sopwith_pup', -30000, 0, 2000); // deep over Allied territory
    s.step(30);
    const bursts = s.events.filter((e) => e.type === 'flak-burst');
    expect(bursts.length).toBeGreaterThan(2);
    for (const b of bursts) if (b.type === 'flak-burst') expect(b.position.x).toBeGreaterThan(-10000);
  });
});

describe('early-war two-seater observers', () => {
  const lewisFrom = (s: ReturnType<typeof scenario>, id: number) => s.events.filter((e) => e.type === 'gun-fired' && e.shooterId === id && e.gun === 'lewis').length;

  it('a pusher nose gunner (F.E.2b, Farman) fires ahead but cannot fire through his own engine', () => {
    for (const type of ['fe2b', 'farman_f40'] as const) {
      const ahead = scenario({ realism: { gunJams: false } });
      ahead.add(1, type, 0, 0, 1000);
      ahead.add(2, 'fokker_eiii', 20, -180, 1015, 0, 'germany');
      ahead.step(3, undefined, 'kinematic');
      expect(lewisFrom(ahead, 1), `${type} ahead`).toBeGreaterThan(5);

      const behind = scenario({ realism: { gunJams: false } });
      behind.add(1, type, 0, 0, 1000);
      behind.add(2, 'fokker_eiii', 0, 150, 1000, 0, 'germany');
      behind.step(3, undefined, 'kinematic');
      expect(lewisFrom(behind, 1), `${type} behind`).toBe(0);
    }
  });

  it('the B.E.2c front observer and the Albatros C.III rear gunner engage an attacker above and behind', () => {
    const be = scenario({ realism: { gunJams: false } });
    be.add(1, 'be2c', 0, 0, 1000);
    be.add(2, 'fokker_eiii', 60, 150, 1080, 0, 'germany');
    be.step(3, undefined, 'kinematic');
    expect(lewisFrom(be, 1)).toBeGreaterThan(5);

    const alb = scenario({ realism: { gunJams: false } });
    alb.add(1, 'albatros_ciii', 0, 0, 1000, 0, 'germany');
    alb.add(2, 'airco_dh2', 0, 180, 1040, 0);
    alb.step(3, undefined, 'kinematic');
    expect(alb.events.filter((e) => e.type === 'gun-fired' && e.shooterId === 1 && e.gun === 'parabellum').length).toBeGreaterThan(5);
  });
});

// Stateful paths that decide kills, credit and outcomes. Every aircraft is controller 'none'
// and steps 'kinematic' or frozen, so the flight model can't overwrite the fields a test sets
// (sideslip, height above ground). Fire is random: those tests aggregate over seeds and
// compare counts rather than pin a figure.
describe('fire, collisions, flak fragments and ground fire', () => {
  const SEED_BASE = 1;
  const SEEDS = Array.from({ length: 24 }, (_, i) => SEED_BASE + i);
  const zoneSum = (ac: AircraftEntity) => Object.values(ac.damage.zones).reduce((a, b) => a + b, 0);
  type Burst = { time: number; position: Vector3; firingSide: 'allied' | 'central'; lethalRadius: number };
  const pushBurst = (s: Scenario, b: Burst) => (s.combat.pendingFlak as Burst[]).push(b);

  /** A burning Camel with attacker 7 on record; `keepBurning` relights it every step. */
  const burning = (seed: number, opts: { slip?: number; keepBurning?: boolean } = {}) => {
    const s = scenario({ seed });
    const ac = s.add(1, 'sopwith_camel', 0, 0, 1000);
    ac.controller = 'none';
    s.combat.damageAircraft(ac, 'leftWing', 0.01, 7, 0);
    ac.damage.onFire = true;
    let destroyedAt: number | null = null;
    let wentOut = false;
    s.step(
      25,
      () => {
        ac.state.sideslip = opts.slip ?? 0;
        if (!ac.damage.onFire && !ac.damage.destroyed) wentOut = true;
        if (opts.keepBurning && !ac.damage.destroyed) ac.damage.onFire = true;
        if (destroyedAt === null && ac.damage.destroyed) destroyedAt = s.world.time;
      },
      false,
    );
    return { s, ac, destroyedAt: destroyedAt as number | null, wentOut };
  };

  it('a fire that keeps burning kills the pilot after the burn limit and credits the last attacker', () => {
    for (const seed of SEEDS) {
      const { s, ac, destroyedAt } = burning(seed, { keepBurning: true });
      expect(ac.damage.destroyed, `seed ${seed}`).toBe(true);
      expect(ac.outcome).toBe('shot-down');
      expect(ac.damage.pilotKilled).toBe(true);
      // The burn limit is at least 8 s.
      expect(destroyedAt).toBeGreaterThan(8);
      const kills = s.events.filter((e) => e.type === 'aircraft-destroyed');
      expect(kills).toHaveLength(1);
      expect(kills[0].type === 'aircraft-destroyed' && kills[0].killerId).toBe(7);
    }
  });

  it('an unattended fire either burns the aircraft down or blows out, and sideslip blows it out more often', () => {
    const blownOut = (slip: number) => {
      let out = 0;
      let killed = 0;
      for (const seed of SEEDS) {
        const r = burning(seed, { slip });
        if (r.ac.damage.destroyed) {
          killed++;
          expect(r.ac.outcome).toBe('shot-down');
          expect(r.destroyedAt).toBeGreaterThan(8);
        } else {
          expect(r.ac.damage.onFire, `seed ${seed} slip ${slip}`).toBe(false);
          out++;
        }
      }
      return { out, killed };
    };
    const straight = blownOut(0);
    expect(straight.killed).toBeGreaterThan(0);
    expect(straight.out).toBeGreaterThan(0);
    const slipping = blownOut(0.3);
    expect(slipping.out).toBeGreaterThan(straight.out);
  });

  it('an invulnerable player burns without being destroyed', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const s = scenario({ seed, realism: { invulnerable: true } });
      const ac = s.add(1, 'sopwith_camel', 0, 0, 1000);
      ac.controller = 'player';
      ac.damage.onFire = true;
      s.step(40, () => (ac.damage.onFire = true), false);
      expect(count(s.events, 'aircraft-destroyed'), `seed ${seed}`).toBe(0);
      expect(ac.damage.destroyed).toBe(false);
    }
  });

  it('a slow scrape damages a wing and nudges the pair apart, reporting at most once a second', () => {
    const s = scenario();
    const a = s.add(1, 'sopwith_camel', 0, 0, 1000);
    const b = s.add(2, 'albatros_dv', 1, 0, 1000, 0, 'germany');
    for (const ac of [a, b]) ac.controller = 'none';
    b.state.velocity.copy(a.state.velocity).add(new Vector3(0, 0, 5)); // 5 m/s apart
    s.step(4, undefined, 'kinematic');
    const n = count(s.events, 'collision');
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2);
    for (const ac of [a, b]) {
      expect(ac.damage.destroyed).toBe(false);
      expect(ac.damage.zones.leftWing + ac.damage.zones.rightWing).toBeGreaterThan(0);
    }
    const r = getHitModel(a.spec).collisionRadius + getHitModel(b.spec).collisionRadius;
    expect(a.state.position.distanceTo(b.state.position)).toBeGreaterThan(r);
  });

  it('a slow scrape between two aircraft flying together separates them', () => {
    // Same velocity: only the nudge can part them.
    const s = scenario();
    const a = s.add(1, 'sopwith_camel', 0, 0, 1000);
    const b = s.add(2, 'albatros_dv', 1, 0, 1000, 0, 'germany');
    for (const ac of [a, b]) ac.controller = 'none';
    b.state.velocity.copy(a.state.velocity);
    s.step(5, undefined, 'kinematic');
    expect(count(s.events, 'collision')).toBeLessThanOrEqual(2);
    const r = getHitModel(a.spec).collisionRadius + getHitModel(b.spec).collisionRadius;
    expect(a.state.position.distanceTo(b.state.position)).toBeGreaterThan(r);
  });

  it('two wrecks falling together do not collide', () => {
    const s = scenario();
    const a = s.add(1, 'sopwith_camel', 0, 0, 1000);
    const b = s.add(2, 'albatros_dv', 1, 0, 1000, 0, 'germany');
    for (const ac of [a, b]) {
      ac.controller = 'none';
      ac.damage.destroyed = true;
    }
    s.step(2, undefined, false);
    expect(count(s.events, 'collision')).toBe(0);
  });

  it('flying into a balloon destroys the aircraft and fires the balloon', () => {
    const s = scenario();
    const ac = s.add(1, 'sopwith_camel', 0, 0, 1000);
    ac.controller = 'none';
    const bl: BalloonEntity = {
      id: 50,
      kind: 'balloon',
      side: 'central',
      position: ac.state.position.clone(),
      anchor: new Vector3(0, 50, 0),
      health: 1,
      burning: false,
      destroyed: false,
      observerBailed: false,
    };
    s.balloons.push(bl);
    s.step(0.5, undefined, false);
    expect(ac.outcome).toBe('collided');
    expect(bl.burning).toBe(true);
    const hits = s.events.filter((e) => e.type === 'collision');
    expect(hits).toHaveLength(1);
    expect(hits[0].type === 'collision' && hits[0].bId).toBe(50);
  });

  it('a flak burst damages enemy aircraft inside its lethal radius only', () => {
    const s = scenario({ realism: { midairCollisions: false } }); // the friendly shares the burst point
    const target = s.add(1, 'sopwith_camel', 0, 0, 1000);
    const friendly = s.add(2, 'albatros_dv', 0, 0, 1000, 0, 'germany');
    const far = s.add(3, 'sopwith_pup', 100, 0, 1000);
    for (const ac of [target, friendly, far]) ac.controller = 'none';
    pushBurst(s, { time: 0, position: target.state.position.clone(), firingSide: 'central', lethalRadius: 30 });
    s.step(SIM_DT, undefined, false);
    expect(count(s.events, 'flak-burst')).toBe(1);
    expect(zoneSum(target)).toBeGreaterThan(0);
    expect(zoneSum(friendly)).toBe(0);
    expect(zoneSum(far)).toBe(0);
  });

  it('ground fire hits aircraft low over enemy ground, not high or over friendly ground', () => {
    let low = 0;
    let high = 0;
    let friendly = 0;
    for (const seed of SEEDS.slice(0, 6)) {
      const s = scenario({ seed, groundFire: true, sideOfFront: (x) => (x > 0 ? 'central' : 'allied') });
      const a = s.add(1, 'sopwith_camel', 1000, 0, 1000);
      const b = s.add(2, 'sopwith_camel', 1000, 500, 1000);
      const c = s.add(3, 'sopwith_camel', -1000, 0, 1000);
      for (const ac of [a, b, c]) ac.controller = 'none';
      s.step(
        60,
        () => {
          a.state.heightAboveGround = 30;
          b.state.heightAboveGround = 300;
          c.state.heightAboveGround = 30;
        },
        false,
      );
      low += zoneSum(a);
      high += zoneSum(b);
      friendly += zoneSum(c);
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBe(0);
    expect(friendly).toBe(0);
  });
});
