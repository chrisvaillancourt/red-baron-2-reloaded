/**
 * WebAudio implementation of the AudioEngine contract (src/core/interfaces.ts).
 *
 * Graph:
 *   engine voices / one-shots -> fxBus ─┐
 *   player loops (wind, wires) -> fxBus  ├─> master -> limiter -> destination
 *   music player -> musicIn -> musicBus ─┤   (musicIn also feeds a hall reverb)
 *   ui sounds -> uiBus ──────────────────┘
 */
import { Quaternion, Vector3, type Camera } from 'three';
import type { AudioEngine, BulletView, MusicCue, WorldQuery } from '../core/interfaces';
import type { AircraftEntity, DamageZone, GameEvent } from '../core/types';
import { GUNS } from '../data/aircraft';
import { SoundBank, type SoundId } from './bank';
import { MusicPlayer } from './music/player';
import { airAbsorptionCutoff, dopplerFactor, selectNearest, soundDelay } from './spatial';
import { engineKindFor, type HitMaterial } from './synthBuffers';
import { EngineVoice, LoopVoice } from './voices';

export const MAX_ENGINE_VOICES = 6;
const ENGINE_HEAR_RANGE = 3500;
const MAX_ONE_SHOTS = 64;
const WHIZZ_RADIUS = 12;

/** The concrete engine exposes a few extras beyond the shared contract. */
export interface ReloadedAudioEngine extends AudioEngine {
  /** The live context (null in the silent fallback). */
  readonly context: AudioContext | null;
  /** Optional per-frame feed of live bullets for near-miss whizzes (call after updateFlight). */
  updateBullets(bullets: readonly BulletView[]): void;
  /** Render the flight sound bank ahead of time (call during mission load). */
  warmUp(): void;
  readonly currentMusic: MusicCue;
}

interface OneShotOpts {
  gain?: number;
  rate?: number;
  /** World position; omit for a non-spatial (in-head) sound. */
  position?: Vector3;
  /** Panner reference distance, m. */
  ref?: number;
  /** Delay by speed of sound from the listener. */
  delayBySound?: boolean;
  /** Additional delay, s. */
  delay?: number;
  pan?: number;
  bus?: AudioNode;
}

interface RemoteEngine {
  voice: EngineVoice;
  panner: PannerNode;
}

const _v = new Vector3();
const _q = new Quaternion();

export class WebAudioEngine implements ReloadedAudioEngine {
  readonly context: AudioContext;
  private readonly bank: SoundBank;
  private readonly master: GainNode;
  private readonly musicBus: GainNode;
  private readonly fxBus: GainNode;
  private readonly uiBus: GainNode;
  private readonly music: MusicPlayer;
  private activeOneShots = 0;

  // Flight state
  private playerId: number | null = null;
  private playerVoice: EngineVoice | null = null;
  private playerPanner: PannerNode | null = null;
  private playerLoops: Record<'wind' | 'wire1' | 'wire2' | 'buffet' | 'rumble' | 'fire', LoopVoice> | null = null;
  private readonly remote = new Map<number, RemoteEngine>();
  private reselectTimer = 0;
  private voicedIds: number[] = [];
  private readonly listenerPos = new Vector3();
  private readonly listenerVel = new Vector3();
  private readonly lastListenerPos = new Vector3();
  private hasListener = false;
  private world: WorldQuery | null = null;
  private lastClearJam = false;
  private readonly crashed = new Set<number>();
  private readonly bulletDist = new WeakMap<BulletView, number>();
  private readonly whizzed = new WeakSet<BulletView>();
  private whizzBudget = 0;
  private playerSide: AircraftEntity['side'] | null = null;
  private cockpit = true;

  constructor(ctx?: AudioContext) {
    this.context = ctx ?? new AudioContext({ latencyHint: 'interactive' });
    const c = this.context;
    this.bank = new SoundBank(c);

    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    this.master = c.createGain();
    this.master.connect(limiter).connect(c.destination);

    this.musicBus = c.createGain();
    this.fxBus = c.createGain();
    this.uiBus = c.createGain();
    this.musicBus.connect(this.master);
    this.fxBus.connect(this.master);
    this.uiBus.connect(this.master);

    const musicIn = c.createGain();
    const reverb = c.createConvolver();
    reverb.buffer = this.bank.hall();
    const reverbGain = c.createGain();
    reverbGain.gain.value = 0.35;
    musicIn.connect(this.musicBus);
    musicIn.connect(reverb).connect(reverbGain).connect(this.musicBus);
    this.music = new MusicPlayer(c, musicIn, { noise: this.bank.noise('white') });

    this.setVolumes(0.8, 0.6, 0.9);
  }

  get currentMusic(): MusicCue {
    return this.music.currentCue;
  }

  async resume(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
  }

  setVolumes(master: number, music: number, effects: number): void {
    const t = this.context.currentTime;
    this.master.gain.setTargetAtTime(clamp01(master), t, 0.05);
    this.musicBus.gain.setTargetAtTime(clamp01(music) * 0.7, t, 0.05);
    this.fxBus.gain.setTargetAtTime(clamp01(effects), t, 0.05);
    this.uiBus.gain.setTargetAtTime(clamp01(effects) * 0.8, t, 0.05);
  }

  playMusic(cue: MusicCue): void {
    if (cue === 'none' || cue === 'flight') this.music.stop();
    else this.music.play(cue);
  }

  playUi(sound: 'click' | 'hover' | 'confirm' | 'back' | 'typewriter' | 'stamp'): void {
    const rate = sound === 'typewriter' ? 0.9 + Math.random() * 0.25 : 1;
    this.oneShot(`ui:${sound}`, { bus: this.uiBus, rate, gain: sound === 'hover' ? 0.5 : 1 });
  }

  warmUp(): void {
    this.bank.warmFlight();
  }

  // -------------------------------------------------------------------------
  // Flight
  // -------------------------------------------------------------------------

  updateFlight(listener: Camera, player: AircraftEntity | null, world: WorldQuery, dt: number, cockpitView: boolean): void {
    const c = this.context;
    this.world = world;
    this.cockpit = cockpitView;
    const now = c.currentTime;

    // --- Listener pose & velocity.
    listener.getWorldPosition(this.listenerPos);
    if (this.hasListener && dt > 0) {
      _v.copy(this.listenerPos).sub(this.lastListenerPos).divideScalar(dt);
      // Camera cuts would produce huge velocities; ignore them.
      if (_v.length() < 400) this.listenerVel.lerp(_v, Math.min(1, dt * 10));
      else this.listenerVel.set(0, 0, 0);
    }
    this.lastListenerPos.copy(this.listenerPos);
    this.hasListener = true;
    listener.getWorldQuaternion(_q);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(_q);
    const up = new Vector3(0, 1, 0).applyQuaternion(_q);
    setListener(c.listener, this.listenerPos, fwd, up, now);

    // --- Player aircraft.
    this.playerId = player?.id ?? null;
    this.playerSide = player?.side ?? null;
    const alive = player && player.outcome !== 'crashed' && player.outcome !== 'collided';
    if (player && alive) {
      this.ensurePlayerVoice(player);
      const s = player.state;
      const pp = this.playerPanner!;
      let doppler = 1;
      let cutoff = 7500;
      if (cockpitView) {
        _v.copy(fwd).multiplyScalar(1.5).add(this.listenerPos);
        setPannerPos(pp, _v, now);
      } else {
        setPannerPos(pp, s.position, now);
        const d = s.position.distanceTo(this.listenerPos);
        doppler = dopplerFactor(s.position, s.velocity, this.listenerPos, this.listenerVel);
        cutoff = airAbsorptionCutoff(d) * 0.8;
      }
      this.playerVoice!.update({
        rpm: s.engineRpm,
        throttle: player.controls.throttle,
        blip: player.controls.blip && player.spec.performance.engineType === 'rotary',
        damage: player.damage.zones.engine,
        dead: player.damage.engineDead,
        doppler,
        cutoff,
        level: cockpitView ? 0.95 : 0.8,
      });
      this.updatePlayerLoops(player, cockpitView);

      // Hammering a jammed gun (edge-triggered input).
      const press = player.controls.clearJam && !this.lastClearJam;
      this.lastClearJam = player.controls.clearJam;
      if (press && player.guns.some((g) => g.jammed)) this.oneShot('hammer', { gain: 0.8, rate: 0.95 + Math.random() * 0.1 });
    } else {
      this.releasePlayer();
    }

    // --- Other aircraft engines: nearest N get voices.
    this.reselectTimer -= dt;
    if (this.reselectTimer <= 0) {
      this.reselectTimer = 0.4;
      const sources = world.aircraft
        .filter((a) => a.id !== this.playerId && a.state.engineRpm > 30 && a.outcome !== 'crashed' && a.outcome !== 'collided')
        .map((a) => ({ id: a.id, pos: a.state.position }));
      this.voicedIds = selectNearest(sources, this.listenerPos, MAX_ENGINE_VOICES, ENGINE_HEAR_RANGE, new Set(this.remote.keys()));
      const keep = new Set(this.voicedIds);
      for (const [id, r] of this.remote) {
        if (!keep.has(id)) {
          r.voice.dispose(0.5);
          setTimeout(() => r.panner.disconnect(), 1000);
          this.remote.delete(id);
        }
      }
    }
    for (const id of this.voicedIds) {
      const a = world.getEntity(id);
      if (!a || a.kind !== 'aircraft') continue;
      let r = this.remote.get(id);
      if (!r) {
        const panner = makePanner(c, 'HRTF', 30);
        panner.connect(this.fxBus);
        const kind = engineKindFor(a.spec.performance.engineType, a.spec.performance.engineName);
        r = { voice: new EngineVoice(c, this.bank, kind, panner), panner };
        this.remote.set(id, r);
      }
      const s = a.state;
      setPannerPos(r.panner, s.position, now);
      const d = s.position.distanceTo(this.listenerPos);
      r.voice.update({
        rpm: s.engineRpm,
        throttle: a.controls.throttle,
        blip: a.controls.blip && a.spec.performance.engineType === 'rotary',
        damage: a.damage.zones.engine,
        dead: a.damage.engineDead,
        doppler: dopplerFactor(s.position, s.velocity, this.listenerPos, this.listenerVel),
        cutoff: airAbsorptionCutoff(d),
        level: a.spec.role === 'fighter' ? 0.8 : 1,
      });
    }

    // --- Falling wrecks hitting the ground.
    for (const a of world.aircraft) {
      if (this.crashed.has(a.id)) continue;
      if ((a.outcome || a.damage.destroyed) && a.state.heightAboveGround < 3 && a.state.airspeed > 15) {
        this.crashed.add(a.id);
        this.crashAt(a.state.position, a.id === this.playerId);
      }
    }

    this.whizzBudget = Math.min(4, this.whizzBudget + dt * 8);
  }

  updateBullets(bullets: readonly BulletView[]): void {
    if (!this.hasListener || this.playerSide === null) return;
    for (const b of bullets) {
      if (b.side === this.playerSide || this.whizzed.has(b)) continue;
      const d = b.position.distanceTo(this.listenerPos);
      const prev = this.bulletDist.get(b);
      this.bulletDist.set(b, d);
      if (prev !== undefined && prev < WHIZZ_RADIUS && d > prev && this.whizzBudget >= 1) {
        this.whizzBudget -= 1;
        this.whizzed.add(b);
        this.oneShot('whizz', { position: b.position.clone(), ref: 4, gain: 0.9 * (1 - prev / WHIZZ_RADIUS) + 0.2, rate: 0.9 + Math.random() * 0.2 });
      }
    }
  }

  handleEvent(e: GameEvent, listenerPos: Vector3): void {
    if (!this.hasListener) this.listenerPos.copy(listenerPos);
    const isPlayer = (id: number) => id === this.playerId;
    const near = (p: Vector3, r: number) => p.distanceTo(this.listenerPos) < r;
    switch (e.type) {
      case 'gun-fired': {
        const id = `gun:${e.gun}` as SoundId;
        if (isPlayer(e.shooterId) && this.cockpit) {
          this.oneShot(id, { gain: 0.6, rate: 0.97 + Math.random() * 0.06, pan: (Math.random() - 0.5) * 0.3 });
        } else if (near(e.position, 2500)) {
          this.oneShot(id, { position: e.position.clone(), ref: 15, gain: 0.9, delayBySound: true, rate: 0.95 + Math.random() * 0.1 });
        }
        return;
      }
      case 'bullet-hit': {
        if (isPlayer(e.targetId)) {
          const mat = zoneMaterial(e.zone);
          this.oneShot(`hit:${mat}`, { gain: mat === 'metal' ? 0.7 : 0.9, rate: 0.9 + Math.random() * 0.2 });
          if (e.zone === 'pilot') this.oneShot('hit:wood', { gain: 0.9, rate: 0.5 });
        } else if (near(e.position, 200)) {
          const mat: HitMaterial = e.zone === 'ground' ? 'wood' : e.zone === 'engine' ? 'metal' : 'fabric';
          this.oneShot(`hit:${mat}`, { position: e.position.clone(), ref: 6, gain: 0.5, rate: e.zone === 'balloon' ? 0.5 : 1 });
        }
        return;
      }
      case 'bullet-impact-ground':
        if (near(e.position, 250)) this.oneShot('hit:wood', { position: e.position.clone(), ref: 5, gain: 0.35, rate: 0.4 + Math.random() * 0.2, delayBySound: true });
        return;
      case 'gun-jammed':
        if (isPlayer(e.aircraftId)) this.oneShot('jam', { gain: 0.9 });
        return;
      case 'gun-cleared':
        if (isPlayer(e.aircraftId)) {
          this.oneShot('latch', { gain: 0.8 });
          this.oneShot('latch', { gain: 0.8, delay: 0.18, rate: 0.8 });
        }
        return;
      case 'drum-change':
        if (isPlayer(e.aircraftId)) this.drumChange();
        return;
      case 'out-of-ammo':
        if (isPlayer(e.aircraftId)) this.oneShot('dryclick', { gain: 0.7 });
        return;
      case 'engine-damaged':
        if (isPlayer(e.aircraftId)) {
          this.oneShot('hit:metal', { gain: 0.8, rate: 0.7 });
          this.oneShot('jam', { gain: 0.6, rate: 0.6, delay: 0.1 });
        }
        return;
      case 'engine-dead':
        if (isPlayer(e.aircraftId)) {
          this.oneShot('jam', { gain: 0.7, rate: 0.5 });
          this.oneShot('jam', { gain: 0.5, rate: 0.45, delay: 0.35 });
        }
        return;
      case 'fire-started':
        if (isPlayer(e.aircraftId)) this.oneShot('whoomph', { gain: 0.5, rate: 1.6 });
        return;
      case 'pilot-hit':
        if (isPlayer(e.aircraftId)) this.oneShot('hit:wood', { gain: 1, rate: 0.45 });
        return;
      case 'structural-failure': {
        const a = this.world?.getEntity(e.aircraftId);
        if (isPlayer(e.aircraftId)) {
          this.oneShot('hit:wood', { gain: 1, rate: 0.6 });
          this.oneShot('crash', { gain: 0.5, rate: 1.3 });
        } else if (a && a.kind === 'aircraft' && near(a.state.position, 800)) {
          this.oneShot('hit:wood', { position: a.state.position.clone(), ref: 20, gain: 1, rate: 0.6, delayBySound: true });
        }
        return;
      }
      case 'aircraft-destroyed': {
        if (this.crashed.has(e.victimId)) return;
        const agl = this.world ? e.position.y - this.world.groundHeightAt(e.position.x, e.position.z) : 1000;
        if (agl < 40 || e.outcome === 'crashed') {
          this.crashed.add(e.victimId);
          this.crashAt(e.position, isPlayer(e.victimId));
        }
        return;
      }
      case 'balloon-destroyed':
        this.oneShot('whoomph', { position: e.position.clone(), ref: 80, gain: 1, delayBySound: true });
        return;
      case 'ground-destroyed':
        this.oneShot('explosion', { position: e.position.clone(), ref: 60, gain: 0.9, delayBySound: true });
        return;
      case 'explosion':
        this.oneShot(e.size >= 1.5 ? 'explosion' : 'explosion-small', {
          position: e.position.clone(),
          ref: 40 * Math.max(0.5, e.size),
          gain: Math.min(1, 0.5 + e.size * 0.3),
          delayBySound: true,
        });
        return;
      case 'flak-burst':
        this.oneShot('flak', { position: e.position.clone(), ref: 60, gain: 1, delayBySound: true, rate: 0.9 + Math.random() * 0.2 });
        return;
      case 'collision':
        if (isPlayer(e.aId) || isPlayer(e.bId)) this.oneShot('crash', { gain: 1 });
        else if (near(e.position, 1500)) this.oneShot('crash', { position: e.position.clone(), ref: 30, delayBySound: true });
        return;
      default:
        return;
    }
  }

  stopFlight(): void {
    this.releasePlayer();
    for (const [, r] of this.remote) {
      r.voice.dispose(0.3);
      setTimeout(() => r.panner.disconnect(), 800);
    }
    this.remote.clear();
    this.voicedIds = [];
    this.crashed.clear();
    this.world = null;
    this.hasListener = false;
    this.playerSide = null;
    this.listenerVel.set(0, 0, 0);
  }

  /** Tear down everything (e.g. on page unload). */
  async close(): Promise<void> {
    this.stopFlight();
    this.music.dispose();
    await this.context.close();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ensurePlayerVoice(player: AircraftEntity): void {
    const kind = engineKindFor(player.spec.performance.engineType, player.spec.performance.engineName);
    if (this.playerVoice && this.playerVoice.kind === kind) return;
    this.releasePlayer();
    const c = this.context;
    this.playerPanner = makePanner(c, 'equalpower', 8);
    this.playerPanner.connect(this.fxBus);
    this.playerVoice = new EngineVoice(c, this.bank, kind, this.playerPanner);
    this.playerLoops = {
      wind: new LoopVoice(c, this.bank.noise('pink'), this.fxBus, 'lowpass', 400),
      wire1: new LoopVoice(c, this.bank.noise('white'), this.fxBus, 'bandpass', 1000, 28),
      wire2: new LoopVoice(c, this.bank.noise('white'), this.fxBus, 'bandpass', 1470, 28),
      buffet: new LoopVoice(c, this.bank.noise('brown'), this.fxBus, 'lowpass', 90),
      rumble: new LoopVoice(c, this.bank.noise('brown'), this.fxBus, 'lowpass', 200),
      fire: new LoopVoice(c, this.bank.fire(), this.fxBus, 'lowpass', 6000),
    };
  }

  private updatePlayerLoops(player: AircraftEntity, cockpitView: boolean): void {
    const L = this.playerLoops!;
    const s = player.state;
    const a = s.airspeed;
    const view = cockpitView ? 1 : 0.35;
    L.wind.set(Math.min(1.2, (a / 75) ** 2) * 0.35 * view, 250 + a * 22);
    const dive = clamp01(-s.velocity.y / 25);
    const wire = clamp01((a - 45) / 40) ** 2 * (0.35 + 0.65 * dive) * 0.12 * view;
    L.wire1.set(wire, a * 20);
    L.wire2.set(wire * 0.7, a * 29.4);
    const stallAmt = s.stalled ? 1 : clamp01((s.aoa - 0.22) / 0.08);
    const gBuffet = clamp01((s.gLoad - 4) / 2) * 0.6;
    const buffet = Math.max(stallAmt, gBuffet) * clamp01(a / 25) * (0.6 + 0.4 * Math.random()) * 0.6 * view;
    L.buffet.set(buffet, 90, undefined, 0.03);
    const groundSpeed = Math.hypot(s.velocity.x, s.velocity.z);
    const rumble = s.onGround && groundSpeed > 1.5 ? clamp01(groundSpeed / 25) * 0.5 * (0.6 + 0.4 * Math.random()) : 0;
    L.rumble.set(rumble, 180, undefined, 0.03);
    L.fire.set(player.damage.onFire ? 0.45 : 0, 6000, undefined, 0.3);
  }

  private releasePlayer(): void {
    this.playerVoice?.dispose(0.4);
    this.playerVoice = null;
    if (this.playerPanner) {
      const p = this.playerPanner;
      setTimeout(() => p.disconnect(), 1000);
      this.playerPanner = null;
    }
    if (this.playerLoops) {
      for (const l of Object.values(this.playerLoops)) l.dispose(0.4);
      this.playerLoops = null;
    }
  }

  private crashAt(position: Vector3, isPlayer: boolean): void {
    if (isPlayer) {
      this.oneShot('crash', { gain: 1 });
      this.oneShot('explosion-small', { gain: 0.8, delay: 0.1 });
    } else if (position.distanceTo(this.listenerPos) < 4000) {
      this.oneShot('crash', { position: position.clone(), ref: 40, gain: 1, delayBySound: true });
      this.oneShot('explosion-small', { position: position.clone(), ref: 50, gain: 0.8, delayBySound: true, delay: 0.1 });
    }
  }

  private drumChange(): void {
    const t = GUNS.lewis.drumChangeTime;
    this.oneShot('latch', { gain: 0.8 });
    this.oneShot('scrape', { gain: 0.7, delay: 0.3 });
    this.oneShot('scrape', { gain: 0.7, delay: Math.max(0.8, t - 1.3), rate: 0.9 });
    this.oneShot('jam', { gain: 0.6, delay: Math.max(1.2, t - 0.5), rate: 1.5 });
    this.oneShot('latch', { gain: 0.8, delay: Math.max(1.4, t - 0.25), rate: 1.2 });
  }

  private oneShot(id: SoundId, o: OneShotOpts = {}): void {
    if (this.activeOneShots >= MAX_ONE_SHOTS) return;
    const c = this.context;
    if (c.state !== 'running') return;
    const src = c.createBufferSource();
    src.buffer = this.bank.get(id);
    src.playbackRate.value = o.rate ?? 1;
    const g = c.createGain();
    g.gain.value = o.gain ?? 1;
    let t = c.currentTime + (o.delay ?? 0);
    const nodes: AudioNode[] = [src, g];
    src.connect(g);
    if (o.position) {
      const d = o.position.distanceTo(this.listenerPos);
      if (o.delayBySound) t += soundDelay(d);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = airAbsorptionCutoff(d);
      const panner = makePanner(c, d < 400 ? 'HRTF' : 'equalpower', o.ref ?? 15);
      setPannerPos(panner, o.position, c.currentTime);
      g.connect(lp).connect(panner).connect(o.bus ?? this.fxBus);
      nodes.push(lp, panner);
    } else if (o.pan) {
      const sp = c.createStereoPanner();
      sp.pan.value = o.pan;
      g.connect(sp).connect(o.bus ?? this.fxBus);
      nodes.push(sp);
    } else {
      g.connect(o.bus ?? this.fxBus);
    }
    this.activeOneShots++;
    src.onended = () => {
      this.activeOneShots--;
      for (const n of nodes) n.disconnect();
    };
    src.start(t);
  }
}

function zoneMaterial(zone: DamageZone | 'balloon' | 'ground'): HitMaterial {
  switch (zone) {
    case 'engine':
    case 'guns':
    case 'fuelTank':
      return 'metal';
    case 'pilot':
    case 'gunner':
    case 'controls':
      return 'wood';
    case 'fuselage':
      return Math.random() < 0.6 ? 'fabric' : 'wood';
    default:
      return 'fabric';
  }
}

function makePanner(c: BaseAudioContext, model: PanningModelType, ref: number): PannerNode {
  const p = c.createPanner();
  p.panningModel = model;
  p.distanceModel = 'inverse';
  p.refDistance = ref;
  p.rolloffFactor = 1.1;
  p.maxDistance = 20000;
  return p;
}

function setPannerPos(p: PannerNode, v: { x: number; y: number; z: number }, t: number): void {
  if (p.positionX) {
    p.positionX.setValueAtTime(v.x, t);
    p.positionY.setValueAtTime(v.y, t);
    p.positionZ.setValueAtTime(v.z, t);
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(v.x, v.y, v.z);
  }
}

function setListener(l: AudioListener, pos: Vector3, fwd: Vector3, up: Vector3, t: number): void {
  if (l.positionX) {
    l.positionX.setValueAtTime(pos.x, t);
    l.positionY.setValueAtTime(pos.y, t);
    l.positionZ.setValueAtTime(pos.z, t);
    l.forwardX.setValueAtTime(fwd.x, t);
    l.forwardY.setValueAtTime(fwd.y, t);
    l.forwardZ.setValueAtTime(fwd.z, t);
    l.upX.setValueAtTime(up.x, t);
    l.upY.setValueAtTime(up.y, t);
    l.upZ.setValueAtTime(up.z, t);
  } else {
    const legacy = l as unknown as {
      setPosition(x: number, y: number, z: number): void;
      setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
    };
    legacy.setPosition(pos.x, pos.y, pos.z);
    legacy.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
