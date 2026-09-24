/**
 * Stylised period map (canvas 2D): trench-map paper, coast, rivers, woods,
 * towns, the front line as a hatched no-man's-land band with trench lines,
 * aerodromes, a 10 km squared grid, compass rose and scale bar. Mission
 * overlays: route + waypoints, balloons, ground targets, aircraft markers.
 *
 * Used for the briefing map and the in-flight map overlay.
 */
import { latLonToWorld } from '../../core/geo';
import type { MissionDefinition, Side, Waypoint } from '../../core/types';
import { aerodromesActiveOn, getAerodrome } from '../../data/aerodromes';
import { COASTLINE, FORESTS, RIVERS, TOWNS } from '../../data/geography';
import { frontLineAt } from '../../world/frontline';
import type { UnitSystem } from '../format';

export interface MapMarker {
  kind: 'aircraft' | 'balloon' | 'ground';
  x: number;
  z: number;
  side: Side;
  /** Radians, 0 = north (aircraft only). */
  heading?: number;
  label?: string;
  isPlayer?: boolean;
  destroyed?: boolean;
}

export interface MapView {
  date: string;
  units: UnitSystem;
  /** Side the viewer fights for (labels "our lines"/"enemy lines"). */
  playerSide?: Side;
  /** Visible region; defaults to fitting the overlays. */
  center?: { x: number; z: number };
  /** Visible width in metres. */
  spanM?: number;
  route?: Waypoint[];
  routeStart?: { x: number; z: number };
  /** Index of the next waypoint (drawn highlighted). */
  activeWaypoint?: number;
  markers?: MapMarker[];
  homeAerodromeId?: string;
  title?: string;
  style?: 'briefing' | 'overlay';
}

const PAPER = '#e9dcbc';
const INK = '#2d241a';
const INK_SOFT = 'rgba(45,36,26,0.55)';
const WATER = '#9fb3b0';
const WATER_INK = '#4f6f73';
const WOOD = 'rgba(96,112,64,0.35)';
const ALLIED = '#2f4a86';
const CENTRAL = '#9a2a22';

let noiseCanvas: HTMLCanvasElement | null = null;
function noise(): HTMLCanvasElement {
  if (noiseCanvas) return noiseCanvas;
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d')!;
  const img = g.createImageData(160, 160);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rnd();
    img.data[i] = 90;
    img.data[i + 1] = 62;
    img.data[i + 2] = 25;
    img.data[i + 3] = v < 0.5 ? v * 30 : v > 0.985 ? 90 : 0;
  }
  g.putImageData(img, 0, 0);
  noiseCanvas = c;
  return c;
}

function hatch(ctx: CanvasRenderingContext2D, color: string, spacing: number, width: number): CanvasPattern {
  const c = document.createElement('canvas');
  const s = Math.max(4, Math.round(spacing));
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(-1, s + 1);
  g.lineTo(s + 1, -1);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(s - 1, s + 1);
  g.lineTo(s + 1, s - 1);
  g.stroke();
  return ctx.createPattern(c, 'repeat')!;
}

/** Fit a view to a mission's route, targets and home field. */
export function fitMission(m: MissionDefinition, aspect = 1.4): { center: { x: number; z: number }; spanM: number } {
  const pts: { x: number; z: number }[] = [];
  const player = m.flights.find((f) => f.role === 'player-flight') ?? m.flights[0];
  if (player) {
    pts.push({ x: player.start.x, z: player.start.z });
    for (const w of player.waypoints) pts.push(w);
  }
  for (const b of m.balloons) pts.push(b);
  for (const g of m.groundTargets) pts.push(g);
  const home = getAerodrome(m.homeAerodromeId);
  if (home) pts.push(home);
  if (!pts.length) return { center: { x: 0, z: 0 }, spanM: 60_000 };
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const w = Math.max(maxX - minX, (maxZ - minZ) * aspect);
  return { center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }, spanM: Math.max(22_000, w * 1.45) };
}

export function missionMapView(m: MissionDefinition, units: UnitSystem, aspect = 1.4): MapView {
  const player = m.flights.find((f) => f.role === 'player-flight') ?? m.flights[0];
  const fit = fitMission(m, aspect);
  const markers: MapMarker[] = [
    ...m.balloons.map((b) => ({ kind: 'balloon' as const, x: b.x, z: b.z, side: b.side })),
    ...m.groundTargets.map((g) => ({ kind: 'ground' as const, x: g.x, z: g.z, side: g.side, label: g.type.replace(/-/g, ' ') })),
  ];
  if (player) markers.push({ kind: 'aircraft', x: player.start.x, z: player.start.z, heading: player.start.heading, side: player.side, isPlayer: true });
  return {
    date: m.date,
    units,
    playerSide: player?.side,
    ...fit,
    route: player?.waypoints,
    routeStart: player ? { x: player.start.x, z: player.start.z } : undefined,
    markers,
    homeAerodromeId: m.homeAerodromeId,
    title: m.title,
    style: 'briefing',
  };
}

interface Proj {
  sx(x: number): number;
  sy(z: number): number;
  scale: number; // px per metre
}

function ll(lat: number, lon: number): { x: number; z: number } {
  return latLonToWorld(lat, lon);
}

/** Draw the map into `canvas` (sized to its CSS box × devicePixelRatio). */
export function drawMap(canvas: HTMLCanvasElement, view: MapView): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext('2d')!;
  const W = cw;
  const H = ch;
  const u = Math.max(1, Math.min(W, H) / 700); // UI scale unit
  const center = view.center ?? { x: 0, z: 0 };
  const span = view.spanM ?? 60_000;
  const scale = W / span;
  const P: Proj = {
    sx: (x) => (x - center.x) * scale + W / 2,
    sy: (z) => (z - center.z) * scale + H / 2,
    scale,
  };

  // --- paper
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  grad.addColorStop(0, 'rgba(255,248,230,0.25)');
  grad.addColorStop(1, 'rgba(120,80,30,0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = ctx.createPattern(noise(), 'repeat')!;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  drawGrid(ctx, P, W, H, u, center, span);
  drawSea(ctx, P, W, H, u);
  drawForests(ctx, P, u);
  drawRivers(ctx, P, u);
  drawFront(ctx, P, view, u);
  drawTowns(ctx, P, u, span);
  drawAerodromes(ctx, P, view, u, span);
  if (view.route) drawRoute(ctx, P, view, u);
  for (const m of view.markers ?? []) drawMarker(ctx, P, m, view, u);
  drawCompass(ctx, W - 58 * u, 62 * u, 40 * u, u);
  drawScale(ctx, W, H, u, scale, view.units);
  if (view.title) drawCartouche(ctx, view, u);
  // frame
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3 * u;
  ctx.strokeRect(6 * u, 6 * u, W - 12 * u, H - 12 * u);
  ctx.lineWidth = 1 * u;
  ctx.strokeRect(11 * u, 11 * u, W - 22 * u, H - 22 * u);
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, P: Proj, W: number, H: number, u: number, center: { x: number; z: number }, span: number): void {
  const step = span > 90_000 ? 20_000 : 10_000;
  ctx.strokeStyle = 'rgba(45,36,26,0.13)';
  ctx.lineWidth = u;
  ctx.fillStyle = 'rgba(45,36,26,0.4)';
  ctx.font = `${10 * u}px "Courier New", monospace`;
  const x0 = Math.floor((center.x - span) / step) * step;
  for (let x = x0; x < center.x + span; x += step) {
    const px = P.sx(x);
    if (px < 0 || px > W) continue;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }
  const z0 = Math.floor((center.z - span) / step) * step;
  let row = 0;
  for (let z = z0; z < center.z + span; z += step, row++) {
    const py = P.sy(z);
    if (py < 0 || py > H) continue;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(W, py);
    ctx.stroke();
  }
  // Square letters (trench-map style)
  const letters = 'ABCDEFGHJKLMNOPQRSTUVWX';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let x = x0; x < center.x + span; x += step)
    for (let z = z0; z < center.z + span; z += step) {
      const px = P.sx(x + step / 2);
      const py = P.sy(z + step / 2);
      if (px < 20 * u || px > W - 20 * u || py < 20 * u || py > H - 20 * u) continue;
      const i = Math.abs(Math.round(x / step) * 7 + Math.round(z / step) * 3) % letters.length;
      ctx.fillStyle = 'rgba(45,36,26,0.14)';
      ctx.font = `bold ${22 * u}px Georgia, serif`;
      ctx.fillText(letters[i], px, py);
    }
}

function drawSea(ctx: CanvasRenderingContext2D, P: Proj, W: number, H: number, u: number): void {
  const pts = COASTLINE.map(([la, lo]) => ll(la, lo));
  const first = pts[0];
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.moveTo(P.sx(first.x - 200_000), P.sy(first.z));
  for (const p of pts) ctx.lineTo(P.sx(p.x), P.sy(p.z));
  ctx.lineTo(P.sx(last.x + 200_000), P.sy(last.z - 200_000));
  ctx.lineTo(P.sx(first.x - 200_000), P.sy(last.z - 200_000));
  ctx.closePath();
  ctx.save();
  ctx.fillStyle = WATER;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.clip();
  // Coast ripple lines
  ctx.strokeStyle = 'rgba(79,111,115,0.35)';
  ctx.lineWidth = u;
  for (let k = 1; k <= 5; k++) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = P.sx(p.x) - k * 6 * u;
      const y = P.sy(p.z) - k * 6 * u;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(P.sx(p.x), P.sy(p.z)) : ctx.lineTo(P.sx(p.x), P.sy(p.z))));
  ctx.strokeStyle = WATER_INK;
  ctx.lineWidth = 1.6 * u;
  ctx.stroke();
  void W;
  void H;
}

function drawForests(ctx: CanvasRenderingContext2D, P: Proj, u: number): void {
  for (const f of FORESTS) {
    ctx.beginPath();
    f.points.forEach(([la, lo], i) => {
      const p = ll(la, lo);
      if (i === 0) ctx.moveTo(P.sx(p.x), P.sy(p.z));
      else ctx.lineTo(P.sx(p.x), P.sy(p.z));
    });
    ctx.closePath();
    ctx.fillStyle = WOOD;
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,86,46,0.6)';
    ctx.lineWidth = u;
    ctx.setLineDash([2 * u, 2 * u]);
    ctx.stroke();
    ctx.setLineDash([]);
    // tree stipple
    const c = f.points.reduce((a, [la, lo]) => ({ la: a.la + la / f.points.length, lo: a.lo + lo / f.points.length }), { la: 0, lo: 0 });
    const cp = ll(c.la, c.lo);
    ctx.fillStyle = 'rgba(60,76,40,0.55)';
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const r = (i % 3) * 5 * u + 3 * u;
      ctx.beginPath();
      ctx.arc(P.sx(cp.x) + Math.cos(a) * r, P.sy(cp.z) + Math.sin(a) * r, 1.5 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    if (f.name && P.scale > 0.004) {
      ctx.fillStyle = 'rgba(60,76,40,0.9)';
      ctx.font = `italic ${10 * u}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText(f.name, P.sx(cp.x), P.sy(cp.z) + 14 * u);
    }
  }
}

function drawRivers(ctx: CanvasRenderingContext2D, P: Proj, u: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const r of RIVERS) {
    const pts = r.points.map(([la, lo]) => ll(la, lo));
    const w = Math.max(1.4 * u, r.width * P.scale * 6);
    for (const [col, lw] of [
      ['rgba(79,111,115,0.7)', w + 1.5 * u],
      [WATER, w],
    ] as const) {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(P.sx(p.x), P.sy(p.z)) : ctx.lineTo(P.sx(p.x), P.sy(p.z))));
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    // Label along the middle segment
    const mid = Math.floor(pts.length / 2);
    const a = pts[mid - 1] ?? pts[0];
    const b = pts[mid];
    let ang = Math.atan2(P.sy(b.z) - P.sy(a.z), P.sx(b.x) - P.sx(a.x));
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    ctx.save();
    ctx.translate((P.sx(a.x) + P.sx(b.x)) / 2, (P.sy(a.z) + P.sy(b.z)) / 2);
    ctx.rotate(ang);
    ctx.fillStyle = WATER_INK;
    ctx.font = `italic ${11 * u}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillText(r.name, 0, -6 * u);
    ctx.restore();
  }
}

function offsetPolyline(pts: { x: number; y: number }[], d: number): { x: number; y: number }[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (-dy / len) * d, y: p.y + (dx / len) * d };
  });
}

/** Resample a polyline to roughly `step` spacing. */
function resample(pts: { x: number; y: number }[], step: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

function drawFront(ctx: CanvasRenderingContext2D, P: Proj, view: MapView, u: number): void {
  const line = frontLineAt(view.date).points.map((p) => ({ x: P.sx(p.x), y: P.sy(p.z) }));
  if (line.length < 2) return;
  const bandW = Math.max(10 * u, 1600 * P.scale);
  // No man's land band
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = 'rgba(120,90,55,0.25)';
  ctx.lineWidth = bandW;
  ctx.stroke();
  ctx.strokeStyle = hatch(ctx, 'rgba(70,50,30,0.55)', 6 * u, 0.9 * u);
  ctx.stroke();
  // Trench lines, zig-zag, either side. Line runs north->south; +normal (−dy, dx) points west (allied side).
  const dense = resample(line, 5 * u);
  for (const [sideSign, color] of [
    [1, ALLIED],
    [-1, CENTRAL],
  ] as const) {
    // Crenellated trench trace: alternate between two parallel offsets.
    const inner = offsetPolyline(dense, (sideSign * bandW) / 2);
    const outer = offsetPolyline(dense, sideSign * (bandW / 2 + 3 * u));
    ctx.beginPath();
    inner.forEach((p, i) => {
      const q = Math.floor(i / 2) % 2 === 0 ? p : outer[i];
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8 * u;
    ctx.stroke();
  }
  // Side labels
  const mid = line[Math.floor(line.length / 2)];
  const pMid = line[Math.floor(line.length / 2) + 1] ?? mid;
  let ang = Math.atan2(pMid.y - mid.y, pMid.x - mid.x);
  const flip = ang > Math.PI / 2 || ang < -Math.PI / 2;
  if (flip) ang += Math.PI;
  const labelFor = (side: Side) => {
    if (!view.playerSide) return side === 'allied' ? 'ALLIED LINES' : 'GERMAN LINES';
    return side === view.playerSide ? 'OUR LINES' : 'ENEMY LINES';
  };
  ctx.font = `bold ${11 * u}px Georgia, serif`;
  ctx.textAlign = 'center';
  const west = offsetPolyline([mid, pMid], bandW / 2 + 16 * u)[0];
  const east = offsetPolyline([mid, pMid], -bandW / 2 - 16 * u)[0];
  for (const [p, side] of [
    [west, 'allied'],
    [east, 'central'],
  ] as const) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.fillStyle = side === 'allied' ? ALLIED : CENTRAL;
    ctx.fillText(labelFor(side).split('').join(String.fromCharCode(8202)), 0, 4 * u);
    ctx.restore();
  }
  ctx.restore();
}

function drawTowns(ctx: CanvasRenderingContext2D, P: Proj, u: number, span: number): void {
  ctx.textBaseline = 'middle';
  for (const t of TOWNS) {
    if (t.size === 'village' && span > 110_000) continue;
    const p = ll(t.lat, t.lon);
    const x = P.sx(p.x);
    const y = P.sy(p.z);
    const r = t.size === 'city' ? 5 * u : t.size === 'town' ? 3.5 * u : 2.2 * u;
    ctx.fillStyle = INK;
    if (t.size === 'city') {
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = PAPER;
      ctx.fillRect(x - r * 0.45, y - r * 0.45, r * 0.9, r * 0.9);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.font =
      t.size === 'city' ? `bold ${13 * u}px Georgia, "Iowan Old Style", serif` : t.size === 'town' ? `${12 * u}px Georgia, serif` : `italic ${10 * u}px Georgia, serif`;
    ctx.fillText(t.size === 'city' ? t.name.toUpperCase() : t.name, x + r + 4 * u, y);
  }
}

function drawAerodromes(ctx: CanvasRenderingContext2D, P: Proj, view: MapView, u: number, span: number): void {
  for (const a of aerodromesActiveOn(view.date)) {
    const home = a.id === view.homeAerodromeId;
    if (!home && span > 100_000) continue;
    const x = P.sx(a.x);
    const y = P.sy(a.z);
    const r = (home ? 9 : 6) * u;
    const col = a.side === 'allied' ? ALLIED : CENTRAL;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = col;
    ctx.fillStyle = home ? 'rgba(255,250,235,0.9)' : 'rgba(255,250,235,0.6)';
    ctx.lineWidth = (home ? 2 : 1.2) * u;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate((a.runwayHeadingDeg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.75);
    ctx.lineTo(0, r * 0.75);
    ctx.stroke();
    ctx.restore();
    if (home || span < 70_000) {
      ctx.fillStyle = col;
      ctx.font = `${home ? 'bold ' : ''}${(home ? 11 : 9) * u}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(home ? `${a.name} (home)` : a.name, x, y + r + 9 * u);
    }
  }
}

function drawRoute(ctx: CanvasRenderingContext2D, P: Proj, view: MapView, u: number): void {
  const route = view.route!;
  const pts = [...(view.routeStart ? [view.routeStart] : []), ...route];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = view.style === 'overlay' ? 'rgba(20,16,12,0.8)' : '#1d1813';
  ctx.lineWidth = 2.2 * u;
  ctx.setLineDash([9 * u, 6 * u]);
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(P.sx(p.x), P.sy(p.z)) : ctx.lineTo(P.sx(p.x), P.sy(p.z))));
  ctx.stroke();
  ctx.setLineDash([]);
  // arrowheads on each leg
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const mx = (P.sx(a.x) + P.sx(b.x)) / 2;
    const my = (P.sy(a.z) + P.sy(b.z)) / 2;
    const ang = Math.atan2(P.sy(b.z) - P.sy(a.z), P.sx(b.x) - P.sx(a.x));
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.fillStyle = '#1d1813';
    ctx.beginPath();
    ctx.moveTo(7 * u, 0);
    ctx.lineTo(-5 * u, -5 * u);
    ctx.lineTo(-5 * u, 5 * u);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  route.forEach((w, i) => {
    const x = P.sx(w.x);
    const y = P.sy(w.z);
    const active = view.activeWaypoint === i;
    const r = (active ? 11 : 9) * u;
    ctx.fillStyle = active ? '#a8262c' : 'rgba(255,250,235,0.95)';
    ctx.strokeStyle = '#1d1813';
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active ? '#fff' : '#1d1813';
    ctx.font = `bold ${11 * u}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y + 0.5 * u);
    const label = w.label ?? actionLabel(w.action);
    if (label) {
      ctx.font = `${10 * u}px "Courier New", monospace`;
      ctx.textAlign = 'left';
      const alt = view.units === 'metric' ? `${Math.round(w.altitude / 100) * 100} m` : `${Math.round((w.altitude * 3.28084) / 500) * 500} ft`;
      const text = `${label} · ${alt}`;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(255,250,235,0.8)';
      ctx.fillRect(x + r + 3 * u, y - 7 * u, tw + 6 * u, 14 * u);
      ctx.fillStyle = '#1d1813';
      ctx.fillText(text, x + r + 6 * u, y);
    }
  });
  ctx.restore();
}

function actionLabel(a: Waypoint['action']): string {
  switch (a) {
    case 'patrol':
      return 'Patrol';
    case 'attack-ground':
      return 'Attack';
    case 'attack-balloon':
      return 'Balloons';
    case 'rendezvous':
      return 'Rendezvous';
    case 'land':
      return 'Land';
    default:
      return '';
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, P: Proj, m: MapMarker, view: MapView, u: number): void {
  const x = P.sx(m.x);
  const y = P.sy(m.z);
  const friendly = view.playerSide ? m.side === view.playerSide : m.side === 'allied';
  const col = m.isPlayer ? '#1d1813' : friendly ? ALLIED : CENTRAL;
  const fCol = view.playerSide ? (friendly ? '#2f4a86' : '#9a2a22') : m.side === 'allied' ? ALLIED : CENTRAL;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = m.destroyed ? 0.45 : 1;
  switch (m.kind) {
    case 'aircraft': {
      ctx.rotate(m.heading ?? 0);
      const s = (m.isPlayer ? 1.3 : 1) * u;
      ctx.fillStyle = m.isPlayer ? '#1d1813' : fCol;
      ctx.strokeStyle = 'rgba(255,250,235,0.9)';
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      // plan-view biplane glyph, nose up (north)
      ctx.moveTo(0, -10 * s);
      ctx.lineTo(1.6 * s, -5 * s);
      ctx.lineTo(10 * s, -4 * s);
      ctx.lineTo(10 * s, -1 * s);
      ctx.lineTo(1.6 * s, 0);
      ctx.lineTo(1.2 * s, 6 * s);
      ctx.lineTo(4.5 * s, 7 * s);
      ctx.lineTo(4.5 * s, 9 * s);
      ctx.lineTo(-4.5 * s, 9 * s);
      ctx.lineTo(-4.5 * s, 7 * s);
      ctx.lineTo(-1.2 * s, 6 * s);
      ctx.lineTo(-1.6 * s, 0);
      ctx.lineTo(-10 * s, -1 * s);
      ctx.lineTo(-10 * s, -4 * s);
      ctx.lineTo(-1.6 * s, -5 * s);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      break;
    }
    case 'balloon': {
      ctx.fillStyle = m.destroyed ? '#555' : fCol;
      ctx.strokeStyle = '#1d1813';
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      ctx.ellipse(0, -4 * u, 7 * u, 4.5 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 7 * u);
      ctx.stroke();
      ctx.fillStyle = '#1d1813';
      ctx.fillRect(-2 * u, 7 * u, 4 * u, 2 * u);
      break;
    }
    case 'ground': {
      ctx.strokeStyle = m.destroyed ? '#555' : fCol;
      ctx.lineWidth = 2.6 * u;
      ctx.beginPath();
      ctx.moveTo(-6 * u, -6 * u);
      ctx.lineTo(6 * u, 6 * u);
      ctx.moveTo(6 * u, -6 * u);
      ctx.lineTo(-6 * u, 6 * u);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
  if (m.label) {
    ctx.fillStyle = col;
    ctx.font = `${9 * u}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(m.label, x, y + 11 * u);
  }
}

function drawCompass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, u: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK;
  ctx.fillStyle = 'rgba(255,250,235,0.7)';
  ctx.lineWidth = u;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const len = i % 2 === 0 ? r : r * 0.55;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(len * 0.14, 0);
    ctx.lineTo(0, len * 0.04);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(-len * 0.14, 0);
    ctx.lineTo(0, len * 0.04);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,250,235,0.95)';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = INK;
  ctx.font = `bold ${13 * u}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', 0, -r - 2 * u);
  ctx.restore();
}

function drawScale(ctx: CanvasRenderingContext2D, W: number, H: number, u: number, scale: number, units: UnitSystem): void {
  const unitM = units === 'metric' ? 1000 : 1609.344;
  const target = 150 * u;
  const candidates = [1, 2, 5, 10, 20];
  let n = candidates[0];
  for (const c of candidates) if (c * unitM * scale <= target) n = c;
  const len = n * unitM * scale;
  const x = W - 30 * u - len;
  const y = H - 34 * u;
  ctx.save();
  ctx.fillStyle = 'rgba(255,250,235,0.75)';
  ctx.fillRect(x - 10 * u, y - 18 * u, len + 20 * u, 32 * u);
  ctx.strokeStyle = INK;
  ctx.lineWidth = u;
  const segs = n <= 2 ? n * 2 : n >= 10 ? 5 : n;
  for (let i = 0; i < segs; i++) {
    ctx.fillStyle = i % 2 === 0 ? INK : 'rgba(255,250,235,1)';
    ctx.fillRect(x + (len / segs) * i, y, len / segs, 5 * u);
  }
  ctx.strokeRect(x, y, len, 5 * u);
  ctx.fillStyle = INK;
  ctx.font = `${10 * u}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('0', x, y - 2 * u);
  ctx.fillText(`${n} ${units === 'metric' ? 'km' : 'miles'}`, x + len, y - 2 * u);
  ctx.restore();
}

function drawCartouche(ctx: CanvasRenderingContext2D, view: MapView, u: number): void {
  const text = view.title!;
  ctx.save();
  ctx.font = `bold ${14 * u}px Georgia, serif`;
  const w = Math.max(ctx.measureText(text).width, 140 * u) + 30 * u;
  const x = 22 * u;
  const y = 22 * u;
  ctx.fillStyle = 'rgba(250,243,225,0.9)';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5 * u;
  ctx.fillRect(x, y, w, 46 * u);
  ctx.strokeRect(x, y, w, 46 * u);
  ctx.strokeRect(x + 3 * u, y + 3 * u, w - 6 * u, 40 * u);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x + 15 * u, y + 9 * u);
  ctx.font = `${10 * u}px "Courier New", monospace`;
  ctx.fillStyle = INK_SOFT;
  const [yy, mm, dd] = view.date.split('-');
  ctx.fillText(`Sheet 51b/57c · Corrected to ${dd}.${mm}.${yy}`, x + 15 * u, y + 28 * u);
  ctx.restore();
}

/** Mount a self-resizing map canvas. */
export function createMapCanvas(view: MapView): { canvas: HTMLCanvasElement; update(v: MapView): void; dispose(): void } {
  const canvas = document.createElement('canvas');
  let current = view;
  const redraw = () => {
    if (canvas.isConnected) drawMap(canvas, current);
  };
  const ro = new ResizeObserver(redraw);
  ro.observe(canvas);
  requestAnimationFrame(redraw);
  return {
    canvas,
    update(v) {
      current = v;
      redraw();
    },
    dispose() {
      ro.disconnect();
    },
  };
}
