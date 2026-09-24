/**
 * Runtime livery painter: draws national insignia, squadron colours,
 * patterns, rib tapes and weathering onto canvases that map onto the model
 * UV atlases (docs/models.md). Textures are cached per (aircraft, livery).
 */
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { AircraftSpec, Livery } from '../../core/types';
import type { AircraftMeta } from './meta';
import { roundelRings, rudderStripes } from './meta';

export interface LiveryTextures {
  fuselage: Texture;
  wingTop: Texture;
  wingBottom: Texture;
  tail: Texture;
  cowling: Texture;
}

type Ctx = CanvasRenderingContext2D;

const FUS_W = 1024, FUS_H = 512;
const WING_W = 1024, WING_H = 512;
const TAIL_W = 512, TAIL_H = 512;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(c);
  t.flipY = false; // glTF UV convention: v = 0 at the top of the image
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Deterministic PRNG so the same livery always paints identically. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Insignia primitives. All draw centred on (0,0) in a unit where the insignia
// "size" is 1 (fits in a 1x1 box). The caller sets up an (anisotropic) scale.
// ---------------------------------------------------------------------------

function drawIronCross(ctx: Ctx, border = true) {
  // Cross patée: arms flare toward the ends.
  const arm = (rot: number) => {
    ctx.save();
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(-0.07, 0);
    ctx.lineTo(-0.2, -0.5);
    ctx.quadraticCurveTo(0, -0.46, 0.2, -0.5);
    ctx.lineTo(0.07, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  if (border) {
    ctx.save();
    ctx.fillStyle = '#f1eee4';
    ctx.scale(1.14, 1.14);
    for (let i = 0; i < 4; i++) arm((i * Math.PI) / 2);
    ctx.fillRect(-0.12, -0.12, 0.24, 0.24);
    ctx.restore();
  }
  ctx.fillStyle = '#141312';
  for (let i = 0; i < 4; i++) arm((i * Math.PI) / 2);
  ctx.fillRect(-0.1, -0.1, 0.2, 0.2);
}

function drawBalkenkreuz(ctx: Ctx) {
  const w = 0.22;
  ctx.fillStyle = '#f1eee4';
  ctx.fillRect(-0.5, -w / 2 - 0.05, 1, w + 0.1);
  ctx.fillRect(-w / 2 - 0.05, -0.5, w + 0.1, 1);
  ctx.fillStyle = '#141312';
  ctx.fillRect(-0.45, -w / 2, 0.9, w);
  ctx.fillRect(-w / 2, -0.45, w, 0.9);
}

function drawRoundel(ctx: Ctx, rings: string[]) {
  const radii = [0.5, 0.34, 0.17];
  rings.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, radii[i], 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.01;
  ctx.beginPath();
  ctx.arc(0, 0, 0.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawInsignia(ctx: Ctx, insignia: Livery['insignia']) {
  if (insignia === 'iron-cross-patee') drawIronCross(ctx);
  else if (insignia === 'balkenkreuz') drawBalkenkreuz(ctx);
  else {
    const rings = roundelRings(insignia);
    if (rings) drawRoundel(ctx, rings);
  }
}

/** Draw an insignia of `sizeM` metres at canvas pixel (cx, cy) with px/m scales. */
function stamp(ctx: Ctx, cx: number, cy: number, sizeM: number, pxPerMu: number, pxPerMv: number, fn: (c: Ctx) => void, flipX = false, flipY = false) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sizeM * pxPerMu * (flipX ? -1 : 1), sizeM * pxPerMv * (flipY ? -1 : 1));
  fn(ctx);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const LOZENGE_UPPER = ['#2e3150', '#3e4a2d', '#5d3c4b', '#6a5b38', '#29384e'];
const LOZENGE_LOWER = ['#8c9db4', '#b99ba7', '#a6af90', '#c8b690', '#809ba9'];

function paintLozenge(ctx: Ctx, x: number, y: number, w: number, h: number, upper: boolean, seed: number) {
  const r = rng(seed);
  const cols = upper ? LOZENGE_UPPER : LOZENGE_LOWER;
  const s = 26; // hexagon size in px
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let row = -1; row * s * 0.75 < h + s; row++) {
    for (let col = -1; col * s < w + s; col++) {
      const cx = x + col * s + (row % 2 ? s / 2 : 0);
      const cy = y + row * s * 0.75;
      ctx.fillStyle = cols[Math.floor(r() * cols.length)];
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const px = cx + Math.cos(a) * s * 0.62 * (1 + (r() - 0.5) * 0.15);
        const py = cy + Math.sin(a) * s * 0.5;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintStreaked(ctx: Ctx, x: number, y: number, w: number, h: number, base: string, seed: number, vertical: boolean) {
  const r = rng(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const cols = ['#4b5a2f', '#6e4f5b', '#5c6a3a', '#7a6a4a'];
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = cols[Math.floor(r() * cols.length)];
    ctx.globalAlpha = 0.35 + r() * 0.35;
    ctx.lineWidth = 6 + r() * 16;
    ctx.beginPath();
    const sx = x + r() * w, sy = y + r() * h;
    const len = 40 + r() * 140;
    const ang = (vertical ? Math.PI / 2 : 0) + (r() - 0.5) * 0.5;
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/** Low-frequency blotches + fine grain so flat colours read as doped fabric. */
function weather(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, amount = 1) {
  const r = rng(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let i = 0; i < 40 * amount; i++) {
    const cx = x + r() * w, cy = y + r() * h, rad = 20 + r() * 90;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const dark = r() < 0.6;
    g.addColorStop(0, dark ? 'rgba(20,16,10,0.06)' : 'rgba(255,250,235,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  ctx.restore();
}

/** Rib tapes: thin chordwise lines every `spacingPx` along u. */
function ribTapes(ctx: Ctx, x: number, y: number, w: number, h: number, spacingPx: number, base: string) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = shade(base.startsWith('#') ? base : '#808080', 1.12);
  ctx.lineWidth = 2;
  for (let px = x + spacingPx / 2; px < x + w; px += spacingPx) {
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + h);
    ctx.stroke();
  }
  // leading-edge ply / trailing-edge wire shading
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y + h - 4, w, 4);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Painters per atlas
// ---------------------------------------------------------------------------

function paintWing(spec: AircraftSpec, liv: Livery, meta: AircraftMeta, top: boolean, date: string, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(WING_W, WING_H);
  const base = top ? liv.wingTop : liv.wingBottom;
  const pattern = liv.pattern ?? 'plain';
  const pxU = WING_W / meta.uv_span_ref; // px per metre spanwise
  const pxV = WING_H / 2 / meta.uv_chord_ref; // px per metre chordwise
  for (const region of [0, 1]) {
    const y0 = region * (WING_H / 2);
    if (pattern === 'lozenge') paintLozenge(ctx, 0, y0, WING_W, WING_H / 2, top, seed + region * 7 + (top ? 1 : 2));
    else if (pattern === 'streaked' && top) paintStreaked(ctx, 0, y0, WING_W, WING_H / 2, base, seed + region, false);
    else {
      ctx.fillStyle = base;
      ctx.fillRect(0, y0, WING_W, WING_H / 2);
    }
    ribTapes(ctx, 0, y0, WING_W, WING_H / 2, 0.3 * pxU, base);
  }
  weather(ctx, 0, 0, WING_W, WING_H, seed + (top ? 11 : 13));
  // insignia on the primary region: top-wing top surface / bottom-wing bottom surface
  const chord = top ? meta.uv_top_wing_chord : meta.uv_bottom_wing_chord;
  const halfSpan = (top ? meta.uv_span_ref : meta.uv_bottom_wing_span) / 2;
  const cy = (chord / 2) * pxV;
  const german = liv.insignia === 'iron-cross-patee' || liv.insignia === 'balkenkreuz';
  const size = german ? Math.min(chord * 0.92, 1.6) : Math.min(chord * 0.88, 1.5);
  const xOff = halfSpan - size * 0.5 - Math.min(0.9, halfSpan * 0.14);
  void date;
  void spec;
  for (const s of [-1, 1]) {
    stamp(ctx, WING_W / 2 + s * xOff * pxU, cy, size, pxU, pxV, (k) => drawInsignia(k, liv.insignia));
  }
  return c;
}

function paintFuselage(spec: AircraftSpec, liv: Livery, meta: AircraftMeta, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(FUS_W, FUS_H);
  const pxU = FUS_W / meta.uv_fuselage_len;
  const pxV = FUS_H / meta.uv_fuselage_perim;
  const pattern = liv.pattern ?? 'plain';
  if (pattern === 'streaked') paintStreaked(ctx, 0, 0, FUS_W, FUS_H, liv.fuselage, seed, false);
  else if (pattern === 'lozenge' && spec.id === 'fokker_dvii') {
    ctx.fillStyle = liv.fuselage;
    ctx.fillRect(0, 0, FUS_W, FUS_H);
  } else {
    ctx.fillStyle = liv.fuselage;
    ctx.fillRect(0, 0, FUS_W, FUS_H);
  }
  // Plywood fuselages: faint grain; fabric: stringer lines
  if (spec.geometry.fuselageShape === 'plywood-oval') {
    const r = rng(seed + 5);
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#3b2412';
    for (let i = 0; i < 160; i++) {
      const y = r() * FUS_H;
      ctx.lineWidth = 1 + r() * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(FUS_W * 0.3, y + (r() - 0.5) * 12, FUS_W * 0.6, y + (r() - 0.5) * 12, FUS_W, y + (r() - 0.5) * 8);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    for (const v of [0.12, 0.38, 0.62, 0.88]) {
      ctx.beginPath();
      ctx.moveTo(FUS_W * 0.25, v * FUS_H);
      ctx.lineTo(FUS_W, v * FUS_H);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (pattern === 'stripes') {
    ctx.save();
    ctx.fillStyle = liv.accent;
    for (let i = 0; i < 3; i++) ctx.fillRect(FUS_W * (0.5 + i * 0.1), 0, FUS_W * 0.04, FUS_H);
    ctx.restore();
  }
  weather(ctx, 0, 0, FUS_W, FUS_H, seed + 3, 1.2);
  // Exhaust / castor-oil staining aft of the engine
  const rotary = spec.performance.engineType === 'rotary';
  ctx.save();
  for (const sideV of [0.25, 0.75]) {
    const g = ctx.createLinearGradient(0, 0, FUS_W * 0.45, 0);
    g.addColorStop(0, rotary ? 'rgba(40,30,15,0.45)' : 'rgba(25,22,20,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    const cyv = (sideV + (rotary ? 0.12 * (sideV < 0.5 ? 1 : -1) : -0.06 * (sideV < 0.5 ? 1 : -1))) * FUS_H;
    ctx.fillRect(0, cyv - 0.25 * pxV, FUS_W * 0.45, 0.5 * pxV);
  }
  ctx.restore();
  // Insignia on both sides
  const german = liv.insignia === 'iron-cross-patee' || liv.insignia === 'balkenkreuz';
  const uIns = german ? 0.72 : 0.62;
  const L = meta.uv_fuselage_len;
  const localHeight = spec.geometry.fuselageWidth * 1.2 * (1 - 0.55 * uIns);
  const size = Math.min(localHeight * 0.95, german ? 0.85 : 0.8);
  if (liv.accent && german && liv.pattern !== 'stripes') {
    // Squadron band around the fuselage, forward of the cross
    ctx.fillStyle = liv.accent;
    ctx.fillRect((uIns - 0.12) * FUS_W, 0, 0.16 * pxU, FUS_H);
  }
  for (const [v, flipX, flipY] of [[0.25, true, false], [0.75, false, true]] as const) {
    stamp(ctx, uIns * FUS_W, v * FUS_H, size, pxU, pxV, (k) => drawInsignia(k, liv.insignia), flipX, flipY);
    if (liv.marking) {
      const mSize = size * 1.15;
      const u = uIns - (size * 0.5 + mSize * 0.55 + 0.1) / L;
      ctx.save();
      ctx.translate(u * FUS_W, v * FUS_H);
      ctx.scale(mSize * pxU * (flipX ? -1 : 1), mSize * pxV * (flipY ? -1 : 1));
      ctx.font = 'bold 0.9px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = german ? '#f1eee4' : '#f1eee4';
      ctx.strokeStyle = '#141312';
      ctx.lineWidth = 0.06;
      ctx.strokeText(liv.marking, 0, 0.03);
      ctx.fillText(liv.marking, 0, 0.03);
      ctx.restore();
    }
  }
  return c;
}

function paintTail(liv: Livery, meta: AircraftMeta, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(TAIL_W, TAIL_H);
  // Lower half: horizontal tail
  if (liv.pattern === 'lozenge') paintLozenge(ctx, 0, TAIL_H / 2, TAIL_W, TAIL_H / 2, true, seed + 21);
  else {
    ctx.fillStyle = liv.tail;
    ctx.fillRect(0, TAIL_H / 2, TAIL_W, TAIL_H / 2);
  }
  // Upper half: fin (u 0..0.4) + rudder (u 0.4..1)
  ctx.fillStyle = liv.tail;
  ctx.fillRect(0, 0, TAIL_W, TAIL_H / 2);
  const stripes = rudderStripes(liv.insignia);
  const rx0 = 0.4 * TAIL_W, rw = 0.6 * TAIL_W;
  if (stripes) {
    stripes.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(rx0 + (rw * i) / 3, 0, rw / 3 + 1, TAIL_H / 2);
    });
  } else {
    // German: white rudder field (1916-17) or plain with Balkenkreuz (1918)
    const pxU = rw / Math.max(0.2, meta.uv_rudder_chord);
    const pxV = TAIL_H / 2 / Math.max(0.3, meta.uv_vtail_height);
    if (liv.insignia === 'iron-cross-patee') {
      ctx.fillStyle = '#f1eee4';
      ctx.fillRect(rx0, 0, rw, TAIL_H / 2);
      const size = Math.min(meta.uv_rudder_chord * 0.85, meta.uv_vtail_height * 0.6);
      stamp(ctx, rx0 + rw * 0.45, TAIL_H * 0.2, size, pxU, pxV, (k) => drawIronCross(k, false));
    } else {
      const size = Math.min(meta.uv_rudder_chord * 0.9, meta.uv_vtail_height * 0.6);
      stamp(ctx, rx0 + rw * 0.45, TAIL_H * 0.22, size, pxU, pxV, drawBalkenkreuz);
    }
  }
  weather(ctx, 0, 0, TAIL_W, TAIL_H, seed + 9, 0.6);
  return c;
}

function paintCowling(liv: Livery): HTMLCanvasElement {
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = liv.cowling;
  ctx.fillRect(0, 0, 256, 128);
  // engine-turned aluminium swirl hint + oil streaks toward the back
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = i % 2 ? '#ffffff' : '#000000';
    ctx.beginPath();
    ctx.arc((i % 10) * 28 + 10, Math.floor(i / 10) * 30 + 12, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.35;
  const g = ctx.createLinearGradient(0, 70, 0, 128);
  g.addColorStop(0, 'rgba(30,22,10,0)');
  g.addColorStop(1, 'rgba(30,22,10,0.8)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 70, 256, 58);
  ctx.globalAlpha = 1;
  return c;
}

const cache = new Map<string, LiveryTextures>();

export function liveryKey(spec: AircraftSpec, liv: Livery): string {
  return `${spec.id}|${JSON.stringify(liv)}`;
}

/** Paint (or fetch cached) livery textures for an aircraft type + livery. */
export function getLiveryTextures(spec: AircraftSpec, liv: Livery, meta: AircraftMeta, date = '1917-06-01'): LiveryTextures {
  const key = liveryKey(spec, liv);
  const hit = cache.get(key);
  if (hit) return hit;
  const seed = hashString(key);
  const t: LiveryTextures = {
    fuselage: tex(paintFuselage(spec, liv, meta, seed)),
    wingTop: tex(paintWing(spec, liv, meta, true, date, seed)),
    wingBottom: tex(paintWing(spec, liv, meta, false, date, seed)),
    tail: tex(paintTail(liv, meta, seed)),
    cowling: tex(paintCowling(liv)),
  };
  cache.set(key, t);
  return t;
}

export function clearLiveryCache(): void {
  for (const t of cache.values()) Object.values(t).forEach((x) => x.dispose());
  cache.clear();
}

/** Plausible default livery for a nation (used when a mission omits one). */
export function defaultLivery(spec: AircraftSpec, date = '1917-06-01'): Livery {
  switch (spec.nation) {
    case 'germany': {
      const insignia = date >= '1918-04-15' ? 'balkenkreuz' : 'iron-cross-patee';
      if (spec.geometry.fuselageShape === 'plywood-oval')
        return { fuselage: '#b58c55', wingTop: '#6c7442', wingBottom: '#a9bccb', tail: '#b58c55', cowling: '#a3a39b', accent: '#b58c55', insignia, pattern: 'streaked' };
      if (date >= '1917-11-01')
        return { fuselage: '#556b3a', wingTop: '#3e4a2d', wingBottom: '#9fb0c0', tail: '#556b3a', cowling: '#556b3a', accent: '#556b3a', insignia, pattern: 'lozenge' };
      return { fuselage: '#c9bd92', wingTop: '#7b7a4c', wingBottom: '#c7cdbd', tail: '#c9bd92', cowling: '#9d9d94', accent: '#7b7a4c', insignia, pattern: 'plain' };
    }
    case 'france':
      return { fuselage: '#b9b7a3', wingTop: '#b9b7a3', wingBottom: '#cfccb6', tail: '#b9b7a3', cowling: '#a7a9a4', accent: '#b9b7a3', insignia: 'roundel-france', pattern: 'plain' };
    case 'usa':
      return { fuselage: '#6d6446', wingTop: '#6d6446', wingBottom: '#d8cfae', tail: '#6d6446', cowling: '#a7a9a4', accent: '#6d6446', insignia: 'roundel-usa', pattern: 'plain' };
    default:
      return { fuselage: '#5d563a', wingTop: '#5d563a', wingBottom: '#d8cfae', tail: '#5d563a', cowling: '#a7a9a4', accent: '#5d563a', insignia: 'roundel-rfc', pattern: 'pc10' };
  }
}
