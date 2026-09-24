/**
 * Cockpit instrument faces drawn to CanvasTextures. Mapped onto the
 * Gauge_* disc meshes (UV 0..1, canvas top = gauge top).
 */
import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace } from 'three';
import type { AircraftEntity, Nation } from '../../core/types';

export type GaugeKind = 'Gauge_RPM' | 'Gauge_Alt' | 'Gauge_Speed' | 'Gauge_Compass' | 'Gauge_Fuel';
export const GAUGE_KINDS: GaugeKind[] = ['Gauge_RPM', 'Gauge_Alt', 'Gauge_Speed', 'Gauge_Compass', 'Gauge_Fuel'];

const SIZE = 192;

export interface GaugeSet {
  materials: Record<GaugeKind, MeshStandardMaterial>;
  draw(ac: AircraftEntity): void;
  dispose(): void;
}

export function imperialFor(nation: Nation): boolean {
  return nation === 'britain' || nation === 'usa';
}

/** Heading in degrees (0 = north, clockwise) from a body->world quaternion. */
export function headingDeg(q: { x: number; y: number; z: number; w: number }): number {
  // forward = q * (0,0,-1)
  const { x, y, z, w } = q;
  const fx = -(2 * (x * z + w * y));
  const fz = -(1 - 2 * (x * x + y * y));
  let h = (Math.atan2(fx, -fz) * 180) / Math.PI;
  if (h < 0) h += 360;
  return h;
}

function dial(ctx: CanvasRenderingContext2D, label: string, min: number, max: number, major: number, value: number, sweep = 300, fmt = (v: number) => String(v)) {
  const c = SIZE / 2;
  ctx.fillStyle = '#e9e1c9';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#16140f';
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e6dcc0';
  ctx.beginPath();
  ctx.arc(c, c, c - 8, 0, Math.PI * 2);
  ctx.fill();
  const a0 = (-sweep / 2 - 90) * (Math.PI / 180);
  const span = sweep * (Math.PI / 180);
  const ang = (v: number) => a0 + ((v - min) / (max - min)) * span;
  ctx.strokeStyle = '#1d1a14';
  ctx.fillStyle = '#1d1a14';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(SIZE * 0.085)}px Georgia, serif`;
  for (let v = min; v <= max + 1e-6; v += major / 2) {
    const a = ang(v);
    const isMajor = Math.abs((v - min) / major - Math.round((v - min) / major)) < 1e-6;
    ctx.lineWidth = isMajor ? 3 : 1.5;
    const r1 = c - 10, r0 = isMajor ? c - 24 : c - 18;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
    if (isMajor) ctx.fillText(fmt(v), c + Math.cos(a) * (c - 38), c + Math.sin(a) * (c - 38));
  }
  ctx.font = `${Math.round(SIZE * 0.07)}px Georgia, serif`;
  ctx.fillText(label, c, c + SIZE * 0.2);
  const a = ang(Math.max(min, Math.min(max, value)));
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(c - Math.cos(a) * 12, c - Math.sin(a) * 12);
  ctx.lineTo(c + Math.cos(a) * (c - 22), c + Math.sin(a) * (c - 22));
  ctx.stroke();
  ctx.fillStyle = '#3a3226';
  ctx.beginPath();
  ctx.arc(c, c, 7, 0, Math.PI * 2);
  ctx.fill();
  glass(ctx);
}

function glass(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 8, 0, Math.PI * 2);
  ctx.fill();
}

function compass(ctx: CanvasRenderingContext2D, heading: number) {
  const c = SIZE / 2;
  ctx.fillStyle = '#16140f';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#d9cfae';
  ctx.beginPath();
  ctx.arc(c, c, c - 8, 0, Math.PI * 2);
  ctx.fill();
  // Card rotates so the current heading sits under the lubber line (top).
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate((-heading * Math.PI) / 180);
  ctx.fillStyle = '#1d1a14';
  ctx.strokeStyle = '#1d1a14';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let d = 0; d < 360; d += 10) {
    const a = (d * Math.PI) / 180 - Math.PI / 2;
    const major = d % 30 === 0;
    ctx.lineWidth = major ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (c - 10), Math.sin(a) * (c - 10));
    ctx.lineTo(Math.cos(a) * (c - (major ? 24 : 17)), Math.sin(a) * (c - (major ? 24 : 17)));
    ctx.stroke();
  }
  ctx.font = `bold ${Math.round(SIZE * 0.13)}px Georgia, serif`;
  const labels: [string, number][] = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  for (const [t, d] of labels) {
    const a = (d * Math.PI) / 180 - Math.PI / 2;
    ctx.save();
    ctx.translate(Math.cos(a) * (c - 42), Math.sin(a) * (c - 42));
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = t === 'N' ? '#8a1c14' : '#1d1a14';
    ctx.fillText(t, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = '#8a1c14';
  ctx.beginPath();
  ctx.moveTo(c, 6);
  ctx.lineTo(c - 7, 22);
  ctx.lineTo(c + 7, 22);
  ctx.closePath();
  ctx.fill();
  glass(ctx);
}

export function createGaugeSet(nation: Nation, rotary: boolean, fuelCapacityL: number): GaugeSet {
  const imperial = imperialFor(nation);
  const canvases = {} as Record<GaugeKind, HTMLCanvasElement>;
  const textures = {} as Record<GaugeKind, CanvasTexture>;
  const materials = {} as Record<GaugeKind, MeshStandardMaterial>;
  for (const k of GAUGE_KINDS) {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    canvases[k] = c;
    const t = new CanvasTexture(c);
    t.flipY = false;
    t.colorSpace = SRGBColorSpace;
    textures[k] = t;
    materials[k] = new MeshStandardMaterial({ map: t, roughness: 0.35, metalness: 0, emissive: 0x2a241a, emissiveIntensity: 0.25, emissiveMap: t });
  }
  const set: GaugeSet = {
    materials,
    draw(ac) {
      const s = ac.state;
      const rpmMax = rotary ? 1600 : 2000;
      dial(canvases.Gauge_RPM.getContext('2d')!, 'R.P.M.', 0, rpmMax, rotary ? 400 : 500, s.engineRpm, 300, (v) => String(v / 100));
      if (imperial) {
        dial(canvases.Gauge_Alt.getContext('2d')!, 'FEET ×1000', 0, 20, 2, (s.altitude * 3.28084) / 1000, 320);
        dial(canvases.Gauge_Speed.getContext('2d')!, 'M.P.H.', 0, 160, 20, s.airspeed * 2.23694, 300);
      } else {
        dial(canvases.Gauge_Alt.getContext('2d')!, 'm ×1000', 0, 7, 1, s.altitude / 1000, 320);
        dial(canvases.Gauge_Speed.getContext('2d')!, 'km/h', 0, 260, 40, s.airspeed * 3.6, 300);
      }
      compass(canvases.Gauge_Compass.getContext('2d')!, headingDeg(ac.state.orientation));
      dial(canvases.Gauge_Fuel.getContext('2d')!, 'FUEL', 0, 1, 0.5, fuelCapacityL > 0 ? s.fuelL / fuelCapacityL : 0, 180, (v) => (v === 0 ? 'E' : v === 1 ? 'F' : '½'));
      for (const k of GAUGE_KINDS) textures[k].needsUpdate = true;
    },
    dispose() {
      for (const k of GAUGE_KINDS) {
        textures[k].dispose();
        materials[k].dispose();
      }
    },
  };
  return set;
}
