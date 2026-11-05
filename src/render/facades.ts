/**
 * Procedural house detail for the instanced town buildings (towns.ts): windows,
 * doors, sills and rising damp on the walls, tile courses and weathering on the
 * roofs. Everything is laid out in metres from the instance scale, so a long
 * farmhouse gets more bays than a cottage, and every feature averages out to its
 * mean tone once it shrinks below a few pixels (no shimmer from the air).
 */
import type { MeshStandardMaterial } from 'three';

const VERT_PARS = /* glsl */ `
varying vec3 vFacLocal;
varying vec3 vFacNormal;
varying vec3 vFacScale;
varying float vFacSeed;
`;

const VERT_BODY = /* glsl */ `
vFacLocal = position;
vFacNormal = normal;
#ifdef USE_INSTANCING
vFacScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vFacSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
#else
vFacScale = vec3(1.0);
vFacSeed = 0.0;
#endif
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vFacLocal;
varying vec3 vFacNormal;
varying vec3 vFacScale;
varying float vFacSeed;
// Box-filtered coverage of the interval [a, b] along x with filter width w.
float facCov(float x, float a, float b, float w) {
  return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0);
}
`;

/** Walls: unit box (base at y = 0) scaled to w × (h + 0.5) × d, sunk 0.5 m into the ground. */
const WALL_FRAG = /* glsl */ `
{
  vec3 n = normalize(vFacNormal);
  // Derivatives first, outside any branch (undefined in non-uniform control flow).
  bool alongX = abs(n.z) > 0.5;
  float faceW = alongX ? vFacScale.x : vFacScale.z;
  float u = (alongX ? vFacLocal.x : vFacLocal.z) * faceW + faceW * 0.5;   // 0..faceW, metres
  float v = vFacLocal.y * vFacScale.y - 0.5;                                // height above ground, m
  float wallH = vFacScale.y - 0.5;
  float fw = max(fwidth(u), fwidth(v)) + 1e-4;
  if (abs(n.y) < 0.5) {
    // Rising damp and grime near the ground, sun-bleached higher up.
    float damp = 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.9, v));
    float k = damp * (0.96 + 0.08 * vFacSeed);
    // Barns and sheds (low or windowless by chance) keep plain walls.
    bool plain = vFacSeed < 0.12;
    if (!plain) {
      float bayW = 2.6 + 0.6 * fract(vFacSeed * 7.3);
      float bays = max(1.0, floor((faceW - 0.8) / bayW));
      float margin = (faceW - bays * bayW) * 0.5;
      float bu = u - margin;
      float bay = floor(bu / bayW);
      float inBays = step(0.0, bu) * step(bu, bays * bayW);
      float lu = bu - bay * bayW;                     // 0..bayW within the bay
      float storey = floor(v / 2.9);
      float lv = v - storey * 2.9;                    // 0..2.9 within the storey
      float winT = 2.25;
      // Only storeys whose whole window fits under the eaves.
      float topStorey = floor((wallH - winT) / 2.9);
      float winW = 0.85, winB = storey < 0.5 ? 0.95 : 0.8;
      float wc = 0.5 * bayW;
      float win = facCov(lu, wc - winW * 0.5, wc + winW * 0.5, fw) * facCov(lv, winB, winT, fw);
      // One door on the ground floor, in a bay picked by the seed.
      float doorBay = floor(fract(vFacSeed * 13.1) * bays);
      bool door = storey < 0.5 && abs(bay - doorBay) < 0.5 && (alongX ? n.z : n.x) > 0.0;
      if (door) win = facCov(lu, wc - 0.5, wc + 0.5, fw) * facCov(lv, 0.0, 2.15, fw);
      win *= inBays * step(storey, topStorey);
      // Shutters either side of the windows on some houses.
      float shut = 0.0;
      if (!door && fract(vFacSeed * 3.7) > 0.45) {
        shut = (facCov(lu, wc - winW * 0.5 - 0.42, wc - winW * 0.5, fw) + facCov(lu, wc + winW * 0.5, wc + winW * 0.5 + 0.42, fw)) * facCov(lv, winB, winT, fw);
        shut *= inBays * step(storey, topStorey);
      }
      // facCov filters one bay's window only; once a bay shrinks to a few pixels, blend to
      // the repeating pattern's mean coverage so the facade keeps its average tone.
      float far = smoothstep(0.15, 0.6, fw / bayW) * inBays * step(storey, topStorey);
      win = mix(win, (winW / bayW) * ((winT - winB) / 2.9), far);
      shut = mix(shut, fract(vFacSeed * 3.7) > 0.45 ? (0.84 / bayW) * ((winT - winB) / 2.9) : 0.0, far);
      float sill = facCov(lu, wc - winW * 0.5 - 0.1, wc + winW * 0.5 + 0.1, fw) * facCov(lv, winB - 0.12, winB, fw) * inBays * step(storey, topStorey) * (door ? 0.0 : 1.0);
      // Sub-pixel features fade to their average tone (coverage already box-filtered).
      vec3 glass = vec3(0.11, 0.12, 0.14) + 0.06 * vFacSeed;
      vec3 wood = mix(vec3(0.26, 0.2, 0.15), vec3(0.3, 0.36, 0.3), step(0.5, fract(vFacSeed * 5.1)));
      diffuseColor.rgb = mix(diffuseColor.rgb, wood * 1.4, shut * 0.85);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + 0.05, sill * 0.7);
      diffuseColor.rgb = mix(diffuseColor.rgb, door ? wood : glass, win);
    }
    diffuseColor.rgb *= k;
  }
}
`;

/** Roofs: gable (towns.ts gableRoof) scaled to w × roofH × d; ridge along local z. */
const ROOF_FRAG = /* glsl */ `
{
  vec3 n = normalize(vFacNormal);
  // Distance up the slope from the eaves, metres; derivatives outside the branch.
  float run = (0.55 - abs(vFacLocal.x)) * vFacScale.x;
  float rise = vFacLocal.y * vFacScale.y;
  float s = length(vec2(run, rise));
  float along = vFacLocal.z * vFacScale.z;
  float fw = max(fwidth(s), fwidth(along)) + 1e-4;
  if (abs(n.z) < 0.5) {
    // Tile courses: a dark line every 0.32 m, fading to its mean when sub-pixel.
    float course = fract(s / 0.32);
    float line = 1.0 - smoothstep(0.0, min(0.5, fw / 0.32 + 0.12), course);
    float lineK = clamp(1.0 - fw / 0.25, 0.0, 1.0);
    float tone = mix(0.94, 1.0 - 0.28 * line, lineK);
    // Patchy weathering and moss, more toward the eaves.
    float patchN = fract(sin(dot(floor(vec2(s / 0.9, along / 0.7)), vec2(12.9898, 78.233)) + vFacSeed * 31.0) * 43758.5453);
    tone *= mix(1.0, 0.86 + 0.24 * patchN, clamp(1.0 - fw / 0.6, 0.0, 1.0));
    tone *= 0.9 + 0.1 * smoothstep(0.0, 2.5, s);
    diffuseColor.rgb *= tone;
  }
}
`;

function patch(mat: MeshStandardMaterial, frag: string, key: string): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.vertexShader = VERT_PARS + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    shader.fragmentShader = FRAG_PARS + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + frag);
  };
  mat.customProgramCacheKey = () => key;
}

export function addFacades(walls: MeshStandardMaterial): void {
  patch(walls, WALL_FRAG, 'rb2-facades-v1');
}

export function addRoofTiles(roofs: MeshStandardMaterial): void {
  patch(roofs, ROOF_FRAG, 'rb2-roof-tiles-v1');
}
