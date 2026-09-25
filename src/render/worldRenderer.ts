/**
 * WorldRenderer implementation (see src/core/interfaces.ts).
 *
 * Owns the WebGLRenderer, the scene, sky/sun/fog, streamed terrain, sea,
 * towns, trees, aerodromes, clouds and the effects system. Game code adds
 * aircraft visuals to `scene` and renders with its own camera.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Object3D,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import type { WorldQuery, WorldRenderer, BulletView } from '../core/interfaces';
import type { BalloonEntity, GameEvent, GraphicsQuality, GroundTargetType, Side, TimeOfDay, Weather } from '../core/types';
import { AerodromeLayer } from './aerodromes';
import { CloudLayer } from './clouds';
import { EffectsSystem } from './effects/effectsSystem';
import { hourForTimeOfDay, seasonOf, sunPosition, turbidityFor } from './environment';
import { balloonBurnState, createBalloonVisual, syncBalloonVisual } from './objects/balloon';
import { CraterGridLoader } from './terrain/craterGridLoader';
import { createGroundTargetVisual, setGroundTargetDestroyed } from './objects/groundTargets';
import { releaseGpuResources } from './releaseGpu';
import { QUALITY, type QualityPreset } from './quality';
import { RiverRibbons } from './rivers';
import { RoadRibbons } from './roadRibbons';
import { Sea } from './sea';
import { linearToDisplay, skyRadiance, SkyDome, type SkyParams } from './sky';
import { buildFeatureMask, type FeatureMask } from './terrain/featureMask';
import { applyPalette, createTerrainMaterial, PALETTES } from './terrain/terrainMaterial';
import { TerrainSystem } from './terrain/terrainSystem';
import { TownLayer } from './towns';
import { TreeLayer } from './trees';
import { terrainHeightAt } from '../world/terrain';

export interface WorldRendererOptions {
  quality: GraphicsQuality;
  date: string;
}

export interface WorldRendererStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  terrainChunks: number;
  terrainPending: number;
  particles: number;
  cpu: Record<string, number>;
  trees?: Record<string, number>;
}

function supportsClipControl(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ok = !!gl?.getExtension('EXT_clip_control');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

const DEFAULT_WEATHER: Weather = { cloudCover: 0.35, cloudBaseM: 1500, cloudTopM: 2300, wind: [4, 0, 1], visibilityM: 30_000, turbulence: 0.2 };

export class WorldRendererImpl implements WorldRenderer {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly quality: QualityPreset;
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly sunDirection = new Vector3(0, 1, 0);
  /** Recommended camera clip planes for this renderer. */
  readonly near = 0.2;
  readonly far: number;

  private readonly sky = new SkyDome();
  private readonly terrain: TerrainSystem;
  private readonly terrainMaterial;
  private readonly sea = new Sea();
  private readonly towns: TownLayer;
  private readonly trees: TreeLayer;
  private readonly aerodromes: AerodromeLayer;
  private readonly clouds: CloudLayer;
  private readonly rivers: RiverRibbons;
  private readonly roads: RoadRibbons;
  private readonly tmpColor = new Color();
  /** Smoothed CPU ms per subsystem update (diagnostics). */
  readonly timings: Record<string, number> = {};
  readonly effects: EffectsSystem;
  private readonly pmrem: PMREMGenerator;
  private envTarget: WebGLRenderTarget | null = null;
  private mask: FeatureMask;
  private date: string;
  private weather: Weather = DEFAULT_WEATHER;
  private readonly balloonVisuals = new Map<number, Group>();
  private time = 0;
  private frameTimes: number[] = [];
  private lastFrame = performance.now();
  private readonly skyParams: SkyParams = { sunDirection: new Vector3(0, 1, 0), turbidity: 4, rayleigh: 1.5, mieCoefficient: 0.005, mieDirectionalG: 0.8, overcast: 0 };
  private readonly fogDisplay = new Color();

  constructor(canvas: HTMLCanvasElement, opts: WorldRendererOptions) {
    this.quality = QUALITY[opts.quality];
    this.far = this.quality.farPlane;
    this.date = opts.date;
    this.craterGrids.ensure(this.date);
    const reversed = supportsClipControl();
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.quality.antialias,
      powerPreference: 'high-performance',
      reversedDepthBuffer: reversed,
      logarithmicDepthBuffer: !reversed,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.pmrem = new PMREMGenerator(this.renderer);

    this.scene.add(this.sky);
    this.scene.fog = new FogExp2(0xb0b8c0, 0.00005);

    // Sun (+ shadows following the camera).
    this.sun.castShadow = this.quality.shadows;
    this.sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -220;
    sc.right = 220;
    sc.top = 220;
    sc.bottom = -220;
    sc.near = 10;
    sc.far = 4000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    this.mask = buildFeatureMask(this.date, this.quality.maskResolution);
    this.terrainMaterial = createTerrainMaterial(this.mask.texture, this.mask.rect);
    this.terrain = new TerrainSystem(this.terrainMaterial, this.date, {
      maxLevel: this.quality.terrainMaxLevel,
      splitFactor: this.quality.terrainSplit,
      maxCached: this.quality.terrainCache,
      workers: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2)),
      farDistance: this.far * 1.1,
    });
    this.scene.add(this.terrain.group);
    this.scene.add(this.sea.mesh);

    this.roads = new RoadRibbons();
    this.scene.add(this.roads.group);
    this.rivers = new RiverRibbons();
    this.scene.add(this.rivers.group);
    this.towns = new TownLayer(this.date, this.quality);
    this.scene.add(this.towns.group);
    this.trees = new TreeLayer(this.date, this.quality);
    this.scene.add(this.trees.group);
    this.aerodromes = new AerodromeLayer(this.date);
    this.scene.add(this.aerodromes.group);
    this.clouds = new CloudLayer(this.quality);
    this.scene.add(this.clouds.group);
    this.effects = new EffectsSystem(this.quality.maxParticles, (x, z) => this.sideOfGround(x, z));
    this.scene.add(this.effects.group);

    this.setEnvironment(this.date, 'morning', DEFAULT_WEATHER);
    if (import.meta.env?.DEV) (globalThis as unknown as { __rb2render?: WorldRendererImpl }).__rb2render = this;
  }

  private sideOfGround: (x: number, z: number) => Side = () => 'allied';

  setEnvironment(date: string, timeOfDay: TimeOfDay, weather: Weather): void {
    const dateChanged = date !== this.date;
    this.date = date;
    this.weather = weather;
    const hour = hourForTimeOfDay(date, timeOfDay);
    const sun = sunPosition(date, hour);
    this.sunDirection.set(...sun.direction);
    const overcast = Math.max(0, (weather.cloudCover - 0.55) / 0.45);
    const p = this.skyParams;
    p.sunDirection.copy(this.sunDirection);
    p.turbidity = turbidityFor(weather);
    p.rayleigh = 1.2 + 0.8 * Math.max(0, 1 - sun.elevationDeg / 25);
    p.mieCoefficient = 0.004 + 0.003 * (1 - Math.min(1, weather.visibilityM / 40_000));
    p.mieDirectionalG = 0.8;
    p.overcast = overcast * 0.9;
    this.sky.setParams(p);

    // Fog colour: the sky just above the horizon, averaged around the compass, display space.
    const acc = [0, 0, 0];
    const dir = new Vector3();
    const tmp: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      dir.set(Math.cos(a), 0.035, Math.sin(a)).normalize();
      skyRadiance(dir, p, tmp);
      acc[0] += tmp[0] / 16;
      acc[1] += tmp[1] / 16;
      acc[2] += tmp[2] / 16;
    }
    const disp = linearToDisplay(acc as [number, number, number], this.renderer.toneMappingExposure);
    // Haze is a little greyer/brighter than the clear-sky horizon.
    const grey = (disp[0] + disp[1] + disp[2]) / 3;
    const hz = 0.25 + 0.2 * Math.min(1, 25_000 / weather.visibilityM);
    this.fogDisplay.setRGB(disp[0] + (grey - disp[0]) * hz, disp[1] + (grey - disp[1]) * hz, disp[2] + (grey - disp[2]) * hz);
    const fog = this.scene.fog as FogExp2;
    // three encodes fog.color (linear) to the output space before mixing; our display-space value must be decoded.
    fog.color.setRGB(this.fogDisplay.r, this.fogDisplay.g, this.fogDisplay.b, SRGBColorSpace);
    fog.density = 2.0 / Math.max(2000, weather.visibilityM);
    this.sky.material.uniforms.hazeColor.value.copy(this.fogDisplay);
    this.sky.material.uniforms.hazeBand.value = 0.05 + 0.1 * Math.min(1, 20_000 / weather.visibilityM);

    // Sun light: warm and weak near the horizon, dimmed by overcast.
    const el = Math.max(0, sun.elevationDeg);
    const warm = Math.max(0, 1 - el / 35);
    this.sun.color.setRGB(1, 1 - 0.28 * warm, 1 - 0.55 * warm);
    const lowSun = Math.min(1, el / 6);
    this.sun.intensity = (0.3 + 2.3 * lowSun) * (1 - 0.75 * overcast);

    // Image-based ambient from the sky.
    this.renderEnvironment();
    this.scene.environmentIntensity = 0.65 * (1 - 0.3 * overcast) + 0.15;

    // Season palette.
    applyPalette(this.terrainMaterial, PALETTES[seasonOf(date).name]);
    this.aerodromes.setGrassColor(PALETTES[seasonOf(date).name].pasture);

    if (dateChanged) {
      this.craterGrids.ensure(date);
      this.terrain.setDate(date);
      this.mask.texture.dispose();
      this.mask = buildFeatureMask(date, this.quality.maskResolution);
      const u = this.terrainMaterial.userData.uniforms;
      u.uMask.value = this.mask.texture;
      u.uMaskRect.value = this.mask.rect;
      this.towns.setDate(date);
      this.trees.setDate(date);
      this.aerodromes.setDate(date);
    }
    this.trees.setSeason(seasonOf(date).name);
    this.clouds.setWeather(weather, this.sunDirection, this.fogDisplay, overcast);
    this.effects.setWind(weather.wind);
    this.effects.setDate(date);
    const lightK = Math.min(1, 0.35 + this.sun.intensity / 3);
    this.effects.setFog(this.fogDisplay, fog.density, new Color(lightK, lightK * (1 - 0.1 * warm), lightK * (1 - 0.2 * warm)));
  }

  private renderEnvironment(): void {
    const envScene = new Scene();
    const u = this.sky.material.uniforms;
    const prevHaze = (u.hazeColor.value as Color).clone();
    // Below the horizon in the env map: a dim, linear ground colour.
    (u.hazeColor.value as Color).setRGB(0.12, 0.13, 0.1).multiplyScalar(Math.max(0.15, this.sun.intensity / 3));
    u.sunDisc.value = 0;
    envScene.add(this.sky);
    this.sky.position.set(0, 0, 0);
    const prev = this.envTarget;
    this.envTarget = this.pmrem.fromScene(envScene, 0, 1, 3000);
    this.scene.environment = this.envTarget.texture as Texture;
    prev?.dispose();
    u.sunDisc.value = 1;
    (u.hazeColor.value as Color).copy(prevHaze);
    this.scene.add(this.sky);
  }

  update(dt: number, camera: Camera, world: WorldQuery, bullets: readonly BulletView[]): void {
    this.debugCameraHook?.(camera);
    camera.updateMatrixWorld();
    this.time += dt;
    this.sideOfGround = (x, z) => world.sideOfFrontAt(x, z);
    const cam = camera.getWorldPosition(new Vector3());
    this.sky.position.copy(cam);
    const T = (k: string, f: () => void) => {
      const t0 = performance.now();
      f();
      const ms = performance.now() - t0;
      this.lastCpu[k] = ms;
      this.timings[k] = (this.timings[k] ?? 0) * 0.9 + ms * 0.1;
    };
    T("terrain", () => this.terrain.update(camera));
    this.sea.update(dt, camera);
    const tu = this.terrainMaterial.userData.uniforms;
    tu.uTime.value = this.time;
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      const fov = MathUtils.degToRad((camera as PerspectiveCamera).fov);
      tu.uPxAngle.value = (2 * Math.tan(fov / 2)) / Math.max(1, this.renderer.domElement.height);
    }
    // Shadow frustum follows the camera.
    this.sun.position.copy(cam).addScaledVector(this.sunDirection, 2000);
    this.sun.target.position.copy(cam);
    this.sun.target.updateMatrixWorld();
    // The shadow box must reach the ground below the camera: with a reversed depth
    // buffer, fragments beyond the shadow camera's far plane read as shadowed.
    {
      const agl = Math.max(0, cam.y - Math.max(0, terrainHeightAt(cam.x, cam.z)));
      const far = Math.min(40_000, Math.max(4000, 2000 + (agl + 400) / Math.max(0.12, this.sunDirection.y) + 400));
      const sc = this.sun.shadow.camera;
      if (Math.abs(sc.far - far) > far * 0.08) {
        sc.far = far;
        sc.updateProjectionMatrix();
      }
    }
    T("towns", () => this.towns.update(cam));
    T("trees", () => this.trees.update(cam));
    T("rivers", () => this.rivers.update(cam));
    T("roads", () => this.roads.update(cam));
    this.aerodromes.update(dt, this.weather);
    T("clouds", () => this.clouds.update(dt, camera));
    T("effects", () => this.effects.update(dt, camera, world, bullets));
    this.syncBalloons(world, dt);
    // In-cloud whiteout: thicken fog when the camera is inside a cloud.
    const inside = this.clouds.densityAt(cam);
    const fog = this.scene.fog as FogExp2;
    const base = 2.0 / Math.max(2000, this.weather.visibilityM);
    fog.density = base + inside * 0.012;
    this.tmpColor.copy(this.fogDisplay).lerp(this.clouds.insideColor, Math.min(1, inside * 1.5));
    fog.color.setRGB(this.tmpColor.r, this.tmpColor.g, this.tmpColor.b, SRGBColorSpace);
  }

  private syncBalloons(world: WorldQuery, dt: number): void {
    for (const b of world.balloons) {
      const v = this.balloonVisuals.get(b.id);
      if (!v) continue;
      syncBalloonVisual(v, b, this.time, world.groundHeightAt(b.anchor.x, b.anchor.z));
      const burn = balloonBurnState(v);
      if (burn && v.visible) this.effects.balloonFire(burn.pos, burn.intensity, dt);
    }
  }

  handleEvent(e: GameEvent): void {
    this.effects.handleEvent(e);
  }

  /** Dev/QA: called with the game camera just before rendering (screenshot rigs). */
  private readonly craterGrids = new CraterGridLoader();
  /** Raw CPU ms per subsystem for the most recent frame (hitch diagnosis). */
  readonly lastCpu: Record<string, number> = {};
  debugCameraHook: ((camera: Camera) => void) | null = null;

  render(camera: Camera): void {
    this.debugCameraHook?.(camera);
    const now = performance.now();
    this.frameTimes.push(now - this.lastFrame);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.lastFrame = now;
    if (camera instanceof PerspectiveCamera && (camera.far !== this.far || camera.near > 1)) {
      // Keep clip planes sane for the world scale.
      camera.far = this.far;
      camera.updateProjectionMatrix();
    }
    const t0 = performance.now();
    this.renderer.render(this.scene, camera);
    this.lastCpu.render = performance.now() - t0;
    this.timings.render = (this.timings.render ?? 0) * 0.9 + this.lastCpu.render * 0.1;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  createBalloonVisual(b: BalloonEntity): Object3D {
    const v = createBalloonVisual(b);
    this.balloonVisuals.set(b.id, v);
    return v;
  }

  createGroundTargetVisual(type: GroundTargetType, side: Side): Object3D {
    return createGroundTargetVisual(type, side);
  }

  /** Resolves when terrain around the camera has streamed in (for loading screens). */
  setGroundTargetDestroyed(obj: Object3D): void {
    setGroundTargetDestroyed(obj);
  }

  /** Resolves once terrain, near trees and town tiles around the camera have streamed in (loading screens keep calling update()). */
  async whenReady(): Promise<void> {
    await this.terrain.whenReady();
    await this.craterGrids.whenReady();
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const check = () => {
        if ((this.trees.pendingCount === 0 && this.towns.pendingCount === 0) || performance.now() - t0 > 8000) resolve();
        else setTimeout(check, 40);
      };
      check();
    });
  }

  stats(): WorldRendererStats {
    const avg = this.frameTimes.length ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length : 16.7;
    const info = this.renderer.info.render;
    return {
      fps: 1000 / avg,
      frameMs: avg,
      drawCalls: info.calls,
      triangles: info.triangles,
      terrainChunks: this.terrain.drawnCount,
      terrainPending: this.terrain.pendingCount,
      particles: this.effects.activeCount,
      cpu: Object.fromEntries(Object.entries(this.timings).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      trees: { ...this.trees.takePerf(), townBuildMax: this.towns.buildMaxMs, frameMax: this.frameTimes.length ? Math.max(...this.frameTimes) : 0 },
    };
  }

  /** Current mission date. */
  get currentDate(): string {
    return this.date;
  }

  dispose(): void {
    // Dev QA hook: don't let it pin a finished flight's renderer (and its GL context).
    const g = globalThis as unknown as { __rb2render?: WorldRendererImpl };
    if (g.__rb2render === this) g.__rb2render = undefined;
    // First, so shared/cached resources drop this renderer's dispose listeners (releaseGpu.ts).
    releaseGpuResources(this.renderer, this.scene);
    this.craterGrids.dispose();
    this.terrain.dispose();
    this.trees.dispose();
    this.towns.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.mask.texture.dispose();
    this.effects.dispose();
    this.clouds.dispose();
    const lost = this.renderer.getContext().isContextLost();
    this.renderer.dispose();
    if (lost) return;
    // Each flight gets a fresh canvas + context. Release the GPU context now rather than
    // whenever the canvas is garbage-collected: browsers cap live contexts (~16) and
    // evict the oldest with a warning, and the GPU memory is held meanwhile.
    this.renderer.forceContextLoss();
  }
}

export function createWorldRenderer(canvas: HTMLCanvasElement, opts: WorldRendererOptions): WorldRendererImpl {
  return new WorldRendererImpl(canvas, opts);
}
