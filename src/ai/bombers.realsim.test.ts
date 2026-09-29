/**
 * AI bombers on the real flight model and combat (docs/ai.md "Bombers"): a D.H.4 formation
 * flies a straight and level run over its 'bomb' waypoint, the leader releases when his
 * predicted impact falls on the targets and the formation releases on his, then they fly
 * home in formation, holding it under attack.
 */
import { describe, expect, it } from 'vitest';
import type { AircraftEntity, GameEvent, GroundTargetEntity, Waypoint } from '../core/types';
import { getBombStats, loadBombs } from '../sim';
import { formationOffset, slotPosition } from './navigation';
import { runSim, SimWorld } from './testing/realSimHarness';
import { routeFlight } from './testing/realScenarios';
import { Vector3 } from 'three';

const DEG = Math.PI / 180;

/** Three D.H.4s heading east at 2,500 m toward a depot 10 km away: three dumps 45 m apart across the run. */
function raid(seed = 1, withEnemy = false) {
  const tgtX = 6000;
  const world = new SimWorld({ seed, frontX: 0 });
  const dumps = [-45, 0, 45].map((z) => world.addGroundTarget('supply-dump', 'central', tgtX, z));
  world.addGroundTarget('aa-gun', 'central', tgtX - 300, 400);
  const rally: Waypoint = { x: -3000, z: 4000, altitude: 2500, action: 'fly' };
  const wps: Waypoint[] = [{ x: tgtX, z: 0, altitude: 2500, action: 'bomb', targetIds: ['a', 'b', 'c'] }, rally];
  world.addFlight(routeFlight('b', 'allied', 'dh4', wps, { task: 'bomb' }));
  const east = Math.PI / 2;
  const lead = world.addAircraft({ aircraftId: 'dh4', side: 'allied', x: -4000, z: 0, alt: 2500, heading: east, flightId: 'b' });
  const wings = [1, 2].map((slot) => {
    const o = formationOffset(slot);
    // Heading east: the leader's right is +z and back is -x.
    return world.addAircraft({ aircraftId: 'dh4', side: 'allied', x: -4000 - o.z, z: o.x, alt: 2500 + o.y, heading: east, flightId: 'b' });
  });
  const bombers = [lead, ...wings];
  for (const b of bombers) loadBombs(b);
  world.addAI(lead, 'regular', { role: 'friendly', task: 'bomb' });
  wings.forEach((w, i) => world.addAI(w, 'regular', { role: 'friendly', task: 'bomb', leaderId: lead.id, formationSlot: i + 1 }));
  let enemy: AircraftEntity | undefined;
  if (withEnemy) {
    // Two scouts coming to meet the formation as it crosses the lines.
    world.addFlight(routeFlight('e', 'central', 'fokker_dvii', [], { task: 'defend' }));
    for (const dz of [0, 60]) {
      enemy = world.addAircraft({ aircraftId: 'fokker_dvii', side: 'central', x: 2500, z: 400 + dz, alt: 2300, heading: -east, flightId: 'e', skill: 'veteran' });
      world.addAI(enemy, 'veteran', { role: 'enemy', task: 'defend' });
    }
  }
  return { world, lead, wings, bombers, dumps, rally, enemy };
}

const bank = (ac: AircraftEntity) => {
  const r = new Vector3(1, 0, 0).applyQuaternion(ac.state.orientation);
  return Math.asin(Math.max(-1, Math.min(1, -r.y)));
};

describe('AI bombers on the real flight model', { timeout: 60_000 }, () => {
  it('a D.H.4 formation bombs its target: most bombs burst within blast range of it, and the formation goes home', () => {
    const { world, lead, wings, bombers, rally, dumps } = raid();
    const released = new Map<number, number[]>();
    const bursts: Extract<GameEvent, { type: 'bomb-exploded' }>[] = [];
    const history: { t: number; bank: number; alt: number }[] = [];
    let rallyDistAtRelease = Infinity;
    runSim(world, 420, {
      onStep: (t) => {
        history.push({ t, bank: bank(lead), alt: lead.state.position.y });
        for (const e of world.events.splice(0)) {
          if (e.type === 'bomb-released') {
            released.set(e.aircraftId, [...(released.get(e.aircraftId) ?? []), t]);
            if (e.aircraftId === lead.id && rallyDistAtRelease === Infinity) rallyDistAtRelease = Math.hypot(rally.x - lead.state.position.x, rally.z - lead.state.position.z);
          }
          if (e.type === 'bomb-exploded') bursts.push(e);
        }
        return bursts.length >= 12 && t > (released.get(lead.id)?.[0] ?? Infinity) + 90;
      },
    });
    if (process.env.BOMB_DEBUG) process.stdout.write(bursts.map((b) => `burst ${b.shooterId} x=${b.position.x.toFixed(1)} z=${b.position.z.toFixed(1)} hit=${b.damagedTargetIds.length}`).join('\n') + '\n' + [...released].map(([k, v]) => `rel ${k}: ${v.map((t) => t.toFixed(2)).join(',')}`).join('\n') + '\n');
    const dropped = bombers.map((b) => getBombStats(b).dropped);
    expect(dropped, 'every bomber dropped its four bombs').toEqual([4, 4, 4]);
    // Within blast range: a 112 lb bomb's 20 kg charge still damages a dump out to Z = 7 from
    // its walls (docs/sim.md "Blast"), about 19 m. (A burst on a dump already destroyed
    // reaches no live target, so count by distance, not `damagedTargetIds`.)
    const reach = 7 * Math.cbrt(20);
    const fromWalls = (p: Vector3, d: GroundTargetEntity) => Math.hypot(Math.max(0, Math.abs(p.x - d.position.x) - 5), Math.max(0, Math.abs(p.z - d.position.z) - 5));
    const onTarget = bursts.filter((b) => dumps.some((d) => fromWalls(b.position, d) < reach)).length;
    expect(bursts.length).toBe(12);
    expect(onTarget, `${onTarget} of 12 bursts reached a target`).toBeGreaterThanOrEqual(7);
    // The formation releases on its leader, not before him.
    const first = released.get(lead.id)![0];
    for (const w of wings) expect(released.get(w.id)![0]).toBeGreaterThanOrEqual(first);
    // Straight and level through the last 20 s of the run.
    const run = history.filter((h) => h.t > first - 20 && h.t <= first);
    expect(Math.max(...run.map((h) => Math.abs(h.bank)))).toBeLessThan(12 * DEG);
    expect(Math.max(...run.map((h) => h.alt)) - Math.min(...run.map((h) => h.alt))).toBeLessThan(80);
    // Then home: toward the rally, still together.
    expect(Math.hypot(rally.x - lead.state.position.x, rally.z - lead.state.position.z)).toBeLessThan(rallyDistAtRelease - 2000);
    for (const [i, w] of wings.entries()) expect(slotPosition(lead, formationOffset(i + 1)).distanceTo(w.state.position)).toBeLessThan(150);
    for (const b of bombers) expect(b.outcome).toBeNull();
  });

  it('leaves the release to the player when he is at the bombsight, and flies him the run', () => {
    const drops = (atSight: boolean) => {
      const { world, lead, wings } = raid();
      for (const w of wings) w.outcome = 'disengaged'; // alone
      if (atSight) lead.stationInputs = { station: 'observer', aim: new Vector3(0, -1, 0), fire: false, releaseBomb: false, clearJam: false };
      let minMiss = Infinity;
      runSim(world, 260, {
        onStep: () => void (minMiss = Math.min(minMiss, Math.abs(lead.state.position.z))),
      });
      return { dropped: getBombStats(lead).dropped, minMiss, phase: world.controllers.get(lead.id)!.phase };
    };
    expect(drops(false).dropped).toBe(4);
    const player = drops(true);
    expect(player.dropped).toBe(0);
    // Still flown down the run line over the target for him.
    expect(player.minMiss).toBeLessThan(30);
  });

  it('comes round for a later run when he takes the waypoint facing away, or misses the first', () => {
    // Heading east, 3 km past the depot; then 1 km short of it and 450 m off to one side, with
    // the bombs' throw (about 1 km from 2,500 m) already past it: a certain miss on the first run.
    const cases = [
      { x: 9000, z: 0 },
      { x: 5000, z: 450 },
    ];
    for (const c of cases) {
      const { world, lead, wings, dumps } = raid();
      for (const w of wings) w.outcome = 'disengaged'; // alone
      lead.state.position.set(c.x, 2500, c.z);
      const bursts: Vector3[] = [];
      let firstRelease = Infinity;
      runSim(world, 900, {
        onStep: (t) => {
          for (const e of world.events.splice(0)) {
            if (e.type === 'bomb-exploded') bursts.push(e.position.clone());
            if (e.type === 'bomb-released') firstRelease = Math.min(firstRelease, t);
          }
          return bursts.length >= 4;
        },
      });
      const ctl = world.controllers.get(lead.id)!;
      if (process.env.BOMB_DEBUG) process.stdout.write(`case ${c.x},${c.z} t=${world.time.toFixed(0)} release=${firstRelease.toFixed(0)} ${ctl.debugState}\n`);
      expect(getBombStats(lead).dropped, `from (${c.x}, ${c.z}): bombs dropped (${ctl.debugState})`).toBe(4);
      // On the target area, not wherever he gave up.
      const near = bursts.filter((b) => dumps.some((d) => Math.hypot(b.x - d.position.x, b.z - d.position.z) < 300)).length;
      expect(near, `from (${c.x}, ${c.z}): bursts within 300 m of a dump`).toBeGreaterThanOrEqual(3);
      // Not on this pass: he went out and came round (a run from 6 km takes over a minute).
      expect(firstRelease, `from (${c.x}, ${c.z}): first release`).toBeGreaterThan(90);
      expect(lead.outcome).toBeNull();
    }
  });

  it('holds formation under attack and does not jink on the run', () => {
    let defended = 0;
    let slotErr = 0;
    let n = 0;
    let leaderBombed = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const { world, lead, wings, bombers } = raid(seed, true);
      let done = false;
      runSim(world, 300, {
        onStep: () => {
          // Breaking off to defend while a formation-mate is still flying beside him.
          for (const b of bombers) {
            if (b.outcome !== null || world.controllers.get(b.id)!.phase !== 'defend') continue;
            if (bombers.some((o) => o !== b && o.outcome === null && !o.damage.destroyed && o.state.position.distanceTo(b.state.position) < 600)) defended++;
          }
          if (lead.outcome === null && !done) {
            wings.forEach((w, i) => {
              if (w.outcome !== null) return;
              slotErr += slotPosition(lead, formationOffset(i + 1)).distanceTo(w.state.position);
              n++;
            });
          }
          done ||= getBombStats(lead).dropped > 0;
          return done && world.time > 200;
        },
      });
      if (getBombStats(lead).dropped === 4) leaderBombed++;
      if (process.env.BOMB_DEBUG) process.stdout.write(`seed ${seed} hits ${world.eventsOf('bullet-hit').length} enemy ${world.aircraft.find((a) => a.side === 'central')?.outcome} bombers ${bombers.map((b) => b.outcome ?? 'ok').join(',')} states ${bombers.map((b) => world.controllers.get(b.id)!.debugState).join('|')}\n`);
    }
    expect(defended, 'steps any bomber spent breaking off to defend').toBe(0);
    expect(slotErr / n, 'mean slot error up to the release').toBeLessThan(60);
    // The leader flies his run and bombs whatever is thrown at the formation.
    expect(leaderBombed).toBe(3);
  });
});
