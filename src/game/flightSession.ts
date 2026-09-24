/**
 * FlightSession: the in-flight loop. Builds the world from a mission,
 * composes sim/combat/AI/render/audio/HUD from `GameModules`, runs a fixed
 * 120 Hz simulation (AI at 30 Hz) with time compression and pause, and
 * resolves a MissionResult when the flight ends.
 */
import { Vector3, type Object3D } from 'three';
import { createEventBus } from '../core/events';
import type {
  AIController,
  AircraftVisual,
  AudioEngine,
  CombatSystem,
  EventBus,
  FlightLauncher,
  GameServices,
  WingmanCommand,
  WorldRenderer,
} from '../core/interfaces';
import type { AircraftEntity, GameEvent, GameSettings, MissionDefinition, MissionResult } from '../core/types';
import { CameraRig, type CameraMode } from './cameras';
import { advanceWaypoint, buildHudView } from './hudView';
import { InputManager, type EdgeAction } from './input';
import { MissionDirector } from './missionDirector';
import type { GameModules } from './moduleTypes';
import type { Hud } from '../ui/hud/types';
import type { MapMarker, MapView } from '../ui/map/mapRenderer';
import { resolveUnits } from '../ui/format';
import { buildWorld, type SessionWorld } from './world';

export const SIM_HZ = 120;
export const AI_EVERY_N_STEPS = 4; // 30 Hz
export const TIME_SCALES = [1, 2, 4, 8] as const;
const MAX_FRAME_DT = 0.1;
const COMPRESSION_SAFE_RANGE = 4000;
const DEFAULT_EYE = new Vector3(0, 1, 0);
const START_HINT = 'Mouse to steer · Space fire · +/− throttle · F1–F5 views · P padlock · O orders · M map · Esc menu';
const ORDER_LABELS: Record<WingmanCommand, string> = {
  'attack-my-target': 'Attack',
  'engage-at-will': 'Engage',
  'form-up': 'Form up',
  'cover-me': 'Cover',
  'return-home': 'Home',
};

export interface SessionDebug {
  readonly time: number;
  readonly timeScale: number;
  readonly paused: boolean;
  readonly cameraMode: CameraMode;
  readonly player: AircraftEntity | null;
  readonly world: SessionWorld;
  readonly frames: number;
  /** Resolves after the next rendered frame with canvas pixel statistics. */
  samplePixels(): Promise<{ distinctColors: number; nonBlack: number; total: number }>;
  command(action: EdgeAction): void;
  endFlight(): boolean;
  abandon(): void;
}

declare global {
  interface Window {
    __rb2?: { session: SessionDebug | null; services?: GameServices };
  }
}

export function createFlightLauncher(modules: GameModules, audio: AudioEngine): FlightLauncher {
  return {
    fly(mission, settings, container) {
      const session = new FlightSession(modules, audio, mission, settings, container);
      return session.run();
    },
  };
}

export class FlightSession {
  private bus: EventBus = createEventBus();
  private world!: SessionWorld;
  private renderer!: WorldRenderer;
  private combat!: CombatSystem;
  private director!: MissionDirector;
  private hud!: Hud;
  private input!: InputManager;
  private rig!: CameraRig;
  private mapOpen = false;
  private mapRedrawAt = 0;
  private ordersOpen = false;
  private waypointIndex = 0;
  private wingmanOrders = new Map<number, string>();
  private ai = new Map<number, AIController>();
  private visuals = new Map<number, AircraftVisual>();
  private entityObjects = new Map<number, Object3D>();
  private root!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private raf = 0;
  private lastT = 0;
  private accumulator = 0;
  private stepCount = 0;
  private timeScaleIdx = 0;
  private paused = false;
  private hudVisible = true;
  private gEffect = 0;
  private frames = 0;
  private wasAirborne = new Set<number>();
  private pixelRequests: ((s: { distinctColors: number; nonBlack: number; total: number }) => void)[] = [];
  private unsubs: (() => void)[] = [];
  private resolve!: (r: MissionResult) => void;
  private reject!: (e: unknown) => void;
  private finished = false;
  private onResize = () => this.resize();

  constructor(
    private readonly modules: GameModules,
    private readonly audio: AudioEngine,
    private readonly mission: MissionDefinition,
    private readonly settings: GameSettings,
    private readonly container: HTMLElement,
  ) {}

  run(): Promise<MissionResult> {
    return new Promise<MissionResult>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.setup().catch((e) => this.fail(e));
    });
  }

  private get timeScale(): number {
    return TIME_SCALES[this.timeScaleIdx];
  }

  private async setup(): Promise<void> {
    const { modules, mission, settings } = this;
    this.root = document.createElement('div');
    this.root.className = 'rb-flight';
    this.root.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#000';
    this.container.appendChild(this.root);
    const loading = document.createElement('div');
    loading.textContent = 'Preparing aircraft…';
    loading.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#efe6cf;font:18px Georgia,serif';
    this.root.appendChild(loading);
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none';
    this.canvas.tabIndex = 0;
    this.root.appendChild(this.canvas);

    const env = modules.createFlightEnvironment(modules.terrainHeightAt, mission.weather);
    this.world = buildWorld({ mission, modules, env, realism: settings.realism });
    this.renderer = modules.createWorldRenderer(this.canvas, { quality: settings.graphics, date: mission.date });
    this.renderer.setEnvironment(mission.date, mission.timeOfDay, mission.weather);
    this.combat = modules.createCombatSystem(this.bus, () => settings.realism);
    this.hud = modules.createHud(this.root, settings);
    this.director = new MissionDirector(this.world, this.bus, (from, text) => this.bus.emit({ type: 'radio', from, text }));

    // AI controllers for every non-player aircraft, including pending spawns.
    for (const [flightId, members] of this.world.flightMembers) {
      const flight = this.world.getFlight(flightId)!;
      const leaderId = members[0].id;
      members.forEach((ac, slot) => {
        if (ac.controller !== 'ai') return;
        const homeAerodromeId = flight.role === 'enemy' ? undefined : mission.homeAerodromeId;
        this.ai.set(ac.id, modules.createAIController(ac, { skill: ac.skill, flight, slot, leaderId, realism: settings.realism, homeAerodromeId }));
      });
    }

    // Visuals.
    const all = this.world.allAircraft();
    await modules.preloadAircraftModels([...new Set(all.map((a) => a.spec.id))]);
    const vis = await Promise.all(all.map((a) => modules.createAircraftVisual(a.spec, a.livery)));
    if (this.finished) return;
    all.forEach((a, i) => {
      this.visuals.set(a.id, vis[i]);
      vis[i].update(a, 0);
      vis[i].object.visible = this.world.aircraft.includes(a);
      this.renderer.scene.add(vis[i].object);
    });
    for (const b of this.world.balloons) {
      const o = this.renderer.createBalloonVisual(b);
      o.position.copy(b.position);
      this.renderer.scene.add(o);
      this.entityObjects.set(b.id, o);
    }
    for (const g of this.world.groundTargets) {
      const o = this.renderer.createGroundTargetVisual(g.type, g.side);
      o.position.copy(g.position);
      o.rotation.y = -g.heading;
      this.renderer.scene.add(o);
      this.entityObjects.set(g.id, o);
    }

    // Camera, input, overlays.
    this.rig = new CameraRig(settings.fov, 1);
    this.input = new InputManager(this.canvas, () => this.settings.controls);
    this.input.attach();
    const player = this.world.player;
    if (player) {
      this.input.setThrottle(player.controls.throttle);
      this.input.resetAim(player);
    } else {
      this.rig.setMode('chase');
    }
    // Event fan-out.
    this.unsubs.push(
      this.bus.onAny((e) => this.onEvent(e)),
    );
    window.addEventListener('resize', this.onResize);
    this.resize();
    loading.remove();
    this.canvas.focus();

    window.__rb2 = { ...window.__rb2, session: this.debugHandle() };
    this.bus.emit({ type: 'radio', from: '', text: `${mission.title}. Esc for the menu, M for the map.` });
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private debugHandle(): SessionDebug {
    const self = this;
    return {
      get time() {
        return self.world.time;
      },
      get timeScale() {
        return self.timeScale;
      },
      get paused() {
        return self.paused;
      },
      get cameraMode() {
        return self.rig.mode;
      },
      get player() {
        return self.world.player;
      },
      get world() {
        return self.world;
      },
      get frames() {
        return self.frames;
      },
      samplePixels: () => new Promise((res) => self.pixelRequests.push(res)),
      command: (a) => self.handleCommands([a]),
      endFlight: () => self.director.requestEndFlight(),
      abandon: () => self.director.abort(),
    };
  }

  private resize(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.renderer.resize(w, h);
    this.rig.setAspect(w / Math.max(1, h));
  }

  /** Pause/resume the simulation; `menu` shows the HUD pause card while paused. */
  private setPaused(p: boolean, menu = true): void {
    this.paused = p;
    if (p && document.pointerLockElement) document.exitPointerLock?.();
    if (!p) {
      this.hud.hidePauseMenu();
      this.canvas.focus();
      return;
    }
    if (!menu) return;
    this.hud.showPauseMenu({
      onResume: () => this.setPaused(false),
      onEndFlight: () => this.promptEndFlight(true),
      onQuit: () => {
        this.director.abort();
        this.setPaused(false);
      },
    });
  }

  /**
   * "End flight" (N or pause menu): confirm with the HUD card. Safe ends are
   * recorded as returned; unsafe ends are an abandon (captured if over enemy lines).
   */
  private promptEndFlight(fromPause = false): void {
    const r = this.director.canEndFlight();
    this.setPaused(true, false);
    this.hud.showEndFlightPrompt({
      safe: r.ok,
      reason: r.reason,
      onConfirm: () => {
        if (!this.director.requestEndFlight()) this.director.abort();
        this.setPaused(false);
      },
      onCancel: () => (fromPause ? this.setPaused(true) : this.setPaused(false)),
    });
  }

  private onEvent(e: GameEvent): void {
    this.renderer.handleEvent(e);
    this.audio.handleEvent(e, this.rig.camera.position);
    const player = this.world.player;
    if (e.type === 'radio') this.hud.showMessage(e.text, { from: e.from || undefined, kind: e.from ? 'radio' : 'info' });
    else if (e.type === 'bullet-hit' && player && e.targetId === player.id) this.hud.setDamageFlash(0.35);
    else if (e.type === 'objective-complete') this.hud.showMessage('Objective complete.', { kind: 'objective' });
    else if (player && e.type === 'aircraft-destroyed' && e.killerId === player.id && e.victimId !== player.id) {
      const v = this.world.getEntity(e.victimId);
      this.hud.showMessage(`${v && v.kind === 'aircraft' ? v.spec.name : 'Enemy'} going down!`, { kind: 'victory' });
    } else if (player && e.type === 'balloon-destroyed' && e.killerId === player.id) this.hud.showMessage('Balloon flamed!', { kind: 'victory' });
    else if (player && e.type === 'gun-jammed' && e.aircraftId === player.id) this.hud.showMessage('Gun jammed! Hammer the clear-jam key.', { kind: 'warning', duration: 3 });
  }

  private buildMapView(): MapView {
    const p = this.world.player;
    const units = resolveUnits(this.settings.units, p?.nation ?? 'britain').system;
    const markers: MapMarker[] = [];
    for (const a of this.world.aircraft) {
      if (a.outcome !== null) continue;
      const friendly = p && a.side === p.side;
      const near = p && a.state.position.distanceTo(p.state.position) < 6000;
      if (a !== p && !friendly && !near) continue;
      const fwd = new Vector3(0, 0, -1).applyQuaternion(a.state.orientation);
      markers.push({ kind: 'aircraft', x: a.state.position.x, z: a.state.position.z, side: a.side, heading: Math.atan2(fwd.x, -fwd.z), isPlayer: a === p });
    }
    for (const b of this.world.balloons) markers.push({ kind: 'balloon', x: b.position.x, z: b.position.z, side: b.side, destroyed: b.destroyed });
    for (const g of this.world.groundTargets)
      markers.push({ kind: 'ground', x: g.position.x, z: g.position.z, side: g.side, destroyed: g.destroyed, label: g.type.replace(/-/g, ' ') });
    const flight = p ? this.world.getFlight(p.flightId) : undefined;
    return {
      date: this.mission.date,
      units,
      playerSide: p?.side,
      center: p ? { x: p.state.position.x, z: p.state.position.z } : undefined,
      spanM: 40_000,
      route: flight?.waypoints,
      activeWaypoint: this.waypointIndex,
      markers,
      homeAerodromeId: this.mission.homeAerodromeId,
      title: this.mission.title,
      style: 'overlay',
    };
  }

  private enemiesNear(): boolean {
    return this.director.nearestEnemyDistance() < COMPRESSION_SAFE_RANGE;
  }

  private handleCommands(cmds: EdgeAction[]): void {
    const player = this.world.player;
    for (const c of cmds) {
      switch (c) {
        case 'pause':
          this.setPaused(!this.paused);
          break;
        case 'viewCockpit':
          if (this.rig.mode === 'cockpit') this.rig.centreHead();
          this.rig.setMode('cockpit');
          break;
        case 'viewChase':
          this.rig.setMode(this.rig.mode === 'chase' ? 'orbit' : 'chase');
          break;
        case 'viewPadlock':
          if (this.rig.mode === 'padlock') this.rig.setMode('cockpit');
          else this.rig.setMode('padlock', this.world, player);
          break;
        case 'viewFlyby':
          this.rig.setMode('flyby');
          break;
        case 'viewTarget':
          if (player && this.rig.targetId === null) this.rig.cycleTarget(this.world, player);
          this.rig.setMode('target');
          break;
        case 'nextTarget':
          if (player) this.rig.cycleTarget(this.world, player);
          break;
        case 'padlockNearest':
          if (player) {
            this.rig.padlockNearest(this.world, player);
            this.rig.setMode('padlock', this.world, player);
          }
          break;
        case 'timeCompress':
          if (this.enemiesNear()) this.hud.showMessage('Enemy aircraft nearby: time compression unavailable.');
          else this.timeScaleIdx = Math.min(TIME_SCALES.length - 1, this.timeScaleIdx + 1);
          break;
        case 'timeNormal':
          this.timeScaleIdx = 0;
          break;
        case 'map':
          this.mapOpen = !this.mapOpen;
          if (!this.mapOpen) this.hud.showMap(null);
          break;
        case 'endFlight':
          this.promptEndFlight();
          break;
        case 'wingmenMenu':
          this.ordersOpen = !this.ordersOpen;
          this.hud.showWingmanMenu(this.ordersOpen);
          break;
        case 'toggleHud':
          this.hudVisible = !this.hudVisible;
          this.hud.setVisible(this.hudVisible);
          break;
        case 'wingmenAttack':
          this.orderWingmen('attack-my-target', 'Attacking your target!');
          break;
        case 'wingmenEngage':
          this.orderWingmen('engage-at-will', 'Engaging at will.');
          break;
        case 'wingmenFormUp':
          this.orderWingmen('form-up', 'Forming up on you.');
          break;
        case 'wingmenCover':
          this.orderWingmen('cover-me', 'Covering you.');
          break;
        case 'wingmenHome':
          this.orderWingmen('return-home', 'Returning to the aerodrome.');
          break;
        default:
          break;
      }
    }
  }

  private orderWingmen(cmd: WingmanCommand, ack: string): void {
    const p = this.world.player;
    if (!p) return;
    const mates = (this.world.flightMembers.get(p.flightId) ?? []).filter((a) => a.id !== p.id && a.outcome === null);
    if (mates.length === 0) {
      this.hud.showMessage('You have no wingmen with you.');
      return;
    }
    const target = cmd === 'attack-my-target' ? (this.rig.targetId ?? this.rig.padlockId ?? undefined) : undefined;
    if (cmd === 'attack-my-target' && target === undefined) {
      this.hud.showMessage('Select a target first (T).');
      return;
    }
    const label = ORDER_LABELS[cmd];
    for (const m of mates) {
      this.ai.get(m.id)?.command(cmd, target);
      this.wingmanOrders.set(m.id, label);
    }
    if (this.ordersOpen) {
      this.ordersOpen = false;
      this.hud.showWingmanMenu(false);
    }
    this.bus.emit({ type: 'radio', from: mates[0].callsign, text: ack });
  }

  private frame = (now: number): void => {
    if (this.finished) return;
    try {
      this.tick(now);
    } catch (e) {
      this.fail(e);
      return;
    }
    if (!this.finished) this.raf = requestAnimationFrame(this.frame);
  };

  private tick(now: number): void {
    const dtReal = Math.min(MAX_FRAME_DT, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    this.frames++;
    const world = this.world;
    const player = world.player;

    // HUD cards (pause, end flight) own the keyboard while open.
    this.input.enabled = !this.hud.menuOpen;
    const inp = this.input.update(dtReal, player && player.outcome === null ? player : null, this.rig.mouseSteers);
    this.handleCommands(inp.commands);
    if (player && player.outcome === null && !this.paused) {
      Object.assign(player.controls, inp.controls);
    }

    if (this.timeScale > 1 && this.enemiesNear()) {
      this.timeScaleIdx = 0;
      this.hud.showMessage('Enemy aircraft sighted: time compression off.');
    }

    if (!this.paused) {
      const h = 1 / SIM_HZ;
      this.accumulator += dtReal * this.timeScale;
      let first = true;
      while (this.accumulator >= h) {
        this.accumulator -= h;
        this.step(h);
        if (first && player) {
          player.controls.clearJam = false; // edge: one step only
          first = false;
        }
        if (this.director.ended) break;
      }
      this.updateGEffect(dtReal);
    }

    // Visual sync.
    for (const ac of world.aircraft) {
      const v = this.visuals.get(ac.id);
      if (!v) continue;
      v.object.visible = true;
      v.update(ac, this.paused ? 0 : dtReal);
    }
    for (const b of world.balloons) this.entityObjects.get(b.id)?.position.copy(b.position);

    if (player) {
      const vis = this.visuals.get(player.id);
      vis?.setCockpitView(this.rig.inCockpit);
      this.rig.update(dtReal, player, world, vis?.eyePoint ?? DEFAULT_EYE, inp);
    }
    this.renderer.update(this.paused ? 0 : dtReal, this.rig.camera, world, this.combat.bullets);
    this.renderer.render(this.rig.camera);
    if (this.pixelRequests.length) this.samplePixels();
    this.audio.updateFlight(this.rig.camera, player, world, this.paused ? 0 : dtReal, this.rig.inCockpit);
    if (player) {
      this.waypointIndex = advanceWaypoint(player, world, this.waypointIndex);
      this.hud.update(
        buildHudView({
          player,
          world,
          camera: this.rig.camera,
          settings: this.settings,
          timeScale: this.timeScale,
          cameraMode: this.rig.mode,
          padlockId: this.rig.mode === 'padlock' ? this.rig.padlockId : null,
          padlockObstructed: this.rig.padlockObstructed,
          targetId: this.rig.targetId,
          aimDirection: inp.aimDirection,
          waypointIndex: this.waypointIndex,
          wingmanOrders: this.wingmanOrders,
          hint: this.settings.showTutorialHints && world.time < 20 ? START_HINT : null,
        }),
      );
      this.hud.setGEffect(this.gEffect);
    }
    if (this.mapOpen && now >= this.mapRedrawAt) {
      this.mapRedrawAt = now + 200;
      this.hud.showMap(this.buildMapView());
    }

    if (this.director.ended) this.finish();
  }

  private step(h: number): void {
    const world = this.world;
    world.time += h;
    for (const ac of world.spawnDue()) {
      const v = this.visuals.get(ac.id);
      if (v) v.object.visible = true;
    }
    const runAi = this.stepCount % AI_EVERY_N_STEPS === 0;
    this.stepCount++;
    if (runAi) {
      for (const ac of world.aircraft) {
        if (ac.outcome !== null) continue;
        const c = this.ai.get(ac.id);
        if (c) c.update(ac, world, h * AI_EVERY_N_STEPS);
      }
    }
    for (const ac of world.aircraft) {
      if (ac.outcome !== null && ac.state.onGround) continue;
      if (ac.outcome === 'disengaged') continue;
      this.modules.sim.stepFlight(ac, world.env, this.settings.realism, h);
      this.detectLanding(ac);
    }
    this.combat.update(world, h);
    this.director.update(h);
  }

  private detectLanding(ac: AircraftEntity): void {
    const s = ac.state;
    if (!s.onGround) {
      if (s.heightAboveGround > 5) this.wasAirborne.add(ac.id);
      return;
    }
    if (ac.outcome !== null || !this.wasAirborne.has(ac.id) || s.airspeed > 2) return;
    const friendly = this.world.sideOfFrontAt(s.position.x, s.position.z) === ac.side;
    ac.outcome = friendly ? 'landed-friendly' : 'landed-enemy';
    this.bus.emit({ type: 'aircraft-landed', aircraftId: ac.id, friendlyTerritory: friendly });
  }

  private updateGEffect(dt: number): void {
    const p = this.world.player;
    if (!p || !this.settings.realism.gEffects) {
      this.gEffect = 0;
      return;
    }
    const g = p.state.gLoad;
    if (g > 4.5) this.gEffect = Math.min(1, this.gEffect + (g - 4.5) * 0.25 * dt);
    else if (g < -1.5) this.gEffect = Math.max(-1, this.gEffect - (-1.5 - g) * 0.4 * dt);
    else this.gEffect += (0 - this.gEffect) * Math.min(1, dt * 0.8);
  }

  private samplePixels(): void {
    const gl = this.renderer.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const hgt = gl.drawingBufferHeight;
    const n = 32;
    const buf = new Uint8Array(4);
    const colors = new Set<number>();
    let nonBlack = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        gl.readPixels(Math.floor(((i + 0.5) / n) * w), Math.floor(((j + 0.5) / n) * hgt), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        colors.add((buf[0] << 16) | (buf[1] << 8) | buf[2]);
        if (buf[0] + buf[1] + buf[2] > 24) nonBlack++;
      }
    const stats = { distinctColors: colors.size, nonBlack, total: n * n };
    const reqs = this.pixelRequests;
    this.pixelRequests = [];
    reqs.forEach((r) => r(stats));
  }

  private finish(): void {
    if (this.finished) return;
    const result = this.director.buildResult();
    this.teardown();
    this.bus.emit({ type: 'mission-end', result });
    this.resolve(result);
  }

  private fail(e: unknown): void {
    if (this.finished) return;
    console.error('Flight session failed', e);
    this.teardown();
    this.reject(e);
  }

  private teardown(): void {
    this.finished = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.input?.detach();
    this.audio.stopFlight();
    this.director?.dispose();
    this.visuals.forEach((v) => {
      v.object.removeFromParent();
      v.dispose();
    });
    this.visuals.clear();
    this.hud?.dispose();
    this.renderer?.dispose();
    this.root?.remove();
    if (window.__rb2) window.__rb2.session = null;
  }
}
