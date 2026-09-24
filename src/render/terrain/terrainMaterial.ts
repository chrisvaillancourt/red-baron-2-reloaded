/**
 * Terrain material: MeshStandardMaterial extended (onBeforeCompile) with a
 * procedural land-use shader — "openfield" strip parcels grouped into
 * furlongs (Artois/Picardy), small hedged fields (Flanders), woods, towns,
 * water/roads from a rasterised feature mask, and the war zone (churned
 * chalk or Flanders mud, craters with bump shading, zig-zag trench lines,
 * wire). Keeps three's lighting, shadows, fog and IBL.
 */
import { Color, MeshStandardMaterial, Texture, Vector4, type IUniform } from 'three';

export interface TerrainPalette {
  fields: string[]; // 6 crop colours
  pasture: string;
  forest: string;
  forestDark: string;
  hedge: string;
  townGround: string;
  mud: string;
  chalk: string;
  road: string;
  water: string;
  sand: string;
  deadWood: string;
}

export const PALETTES: Record<'winter' | 'spring' | 'summer' | 'autumn', TerrainPalette> = {
  spring: {
    fields: ['#6b8a40', '#78944a', '#6a5a42', '#8b7d58', '#587636', '#8f8c54'],
    pasture: '#6e8f44', forest: '#46633a', forestDark: '#35502b', hedge: '#34502a', townGround: '#77705f',
    mud: '#5c4c3b', chalk: '#ab9f89', road: '#a79d86', water: '#26393d', sand: '#c9bc9b', deadWood: '#5d554a',
  },
  summer: {
    fields: ['#a8935a', '#b5a472', '#5f7639', '#786448', '#4c632d', '#98905c'],
    pasture: '#66823f', forest: '#3e5631', forestDark: '#2f4527', hedge: '#2e4526', townGround: '#7c7463',
    mud: '#5f4e3b', chalk: '#b1a58d', road: '#b1a78e', water: '#25383c', sand: '#cfc2a0', deadWood: '#62594c',
  },
  autumn: {
    fields: ['#a2906a', '#6c5539', '#6f8044', '#586d33', '#86754f', '#968358'],
    pasture: '#6c7f41', forest: '#5f5834', forestDark: '#47452b', hedge: '#484828', townGround: '#76705f',
    mud: '#584732', chalk: '#aa9e87', road: '#a79d86', water: '#24363a', sand: '#c7b998', deadWood: '#5a5246',
  },
  winter: {
    fields: ['#5c4a35', '#667248', '#78705a', '#86826f', '#5b6d3e', '#665741'],
    pasture: '#657146', forest: '#524e40', forestDark: '#3f3c32', hedge: '#44432f', townGround: '#726d66',
    mud: '#4e4031', chalk: '#a39884', road: '#9f9884', water: '#233437', sand: '#bfb498', deadWood: '#534c43',
  },
};

const VERT_PARS = /* glsl */ `
attribute vec4 aLand;
attribute vec2 aFront;
varying vec4 vLand;
varying float vFront;
varying float vFresh;
varying vec3 vWPos;
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vLand;
varying float vFront;
varying float vFresh;
varying vec3 vWPos;
uniform sampler2D uMask;
uniform vec4 uMaskRect; // x0, z0, 1/width, 1/depth
uniform vec3 uFields[6];
uniform vec3 uPasture, uForest, uForestDark, uHedge, uTownGround, uMud, uChalk, uRoad, uWater, uSand, uDeadWood;
uniform float uTime;
uniform float uTrenches; // 1 = draw trench network
uniform float uDetail;   // 0 = low quality (skip micro-detail)
float tWater;
float tBump;

vec2 th22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float th12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float tnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th12(i), th12(i + vec2(1, 0)), u.x), mix(th12(i + vec2(0, 1)), th12(i + vec2(1, 1)), u.x), u.y);
}
float tfbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * tnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// Voronoi: x = F1, y = F2 (distances), z = cell hash, w = second hash
vec4 tvoronoi(vec2 x) {
  vec2 n = floor(x); vec2 f = fract(x);
  float F1 = 8.0, F2 = 8.0; vec2 id = n;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = th22(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; id = n + g; } else if (d < F2) { F2 = d; }
  }
  return vec4(sqrt(F1), sqrt(F2), th12(id), th12(id + 71.3));
}
// Crater field at a given cell size: (bowl darkness, rim, water, height m). Height is continuous.
vec4 craters(vec2 p, float cell, float density, float flanders) {
  vec2 q = p / cell;
  vec2 n = floor(q); vec2 f = fract(q);
  float bowl = 0.0, rim = 0.0, wat = 0.0, h = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 id = n + g;
    float e = th12(id * 1.37 + 3.1);
    if (e > density) continue;
    vec2 o = th22(id);
    float r = 0.22 + 0.22 * th12(id + 9.7);
    float d = length(g + o - f) / r;
    if (d < 1.7) {
      bowl = max(bowl, 1.0 - smoothstep(0.0, 1.0, d));
      float rv = exp(-pow((d - 1.0) / 0.24, 2.0));
      rim = max(rim, rv);
      float hh = (d < 1.0 ? -(1.0 - d * d) : 0.0) + 0.28 * rv;
      h += hh * r * cell * 0.45;
      if (th12(id + 5.3) < 0.15 + 0.5 * flanders && d < 0.62) wat = 1.0;
    }
  }
  return vec4(bowl, rim, wat, h);
}
float triWave(float x) { return abs(fract(x) - 0.5) * 2.0; }
`;

const FRAG_COLOR = /* glsl */ `
{
  vec2 p = vWPos.xz;
  // Pixel footprint in metres (for detail fade / anti-aliasing).
  float px = length(fwidth(p)) + 1e-3;
  float forest = vLand.x;
  float town = vLand.y;
  float crater = vLand.z;
  float beach = vLand.w;
  float lat = 50.3 - vWPos.z / 111200.0;
  float flanders = smoothstep(50.52, 50.64, lat);
  vec3 warBase = mix(mix(uMud, uChalk, 0.38) * vec3(1.07, 1.0, 0.9), mix(uMud, uChalk, 0.26) * vec3(1.12, 1.08, 1.0), flanders);
  float micro = uDetail * clamp(1.0 - px / 1.2, 0.0, 1.0);

  // --- furlongs (districts): one orientation and strip width each
  vec2 dwarp = (vec2(tnoise(p / 2600.0), tnoise(p / 2600.0 + 9.0)) - 0.5) * 0.7;
  vec4 dv = tvoronoi(p / 1100.0 + dwarp);
  float did = dv.z;
  float dEdge = (dv.y - dv.x) * 1100.0 * 0.5;
  float ang = did * 6.2832;
  vec2 cs = vec2(cos(ang), sin(ang));
  vec2 q = vec2(cs.x * p.x - cs.y * p.y, cs.y * p.x + cs.x * p.y);
  float fid, edge, rowCoord;
  bool irregular = th12(vec2(did, 7.0)) < flanders * 0.85 + 0.04;
  if (irregular) {
    // Flanders: small irregular hedged fields and meadows.
    vec2 fw2 = (vec2(tnoise(p / 90.0), tnoise(p / 90.0 + 5.0)) - 0.5) * 0.35;
    vec4 fv = tvoronoi(p / 140.0 + fw2);
    fid = fv.z;
    edge = (fv.y - fv.x) * 140.0 * 0.5;
    rowCoord = q.y;
  } else {
    // Artois / Picardy openfield: long parallel strips.
    float colW = mix(40.0, 125.0, dv.w);
    float col = floor(q.x / colW);
    float colH = th12(vec2(col, did * 113.0));
    float len = mix(170.0, 480.0, colH);
    float yy = q.y + colH * len;
    float row = floor(yy / len);
    fid = th12(vec2(col * 1.7 + did * 31.0, row * 2.3 + 0.5));
    float fx = fract(q.x / colW), fy = fract(yy / len);
    edge = min(min(fx, 1.0 - fx) * colW, min(fy, 1.0 - fy) * len);
    rowCoord = q.x;
  }
  edge = min(edge, dEdge);
  float pastureChance = 0.18 + 0.45 * flanders;
  bool isPasture = th12(vec2(fid * 17.0, did)) < pastureChance;
  vec3 fieldCol = isPasture ? uPasture : uFields[int(fid * 5.999)];
  fieldCol *= 0.94 + 0.12 * th12(vec2(fid * 91.0, 3.0));
  // Pull crops toward the local average: real patchwork is lower contrast than a quilt.
  fieldCol = mix(fieldCol, mix((uFields[0] + uFields[1] + uFields[2] + uFields[3] + uFields[4] + uFields[5]) / 6.0, uPasture, 0.3), 0.3);
  // Distant fields average out (reduces shimmer).
  vec3 avgCrop = (uFields[0] + uFields[1] + uFields[2] + uFields[3] + uFields[4] + uFields[5]) / 6.0;
  vec3 distCol = mix(avgCrop, uPasture, pastureChance) * (0.92 + 0.16 * did);
  fieldCol = mix(fieldCol, distCol, smoothstep(25.0, 140.0, px) * 0.75);
  // Crop rows / furrows (fade out when sub-pixel).
  float rowFreq = 1.0 / (2.2 + 1.5 * fract(fid * 7.0));
  float rowAA = clamp(1.0 - px * rowFreq * 2.0, 0.0, 1.0);
  if (!isPasture) fieldCol *= 1.0 - 0.08 * rowAA * (0.5 + 0.5 * sin(rowCoord * rowFreq * 6.2832));
  // Mottling (soil moisture / patchy growth).
  fieldCol *= 0.9 + 0.2 * (tnoise(p / 900.0) * 0.65 + tnoise(p / 370.0) * 0.35);
  fieldCol *= 1.0 + (tnoise(p / 14.0) - 0.5) * 0.14 * clamp(1.0 - px / 6.0, 0.0, 1.0);
  fieldCol *= 1.0 + (tnoise(p / 1.7) - 0.5) * 0.16 * micro;
  vec3 col = fieldCol;

  // Field margins: grassy verges everywhere, hedgerows on some (mostly Flanders).
  float edgeAA = max(px * 0.75, 0.4);
  float vergeW = 1.6;
  float verge = (1.0 - smoothstep(vergeW - edgeAA, vergeW + edgeAA, edge)) * min(1.0, vergeW / edgeAA);
  col = mix(col, uPasture * 0.92, verge * 0.6);
  float hedgeW = 2.8;
  float hedgeCov = (1.0 - smoothstep(hedgeW - edgeAA, hedgeW + edgeAA, edge)) * min(1.0, hedgeW / edgeAA);
  float hasHedge = step(th12(vec2(fid, did) * 13.0), 0.08 + 0.55 * flanders);
  col = mix(col, uHedge, hedgeCov * hasHedge * 0.9 * (1.0 - smoothstep(0.2, 0.5, crater)));

  // --- woods
  float fw = smoothstep(0.46, 0.56, forest + (tnoise(p / 40.0) - 0.5) * 0.12 + (tnoise(p / 260.0) - 0.5) * 0.35 * smoothstep(20.0, 120.0, px));
  if (fw > 0.002) {
  vec3 canopy = mix(uForestDark, uForest, smoothstep(0.3, 0.75, px < 30.0 ? tfbm(p / 14.0 + 7.0) : 0.5));
  canopy *= 0.8 + 0.4 * tnoise(p / 5.0) * clamp(1.0 - px / 4.0, 0.0, 1.0);
  // War-shattered woods become grey-brown stumps and mud.
  canopy = mix(canopy, mix(warBase, uDeadWood, 0.55), smoothstep(0.4, 0.75, crater));
  col = mix(col, canopy, fw);
  }

  // --- towns: built-up ground (streets, yards, gardens)
  float tw = smoothstep(0.2, 0.55, town + (tnoise(p / 60.0) - 0.5) * 0.3);
  vec3 townCol = mix(uTownGround, uPasture * 0.85, step(0.62, tnoise(p / 22.0)) * 0.6);
  townCol *= 0.9 + 0.2 * tnoise(p / 7.0);
  col = mix(col, townCol, tw);

  // --- war zone: neglected rear fields, churned ground, craters, trenches.
  // vFresh: 1 = ground fought over now (raw mud); decays as weeds and grass
  // reclaim abandoned battlefields, which stay pocked with overgrown craters.
  float fresh = clamp(vFresh / max(crater, 0.05), 0.0, 1.0);
  // Large-scale mottling (km scale) so the war zone never reads as flat paving from altitude.
  float mot = tnoise(p / 1500.0 + 4.0) * 0.55 + tnoise(p / 480.0 + 9.0) * 0.3 + tnoise(p / 160.0) * 0.15;
  col = mix(col, mix(uPasture, uMud, 0.45) * (0.9 + 0.2 * tnoise(p / 50.0)), smoothstep(0.1, 0.4, crater) * 0.45 * mix(0.6, 1.0, fresh));
  float churnRaw = smoothstep(0.34, 0.85, crater + (mot - 0.5) * 0.18);
  float churn = churnRaw * smoothstep(0.08, 0.5, fresh);
  if (churnRaw > 0.002) {
  // Fine grain fades out before it can alias into "gravel" at altitude.
  float grain = mix(tfbm(p / 22.0), 0.5, smoothstep(3.0, 9.0, px));
  vec3 mud = warBase * (0.76 + 0.22 * mot + 0.26 * grain);
  // Upcast chalk (Artois/Somme) in streaks and splashes; standing water and dark wet mud in Flanders.
  float chalkN = tnoise(p / 55.0 + 3.0) * 0.5 + tnoise(p / 260.0 + 1.7) * 0.5;
  // Chalk spoil is thickest along the trench systems; elsewhere only faint patches.
  float nearLine = 0.35 + 0.65 * (1.0 - smoothstep(500.0, 2200.0, abs(vFront)));
  mud = mix(mud, uChalk * (0.92 + 0.1 * grain), (1.0 - flanders) * smoothstep(0.6, 0.85, chalkN) * 0.45 * nearLine);
  mud = mix(mud, warBase * 0.62, flanders * smoothstep(0.55, 0.8, tnoise(p / 140.0 + 5.0)) * 0.4);
  // Regrowth: coarse grass, thistle and poppies over old shell-holes.
  vec3 weeds = mix(uPasture * 0.85, uMud * 1.3, 0.48 + 0.3 * tnoise(p / 90.0 + 2.0)) * (0.84 + 0.26 * mot);
  weeds = mix(weeds, uChalk * 0.9, (1.0 - flanders) * smoothstep(0.66, 0.86, chalkN) * 0.35);
  col = mix(col, mix(weeds, mud, smoothstep(0.1, 0.6, fresh)), churnRaw);
  }
  tBump = 0.0;
  if (crater > 0.12 && px > 14.0) {
    // Far: big craters and shell-hole clusters still texture the ground.
    float cd = smoothstep(0.18, 0.8, crater);
    vec4 c3 = px < 45.0 ? craters(p + 77.0, 55.0, cd * 0.4, flanders) : vec4(0.0);
    float cluster = smoothstep(0.45, 0.8, tnoise(p / 110.0 + 13.0)) * churnRaw;
    col *= 1.0 - 0.07 * crater - c3.x * 0.16 * churnRaw - cluster * 0.08;
    tWater = max(tWater, 0.35 * churn * flanders);
  } else if (crater > 0.12) {
    float df = clamp(1.0 - px / 2.2, 0.0, 1.0);
    float cd = smoothstep(0.18, 0.8, crater);
    vec4 c1 = px < 3.0 ? craters(p, 8.0, cd * 0.95, flanders) : vec4(0.0);
    vec4 c2 = px < 7.0 ? craters(p + 311.0, 21.0, cd * 0.75, flanders) : vec4(0.0);
    vec4 c3 = craters(p + 77.0, 55.0, cd * 0.4, flanders);
    float bowl = max(max(c1.x, c2.x), c3.x);
    float rimL = max(max(c1.y, c2.y), c3.y);
    float wat = max(max(c1.z, c2.z * 0.8), c3.z * 0.6) * smoothstep(0.35, 0.7, crater);
    float cf = mix(0.15, 1.0, clamp(1.0 - px / 8.0, 0.0, 1.0));
    col *= 1.0 - bowl * (0.06 + 0.16 * max(churn, churnRaw * 0.6)) * cf;
    col = mix(col, mix(uChalk, warBase * 1.2, flanders), rimL * 0.18 * cf * churn);
    float wk = wat * clamp(1.0 - px / 4.0, 0.0, 1.0);
    col = mix(col, mix(uWater * 1.6, vec3(0.3, 0.32, 0.34), 0.55), wk * 0.9);
    tWater = max(tWater, wk * 0.8);
    // Average darkening where craters are sub-pixel.
    col *= 1.0 - 0.1 * crater * (1.0 - cf);
    tBump += (c1.w + c2.w + c3.w) * df * (0.2 + 0.8 * churn);
    // Wet mud glints where craters are sub-pixel (Flanders).
    tWater = max(tWater, 0.35 * churn * flanders * (1.0 - cf));
  }
  if (uTrenches > 0.5 && abs(vFront) < 1400.0 && px < 30.0) {
    float d = vFront;
    float along = vWPos.z * 0.92 + vWPos.x * 0.38;
    float zig = (triWave(along / 16.0) - 0.5) * 7.0;
    float tr = 0.0;
    float spoil = 0.0;
    float trAA = max(px * 0.6, 0.35);
    // Fire, support and reserve trenches on each side.
    for (int s = 0; s < 2; s++) {
      float sg = s == 0 ? 1.0 : -1.0;
      for (int k = 0; k < 3; k++) {
        float off = k == 0 ? 110.0 : (k == 1 ? 290.0 : 640.0);
        float wob = (tnoise(vec2(along / 120.0, float(k + s * 3))) - 0.5) * 30.0;
        float dd = abs(d - sg * (off + wob) + zig * (k == 2 ? 0.6 : 1.0));
        tr = max(tr, 1.0 - smoothstep(1.3 - trAA, 1.3 + trAA, dd));
        spoil = max(spoil, 1.0 - smoothstep(3.2 - trAA, 4.8 + trAA, dd));
      }
    }
    // Communication trenches zig-zagging back from the line.
    float ct = abs(fract(along / 380.0 + tnoise(vec2(d / 200.0, 3.0)) * 0.08) - 0.5) * 380.0;
    ct += (triWave(d / 14.0) - 0.5) * 5.0;
    float inComm = step(115.0, abs(d)) * step(abs(d), 660.0);
    tr = max(tr, (1.0 - smoothstep(1.1 - trAA, 1.1 + trAA, ct)) * inComm);
    spoil = max(spoil, (1.0 - smoothstep(2.8 - trAA, 4.2 + trAA, ct)) * inComm);
    // Barbed-wire belts ahead of each fire trench.
    float wire = 0.0;
    for (int s = 0; s < 2; s++) {
      float sg = s == 0 ? 1.0 : -1.0;
      float wd = abs(d - sg * 85.0 + zig * 0.3);
      wire = max(wire, (1.0 - smoothstep(4.0, 7.0, wd)) * step(0.45, tnoise(p / 2.2)));
    }
    // Keep the network readable from altitude: fade to a thin tone, not to nothing.
    float fade = clamp(1.6 - px / 2.5, 0.3, 1.0);
    vec3 spoilCol = mix(uChalk * 1.1, warBase * 1.15, flanders);
    col = mix(col, spoilCol, spoil * 0.6 * fade);
    col = mix(col, vec3(0.06, 0.05, 0.045), tr * 0.9 * fade);
    col = mix(col, vec3(0.13, 0.11, 0.09), wire * 0.5 * fade * clamp(1.0 - px / 1.5, 0.0, 1.0));
    tBump += (-tr * 1.4 + spoil * 0.3) * clamp(1.0 - px / 2.0, 0.0, 1.0);
    // No-man's-land between the fire trenches: completely churned.
    col = mix(col, warBase * 0.82 * (0.8 + 0.4 * tnoise(p / 7.0)), (1.0 - smoothstep(60.0, 100.0, abs(d))) * 0.55);
  }

  // --- mask features: water (R), roads (G), aerodrome grass (B)
  vec2 muv = (p - uMaskRect.xy) * uMaskRect.zw;
  vec4 m = texture2D(uMask, muv);
  // Near the camera, road ribbons take over; the mask road fades in with distance.
  float road = smoothstep(0.4, 0.85, m.g) * (1.0 - tw * 0.6) * smoothstep(1.2, 3.0, px);
  vec3 roadCol = mix(uRoad, uRoad * 0.78, flanders);
  col = mix(col, mix(col, roadCol, 0.5), road * (1.0 - churn * 0.6));
  float aero = smoothstep(0.3, 0.7, m.b);
  vec3 mown = uPasture * (1.06 + 0.07 * sin(dot(p, vec2(0.34, 0.94)) * 0.25) * clamp(1.0 - px / 3.0, 0.0, 1.0));
  col = mix(col, mown, aero);
  // R is water *coverage* (see featureMask.ts): blend, don't threshold. Ribbons draw
  // rivers at true width near the camera, so the mask fades in with distance.
  float wat = clamp(m.r, 0.0, 1.0) * smoothstep(0.9, 3.5, px);
  col = mix(col, col * 0.8, smoothstep(0.0, 0.3, wat) * 0.5); // damp banks and reeds
  col = mix(col, uWater, wat);
  tWater = max(tWater, wat);

  // --- beaches
  col = mix(col, uSand * (0.95 + 0.1 * tnoise(p / 8.0)), smoothstep(0.3, 0.8, beach));
  diffuseColor.rgb = col;
}
`;

export function createTerrainMaterial(mask: Texture, maskRect: Vector4, detail = 1): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: 0.96, metalness: 0, color: 0xffffff });
  const u: Record<string, IUniform> = {
    uMask: { value: mask },
    uMaskRect: { value: maskRect },
    uFields: { value: Array.from({ length: 6 }, () => new Color()) },
    uPasture: { value: new Color() },
    uForest: { value: new Color() },
    uForestDark: { value: new Color() },
    uHedge: { value: new Color() },
    uTownGround: { value: new Color() },
    uMud: { value: new Color() },
    uChalk: { value: new Color() },
    uRoad: { value: new Color() },
    uWater: { value: new Color() },
    uSand: { value: new Color() },
    uDeadWood: { value: new Color() },
    uTime: { value: 0 },
    uTrenches: { value: 1 },
    uDetail: { value: detail },
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = VERT_PARS + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vLand = aLand; vFront = aFront.x; vFresh = aFront.y;
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = FRAG_PARS + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n tWater = 0.0;\n' + FRAG_COLOR)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.07, tWater);`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          // Bump from crater/trench pseudo-height (derivative-based).
          vec3 dpx = dFdx(-vViewPosition);
          vec3 dpy = dFdy(-vViewPosition);
          float hx = dFdx(tBump);
          float hy = dFdy(tBump);
          vec3 r1 = cross(dpy, normal);
          vec3 r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (hx * r1 + hy * r2);
          vec3 bn = normalize(abs(det) * normal - grad);
          normal = normalize(mix(normal, bn, clamp(1.0 - length(fwidth(vWPos.xz)) / 3.0, 0.0, 1.0)));
          // Gentle wind ripples on water.
          if (tWater > 0.01) {
            vec2 wp = vWPos.xz;
            float t = uTime;
            vec3 wn = vec3(
              sin(wp.x * 0.21 + t * 1.3) * 0.5 + sin(wp.x * 0.53 - wp.y * 0.31 + t * 2.1) * 0.3,
              0.0,
              cos(wp.y * 0.19 - t * 1.1) * 0.5 + sin(wp.y * 0.47 + wp.x * 0.27 + t * 1.7) * 0.3);
            vec3 wv = normalize((viewMatrix * vec4(wn * 0.06, 0.0)).xyz + normal);
            normal = normalize(mix(normal, wv, tWater * clamp(1.0 - length(fwidth(vWPos.xz)) / 3.0, 0.0, 1.0)));
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'rb2-terrain-v3';
  return mat;
}

export function applyPalette(mat: MeshStandardMaterial, pal: TerrainPalette): void {
  const u = mat.userData.uniforms as Record<string, IUniform>;
  (u.uFields.value as Color[]).forEach((c, i) => c.set(pal.fields[i]));
  (u.uPasture.value as Color).set(pal.pasture);
  (u.uForest.value as Color).set(pal.forest);
  (u.uForestDark.value as Color).set(pal.forestDark);
  (u.uHedge.value as Color).set(pal.hedge);
  (u.uTownGround.value as Color).set(pal.townGround);
  (u.uMud.value as Color).set(pal.mud);
  (u.uChalk.value as Color).set(pal.chalk);
  (u.uRoad.value as Color).set(pal.road);
  (u.uWater.value as Color).set(pal.water);
  (u.uSand.value as Color).set(pal.sand);
  (u.uDeadWood.value as Color).set(pal.deadWood);
}
