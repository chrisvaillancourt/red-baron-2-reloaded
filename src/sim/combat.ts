/**
 * Combat system: guns, ballistics, hit detection, damage model, fire, kill
 * credit, mid-air collisions, anti-aircraft fire ("archie") and ground fire.
 *
 * Emits the GameEvents defined in src/core/types.ts on the flight session bus.
 */
import { Quaternion, Vector3 } from 'three';
import type { EventBus, CombatSystem, BulletView, WorldQuery } from '../core/interfaces';
import type {
  AircraftEntity,
  AircraftOutcome,
  AircraftSpec,
  CrewStation,
  CrewStationId,
  FireArc,
  BalloonEntity,
  DamageZone,
  GroundTargetEntity,
  GunMount,
  GunState,
  GunType,
  RealismSettings,
  Side,
  SkillLevel,
  StationInputs,
} from '../core/types';
import { GUNS } from '../data/aircraft';
import { crewStations, inFireArcs, stationForGun } from '../data/crew';
import { G } from './atmosphere';
import { getSimInternal, type FailedPart } from './flightModel';
import {
  BALLOON_RADIUS,
  GROUND_TARGET_BOXES,
  getHitModel,
  pointSegmentDistanceSq,
  segmentBox,
} from './hitboxes';
import { createRng, gaussian, type Rng } from './rng';

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

interface GunnerAssignment {
  /** Every AI gunner's target, or null for each to pick his own. */
  all: number | null;
  /** Per-station overrides (setGunnerTarget's third argument). */
  stations: Map<CrewStationId, number>;
}

const gunnerTargets = new WeakMap<AircraftEntity, GunnerAssignment>();

/**
 * Assign the AI gunners' target (entity id), or null to let each gunner pick the
 * nearest threat automatically. Without `station` this assigns every gunner and clears
 * any per-station assignment; with it, only the gunner at that station (null clears the
 * override, so he follows the aircraft-wide target again). Gunners always hold fire at
 * friendlies.
 */
export function setGunnerTarget(ac: AircraftEntity, targetId: number | null, station?: CrewStationId): void {
  let a = gunnerTargets.get(ac);
  if (!a) gunnerTargets.set(ac, (a = { all: null, stations: new Map() }));
  if (station === undefined) {
    a.all = targetId;
    a.stations.clear();
  } else if (targetId === null) a.stations.delete(station);
  else a.stations.set(station, targetId);
}

/** The assigned target: the station's own when given and set, else the aircraft-wide one. Null means automatic. */
export function getGunnerTarget(ac: AircraftEntity, station?: CrewStationId): number | null {
  const a = gunnerTargets.get(ac);
  if (!a) return null;
  if (station !== undefined) return a.stations.get(station) ?? a.all;
  return a.all;
}

const stationAims = new WeakMap<AircraftEntity, Map<CrewStationId, Vector3>>();

/**
 * World direction (unit) the guns at `station` are laid on this step: the AI gunner's
 * firing solution while he has a target in his arcs, or the player's aim at his station.
 * Null while the station is idle. For the renderer's `setStationAim` and the HUD.
 */
export function getStationAim(ac: AircraftEntity, station: CrewStationId): Vector3 | null {
  return stationAims.get(ac)?.get(station) ?? null;
}

function setStationAim(ac: AircraftEntity, station: CrewStationId, dir: Vector3 | null) {
  let m = stationAims.get(ac);
  if (!dir) {
    m?.delete(station);
    return;
  }
  if (!m) stationAims.set(ac, (m = new Map()));
  const v = m.get(station);
  if (v) v.copy(dir);
  else m.set(station, dir.clone());
}

const _aimTmp = new Vector3();
const _aimQ = new Quaternion();

const mountArcCache = new WeakMap<AircraftSpec, readonly (readonly FireArc[])[]>();

/** The field of fire of a gun: its station's arcs (none for a fixed gun). */
function mountArcs(spec: AircraftSpec, mountIndex: number): readonly FireArc[] {
  let c = mountArcCache.get(spec);
  if (!c) {
    c = spec.guns.map((_, i) => stationForGun(spec, i)?.arcs ?? []);
    mountArcCache.set(spec, c);
  }
  return c[mountIndex] ?? [];
}

/** Is a world direction inside the arcs, in the aircraft's body frame? */
function inArcsWorld(ac: AircraftEntity, arcs: readonly FireArc[], dirWorld: Vector3): boolean {
  if (arcs.length === 0) return false;
  _aimQ.copy(ac.state.orientation).invert();
  const d = _aimTmp.copy(dirWorld).applyQuaternion(_aimQ);
  return inFireArcs(arcs, d.x, d.y, d.z);
}

/**
 * Direction (world, unit) a flexible gun must point to hit a stationary point,
 * and whether that direction is inside the gun's field of fire (its crew station's
 * arcs, `crewStations(spec)`). For moving targets pass the lead-corrected intercept point.
 */
export function aimFlexibleGun(
  ac: AircraftEntity,
  mountIndex: number,
  targetWorldPos: Vector3,
  out = new Vector3(),
): { inArc: boolean; direction: Vector3 } {
  const m = ac.spec.guns[mountIndex];
  const muzzle = mountWorldPosition(ac, m, _aimTmp);
  out.copy(targetWorldPos).sub(muzzle);
  const dist = out.length();
  // Compensate for drop over the flight time.
  const tFlight = dist / GUNS[m.type].muzzleVelocity;
  out.y += 0.5 * G * tFlight * tFlight;
  out.normalize();
  return { inArc: inArcsWorld(ac, mountArcs(ac.spec, mountIndex), out), direction: out };
}

function mountWorldPosition(ac: AircraftEntity, m: GunMount, out: Vector3): Vector3 {
  return out.set(m.position[0], m.position[1], m.position[2]).applyQuaternion(ac.state.orientation).add(ac.state.position);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Bullet extends BulletView {
  position: Vector3;
  velocity: Vector3;
  prev: Vector3;
  tracer: boolean;
  side: Side;
  age: number;
  shooterId: number;
  gun: GunType;
}

interface CombatMemory {
  roundCount: number[];
  lastHitTime: number;
  reported: boolean; // aircraft-destroyed emitted
  prevOutcome: AircraftOutcome | null;
  prevEngineDead: boolean;
  engineDamagedReported: boolean;
  impactReported: boolean;
  fireTime: number;
  burnLimit: number;
  /** The rear crew of a type without explicit stations is dead (its `gunner` zone). */
  gunnerKilled: boolean;
  /** One AI gunner per crew member who works a flexible gun. */
  gunners: GunnerMem[];
  flakTimer: number;
  groundFireTimer: number;
  outOfAmmoReported: boolean[];
}

/** One crew member at the flexible guns: his stations, target and burst rhythm. */
interface GunnerMem {
  crewIndex: number;
  /** His stations, each with its flexible guns (indices into `spec.guns`). */
  stations: { station: CrewStation; guns: number[] }[];
  /** The station he is at now. */
  active: number;
  /** Seconds left moving between stations; he can't fire meanwhile. */
  switching: number;
  autoTarget: number | null;
  retarget: number;
  burst: number;
  pause: number;
}

interface PendingBurst {
  time: number;
  position: Vector3;
  firingSide: Side;
  lethalRadius: number;
}

/** Bullet drag, 1/m: deceleration = k |v| v. The AI lead solution (src/ai/gunnery.ts) uses it. */
export const BULLET_DRAG_K = 0.0007;
const DRAG_K = BULLET_DRAG_K;
const BULLET_LIFE = 3.5;
const CONVERGENCE = 150;
const RECENT_HIT_S = 30;

const ZONE_DAMAGE: Record<DamageZone, number> = {
  engine: 0.1,
  fuelTank: 0.09,
  pilot: 0.22,
  gunner: 0.34,
  leftWing: 0.035,
  rightWing: 0.035,
  tail: 0.06,
  fuselage: 0.025,
  controls: 0.08,
  guns: 0.08,
};

const HIT_PRIORITY: DamageZone[] = ['pilot', 'engine', 'fuelTank', 'gunner', 'controls', 'guns', 'tail', 'leftWing', 'rightWing', 'fuselage'];

// Flexible guns on a pitching, weaving two-seater: coarser than a pilot's fixed guns
// (DECISIONS.md "Rear gunners are less accurate").
const GUNNER_ERROR: Record<SkillLevel, number> = { novice: 0.045, regular: 0.03, veteran: 0.021, ace: 0.015 };
const GUNNER_RANGE: Record<SkillLevel, number> = { novice: 275, regular: 325, veteran: 375, ace: 425 };
/** Seconds a gunner takes to move between his stations (the Gotha's dorsal ring and tunnel gun). */
const GUNNER_SWITCH_S = 1.0;
/** The player aims a flexible gun himself: only the gun's own dispersion, as for fixed guns. */
const PLAYER_FLEX_DISPERSION = 0.0025;

/** One AI gunner per crew member who works flexible guns (not the pilot), from crewStations(). */
function buildGunners(spec: AircraftSpec): GunnerMem[] {
  const out: GunnerMem[] = [];
  for (const station of crewStations(spec)) {
    if (station.crewIndex === 0) continue;
    const guns = station.guns.filter((i) => spec.guns[i]?.mount === 'flexible');
    if (guns.length === 0) continue;
    let g = out.find((x) => x.crewIndex === station.crewIndex);
    if (!g) out.push((g = { crewIndex: station.crewIndex, stations: [], active: 0, switching: 0, autoTarget: null, retarget: 0, burst: 0, pause: 0 }));
    g.stations.push({ station, guns });
  }
  return out;
}

export interface CombatOptions {
  rng?: Rng;
  /** Anti-aircraft fire near the front and around balloons/AA guns (default true). */
  flak?: boolean;
  /** Small-arms fire from the trenches at low-flying aircraft (default true). */
  groundFire?: boolean;
}

export interface SimCombatSystem extends CombatSystem {
  /**
   * Apply damage directly (tests, scripted events). `index` picks the crew member for
   * `'gunner'` on types with explicit stations (`crewWounds`), and the engine for `'engine'` on
   * multi-engine types (`engines`); absent, the first fit gunner or a random engine.
   */
  damageAircraft(ac: AircraftEntity, zone: DamageZone, amount: number, attackerId: number | null, time: number, index?: number): void;
  /** Pending flak bursts (for debugging/overlays). */
  readonly pendingFlak: readonly { time: number; position: Vector3 }[];
}

export function createCombatSystem(bus: EventBus, getRealism: () => RealismSettings, opts: CombatOptions = {}): SimCombatSystem {
  const rng = opts.rng ?? createRng(0xc0ffee);
  const flakEnabled = opts.flak ?? true;
  const groundFireEnabled = opts.groundFire ?? true;
  const bullets: Bullet[] = [];
  const pool: Bullet[] = [];
  const memory = new WeakMap<AircraftEntity, CombatMemory>();
  const pending: PendingBurst[] = [];
  let now = 0;

  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpDir = new Vector3();
  const tmpQ = new Quaternion();
  const tmpV = new Vector3();
  const tmpDisp = new Vector3();

  function mem(ac: AircraftEntity): CombatMemory {
    let m = memory.get(ac);
    if (!m) {
      m = {
        roundCount: ac.spec.guns.map(() => 0),
        lastHitTime: -Infinity,
        reported: ac.damage.destroyed,
        prevOutcome: ac.outcome,
        prevEngineDead: ac.damage.engineDead,
        engineDamagedReported: false,
        impactReported: false,
        fireTime: 0,
        burnLimit: 8 + rng() * 12,
        gunnerKilled: false,
        gunners: buildGunners(ac.spec),
        flakTimer: 2 + rng() * 4,
        groundFireTimer: 1,
        outOfAmmoReported: ac.spec.guns.map(() => false),
      };
      memory.set(ac, m);
      if (ac.spec.crewStations && !ac.damage.crewWounds) ac.damage.crewWounds = new Array(ac.spec.geometry.crew).fill(0);
    }
    return m;
  }

  const isProtected = (ac: AircraftEntity) => getRealism().invulnerable && ac.controller === 'player';

  // -------------------------------------------------------------- kills
  function destroy(ac: AircraftEntity, outcome: AircraftOutcome, killerId: number | null) {
    const m = mem(ac);
    ac.damage.destroyed = true;
    if (ac.outcome === null) ac.outcome = outcome;
    m.prevOutcome = ac.outcome;
    if (m.reported) return;
    m.reported = true;
    bus.emit({ type: 'aircraft-destroyed', victimId: ac.id, killerId, outcome: ac.outcome, position: ac.state.position.clone() });
  }

  function creditFor(ac: AircraftEntity): number | null {
    const m = mem(ac);
    return now - m.lastHitTime <= RECENT_HIT_S ? ac.damage.lastAttackerId : null;
  }

  function structuralFailure(ac: AircraftEntity, part: FailedPart) {
    if (ac.damage.structuralFailure) return;
    ac.damage.structuralFailure = true;
    ac.damage.zones[part] = 1;
    const it = getSimInternal(ac);
    it.failedPart = part;
  }

  function damageAircraft(ac: AircraftEntity, zone: DamageZone, amount: number, attackerId: number | null, time: number, index?: number) {
    const d = ac.damage;
    if (d.destroyed && ac.outcome !== null) {
      d.zones[zone] = Math.min(1, d.zones[zone] + amount);
      return;
    }
    if (isProtected(ac)) return;
    const m = mem(ac);
    if (attackerId !== null) {
      d.lastAttackerId = attackerId;
      m.lastHitTime = time;
    }
    const z = d.zones;
    z[zone] = Math.min(1, z[zone] + amount);

    switch (zone) {
      case 'engine':
        if (z.engine > 0.3 && !m.engineDamagedReported) {
          m.engineDamagedReported = true;
          bus.emit({ type: 'engine-damaged', aircraftId: ac.id });
        }
        if (z.engine > 0.4) d.smoking = true;
        if (rng() < 0.04 * Math.min(1, amount / ZONE_DAMAGE.engine)) startFire(ac);
        if (z.engine >= 1) d.engineDead = true;
        break;
      case 'fuelTank':
        if (rng() < 0.35) d.fuelLeak = true;
        // Splinters (flak, ground fire) are smaller than a bullet strike: fewer fires.
        if (rng() < (0.06 + 0.1 * z.fuelTank) * Math.min(1, amount / ZONE_DAMAGE.fuelTank)) startFire(ac);
        break;
      case 'pilot':
      case 'gunner': {
        // The box is larger than the man: not every round finds him.
        z[zone] = Math.max(0, z[zone] - amount);
        if (rng() > 0.45) break;
        z[zone] = Math.min(1, z[zone] + amount);
        if (zone === 'pilot') {
          // Splinters (flak, ground fire) mostly wound; a full bullet strike is likelier to kill.
          const severity = 0.3 + 0.7 * Math.min(1, amount / ZONE_DAMAGE.pilot);
          // Most hits wound. The chance that this one kills grows with the wounds already
          // taken (z.pilot accumulates ~0.22 per bullet; the fifth is certainly fatal).
          const killed = z.pilot >= 1 || rng() < (0.07 + 0.25 * z.pilot) * severity;
          if (killed) {
            z.pilot = 1;
            d.pilotKilled = true;
          }
          d.pilotWounded = true;
          bus.emit({ type: 'pilot-hit', aircraftId: ac.id, killed });
          if (killed) destroy(ac, 'pilot-killed', attackerId);
          if (d.crewWounds && ac.spec.crewStations) d.crewWounds[0] = z.pilot;
        } else if (d.crewWounds && ac.spec.crewStations) {
          // Explicit stations: the round finds one crew member; the zone holds the worst wound.
          const cw = d.crewWounds;
          const c = index ?? firstFitGunner(cw);
          if (c > 0 && c < cw.length) {
            cw[c] = Math.min(1, cw[c] + amount);
            if (cw[c] >= 1 || rng() < 0.25) cw[c] = 1;
          }
          z.gunner = Math.max(0, ...cw.slice(1));
        } else if (z.gunner >= 1 || rng() < 0.25) {
          z.gunner = 1;
          m.gunnerKilled = true;
        }
        break;
      }
      case 'guns':
        if (rng() < 0.25) {
          const g = ac.guns[Math.floor(rng() * ac.guns.length)];
          if (g && !g.jammed && getRealism().gunJams) {
            g.jammed = true;
            g.jamClearProgress = 0;
            bus.emit({ type: 'gun-jammed', aircraftId: ac.id, mountIndex: g.mountIndex });
          }
        }
        break;
      case 'leftWing':
      case 'rightWing':
      case 'tail':
        if (z[zone] >= 1) structuralFailure(ac, zone);
        break;
      case 'fuselage':
        if (z.fuselage >= 1) structuralFailure(ac, 'tail');
        break;
      default:
        break;
    }
  }

  /** The first crew member after the pilot who isn't dead (the one a stray round finds). */
  function firstFitGunner(cw: number[]): number {
    for (let i = 1; i < cw.length; i++) if (cw[i] < 1) return i;
    return cw.length - 1;
  }

  function startFire(ac: AircraftEntity) {
    if (ac.damage.onFire) return;
    ac.damage.onFire = true;
    ac.damage.smoking = true;
    mem(ac).fireTime = 0;
    bus.emit({ type: 'fire-started', aircraftId: ac.id });
  }

  // -------------------------------------------------------------- guns
  function spawnBullet(ac: AircraftEntity, mountIndex: number, dirWorld: Vector3, dispersion: number) {
    const m = ac.spec.guns[mountIndex];
    const gun = GUNS[m.type];
    const b = pool.pop() ?? ({ position: new Vector3(), velocity: new Vector3(), prev: new Vector3() } as Bullet);
    mountWorldPosition(ac, m, b.position);
    b.prev.copy(b.position);
    // Dispersion: random small perpendicular offset.
    tmpDisp.set(gaussian(rng), gaussian(rng), gaussian(rng)).multiplyScalar(dispersion).add(dirWorld).normalize();
    b.velocity.copy(ac.state.velocity).addScaledVector(tmpDisp, gun.muzzleVelocity);
    const mm = mem(ac);
    mm.roundCount[mountIndex]++;
    b.tracer = mm.roundCount[mountIndex] % 4 === 0;
    b.side = ac.side;
    b.age = 0;
    b.shooterId = ac.id;
    b.gun = m.type;
    bullets.push(b);
    bus.emit({ type: 'gun-fired', shooterId: ac.id, gun: m.type, position: b.position.clone(), mountIndex });
  }

  function fixedGunDirection(ac: AircraftEntity, m: GunMount, out: Vector3): Vector3 {
    // Converge on the sight line (eye ~0.8 m above CG) at CONVERGENCE metres, with drop allowance.
    const drop = 0.5 * G * (CONVERGENCE / GUNS[m.type].muzzleVelocity) ** 2;
    return out
      .set(-m.position[0], 0.8 + drop - m.position[1], -CONVERGENCE - m.position[2])
      .normalize()
      .applyQuaternion(ac.state.orientation);
  }

  function tryFire(ac: AircraftEntity, index: number, dir: Vector3, dispersion: number, rpm: number): boolean {
    const g = ac.guns[index];
    const m = ac.spec.guns[index];
    const realism = getRealism();
    if (g.jammed || g.reloading > 0 || ac.damage.zones.guns >= 1) return false;
    if (g.roundsLeft <= 0) {
      if (g.sparesLeft > 0 && GUNS[m.type].drumChangeTime > 0) {
        g.reloading = GUNS[m.type].drumChangeTime;
        g.sparesLeft--;
        bus.emit({ type: 'drum-change', aircraftId: ac.id, mountIndex: index });
      } else if (!mem(ac).outOfAmmoReported[index]) {
        mem(ac).outOfAmmoReported[index] = true;
        bus.emit({ type: 'out-of-ammo', aircraftId: ac.id, mountIndex: index });
      }
      return false;
    }
    if (g.cooldown > 0) return false;
    g.cooldown += 60 / rpm;
    if (realism.limitedAmmo) g.roundsLeft--;
    g.heat = Math.min(1, g.heat + 0.02);
    spawnBullet(ac, index, dir, dispersion);
    if (realism.gunJams) {
      const p = GUNS[m.type].jamChancePerRound * (1 + 8 * g.heat * g.heat) * (1 + 3 * ac.damage.zones.guns);
      if (rng() < p) {
        g.jammed = true;
        g.jamClearProgress = 0;
        bus.emit({ type: 'gun-jammed', aircraftId: ac.id, mountIndex: index });
      }
    }
    return true;
  }

  /** One blow of the hammer at a jammed gun (~5 clear it). */
  function hammer(ac: AircraftEntity, g: GunState | undefined) {
    if (!g?.jammed) return;
    g.jamClearProgress += 0.16 + rng() * 0.12;
    if (g.jamClearProgress >= 1) {
      g.jammed = false;
      g.jamClearProgress = 0;
      bus.emit({ type: 'gun-cleared', aircraftId: ac.id, mountIndex: g.mountIndex });
    }
  }

  function updateGuns(ac: AircraftEntity, world: WorldQuery, dt: number) {
    const m = mem(ac);
    const alive = !ac.damage.destroyed && !ac.damage.pilotKilled && ac.outcome === null;
    for (const g of ac.guns) {
      g.cooldown = Math.max(-0.05, g.cooldown - dt);
      g.heat = Math.max(0, g.heat - dt * 0.08);
      if (g.reloading > 0) {
        g.reloading -= dt;
        if (g.reloading <= 0) {
          g.reloading = 0;
          g.roundsLeft = ac.spec.guns[g.mountIndex].rounds;
        }
      }
    }
    if (ac.controls.clearJam) {
      for (const g of ac.guns) hammer(ac, g);
      ac.controls.clearJam = false; // edge-triggered: one press per input edge
    }
    // The player at a gunner's station hammers his own guns (edge-triggered, consumed like the pilot's).
    const sIn = ac.stationInputs;
    if (sIn?.clearJam) {
      const st = crewStations(ac.spec).find((x) => x.id === sIn.station);
      for (const gi of st?.guns ?? []) hammer(ac, ac.guns[gi]);
      sIn.clearJam = false;
    }
    if (!alive) return;

    // Pilot's fixed guns.
    if (ac.controls.fireGuns) {
      for (let i = 0; i < ac.spec.guns.length; i++) {
        const mount = ac.spec.guns[i];
        if (mount.mount === 'flexible') continue;
        // Synchronised guns are driven by the engine's interrupter gear.
        if (mount.mount === 'fixed-synchronized' && ac.state.engineRpm < 200) continue;
        const spec = GUNS[mount.type];
        const rpm = mount.mount === 'fixed-synchronized' ? spec.rpmSynchronized : spec.rpmFree;
        fixedGunDirection(ac, mount, tmpDir);
        let guard = 0;
        while (guard++ < 4 && tryFire(ac, i, tmpDir, 0.0025, rpm)) {
          if (ac.guns[i].cooldown > 0) break;
        }
      }
    }

    // Gunners: the player at his station, the AI at the others.
    const si = ac.stationInputs;
    const playerStation = si && si.station !== 'pilot' ? crewStations(ac.spec).find((st) => st.id === si.station) : undefined;
    const multi = m.gunners.length > 1;
    for (const g of m.gunners) {
      if (!gunnerFit(ac, m, g)) {
        for (const st of g.stations) setStationAim(ac, st.station.id, null);
        continue;
      }
      if (playerStation && playerStation.crewIndex === g.crewIndex) playerGunner(ac, g, playerStation, si!);
      else updateGunner(ac, world, dt, g, multi);
    }
  }

  /** Can this crew member work his guns? Explicit stations: his `crewWounds`; else the `gunner` zone. */
  function gunnerFit(ac: AircraftEntity, m: CombatMemory, g: GunnerMem): boolean {
    const cw = ac.spec.crewStations ? ac.damage.crewWounds : undefined;
    if (cw) return (cw[g.crewIndex] ?? 0) < 1;
    return ac.spec.geometry.crew >= 2 && !m.gunnerKilled && ac.damage.zones.gunner < 1;
  }

  /** The player works the guns at his station: his aim, his trigger, the station's arcs. */
  function playerGunner(ac: AircraftEntity, g: GunnerMem, station: CrewStation, si: StationInputs) {
    for (const st of g.stations) if (st.station !== station) setStationAim(ac, st.station.id, null);
    const k = g.stations.findIndex((st) => st.station === station);
    if (k < 0) return;
    g.active = k;
    g.switching = 0;
    setStationAim(ac, station.id, si.aim);
    if (!si.fire || !inArcsWorld(ac, station.arcs, si.aim)) return;
    for (const gi of g.stations[k].guns) {
      const rpm = GUNS[ac.spec.guns[gi].type].rpmFree;
      let guard = 0;
      while (guard++ < 4 && tryFire(ac, gi, si.aim, PLAYER_FLEX_DISPERSION, rpm)) {
        if (ac.guns[gi].cooldown > 0) break;
      }
    }
  }

  /** Does any of the gunner's stations bear on the aircraft (no lead)? */
  function bearsOn(ac: AircraftEntity, g: GunnerMem, o: AircraftEntity): boolean {
    for (const st of g.stations) {
      const muzzle = mountWorldPosition(ac, ac.spec.guns[st.guns[0]], tmpV);
      tmpDir.copy(o.state.position).sub(muzzle);
      if (inArcsWorld(ac, st.station.arcs, tmpDir)) return true;
    }
    return false;
  }

  /** Nearest live enemy within 1.3x range; with `bearing`, only those his stations bear on. */
  function pickTarget(ac: AircraftEntity, world: WorldQuery, range: number, bearing: GunnerMem | null): number | null {
    let best: AircraftEntity | null = null;
    let bestD = range * 1.3;
    for (const o of world.aircraft) {
      if (o.side === ac.side || o.damage.destroyed || o.outcome !== null) continue;
      const d = o.state.position.distanceTo(ac.state.position);
      if (d >= bestD) continue;
      if (bearing && !bearsOn(ac, bearing, o)) continue;
      bestD = d;
      best = o;
    }
    return best?.id ?? null;
  }

  function liveEnemy(ac: AircraftEntity, world: WorldQuery, id: number | null): AircraftEntity | null {
    if (id === null) return null;
    const t = world.getEntity(id);
    if (!t || t.kind !== 'aircraft' || t.damage.destroyed || t.side === ac.side) return null;
    return t;
  }

  /**
   * Firing solution from station `k` of the gunner at `target`: leaves rel (tmpA), relative
   * velocity (tmpB) and the drop-compensated direction (tmpDir). -1 out of range, 0 out of
   * arc, 1 in arc.
   */
  function solve(ac: AircraftEntity, g: GunnerMem, k: number, target: AircraftEntity, range: number): number {
    const rel = tmpA.copy(target.state.position).sub(ac.state.position);
    const dist = rel.length();
    if (dist > range) return -1;
    const gi = g.stations[k].guns[0];
    // Lead: bullets inherit our velocity, so aim with relative velocity.
    const mv = GUNS[ac.spec.guns[gi].type].muzzleVelocity;
    const relVel = tmpB.copy(target.state.velocity).sub(ac.state.velocity);
    let t = dist / mv;
    for (let i = 0; i < 2; i++) t = tmpV.copy(rel).addScaledVector(relVel, t).length() / mv;
    const aimPoint = tmpV.copy(target.state.position).addScaledVector(relVel, t);
    return aimFlexibleGun(ac, gi, aimPoint, tmpDir).inArc ? 1 : 0;
  }

  /**
   * Station the gunner can shoot `target` from: his current one if it bears, else the one
   * with the most guns that does, which he then moves to (GUNNER_SWITCH_S). -1: no shot.
   * Returns the station index, or -2 when he has just started moving.
   */
  function stationFor(ac: AircraftEntity, g: GunnerMem, target: AircraftEntity, range: number): number {
    const r = solve(ac, g, g.active, target, range);
    if (r === 1) return g.active;
    if (r < 0 || g.stations.length === 1) return -1;
    let best = -1;
    for (let k = 0; k < g.stations.length; k++) {
      if (k === g.active || solve(ac, g, k, target, range) !== 1) continue;
      if (best < 0 || g.stations[k].guns.length > g.stations[best].guns.length) best = k;
    }
    if (best < 0) return -1;
    g.active = best;
    g.switching = GUNNER_SWITCH_S;
    return -2;
  }

  function updateGunner(ac: AircraftEntity, world: WorldQuery, dt: number, g: GunnerMem, multi: boolean) {
    for (const st of g.stations) setStationAim(ac, st.station.id, null);
    if (g.switching > 0) {
      g.switching -= dt;
      return;
    }
    const range = GUNNER_RANGE[ac.skill];
    const asg = gunnerTargets.get(ac);
    let strict = false;
    let targetId: number | null = null;
    if (asg) {
      for (const st of g.stations) {
        const t = asg.stations.get(st.station.id);
        if (t !== undefined) {
          targetId = t;
          strict = true;
          break;
        }
      }
      if (!strict) targetId = asg.all;
    }
    let target: AircraftEntity | null;
    let k: number;
    if (!multi) {
      // One gunner aboard (every two-seater): the nearest threat, or the assigned one.
      if (targetId === null) {
        g.retarget -= dt;
        if (g.retarget <= 0) {
          g.retarget = 0.5;
          g.autoTarget = pickTarget(ac, world, range, null);
        }
        targetId = g.autoTarget;
      }
      target = liveEnemy(ac, world, targetId);
      if (!target) return;
      k = stationFor(ac, g, target, range);
    } else {
      // Several gunners: each keeps his own watch, the nearest enemy his guns bear on, and
      // falls back to it when the aircraft-wide target is out of his arcs.
      g.retarget -= dt;
      if (g.retarget <= 0) {
        g.retarget = 0.5;
        g.autoTarget = pickTarget(ac, world, range, g);
      }
      target = liveEnemy(ac, world, targetId ?? g.autoTarget);
      k = target ? stationFor(ac, g, target, range) : -1;
      if (k === -1 && !strict && targetId !== null && g.autoTarget !== targetId) {
        target = liveEnemy(ac, world, g.autoTarget);
        k = target ? stationFor(ac, g, target, range) : -1;
      }
      if (!target) return;
    }
    if (k < 0) return;
    const station = g.stations[k];
    setStationAim(ac, station.station.id, tmpDir);
    // Bursts with pauses.
    if (g.pause > 0) {
      g.pause -= dt;
      return;
    }
    g.burst += dt;
    if (g.burst > 1.5 + rng() * 1.0) {
      g.burst = 0;
      g.pause = 0.8 + rng() * 1.4;
      return;
    }
    // Harder to hold on target when our own machine is manoeuvring or the target is crossing fast.
    const rel = tmpA;
    const relVel = tmpB;
    const dist = rel.length();
    const ownRate = ac.state.angularVelocity.length();
    const crossRate = tmpV.copy(relVel).addScaledVector(rel, -relVel.dot(rel) / Math.max(1, dist * dist)).length() / Math.max(1, dist);
    const cw = ac.spec.crewStations ? ac.damage.crewWounds : undefined;
    const ownWound = cw ? (cw[g.crewIndex] ?? 0) : 0;
    const err = GUNNER_ERROR[ac.skill] * (1 + (ac.damage.pilotWounded ? 0.5 : 0)) * (1 + ownWound) * (1 + ownRate + 3 * crossRate);
    for (const gi of station.guns) tryFire(ac, gi, tmpDir, err, GUNS[ac.spec.guns[gi].type].rpmFree);
  }

  // ------------------------------------------------------------ bullets
  function hitAircraft(b: Bullet, world: WorldQuery, dt: number): boolean {
    for (const ac of world.aircraft) {
      if (ac.id === b.shooterId) continue;
      if (getSimInternal(ac).impacted) continue;
      const hm = getHitModel(ac.spec);
      const p = ac.state.position;
      const v = ac.state.velocity;
      // Relative segment: bullet vs target's previous and current position.
      const ax = b.prev.x - (p.x - v.x * dt);
      const ay = b.prev.y - (p.y - v.y * dt);
      const az = b.prev.z - (p.z - v.z * dt);
      const bx = b.position.x - p.x;
      const by = b.position.y - p.y;
      const bz = b.position.z - p.z;
      if (pointSegmentDistanceSq(0, 0, 0, ax, ay, az, bx, by, bz) > hm.radius * hm.radius) continue;
      tmpQ.copy(ac.state.orientation).invert();
      tmpA.set(ax, ay, az).applyQuaternion(tmpQ);
      tmpB.set(bx, by, bz).applyQuaternion(tmpQ);
      let firstT = 2;
      for (const zb of hm.zones) {
        const t = segmentBox(tmpA.x, tmpA.y, tmpA.z, tmpB.x, tmpB.y, tmpB.z, zb);
        if (t >= 0 && t < firstT) firstT = t;
      }
      if (firstT > 1) continue;
      // Rounds pass through fabric: trace the full path through the airframe from the entry point.
      const segLen = tmpB.distanceTo(tmpA);
      tmpDir.copy(tmpB).sub(tmpA).multiplyScalar(1 / Math.max(segLen, 1e-6));
      tmpA.addScaledVector(tmpDir, segLen * firstT);
      tmpB.copy(tmpA).addScaledVector(tmpDir, hm.radius * 2);
      let best: DamageZone | null = null;
      let bestPri = 99;
      const hitZones: DamageZone[] = [];
      for (const zb of hm.zones) {
        if (segmentBox(tmpA.x, tmpA.y, tmpA.z, tmpB.x, tmpB.y, tmpB.z, zb) < 0) continue;
        hitZones.push(zb.zone);
        const pri = HIT_PRIORITY.indexOf(zb.zone);
        if (pri < bestPri) {
          bestPri = pri;
          best = zb.zone;
        }
      }
      if (!best) continue;
      const hitPos = tmpV.copy(b.prev).lerp(b.position, Math.min(1, firstT)).clone();
      const shooter = b.shooterId;
      bus.emit({ type: 'bullet-hit', targetId: ac.id, shooterId: shooter, position: hitPos, zone: best });
      // The engine block stops a round; anything behind it along the path is spared.
      const engineIdx = hitZones.indexOf('engine');
      if (engineIdx >= 0) hitZones.length = engineIdx + 1;
      for (const z of hitZones) damageAircraft(ac, z, ZONE_DAMAGE[z], shooter, now);
      return true;
    }
    return false;
  }

  function hitBalloon(b: Bullet, world: WorldQuery): boolean {
    for (const bl of world.balloons) {
      if (bl.destroyed) continue;
      const c = bl.position;
      if (
        pointSegmentDistanceSq(c.x, c.y, c.z, b.prev.x, b.prev.y, b.prev.z, b.position.x, b.position.y, b.position.z) >
        BALLOON_RADIUS * BALLOON_RADIUS
      )
        continue;
      bus.emit({ type: 'bullet-hit', targetId: bl.id, shooterId: b.shooterId, position: b.position.clone(), zone: 'balloon' });
      damageBalloon(bl, b.shooterId);
      return true;
    }
    return false;
  }

  function damageBalloon(bl: BalloonEntity, shooterId: number | null) {
    bl.health = Math.max(0, bl.health - 0.035);
    if (bl.health < 0.6) bl.observerBailed = true;
    // Incendiary/tracer rounds: small chance each hit touches off the hydrogen.
    if (bl.health <= 0 || rng() < 0.02) igniteBalloon(bl, shooterId);
  }

  function igniteBalloon(bl: BalloonEntity, killerId: number | null) {
    if (bl.burning) return;
    bl.burning = true;
    bl.destroyed = true;
    bl.observerBailed = true;
    bl.health = 0;
    bus.emit({ type: 'balloon-destroyed', balloonId: bl.id, killerId, position: bl.position.clone() });
    bus.emit({ type: 'explosion', position: bl.position.clone(), size: 3 });
  }

  function hitGround(b: Bullet, world: WorldQuery): boolean {
    for (const gt of world.groundTargets) {
      if (gt.destroyed) continue;
      const spec = GROUND_TARGET_BOXES[gt.type];
      const p = gt.position;
      const r = Math.hypot(spec.hx, spec.hz) + spec.h;
      if (
        pointSegmentDistanceSq(p.x, p.y + spec.h / 2, p.z, b.prev.x, b.prev.y, b.prev.z, b.position.x, b.position.y, b.position.z) >
        r * r
      )
        continue;
      // Into the target's local frame (rotate by -heading about Y).
      const c = Math.cos(gt.heading);
      const s = Math.sin(gt.heading);
      const lx = (x: number, z: number) => x * c + z * s;
      const lz = (x: number, z: number) => -x * s + z * c;
      const ax = b.prev.x - p.x, az = b.prev.z - p.z, bx = b.position.x - p.x, bz = b.position.z - p.z;
      const t = segmentBox(lx(ax, az), b.prev.y - p.y, lz(ax, az), lx(bx, bz), b.position.y - p.y, lz(bx, bz), {
        min: [-spec.hx, 0, -spec.hz],
        max: [spec.hx, spec.h, spec.hz],
      });
      if (t < 0) continue;
      bus.emit({ type: 'bullet-hit', targetId: gt.id, shooterId: b.shooterId, position: b.position.clone(), zone: 'ground' });
      damageGround(gt, spec.damagePerHit, b.shooterId);
      return true;
    }
    return false;
  }

  function damageGround(gt: GroundTargetEntity, amount: number, killerId: number | null) {
    gt.health = Math.max(0, gt.health - amount);
    if (gt.health <= 0 && !gt.destroyed) {
      gt.destroyed = true;
      bus.emit({ type: 'ground-destroyed', targetId: gt.id, killerId, position: gt.position.clone() });
      bus.emit({ type: 'explosion', position: gt.position.clone(), size: GROUND_TARGET_BOXES[gt.type].blast });
    }
  }

  let impactCounter = 0;
  function updateBullets(world: WorldQuery, dt: number) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.prev.copy(b.position);
      const sp = b.velocity.length();
      b.velocity.multiplyScalar(Math.max(0, 1 - DRAG_K * sp * dt));
      b.velocity.y -= G * dt;
      b.position.addScaledVector(b.velocity, dt);
      b.age += dt;
      let dead = b.age > BULLET_LIFE;
      if (!dead) dead = hitAircraft(b, world, dt) || hitBalloon(b, world) || hitGround(b, world);
      if (!dead && b.position.y < world.groundHeightAt(b.position.x, b.position.z)) {
        dead = true;
        if (impactCounter++ % 2 === 0) bus.emit({ type: 'bullet-impact-ground', position: b.position.clone() });
      }
      if (dead) {
        bullets[i] = bullets[bullets.length - 1];
        bullets.pop();
        pool.push(b);
      }
    }
  }

  // --------------------------------------------------- per-aircraft status
  function updateStatus(ac: AircraftEntity, dt: number) {
    const m = mem(ac);
    const d = ac.damage;
    const it = getSimInternal(ac);

    if (d.onFire && !(d.destroyed && it.impacted)) {
      m.fireTime += dt;
      d.zones.fuselage = Math.min(1, d.zones.fuselage + dt * 0.02);
      d.zones.fuelTank = Math.min(1, d.zones.fuelTank + dt * 0.03);
      const slipping = Math.abs(ac.state.sideslip) > 0.17;
      if (!d.destroyed && rng() < dt * (0.03 + (slipping ? 0.1 : 0))) {
        d.onFire = false; // blown out
      } else if (!d.destroyed && m.fireTime > m.burnLimit && !isProtected(ac)) {
        d.pilotKilled = true;
        d.zones.pilot = 1;
        destroy(ac, 'shot-down', creditFor(ac));
      }
    }
    if (d.engineDead && !m.prevEngineDead) {
      m.prevEngineDead = true;
      bus.emit({ type: 'engine-dead', aircraftId: ac.id });
    }
    if (d.structuralFailure && !m.reported) {
      bus.emit({ type: 'structural-failure', aircraftId: ac.id, part: it.failedPart ?? 'tail' });
      const killer = creditFor(ac);
      destroy(ac, killer !== null ? 'shot-down' : 'crashed', killer);
    }
    // Sim set a ground outcome (crashed / ditched): a victory for whoever forced it down.
    if (ac.outcome !== m.prevOutcome) {
      m.prevOutcome = ac.outcome;
      if ((ac.outcome === 'crashed' || ac.outcome === 'ditched') && !m.reported) destroy(ac, ac.outcome, creditFor(ac));
    }
    if (it.impacted && !m.impactReported) {
      m.impactReported = true;
      bus.emit({ type: 'explosion', position: ac.state.position.clone(), size: d.onFire ? 1.5 : 1 });
    }
  }

  // --------------------------------------------------------- collisions
  const collidedAt = new Map<number, number>();
  function updateCollisions(world: WorldQuery) {
    if (!getRealism().midairCollisions) return;
    const list = world.aircraft;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (getSimInternal(a).impacted) continue;
      const ra = getHitModel(a.spec).collisionRadius;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (getSimInternal(b).impacted) continue;
        const rb = getHitModel(b.spec).collisionRadius;
        const r = ra + rb;
        if (a.state.position.distanceToSquared(b.state.position) > r * r) continue;
        // Two wrecks tumbling down together don't collide again; any pair reports at most once a second.
        if (a.damage.destroyed && b.damage.destroyed) continue;
        const pairKey = a.id < b.id ? a.id * 100_000 + b.id : b.id * 100_000 + a.id;
        if (now - (collidedAt.get(pairKey) ?? -Infinity) < 1) continue;
        collidedAt.set(pairKey, now);
        const relSpeed = tmpA.copy(a.state.velocity).sub(b.state.velocity).length();
        const pos = tmpB.copy(a.state.position).lerp(b.state.position, 0.5).clone();
        bus.emit({ type: 'collision', aId: a.id, bId: b.id, position: pos });
        for (const [x, other] of [
          [a, b],
          [b, a],
        ] as const) {
          if (isProtected(x)) continue;
          if (relSpeed > 12) {
            if (!x.damage.destroyed) destroy(x, 'collided', null);
            structuralFailure(x, rng() < 0.5 ? 'leftWing' : 'rightWing');
          } else {
            damageAircraft(x, rng() < 0.5 ? 'leftWing' : 'rightWing', 0.35, null, now);
            // Nudge apart so a slow scrape doesn't repeat every frame.
            tmpA.copy(x.state.position).sub(other.state.position).normalize();
            x.state.velocity.addScaledVector(tmpA, 2);
          }
        }
      }
      // Flying into a balloon envelope.
      for (const bl of world.balloons) {
        const rr = BALLOON_RADIUS + ra * 0.6;
        if (a.state.position.distanceToSquared(bl.position) > rr * rr) continue;
        if (!isProtected(a) && !a.damage.destroyed) {
          bus.emit({ type: 'collision', aId: a.id, bId: bl.id, position: bl.position.clone() });
          destroy(a, 'collided', null);
          structuralFailure(a, 'leftWing');
        }
        if (!bl.burning) igniteBalloon(bl, null);
      }
    }
  }

  // ------------------------------------------------------ flak & ground fire
  function threatAssessment(ac: AircraftEntity, world: WorldQuery) {
    const p = ac.state.position;
    const enemyGround = world.sideOfFrontAt(p.x, p.z) !== ac.side;
    let nearFront = false;
    if (enemyGround) {
      for (const [dx, dz] of [
        [5000, 0],
        [-5000, 0],
        [0, 5000],
        [0, -5000],
      ]) {
        if (world.sideOfFrontAt(p.x + dx, p.z + dz) === ac.side) {
          nearFront = true;
          break;
        }
      }
    }
    let balloon = false;
    for (const bl of world.balloons) {
      if (bl.side === ac.side || bl.destroyed) continue;
      if (Math.hypot(bl.position.x - p.x, bl.position.z - p.z) < 3000) {
        balloon = true;
        break;
      }
    }
    let aaGuns = 0;
    for (const gt of world.groundTargets) {
      if (gt.type !== 'aa-gun' || gt.destroyed || gt.side === ac.side) continue;
      if (Math.hypot(gt.position.x - p.x, gt.position.z - p.z) < 4000) aaGuns++;
    }
    return { enemyGround, nearFront, balloon, aaGuns };
  }

  function updateFlak(ac: AircraftEntity, world: WorldQuery, dt: number) {
    const m = mem(ac);
    if (ac.damage.destroyed || ac.outcome !== null || ac.state.onGround) return;
    const agl = ac.state.heightAboveGround;
    m.flakTimer -= dt;
    m.groundFireTimer -= dt;

    if (flakEnabled && m.flakTimer <= 0 && agl > 500) {
      const t = threatAssessment(ac, world);
      let interval = 0;
      let sigma = 75 + agl * 0.02;
      if (t.balloon) {
        interval = 2.5 + rng() * 2;
        sigma *= 0.75;
      } else if (t.aaGuns > 0) {
        interval = (3 + rng() * 2) / Math.min(2, t.aaGuns);
      } else if (t.nearFront) {
        interval = 4 + rng() * 3;
      } else if (t.enemyGround) {
        interval = 10 + rng() * 8;
      }
      if (interval === 0) {
        m.flakTimer = 3;
      } else {
        m.flakTimer = interval;
        const tf = 2 + ac.state.position.y / 700;
        const pos = ac.state.position.clone().addScaledVector(ac.state.velocity, tf);
        pos.x += gaussian(rng) * sigma;
        pos.y += gaussian(rng) * sigma * 1.3; // fuse timing error
        pos.z += gaussian(rng) * sigma;
        pending.push({ time: now + tf, position: pos, firingSide: ac.side === 'allied' ? 'central' : 'allied', lethalRadius: 30 });
      }
    }

    if (groundFireEnabled && m.groundFireTimer <= 0) {
      m.groundFireTimer = 1;
      if (agl < 250) {
        const p = ac.state.position;
        const hostile = world.sideOfFrontAt(p.x, p.z) !== ac.side;
        if (hostile && rng() < 0.05 * (1 - agl / 250)) {
          const zones: DamageZone[] = ['leftWing', 'rightWing', 'fuselage', 'engine', 'tail', 'pilot', 'fuelTank'];
          damageAircraft(ac, zones[Math.floor(rng() * zones.length)], 0.04, null, now);
        }
      }
    }
  }

  function updatePendingFlak(world: WorldQuery) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const f = pending[i];
      if (f.time > now) continue;
      pending.splice(i, 1);
      bus.emit({ type: 'flak-burst', position: f.position });
      for (const ac of world.aircraft) {
        if (ac.side === f.firingSide || getSimInternal(ac).impacted) continue;
        const d = ac.state.position.distanceTo(f.position);
        if (d > f.lethalRadius) continue;
        const scale = (1 - d / f.lethalRadius) ** 2;
        const n = Math.floor(8 * scale + rng());
        const zones: DamageZone[] = ['leftWing', 'rightWing', 'leftWing', 'rightWing', 'fuselage', 'fuselage', 'tail', 'engine', 'fuelTank', 'controls', 'pilot'];
        for (let k = 0; k < n; k++) damageAircraft(ac, zones[Math.floor(rng() * zones.length)], 0.03, null, now);
      }
    }
  }

  // ------------------------------------------------------------ system
  const system: SimCombatSystem = {
    get bullets() {
      return bullets;
    },
    get pendingFlak() {
      return pending;
    },
    damageAircraft,
    update(world: WorldQuery, dt: number) {
      now = world.time;
      for (const ac of world.aircraft) {
        mem(ac);
        updateGuns(ac, world, dt);
      }
      updateBullets(world, dt);
      updateCollisions(world);
      for (const ac of world.aircraft) {
        updateStatus(ac, dt);
        updateFlak(ac, world, dt);
      }
      updatePendingFlak(world);
    },
  };
  return system;
}
