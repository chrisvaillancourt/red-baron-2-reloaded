/**
 * Rasterised feature mask for the terrain shader: R = water (rivers/canals),
 * G = roads, B = aerodrome grass. One texture covers the sector.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, Vector4 } from 'three';
import { roadNetwork } from '../../world/roads';
import { riverPolylines } from '../../world/terrain';

export const MASK_RECT = { x0: -72_000, z0: -98_000, x1: 84_000, z1: 84_000 };

export interface FeatureMask {
  texture: CanvasTexture;
  rect: Vector4; // x0, z0, 1/w, 1/h
  resolution: number;
}

export function buildFeatureMask(_date: string, resolution: number): FeatureMask {
  const w = Math.ceil((MASK_RECT.x1 - MASK_RECT.x0) / resolution);
  const h = Math.ceil((MASK_RECT.z1 - MASK_RECT.z0) / resolution);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const X = (x: number) => (x - MASK_RECT.x0) / resolution;
  const Z = (z: number) => (z - MASK_RECT.z0) / resolution;

  // Roads first (green).
  for (const r of roadNetwork()) {
    ctx.strokeStyle = r.major ? 'rgb(0,255,0)' : 'rgb(0,200,0)';
    ctx.lineWidth = Math.max(r.width / resolution, r.major ? 0.9 : 0.7);
    ctx.beginPath();
    r.points.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Z(p.z)) : ctx.lineTo(X(p.x), Z(p.z))));
    ctx.stroke();
  }
  // Rivers (red). Minimum width keeps them legible from altitude.
  for (const r of riverPolylines()) {
    ctx.strokeStyle = 'rgb(255,0,0)';
    ctx.lineWidth = Math.max(r.width, resolution * 1.15) / resolution;
    ctx.beginPath();
    r.points.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Z(p.z)) : ctx.lineTo(X(p.x), Z(p.z))));
    ctx.stroke();
  }
  // Aerodrome grass is a mesh decal (render/aerodromes.ts); B is unused.
  const tex = new CanvasTexture(canvas);
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return {
    texture: tex,
    rect: new Vector4(MASK_RECT.x0, MASK_RECT.z0, 1 / (w * resolution), 1 / (h * resolution)),
    resolution,
  };
}
