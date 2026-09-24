/**
 * Spotting dot: keeps distant aircraft visible as a fixed-pixel speck, as in
 * Red Baron II, where spotting a dot at a few miles was half the fight. A
 * real scout covers about 1 px at 4 km, which a GPU simply drops.
 *
 * The dot fades in as the aircraft's projected span shrinks below a few
 * pixels, and fades out with distance (spotting range), so it never draws
 * over a visible model and never reveals aircraft beyond the haze.
 */
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, PerspectiveCamera, Points, PointsMaterial, Vector3, type Camera, type Texture, type WebGLRenderer } from 'three';

/** Screen size (px) of the dot and the span below which it takes over from the mesh. */
export const DOT_PX = 2.6;
export const DOT_FULL_BELOW_PX = 2.5;
export const DOT_GONE_ABOVE_PX = 7;
/** Spotting range: full strength to SPOT_NEAR, gone by SPOT_FAR (m). */
export const SPOT_NEAR = 3500;
export const SPOT_FAR = 9000;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Opacity of the dot for an aircraft of `span` metres at `dist` metres, drawn `pxPerRad` pixels per radian. */
export function spotDotOpacity(span: number, dist: number, pxPerRad: number): number {
  if (dist <= 1) return 0;
  const spanPx = (span / dist) * pxPerRad;
  const takeover = 1 - smooth(DOT_FULL_BELOW_PX, DOT_GONE_ABOVE_PX, spanPx);
  const range = 1 - smooth(SPOT_NEAR, SPOT_FAR, dist);
  return takeover * range;
}

let dotTex: Texture | null = null;
function dotTexture(): Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  dotTex = new CanvasTexture(c);
  return dotTex;
}

export function createSpotDot(span: number): { points: Points; material: PointsMaterial } {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
  const material = new PointsMaterial({
    color: 0x1a1612,
    size: DOT_PX,
    sizeAttenuation: false,
    map: dotTexture(),
    transparent: true,
    depthWrite: false,
    fog: false,
    opacity: 0,
  });
  const points = new Points(geo, material);
  points.name = 'SpotDot';
  points.renderOrder = 3;
  points.frustumCulled = false;
  points.onBeforeRender = (renderer: WebGLRenderer, _scene, camera: Camera) => {
    const h = renderer.domElement.height / renderer.getPixelRatio(); // CSS pixels, like DOT_PX
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 70;
    const pxPerRad = h / 2 / Math.tan(((fov * Math.PI) / 180) / 2);
    const dist = camera.position.distanceTo(points.getWorldPosition(_wp));
    material.opacity = spotDotOpacity(span, dist, pxPerRad);
  };
  return { points, material };
}

const _wp = new Vector3();
