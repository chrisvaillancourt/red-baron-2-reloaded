/**
 * STUB combat: fixed guns, simple ballistic bullets, sphere hits, crude
 * damage, jams and balloon/ground kills. Replaced by src/sim combat.
 */
import { Vector3 } from 'three';
import type { BulletView, CombatSystem, EventBus, WorldQuery } from '../../core/interfaces';
import type { AircraftEntity, DamageZone, RealismSettings, Side } from '../../core/types';
import { GUNS } from '../../data/aircraft';

interface Bullet extends BulletView {
  position: Vector3;
  velocity: Vector3;
  tracer: boolean;
  side: Side;
  age: number;
  shooterId: number;
}

const ZONES: DamageZone[] = ['engine', 'fuelTank', 'pilot', 'leftWing', 'rightWing', 'tail', 'fuselage', 'controls'];
const gunnerTargets = new WeakMap<AircraftEntity, number | null>();

export function stubSetGunnerTarget(ac: AircraftEntity, id: number | null): void {
  gunnerTargets.set(ac, id);
}

export function stubCreateCombatSystem(bus: EventBus, getRealism: () => RealismSettings): CombatSystem {
  const bullets: Bullet[] = [];
  let roundCounter = 0;
  const seg = new Vector3();
  const rel = new Vector3();

  function damageAircraft(victim: AircraftEntity, shooterId: number, pos: Vector3): void {
    const realism = getRealism();
    const zone = ZONES[Math.floor(Math.random() * ZONES.length)];
    bus.emit({ type: 'bullet-hit', targetId: victim.id, shooterId, position: pos.clone(), zone });
    if (victim.controller === 'player' && realism.invulnerable) return;
    const d = victim.damage;
    d.lastAttackerId = shooterId;
    d.zones[zone] = Math.min(1, d.zones[zone] + 0.12);
    if (zone === 'engine' && d.zones.engine >= 1 && !d.engineDead) {
      d.engineDead = true;
      bus.emit({ type: 'engine-dead', aircraftId: victim.id });
    }
    if (zone === 'fuelTank' && d.zones.fuelTank > 0.5 && !d.onFire && Math.random() < 0.15) {
      d.onFire = true;
      bus.emit({ type: 'fire-started', aircraftId: victim.id });
    }
    if (zone === 'pilot' && d.zones.pilot > 0.3 && !d.pilotWounded) {
      d.pilotWounded = true;
      bus.emit({ type: 'pilot-hit', aircraftId: victim.id, killed: false });
    }
    if (zone === 'pilot' && d.zones.pilot >= 0.9 && !d.pilotKilled) {
      d.pilotKilled = true;
      bus.emit({ type: 'pilot-hit', aircraftId: victim.id, killed: true });
    }
    const total = Object.values(d.zones).reduce((a, b) => a + b, 0);
    d.smoking = total > 0.6;
    if (!d.destroyed && (total > 1.8 || d.pilotKilled || d.onFire)) {
      d.destroyed = true;
      victim.outcome = d.pilotKilled ? 'pilot-killed' : 'shot-down';
      bus.emit({ type: 'aircraft-destroyed', victimId: victim.id, killerId: shooterId, outcome: victim.outcome, position: victim.state.position.clone() });
    }
  }

  function fire(ac: AircraftEntity, dt: number, world: WorldQuery): void {
    const realism = getRealism();
    ac.spec.guns.forEach((mount, i) => {
      const g = ac.guns[i];
      if (!g) return;
      g.cooldown = Math.max(0, g.cooldown - dt);
      g.heat = Math.max(0, g.heat - dt * 0.08);
      if (g.reloading > 0) {
        g.reloading -= dt;
        if (g.reloading <= 0) {
          g.roundsLeft = mount.rounds;
          g.sparesLeft--;
        }
        return;
      }
      if (g.jammed) {
        if (ac.controls.clearJam) {
          g.jamClearProgress += 0.25;
          if (g.jamClearProgress >= 1) {
            g.jammed = false;
            g.jamClearProgress = 0;
            bus.emit({ type: 'gun-cleared', aircraftId: ac.id, mountIndex: i });
          }
        }
        return;
      }
      let wantFire = ac.controls.fireGuns && mount.mount !== 'flexible';
      let dir = new Vector3(0, 0, -1).applyQuaternion(ac.state.orientation);
      if (mount.mount === 'flexible') {
        const tid = gunnerTargets.get(ac);
        const t = tid != null ? world.getEntity(tid) : undefined;
        if (t && t.kind === 'aircraft' && t.outcome === null) {
          rel.copy(t.state.position).sub(ac.state.position);
          if (rel.length() < 400) {
            wantFire = true;
            dir = rel.clone().normalize();
            dir.x += (Math.random() - 0.5) * 0.03;
            dir.y += (Math.random() - 0.5) * 0.03;
          }
        }
      }
      if (!wantFire || g.cooldown > 0 || ac.outcome !== null) return;
      if (g.roundsLeft <= 0) {
        if (g.sparesLeft > 0 && GUNS[mount.type].drumChangeTime > 0) {
          g.reloading = GUNS[mount.type].drumChangeTime;
          bus.emit({ type: 'drum-change', aircraftId: ac.id, mountIndex: i });
        }
        return;
      }
      const spec = GUNS[mount.type];
      const rpm = mount.mount === 'fixed-synchronized' ? spec.rpmSynchronized : spec.rpmFree;
      g.cooldown = 60 / rpm;
      if (realism.limitedAmmo) g.roundsLeft--;
      if (g.roundsLeft <= 0 && g.sparesLeft <= 0) bus.emit({ type: 'out-of-ammo', aircraftId: ac.id, mountIndex: i });
      g.heat = Math.min(1, g.heat + 0.01);
      if (realism.gunJams && Math.random() < spec.jamChancePerRound * (1 + g.heat * 6)) {
        g.jammed = true;
        bus.emit({ type: 'gun-jammed', aircraftId: ac.id, mountIndex: i });
      }
      const muzzle = new Vector3(...mount.position).applyQuaternion(ac.state.orientation).add(ac.state.position);
      const vel = dir.clone().multiplyScalar(spec.muzzleVelocity).add(ac.state.velocity);
      bullets.push({ position: muzzle, velocity: vel, tracer: roundCounter++ % 4 === 0, side: ac.side, age: 0, shooterId: ac.id });
      bus.emit({ type: 'gun-fired', shooterId: ac.id, gun: mount.type, position: muzzle.clone() });
    });
  }

  return {
    bullets,
    update(world, dt) {
      for (const ac of world.aircraft) fire(ac, dt, world);
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        seg.copy(b.velocity).multiplyScalar(dt);
        const start = b.position.clone();
        b.velocity.y -= 9.81 * dt;
        b.velocity.multiplyScalar(1 - 0.25 * dt);
        b.position.add(seg);
        b.age += dt;
        let hit = false;
        const segLen = seg.length();
        const segDir = seg.clone().normalize();
        const closest = (c: Vector3) => {
          rel.copy(c).sub(start);
          const t = Math.max(0, Math.min(segLen, rel.dot(segDir)));
          return start.clone().addScaledVector(segDir, t).distanceTo(c);
        };
        for (const ac of world.aircraft) {
          if (ac.id === b.shooterId || ac.damage.destroyed) continue;
          if (closest(ac.state.position) < 3.5) {
            damageAircraft(ac, b.shooterId, b.position);
            hit = true;
            break;
          }
        }
        if (!hit)
          for (const bl of world.balloons) {
            if (bl.destroyed || bl.side === b.side) continue;
            if (closest(bl.position) < 10) {
              hit = true;
              bl.health -= 0.04;
              bus.emit({ type: 'bullet-hit', targetId: bl.id, shooterId: b.shooterId, position: b.position.clone(), zone: 'balloon' });
              if (bl.health <= 0) {
                bl.burning = true;
                bl.destroyed = true;
                bus.emit({ type: 'balloon-destroyed', balloonId: bl.id, killerId: b.shooterId, position: bl.position.clone() });
              }
              break;
            }
          }
        if (!hit)
          for (const gt of world.groundTargets) {
            if (gt.destroyed || gt.side === b.side) continue;
            if (closest(gt.position) < 5) {
              hit = true;
              gt.health -= 0.05;
              bus.emit({ type: 'bullet-hit', targetId: gt.id, shooterId: b.shooterId, position: b.position.clone(), zone: 'ground' });
              if (gt.health <= 0) {
                gt.destroyed = true;
                bus.emit({ type: 'ground-destroyed', targetId: gt.id, killerId: b.shooterId, position: gt.position.clone() });
                bus.emit({ type: 'explosion', position: gt.position.clone(), size: 4 });
              }
              break;
            }
          }
        const gh = world.groundHeightAt(b.position.x, b.position.z);
        if (!hit && b.position.y < gh) {
          bus.emit({ type: 'bullet-impact-ground', position: b.position.clone() });
          hit = true;
        }
        if (hit || b.age > 3) bullets.splice(i, 1);
      }
    },
  };
}
