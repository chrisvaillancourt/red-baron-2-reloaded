/**
 * HUD declutter rules: decide which centre-screen markers to show, and how,
 * when the waypoint, target box, mouse-aim ring, nose cross and gun reticle
 * crowd together (typically at the start of a mission and in every fight).
 *
 * Priority, highest first: target box > aim ring > gun reticle > nose cross
 * > waypoint. Pure function of screen positions so it can be unit-tested.
 */
import type { HudScreenPoint, HudThreat } from './types';

export interface DeclutterInput {
  /** Viewport size in px. */
  w: number;
  h: number;
  target: HudScreenPoint | null;
  waypoint: HudScreenPoint | null;
  aim: HudScreenPoint | null;
  nose: HudScreenPoint | null;
  reticle: HudScreenPoint | null;
  /** An enemy is close enough to box or is threatening us. */
  combat: boolean;
}

export interface DeclutterResult {
  /** 0 hides the waypoint marker, 1 is full strength. */
  waypointOpacity: number;
  waypointLabel: boolean;
  showNose: boolean;
  /** Aim ring sits on the nose/reticle: draw it as a single "on target" mark. */
  aimAligned: boolean;
  showReticle: boolean;
  /** Put the target's text block left of the box (when the box is right of centre). */
  targetInfoLeft: boolean;
}

/** Pixel radii for the proximity tests. */
export const DECLUTTER_PX = {
  merge: 14, // aim ring vs nose/reticle: treat as one
  noseOnReticle: 26,
  waypointNearTarget: 90,
  waypointLabelNearCentre: 70,
};

function onScreen(p: HudScreenPoint | null | undefined): p is HudScreenPoint {
  return !!p && p.onScreen;
}

function distPx(a: HudScreenPoint, b: HudScreenPoint, w: number, h: number): number {
  return Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
}

export function declutter(i: DeclutterInput): DeclutterResult {
  const { w, h } = i;
  const near = (a: HudScreenPoint | null, b: HudScreenPoint | null, px: number) => onScreen(a) && onScreen(b) && distPx(a, b, w, h) < px;

  const reticle = onScreen(i.reticle) ? i.reticle : null;
  const aimOnReticle = !!i.aim && near(i.aim, reticle, DECLUTTER_PX.noseOnReticle);
  const aimAligned = !!i.aim && (near(i.aim, i.nose, DECLUTTER_PX.merge) || aimOnReticle);
  // The nose cross and the reticle both mark the gun line; one is enough.
  const showNose = !!i.nose && !aimAligned && !near(i.nose, reticle, DECLUTTER_PX.noseOnReticle);

  let waypointOpacity = 1;
  let waypointLabel = true;
  if (i.combat) {
    waypointOpacity = 0.35;
    waypointLabel = false;
  }
  if (near(i.waypoint, i.target, DECLUTTER_PX.waypointNearTarget)) waypointOpacity = 0;
  const centreCluster = [i.aim, reticle, i.nose].filter(onScreen);
  if (onScreen(i.waypoint) && centreCluster.some((c) => distPx(i.waypoint!, c, w, h) < DECLUTTER_PX.waypointLabelNearCentre)) waypointLabel = false;
  if (waypointOpacity === 0) waypointLabel = false;

  return {
    waypointOpacity,
    waypointLabel,
    showNose,
    aimAligned,
    // The amber "aligned" ring then stands for the gun line on its own.
    showReticle: !!reticle && !aimOnReticle,
    targetInfoLeft: onScreen(i.target) && i.target.x > 0.62,
  };
}

/** Threat ring entries worth drawing: off-screen enemies, plus any that are an immediate danger. */
export function visibleThreats(threats: readonly HudThreat[]): HudThreat[] {
  return threats.filter((t) => t.danger || !t.onScreen);
}
