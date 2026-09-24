/**
 * UV-atlas metadata shared by the GLB models (glTF extras on the root node,
 * written by tools/blender/aircraft_gen.py) and the procedural fallback.
 * See docs/models.md for the canvas conventions.
 */
import type { AircraftGeometry } from '../../core/types';

export interface AircraftMeta {
  /** Fuselage canvas: u = 0 at the nose .. 1 at the sternpost over this many metres. */
  uv_fuselage_len: number;
  /** Fuselage canvas: v spans this many metres of arc (max section perimeter). */
  uv_fuselage_perim: number;
  /** Wing canvases: u = 0.5 + x / span_ref. */
  uv_span_ref: number;
  /** Wing canvases: each half-canvas region spans this chord (metres). */
  uv_chord_ref: number;
  uv_top_wing_chord: number;
  uv_bottom_wing_chord: number;
  uv_bottom_wing_span: number;
  /** Tail canvas lower half: u = 0.5 + x / tail_span; v over tail_chord. */
  uv_tail_span: number;
  uv_tail_chord: number;
  /** Tail canvas upper half: fin u 0..0.4, rudder u 0.4..1, v over vtail height. */
  uv_rudder_chord: number;
  uv_fin_chord: number;
  uv_vtail_height: number;
  prop_radius: number;
}

export function metaFromUserData(ud: Record<string, unknown>, g: AircraftGeometry): AircraftMeta {
  const d = estimateMeta(g);
  const num = (k: keyof AircraftMeta) => (typeof ud[k] === 'number' ? (ud[k] as number) : d[k]);
  return {
    uv_fuselage_len: num('uv_fuselage_len'),
    uv_fuselage_perim: num('uv_fuselage_perim'),
    uv_span_ref: num('uv_span_ref'),
    uv_chord_ref: num('uv_chord_ref'),
    uv_top_wing_chord: num('uv_top_wing_chord'),
    uv_bottom_wing_chord: num('uv_bottom_wing_chord'),
    uv_bottom_wing_span: num('uv_bottom_wing_span'),
    uv_tail_span: num('uv_tail_span'),
    uv_tail_chord: num('uv_tail_chord'),
    uv_rudder_chord: num('uv_rudder_chord'),
    uv_fin_chord: num('uv_fin_chord'),
    uv_vtail_height: num('uv_vtail_height'),
    prop_radius: num('prop_radius'),
  };
}

/** Geometry-derived approximation (used by the fallback mesh and as defaults). */
export function estimateMeta(g: AircraftGeometry): AircraftMeta {
  const mono = g.layout === 'monoplane' || g.layout === 'parasol';
  const H = g.fuselageWidth * 1.2;
  return {
    uv_fuselage_len: g.length * 0.88,
    uv_fuselage_perim: 2 * (g.fuselageWidth + H) * 0.9,
    uv_span_ref: g.span,
    uv_chord_ref: g.chord,
    uv_top_wing_chord: g.chord,
    uv_bottom_wing_chord: mono ? g.chord : g.lowerChord || g.chord,
    uv_bottom_wing_span: mono ? g.span : g.lowerSpan || g.span,
    uv_tail_span: Math.max(2.2, Math.min(4.8, 0.32 * g.span)),
    uv_tail_chord: g.crew === 2 ? 1.2 : 1.0,
    uv_rudder_chord: g.crew === 2 ? 0.62 : 0.55,
    uv_fin_chord: g.tailShape === 'comma' ? 0 : 0.6,
    uv_vtail_height: Math.max(0.75, Math.min(1.25, 0.1 * g.span)) * 1.1,
    prop_radius: g.crew === 2 ? 1.45 : 1.3,
  };
}

/** Distinct gun-type/insignia helpers that don't need a DOM (unit-testable). */
export type InsigniaSlot = 'wingTop' | 'wingBottom' | 'fuselageSide' | 'rudder';

export function insigniaSlots(insignia: string): InsigniaSlot[] {
  switch (insignia) {
    case 'iron-cross-patee':
    case 'balkenkreuz':
      return ['wingTop', 'wingBottom', 'fuselageSide', 'rudder'];
    case 'roundel-rfc':
    case 'roundel-france':
    case 'roundel-usa':
      return ['wingTop', 'wingBottom', 'fuselageSide', 'rudder'];
    default:
      return [];
  }
}

/** Rudder stripe colours, leading edge first. */
export function rudderStripes(insignia: string): string[] | null {
  switch (insignia) {
    case 'roundel-rfc':
      return ['#2a3f7a', '#f2efe6', '#b3241f'];
    case 'roundel-france':
      return ['#2a3f8a', '#f2efe6', '#c12a22'];
    case 'roundel-usa':
      return ['#c12a22', '#f2efe6', '#2a3f8a'];
    default:
      return null;
  }
}

/** Roundel rings, outermost first. */
export function roundelRings(insignia: string): string[] | null {
  switch (insignia) {
    case 'roundel-rfc':
      return ['#2a3f7a', '#f2efe6', '#b3241f'];
    case 'roundel-france':
      return ['#c12a22', '#f2efe6', '#2a3f8a'];
    case 'roundel-usa':
      return ['#c12a22', '#2a3f8a', '#f2efe6'];
    default:
      return null;
  }
}

/** Control-surface deflections (radians) in the glTF node frames. */
export function controlSurfaceAngles(c: { pitch: number; roll: number; yaw: number }, max = 0.35) {
  return {
    aileronR: -c.roll * max,
    aileronL: c.roll * max,
    elevator: -c.pitch * max,
    rudder: c.yaw * max,
  };
}
