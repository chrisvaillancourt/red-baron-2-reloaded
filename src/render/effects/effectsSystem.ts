/**
 * Visual effects driven by GameEvents and live entity state: tracers,
 * muzzle flashes, hit sparks and splinters, flak ("archie": black German,
 * white Allied), explosions, burning/smoking aircraft trails, balloon fires,
 * ground impacts and crash fires.
 */
import { Color, Group, Vector3, type Camera } from 'three';
import type { BulletView, WorldQuery } from '../../core/interfaces';
import type { GameEvent, Side } from '../../core/types';
import { landUseAt } from '../../world/landuse';
import { ParticlePool, type ParticleSpawn } from './particles';
import { Tracers } from './tracers';

interface GroundFire {
  x: number;
  y: number;
  z: number;
  t: number;
  life: number;
  size: number;
}

const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

export class EffectsSystem {
  readonly group = new Group();
  private readonly smoke: ParticlePool;
  private readonly glow: ParticlePool;
  private readonly tracers = new Tracers();
  private readonly wind = new Vector3();
  private readonly fires: GroundFire[] = [];
  private readonly emitAcc = new Map<number, number>();
  private readonly lastPos = new Map<number, Vector3>();
  private date = '1917-06-01';

  constructor(
    maxParticles: number,
    private readonly sideAt: (x: number, z: number) => Side,
  ) {
    this.group.name = 'effects';
    this.smoke = new ParticlePool(Math.round(maxParticles * 0.7), false);
    this.glow = new ParticlePool(Math.round(maxParticles * 0.3), true);
    this.group.add(this.smoke.mesh, this.glow.mesh, this.tracers.mesh);
  }

  setWind(w: [number, number, number]): void {
    this.wind.set(w[0], 0, w[2]);
  }

  setFog(color: Color, density: number, sunTint: Color): void {
    for (const p of [this.smoke, this.glow]) {
      p.material.uniforms.uFogColor.value.copy(color);
      p.material.uniforms.uFogDensity.value = density;
      p.material.uniforms.uSunTint.value.copy(sunTint);
    }
  }

  setDate(date: string): void {
    this.date = date;
  }

  get activeCount(): number {
    return this.smoke.count + this.glow.count;
  }

  private puff(s: ParticleSpawn): void {
    this.smoke.spawn(s);
  }

  private flash(s: ParticleSpawn): void {
    this.glow.spawn(s);
  }

  // --- composite effects ------------------------------------------------------

  muzzleFlash(p: Vector3): void {
    this.flash({ x: p.x, y: p.y, z: p.z, life: 0.05, size0: 0.35, size1: 0.6, color: [1, 0.7, 0.3], alpha0: 1, alpha1: 0.2 });
  }

  sparks(p: Vector3, n: number, color: [number, number, number] = [1, 0.8, 0.4]): void {
    for (let i = 0; i < n; i++) {
      this.flash({
        x: p.x, y: p.y, z: p.z, vx: rnd(18), vy: rnd(18) + 4, vz: rnd(18),
        life: 0.15 + Math.random() * 0.2, size0: 0.12, size1: 0.05, color, alpha0: 1, alpha1: 0, drag: 3, lift: -9.8, shape: 1, stretch: 3,
      });
    }
  }

  splinters(p: Vector3, n: number, fabric: boolean): void {
    const c: [number, number, number] = fabric ? [0.78, 0.74, 0.62] : [0.45, 0.33, 0.2];
    for (let i = 0; i < n; i++) {
      this.puff({
        x: p.x, y: p.y, z: p.z, vx: rnd(10), vy: rnd(8) + 2, vz: rnd(10),
        life: 1.2 + Math.random(), size0: 0.12, size1: 0.1, color: c, alpha0: 1, alpha1: 0.8, drag: 1.5, lift: -6, shape: 1, spin: rnd(8),
      });
    }
    this.puff({ x: p.x, y: p.y, z: p.z, life: 0.8, size0: 0.4, size1: 1.6, color: [0.55, 0.52, 0.48], alpha0: 0.5, alpha1: 0, drag: 2, windFollow: 1 });
  }

  flak(p: Vector3, german: boolean): void {
    const base: [number, number, number] = german ? [0.07, 0.065, 0.06] : [0.74, 0.73, 0.7];
    this.flash({ x: p.x, y: p.y, z: p.z, life: 0.12, size0: 3, size1: 7, color: [1, 0.6, 0.25], alpha0: 1, alpha1: 0 });
    for (let i = 0; i < 7; i++) {
      this.puff({
        x: p.x + rnd(2.5), y: p.y + rnd(2.5), z: p.z + rnd(2.5), vx: rnd(4), vy: rnd(3), vz: rnd(4),
        life: 22 + Math.random() * 10, size0: 3 + Math.random() * 2, size1: 11 + Math.random() * 5,
        color: base, alpha0: german ? 0.95 : 0.85, alpha1: 0, drag: 0.8, windFollow: 1, lift: 0.05,
      });
    }
  }

  explosion(p: Vector3, size: number, onGround: boolean): void {
    this.flash({ x: p.x, y: p.y + size * 0.5, z: p.z, life: 0.3, size0: size * 3, size1: size * 7, color: [1, 0.62, 0.28], alpha0: 0.8, alpha1: 0 });
    for (let i = 0; i < 14; i++) {
      this.flash({
        x: p.x, y: p.y, z: p.z, vx: rnd(size * 4), vy: rnd(size * 3) + size * 2, vz: rnd(size * 4),
        life: 0.6 + Math.random() * 0.6, size0: size * 1.2, size1: size * 2.6, color: [0.95, 0.38 + Math.random() * 0.18, 0.08], alpha0: 0.55, alpha1: 0, drag: 2.5, lift: 3,
      });
    }
    for (let i = 0; i < 10; i++) {
      this.puff({
        x: p.x + rnd(size), y: p.y + rnd(size), z: p.z + rnd(size), vx: rnd(size * 2), vy: size * 1.5 + Math.random() * size, vz: rnd(size * 2),
        life: 8 + Math.random() * 8, size0: size * 1.5, size1: size * 6, color: [0.09, 0.08, 0.07], alpha0: 0.85, alpha1: 0, drag: 1.2, lift: 1.2, windFollow: 1,
      });
    }
    for (let i = 0; i < 16; i++) {
      this.puff({
        x: p.x, y: p.y, z: p.z, vx: rnd(size * 6), vy: Math.random() * size * 6, vz: rnd(size * 6),
        life: 2 + Math.random() * 2, size0: 0.25, size1: 0.2, color: [0.2, 0.17, 0.14], alpha0: 1, alpha1: 1, lift: -9.8, drag: 0.3, shape: 1, spin: rnd(6),
      });
    }
    if (onGround) this.fires.push({ x: p.x, y: p.y, z: p.z, t: 0, life: 45 + Math.random() * 30, size });
  }

  groundImpact(p: Vector3): void {
    const lu = landUseAt(p.x, p.z, this.date);
    if (lu === 'water' || lu === 'sea') {
      for (let i = 0; i < 4; i++)
        this.puff({ x: p.x, y: p.y, z: p.z, vx: rnd(1), vy: 6 + Math.random() * 5, vz: rnd(1), life: 0.9, size0: 0.4, size1: 1.4, color: [0.85, 0.88, 0.9], alpha0: 0.8, alpha1: 0, lift: -9.8, drag: 1 });
      return;
    }
    const chalk = lu === 'trench-zone' || lu === 'shell-cratered';
    const c: [number, number, number] = chalk ? [0.62, 0.58, 0.5] : [0.42, 0.36, 0.28];
    this.puff({ x: p.x, y: p.y + 0.3, z: p.z, vx: rnd(0.5), vy: 1.5, vz: rnd(0.5), life: 1.6, size0: 0.4, size1: 2.4, color: c, alpha0: 0.75, alpha1: 0, drag: 2, windFollow: 1 });
  }

  // --- events -------------------------------------------------------------------

  handleEvent(e: GameEvent): void {
    switch (e.type) {
      case 'gun-fired':
        this.muzzleFlash(e.position);
        break;
      case 'bullet-hit':
        if (e.zone === 'ground') this.sparks(e.position, 4, [1, 0.7, 0.35]);
        else if (e.zone === 'balloon') this.sparks(e.position, 2, [1, 0.8, 0.5]);
        else {
          this.sparks(e.position, e.zone === 'engine' ? 6 : 3);
          this.splinters(e.position, 3, e.zone === 'leftWing' || e.zone === 'rightWing' || e.zone === 'tail');
        }
        break;
      case 'bullet-impact-ground':
        this.groundImpact(e.position);
        break;
      case 'flak-burst':
        this.flak(e.position, this.sideAt(e.position.x, e.position.z) === 'central');
        break;
      case 'explosion':
        this.explosion(e.position, Math.max(1, e.size), false);
        break;
      case 'aircraft-destroyed': {
        const onGround = e.outcome === 'crashed' || e.outcome === 'collided' || e.outcome === 'ditched';
        if (e.outcome === 'ditched') {
          this.groundImpact(e.position);
          break;
        }
        if (onGround || e.outcome === 'shot-down') this.explosion(e.position, onGround ? 4 : 2.5, onGround && e.outcome !== 'shot-down');
        break;
      }
      case 'collision':
        this.explosion(e.position, 2, false);
        break;
      case 'balloon-destroyed':
        this.explosion(e.position, 8, false);
        break;
      case 'ground-destroyed':
        this.explosion(e.position, 5, true);
        break;
      default:
        break;
    }
  }

  // --- per-frame ---------------------------------------------------------------

  update(dt: number, camera: Camera, world: WorldQuery, bullets: readonly BulletView[]): void {
    this.tracers.update(bullets);
    // Smoke/fire trails from damaged aircraft (emitted by distance travelled).
    for (const ac of world.aircraft) {
      const d = ac.damage;
      const p = ac.state.position;
      const last = this.lastPos.get(ac.id);
      if (!last) {
        this.lastPos.set(ac.id, p.clone());
        continue;
      }
      const moved = last.distanceTo(p);
      last.copy(p);
      if (!(d.smoking || d.onFire || d.engineDead) || moved > 200) continue;
      const onGround = ac.state.onGround || ac.outcome === 'crashed';
      if (onGround && !d.onFire) continue;
      const spacing = d.onFire ? 2.4 : 4.5;
      let acc = (this.emitAcc.get(ac.id) ?? 0) + Math.max(moved, onGround ? dt * 6 : 0);
      const v = ac.state.velocity;
      let guard = 0;
      while (acc > spacing && guard++ < 12) {
        acc -= spacing;
        const back = acc / Math.max(1e-3, moved);
        const x = p.x - v.x * dt * back, y = p.y - v.y * dt * back, z = p.z - v.z * dt * back;
        if (d.onFire) {
          this.flash({ x: x + rnd(0.4), y: y + rnd(0.4), z: z + rnd(0.4), vx: v.x * 0.05, vy: 1, vz: v.z * 0.05, life: 0.35 + Math.random() * 0.3, size0: 1.3, size1: 2.4, color: [1, 0.42 + Math.random() * 0.15, 0.08], alpha0: 0.6, alpha1: 0, drag: 3 });
          this.puff({ x: x + rnd(0.8), y: y + rnd(0.8), z: z + rnd(0.8), vx: rnd(1.2), vy: 0.8, vz: rnd(1.2), life: 7 + Math.random() * 5, size0: 1.4, size1: 12 + Math.random() * 6, color: [0.11, 0.1, 0.09], alpha0: 0.6, alpha1: 0, drag: 0.6, windFollow: 1, lift: 0.6 });
        } else {
          const grey = d.engineDead ? 0.35 : 0.5;
          this.puff({ x: x + rnd(0.5), y: y + rnd(0.5), z: z + rnd(0.5), vx: rnd(0.8), vy: 0.3, vz: rnd(0.8), life: 4 + Math.random() * 4, size0: 0.9, size1: 7 + Math.random() * 3, color: [grey, grey * 0.97, grey * 0.93], alpha0: d.engineDead ? 0.7 : 0.45, alpha1: 0, drag: 0.6, windFollow: 1, lift: 0.3 });
        }
      }
      this.emitAcc.set(ac.id, acc);
    }
    // Burning balloons.
    for (const b of world.balloons) {
      if (!b.burning) continue;
      for (let i = 0; i < 3; i++) {
        this.flash({ x: b.position.x + rnd(5), y: b.position.y + rnd(4), z: b.position.z + rnd(5), vy: 4, life: 0.6, size0: 5, size1: 9, color: [1, 0.55, 0.15], alpha0: 0.9, alpha1: 0, drag: 2 });
      }
      this.puff({ x: b.position.x, y: b.position.y + 6, z: b.position.z, vy: 3, life: 14, size0: 6, size1: 22, color: [0.07, 0.06, 0.05], alpha0: 0.85, alpha1: 0, drag: 0.5, windFollow: 1, lift: 0.8 });
    }
    // Ground fires & wreck smoke columns.
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t > f.life) {
        this.fires.splice(i, 1);
        continue;
      }
      const k = 1 - f.t / f.life;
      if (Math.random() < dt * 30 * k) this.flash({ x: f.x + rnd(f.size * 0.7), y: f.y + 0.5 + Math.random() * f.size * 0.5, z: f.z + rnd(f.size * 0.7), vy: 2 + f.size * 0.6, life: 0.6 + Math.random() * 0.5, size0: f.size * 1.1, size1: f.size * 1.8, color: [1, 0.33 + Math.random() * 0.12, 0.05], alpha0: 0.28 * k + 0.06, alpha1: 0, drag: 2 });
      if (Math.random() < dt * 9) this.puff({ x: f.x + rnd(f.size * 0.3), y: f.y + f.size, z: f.z + rnd(f.size * 0.3), vy: 4 + f.size * 1.2, vx: rnd(0.6), vz: rnd(0.6), life: 22, size0: f.size * 0.9, size1: f.size * 9, color: [0.16, 0.15, 0.14], alpha0: 0.55 * k + 0.1, alpha1: 0, drag: 0.25, windFollow: 1, lift: 0.3 });
    }
    // Forget aircraft that left the world.
    if (this.lastPos.size > world.aircraft.length + 8) {
      const ids = new Set(world.aircraft.map((a) => a.id));
      for (const id of this.lastPos.keys()) if (!ids.has(id)) this.lastPos.delete(id);
    }
    this.smoke.update(dt, this.wind, camera, true);
    this.glow.update(dt, this.wind, camera, false);
  }

  dispose(): void {
    this.smoke.dispose();
    this.glow.dispose();
    this.tracers.dispose();
  }
}
