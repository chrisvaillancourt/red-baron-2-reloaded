import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AircraftEntity, GameEvent } from '../core/types';
import { aimFlexibleGun, getGunnerTarget, setGunnerTarget } from './combat';
import { SIM_DT } from './flightModel';
import { TEST_TWIN } from './testing/fixtures';
import { scenario, type Scenario } from './testing/scenario';

type Fired = Extract<GameEvent, { type: 'gun-fired' }>;
const firedBy = (s: Scenario, id: number, mount?: number) =>
  s.events.filter((e): e is Fired => e.type === 'gun-fired' && e.shooterId === id && (mount === undefined || e.mountIndex === mount));

/** The twin flying north at 1000 m, with enemies (kinematic, same velocity) at fixed offsets. */
function twinWith(offsets: [number, number, number][], opts: { seed?: number } = {}) {
  const s = scenario({ realism: { gunJams: false }, seed: opts.seed });
  const twin = s.add(1, TEST_TWIN, 0, 0, 1000);
  const enemies = offsets.map(([x, y, z], i) => s.add(10 + i, 'sopwith_camel', x, z, 1000 + y));
  return { s, twin, enemies };
}

const AHEAD: [number, number, number] = [0, 10, -220];
const ABOVE_BEHIND: [number, number, number] = [0, 80, 200];
const BELOW_BEHIND: [number, number, number] = [0, -80, 190];

describe('crew stations: AI gunners', () => {
  it('fires every flexible gun from its own station, each only into its own arcs', () => {
    const ahead = twinWith([AHEAD]);
    ahead.s.step(3, undefined, 'kinematic');
    expect(firedBy(ahead.s, 1, 0).length).toBeGreaterThan(5);
    expect(firedBy(ahead.s, 1, 1).length + firedBy(ahead.s, 1, 2).length).toBe(0);

    const above = twinWith([ABOVE_BEHIND]);
    above.s.step(3, undefined, 'kinematic');
    expect(firedBy(above.s, 1, 1).length).toBeGreaterThan(5);
    expect(firedBy(above.s, 1, 0).length + firedBy(above.s, 1, 2).length).toBe(0);

    const below = twinWith([BELOW_BEHIND]);
    below.s.step(3, undefined, 'kinematic');
    expect(firedBy(below.s, 1, 2).length).toBeGreaterThan(5);
    expect(firedBy(below.s, 1, 0).length + firedBy(below.s, 1, 1).length).toBe(0);
  });

  it('gunners who are different men fire at the same time; one man works one station at a time', () => {
    const { s, enemies } = twinWith([AHEAD, BELOW_BEHIND, ABOVE_BEHIND]);
    const perStep: Set<number>[] = [];
    let seen = 0;
    s.step(6, () => {
      const now = new Set<number>();
      for (const e of s.events.slice(seen)) if (e.type === 'gun-fired' && e.shooterId === 1) now.add(e.mountIndex!);
      seen = s.events.length;
      perStep.push(now);
      // The tunnel target goes down at 3 s: the rear gunner must move up to the dorsal ring.
      if (Math.abs(s.world.time - 3) < SIM_DT / 2) {
        enemies[1].damage.destroyed = true;
        enemies[1].outcome = 'shot-down';
      }
    }, 'kinematic');
    // Nose and rear gunner overlap in time.
    const windows = (m: number) => perStep.map((set, i) => (set.has(m) ? Math.floor(i / 60) : -1)).filter((w) => w >= 0);
    const noseW = new Set(windows(0));
    expect([...new Set([...windows(1), ...windows(2)])].some((w) => noseW.has(w))).toBe(true);
    // The rear gunner never fires dorsal and ventral in the same step.
    expect(perStep.some((set) => set.has(1) && set.has(2))).toBe(false);
    // He fired the tunnel gun first, then moved to the ring, with a pause between.
    const lastVentral = perStep.map((set, i) => (set.has(2) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const firstDorsal = perStep.findIndex((set) => set.has(1));
    expect(lastVentral).toBeGreaterThan(0);
    expect(firstDorsal).toBeGreaterThan(lastVentral);
    expect((firstDorsal - lastVentral) * SIM_DT).toBeGreaterThan(0.4);
  });

  it('a killed gunner stops; his crewmates keep firing', () => {
    const { s, twin } = twinWith([AHEAD, ABOVE_BEHIND]);
    s.step(SIM_DT, undefined, 'kinematic');
    expect(twin.damage.crewWounds).toHaveLength(3);
    twin.damage.crewWounds![2] = 1;
    const before = s.events.length;
    s.step(3, undefined, 'kinematic');
    const after = s.events.slice(before).filter((e): e is Fired => e.type === 'gun-fired' && e.shooterId === 1);
    expect(after.filter((e) => e.mountIndex === 0).length).toBeGreaterThan(5);
    expect(after.filter((e) => e.mountIndex === 1 || e.mountIndex === 2).length).toBe(0);
  });

  it('gunner hits wound one crew member, and the gunner zone holds the worst', () => {
    const { s, twin } = twinWith([]);
    s.step(SIM_DT, undefined, 'kinematic');
    for (let i = 0; i < 40 && twin.damage.crewWounds![1] < 1; i++) s.combat.damageAircraft(twin, 'gunner', 0.34, 5, 0, 1);
    expect(twin.damage.crewWounds![1]).toBe(1);
    expect(twin.damage.crewWounds![2]).toBe(0);
    expect(twin.damage.zones.gunner).toBe(1);
  });

  it('two-seaters without explicit stations keep the gunner zone', () => {
    const s = scenario({ realism: { gunJams: false } });
    const bristol = s.add(1, 'bristol_f2b', 0, -200, 1000);
    s.add(2, 'albatros_dv', 0, 0, 1040, 0, 'germany');
    s.step(SIM_DT, undefined, 'kinematic');
    expect(bristol.damage.crewWounds).toBeUndefined();
    bristol.damage.zones.gunner = 1;
    const before = firedBy(s, 1).length;
    s.step(3, undefined, 'kinematic');
    expect(firedBy(s, 1).length).toBe(before);
  });

  it('setGunnerTarget assigns every gunner, or one station with the third argument', () => {
    const { s, twin, enemies } = twinWith([AHEAD, [30, 20, -260]]);
    // The nose gunner is told to take the far fighter; with no override he'd take the nearer.
    setGunnerTarget(twin, enemies[1].id, 'nose');
    expect(getGunnerTarget(twin, 'nose')).toBe(enemies[1].id);
    expect(getGunnerTarget(twin)).toBeNull();
    s.step(2, undefined, 'kinematic');
    const hits = s.events.filter((e) => e.type === 'bullet-hit' && e.shooterId === 1);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => e.type === 'bullet-hit' && e.targetId === enemies[1].id)).toBe(true);
    setGunnerTarget(twin, null, 'nose');
    setGunnerTarget(twin, enemies[0].id);
    expect(getGunnerTarget(twin, 'nose')).toBe(enemies[0].id);
  });

  it('aimFlexibleGun tests the gun station arcs', () => {
    const { twin } = twinWith([]);
    const p = twin.state.position;
    expect(aimFlexibleGun(twin, 2, p.clone().add(new Vector3(0, -60, 200))).inArc).toBe(true);
    expect(aimFlexibleGun(twin, 2, p.clone().add(new Vector3(0, 60, 200))).inArc).toBe(false);
    expect(aimFlexibleGun(twin, 0, p.clone().add(new Vector3(0, 0, -200))).inArc).toBe(true);
    expect(aimFlexibleGun(twin, 1, p.clone().add(new Vector3(0, 0, -200))).inArc).toBe(false);
  });
});

describe('crew stations: the player at a gun', () => {
  const aimAtEnemy = (twin: AircraftEntity, e: AircraftEntity) => e.state.position.clone().sub(twin.state.position).normalize();

  it('his aim and trigger drive his station; his other station is silent; other gunners stay AI', () => {
    const { s, twin, enemies } = twinWith([AHEAD, ABOVE_BEHIND, BELOW_BEHIND]);
    twin.controller = 'player';
    twin.stationInputs = { station: 'dorsal', aim: aimAtEnemy(twin, enemies[1]), fire: false, releaseBomb: false, clearJam: false };
    s.step(2, undefined, 'kinematic');
    // Trigger released: the dorsal gun is quiet, and so is the tunnel (he is the same man).
    expect(firedBy(s, 1, 1).length + firedBy(s, 1, 2).length).toBe(0);
    expect(firedBy(s, 1, 0).length).toBeGreaterThan(5);
    twin.stationInputs.fire = true;
    const before = firedBy(s, 1, 1).length;
    s.step(2, () => twin.stationInputs!.aim.copy(aimAtEnemy(twin, enemies[1])), 'kinematic');
    // Continuous fire, no AI bursts: 2 s of a Parabellum at ~600 rpm is ~20 rounds.
    expect(firedBy(s, 1, 1).length - before).toBeGreaterThan(15);
    expect(firedBy(s, 1, 2).length).toBe(0);
  });

  it('respects the arc, and his clear-jam presses hammer only his station', () => {
    const { s, twin } = twinWith([]);
    twin.controller = 'player';
    const forward = new Vector3(0, 0, -1).applyQuaternion(twin.state.orientation);
    twin.stationInputs = { station: 'dorsal', aim: forward, fire: true, releaseBomb: false, clearJam: false };
    s.step(1, undefined, 'kinematic');
    expect(firedBy(s, 1, 1).length).toBe(0);

    twin.guns[1].jammed = true;
    twin.guns[0].jammed = true;
    let presses = 0;
    while (twin.guns[1].jammed && presses < 20) {
      twin.stationInputs.clearJam = true;
      s.step(SIM_DT, undefined, 'kinematic');
      expect(twin.stationInputs.clearJam).toBe(false);
      presses++;
    }
    expect(twin.guns[1].jammed).toBe(false);
    expect(twin.guns[0].jammed).toBe(true);
  });

  it('a killed player-gunner cannot fire', () => {
    const { s, twin, enemies } = twinWith([ABOVE_BEHIND]);
    twin.controller = 'player';
    s.step(SIM_DT, undefined, 'kinematic');
    twin.damage.crewWounds![2] = 1;
    twin.stationInputs = { station: 'dorsal', aim: aimAtEnemy(twin, enemies[0]), fire: true, releaseBomb: false, clearJam: false };
    const before = firedBy(s, 1).length;
    s.step(1, undefined, 'kinematic');
    expect(firedBy(s, 1).length).toBe(before);
  });
});
