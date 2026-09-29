/**
 * The player's crew seat in flight (docs/bombers.md, D-089 to D-091): the seat keys, the gunner's aim,
 * the bombsight and bomb release. The flight session owns one; it turns key commands into
 * seat changes on the SimCore, keeps the camera and input in step with the seat, writes the
 * station inputs (or the pilot's bomb release) before each sim step, and gives the HUD its
 * seat, sight and bomb fields.
 */
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import type { AircraftVisual } from '../core/interfaces';
import type { AircraftEntity, CrewStation, CrewStationId } from '../core/types';
import { crewStations, stationEye } from '../data/crew';
import { codeLabel } from '../ui/bindings';
import type { HudBombs, HudBombsight, HudGunnerSight, HudSeat, HudView } from '../ui/hud/types';
import { bombsLeft, driftAngle, nextStoreIndex, predictBombImpact, releaseSolution } from './bombsight';
import type { CameraRig } from './cameras';
import { arcBoundary, aimBodyVector, bombAimerStation, cycleStation, stationInputsFor, StationAim, stationOf } from './crewSeat';
import { pinToEdge, toScreen } from './hudView';
import type { EdgeAction, InputFrame } from './input';
import type { SimCore } from './simCore';

const DEFAULT_EYE = new Vector3(0, 1, 0);

export interface PlayerCrewDeps {
  core: Pick<SimCore, 'playerStation' | 'setPlayerStation' | 'world'>;
  rig: CameraRig;
  input: { stationMode: boolean; syncTo(ac: AircraftEntity): void };
  message(text: string): void;
  bindings(): Record<string, string[]>;
  /** The player's aircraft visual, once loaded. */
  visual(): AircraftVisual | undefined;
}

/** What the HUD needs from the crew seat (merged into HudView by buildHudView). */
export type CrewHudFields = Pick<HudView, 'seat' | 'gunnerSight' | 'bombsight' | 'bombs'> & {
  /** At a gunner's station: only his guns show on the HUD, as the player's own. */
  stationGuns?: readonly number[];
};

/**
 * Radius (m) round a target inside which the predicted impact counts as on target: the
 * target's own size plus a blast that grows with the cube root of the charge.
 * Keep near track A's blast radius (src/sim) when it lands.
 */
export function releaseRadiusM(explosiveKg: number): number {
  return 10 + 4 * Math.cbrt(Math.max(0, explosiveKg));
}

export class PlayerCrew {
  /** The gun's aim at a non-pilot station; null in the pilot's seat. */
  aim: StationAim | null = null;
  private fire = false;
  /** The release key is down (a held input: the sim drops one bomb per false-to-true edge). */
  private releaseHeld = false;
  private jamPending = false;
  private readonly eyeTmp = new Vector3();
  private readonly aimTmp = new Vector3();

  constructor(private readonly d: PlayerCrewDeps) {}

  private get player(): AircraftEntity | null {
    return this.d.core.world.player;
  }

  /** The station the player works. */
  get station(): CrewStation | undefined {
    const p = this.player;
    return p ? stationOf(p.spec, this.d.core.playerStation) : undefined;
  }

  get atGun(): boolean {
    return this.d.core.playerStation !== 'pilot';
  }

  /** Apply the seat the flight starts in (SimCore has already put him there). */
  start(): void {
    if (this.atGun) this.enterStation(this.d.core.playerStation, 'gunner');
  }

  private key(action: string): string {
    return codeLabel(this.d.bindings()[action]?.[0] ?? '?');
  }

  /** Handle a crew command; true when it was one (the session skips its own handling). */
  command(cmd: EdgeAction, waypointIndex: number): boolean {
    const p = this.player;
    switch (cmd) {
      case 'stationNext':
      case 'stationPrev': {
        if (!p) return true;
        const st = crewStations(p.spec);
        if (st.length < 2) {
          this.d.message('This machine has only the pilot.');
          return true;
        }
        this.takeSeat(cycleStation(st, this.d.core.playerStation, cmd === 'stationNext' ? 1 : -1), waypointIndex);
        return true;
      }
      case 'stationPilot':
        if (this.atGun) this.takeSeat('pilot', waypointIndex);
        return true;
      case 'viewCockpit':
        if (!this.atGun) return false;
        this.d.rig.setMode('gunner');
        return true;
      case 'viewBombsight':
        this.toggleBombsight(waypointIndex);
        return true;
      case 'releaseBomb':
        // The press only explains a release that can't happen; the held key does the releasing.
        this.explainRelease();
        return true;
      default:
        return false;
    }
  }

  private takeSeat(id: CrewStationId, waypointIndex: number, view?: 'gunner' | 'bombsight'): void {
    const p = this.player;
    if (!p || p.outcome !== null) return;
    const from = this.d.core.playerStation;
    if (!this.d.core.setPlayerStation(id, { fromWaypoint: waypointIndex })) return;
    if (id === 'pilot') {
      this.aim = null;
      this.fire = false;
      this.d.rig.station = null;
      this.d.input.stationMode = false;
      if (from !== 'pilot') this.d.input.syncTo(p);
      if (this.d.rig.mode === 'gunner' || this.d.rig.mode === 'bombsight') this.d.rig.setMode('cockpit');
      this.d.message('You have the controls.');
      return;
    }
    this.enterStation(id, view);
    const st = this.station!;
    this.d.message(`${st.label}. The pilot flies; ${this.key('stationPilot')} takes the controls back.`);
  }

  private enterStation(id: CrewStationId, view?: 'gunner' | 'bombsight'): void {
    const p = this.player!;
    const st = stationOf(p.spec, id)!;
    this.aim = new StationAim(st.arcs);
    this.fire = false;
    this.d.input.stationMode = true;
    this.d.rig.station = { eye: this.stationEyeBody(st, new Vector3()), aimBody: this.aim.body(new Vector3()) };
    const rig = this.d.rig;
    if (view) rig.setMode(view);
    else if (rig.inCockpit) rig.setMode(rig.mode === 'bombsight' && st.bombAimer ? 'bombsight' : 'gunner');
  }

  private toggleBombsight(waypointIndex: number): void {
    const p = this.player;
    if (!p) return;
    const aimer = bombAimerStation(p.spec);
    if (!aimer || !p.bombs) {
      this.d.message('No bomb racks on this sortie.');
      return;
    }
    const rig = this.d.rig;
    if (aimer.id === this.d.core.playerStation) {
      if (rig.mode === 'bombsight') rig.setMode(this.atGun ? 'gunner' : 'cockpit');
      else rig.setMode('bombsight');
      return;
    }
    this.takeSeat(aimer.id, waypointIndex, 'bombsight');
  }

  private explainRelease(): void {
    const p = this.player;
    if (!p) return;
    const aimer = bombAimerStation(p.spec);
    if (!aimer || !p.bombs) {
      this.d.message('No bomb racks on this sortie.');
      return;
    }
    if (bombsLeft(p.bombs) <= 0) {
      this.d.message('No bombs left.');
      return;
    }
    if (aimer.id !== this.d.core.playerStation) {
      this.d.message(`Your ${aimer.label.toLowerCase()} aims the bombs: ${this.key('viewBombsight')} takes his seat at the bombsight.`);
    }
  }

  /** Per rendered frame: the release key, and at a gun: swing it, read fire and clear-jam, keep the view on the seat. */
  applyInput(inp: InputFrame): void {
    this.releaseHeld = !!inp.controls.releaseBomb;
    if (!this.aim || !this.atGun) return;
    if (inp.stationAim) this.aim.move(MathUtils.radToDeg(inp.stationAim.azimuth), MathUtils.radToDeg(inp.stationAim.elevation));
    this.fire = inp.controls.fireGuns;
    if (inp.controls.clearJam) this.jamPending = true;
    const rig = this.d.rig;
    if (rig.station) {
      this.aim.body(rig.station.aimBody);
      // Eyes arrive with the model; keep the station's current.
      const st = this.station;
      if (st) this.stationEyeBody(st, rig.station.eye);
    }
    // A lost padlock drops to the cockpit view: at a gun, that's the gunner's view.
    if (rig.mode === 'cockpit') rig.setMode('gunner');
  }

  /**
   * Before each sim step (`first` for the frame's first): the station inputs from the aim,
   * with jam clearing a one-step edge and the bomb release held while its key is down; in
   * the pilot's seat, `controls.releaseBomb` held for a pilot who aims his own bombs and
   * false for any other (the session copies the key into the controls).
   */
  beforeStep(first: boolean): void {
    const p = this.player;
    if (!p || p.outcome !== null) return;
    if (this.atGun) {
      const st = this.station;
      if (!st || !this.aim) return;
      p.stationInputs = stationInputsFor(st, this.aim.body(this.aimTmp), p.state.orientation, { fire: this.fire, releaseBomb: this.releaseHeld, clearJam: first && this.jamPending }, p.stationInputs);
    } else {
      p.controls.releaseBomb = this.releaseHeld && bombAimerStation(p.spec)?.id === 'pilot';
    }
    if (first) this.jamPending = false;
  }

  /** Body-frame eye of the player's seat (for the camera rig's `eye`). */
  eye(out: Vector3): Vector3 {
    const st = this.station;
    if (!st || st.id === 'pilot') return out.copy(this.d.visual()?.eyePoint ?? DEFAULT_EYE);
    return this.stationEyeBody(st, out);
  }

  private stationEyeBody(st: CrewStation, out: Vector3): Vector3 {
    const v = this.d.visual();
    const fromModel = v?.stationEyes?.get(st.id);
    if (fromModel) return out.copy(fromModel);
    const p = this.player!;
    const e = stationEye(p.spec, st);
    if (e) return out.set(e[0], e[1], e[2]);
    return out.copy(v?.eyePoint ?? DEFAULT_EYE);
  }

  /** Swing the station's gun on the model (and the old rear-gun hook for today's models). */
  syncVisual(): void {
    const v = this.d.visual();
    const p = this.player;
    if (!v || !p || !this.aim || !this.atGun) return;
    const aimBody = this.aim.body(this.aimTmp);
    if (v.setStationAim) {
      v.setStationAim(this.d.core.playerStation, aimBody);
      return;
    }
    const ext = v as AircraftVisual & { aimFlexibleGun?: (p: Vector3 | null) => void };
    const eye = this.eye(this.eyeTmp).applyQuaternion(p.state.orientation).add(p.state.position);
    ext.aimFlexibleGun?.(eye.addScaledVector(aimBody.applyQuaternion(p.state.orientation), 200));
  }

  /** True while the player's own station decides where the flexible gun points (skip the AI gunner visual). */
  get aimsFlexibleGun(): boolean {
    return this.atGun && !!this.aim;
  }

  hud(camera: PerspectiveCamera): CrewHudFields {
    const p = this.player;
    if (!p) return {};
    const stations = crewStations(p.spec);
    const st = this.station;
    const out: CrewHudFields = {};
    if (stations.length > 1 && st) {
      const seat: HudSeat = { label: st.label, index: stations.indexOf(st) + 1, count: stations.length, aiFlying: st.id !== 'pilot' };
      out.seat = seat;
    }
    if (p.bombs && p.spec.bombs) {
      const next = nextStoreIndex(p.spec, p.bombs);
      const bombs: HudBombs = { left: bombsLeft(p.bombs), total: p.spec.bombs.reduce((a, b) => a + b.count, 0), next: next === null ? null : p.spec.bombs[next].name };
      out.bombs = bombs;
    }
    if (st && st.id !== 'pilot') out.stationGuns = st.guns;
    const mode = this.d.rig.mode;
    if (mode === 'gunner' && this.aim && st) out.gunnerSight = this.gunnerSight(p, st, camera);
    if (mode === 'bombsight') out.bombsight = this.bombsight(p, camera);
    return out;
  }

  private gunnerSight(p: AircraftEntity, st: CrewStation, camera: PerspectiveCamera): HudGunnerSight {
    const q = p.state.orientation;
    const eyeW = this.eye(this.eyeTmp).applyQuaternion(q).add(p.state.position);
    const dir = new Vector3();
    const pt = new Vector3();
    const ring = toScreen(camera, pt.copy(this.aim!.body(dir)).applyQuaternion(q).multiplyScalar(500).add(eyeW));
    const arcEdges: { x: number; y: number }[][] = [];
    camera.updateMatrixWorld();
    for (const line of arcBoundary(st.arcs)) {
      let run: { x: number; y: number }[] = [];
      for (const [az, el] of line) {
        aimBodyVector(az, el, dir).applyQuaternion(q);
        pt.copy(dir).multiplyScalar(500).add(eyeW);
        const cam = pt.clone().applyMatrix4(camera.matrixWorldInverse);
        if (cam.z > -1) {
          if (run.length > 1) arcEdges.push(run);
          run = [];
          continue;
        }
        const s = toScreen(camera, pt);
        run.push({ x: s.x, y: s.y });
      }
      if (run.length > 1) arcEdges.push(run);
    }
    return { ring, limited: this.aim!.limited, arcEdges };
  }

  /**
   * Per frame, before the camera: in the bombsight view, predict the impact and point the
   * sight line at it (as the aimer set a course-setting sight for height and speed).
   */
  frame(): void {
    const p = this.player;
    this.sight = null;
    if (!p || this.d.rig.mode !== 'bombsight') return;
    const s = p.state;
    const world = this.d.core.world;
    const store = nextStoreIndex(p.spec, p.bombs) ?? 0;
    const bomb = p.spec.bombs?.[store];
    // TODO(bombers merge): src/sim predictBombImpact(p, env, store) runs the sim's own integrator.
    const impact = bomb ? predictBombImpact(s.position, s.velocity, world.env, bomb.massKg) : null;
    const targets = world.groundTargets.filter((g) => !g.destroyed && g.side !== p.side).map((g) => ({ id: g.id, position: g.position }));
    const solution = impact ? releaseSolution(impact.point, s.velocity, targets, releaseRadiusM(bomb?.explosiveKg ?? 0)) : null;
    this.sight = { impact: impact?.point ?? null, solution };
    if (impact) {
      const eye = this.eye(this.eyeTmp).applyQuaternion(s.orientation).add(s.position);
      this.d.rig.bombsightDepression = Math.atan2(eye.y - impact.point.y, Math.hypot(impact.point.x - eye.x, impact.point.z - eye.z));
    } else this.d.rig.bombsightDepression = Math.PI / 2;
  }

  private sight: { impact: Vector3 | null; solution: ReturnType<typeof releaseSolution> | null } | null = null;

  private bombsight(p: AircraftEntity, camera: PerspectiveCamera): HudBombsight {
    const s = p.state;
    const world = this.d.core.world;
    const fwd = new Vector3(0, 0, -1).applyQuaternion(s.orientation);
    const impact = this.sight?.impact ?? null;
    const sol = this.sight?.solution ?? null;
    const target = sol?.targetId != null ? world.getEntity(sol.targetId) : undefined;
    // The wire: the ground track from behind the impact point to well ahead of it.
    const wire: { x: number; y: number }[] = [];
    const gs = Math.hypot(s.velocity.x, s.velocity.z);
    if (impact && gs > 1) {
      camera.updateMatrixWorld();
      const pt = new Vector3();
      for (let d = -1500; d <= 4000; d += 250) {
        pt.set(impact.x + (s.velocity.x / gs) * d, impact.y, impact.z + (s.velocity.z / gs) * d);
        const c = pt.clone().applyMatrix4(camera.matrixWorldInverse);
        if (c.z > -1) continue; // behind the sight
        const sp = toScreen(camera, pt);
        wire.push({ x: sp.x, y: sp.y });
      }
    }
    return {
      impact: impact ? pinToEdge(toScreen(camera, impact)) : null,
      driftAngle: driftAngle(fwd, s.velocity),
      wire,
      cue: sol?.cue ?? 'none',
      timeToRelease: sol?.cue === 'run-in' ? sol.timeToRelease : null,
      crossM: sol?.crossM ?? 0,
      // Still far up the track, the target sits above the sight: pin it to the edge.
      target: target && target.kind === 'ground' ? pinToEdge(toScreen(camera, target.position)) : null,
      releaseKey: this.key('releaseBomb'),
    };
  }
}
