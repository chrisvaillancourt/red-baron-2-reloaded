/**
 * HUD overlays for the crew stations (docs/bombers.md): the seat plate, the gunner's ring
 * sight and field-of-fire edge, the bombsight's drift wire, impact mark and release cue, and
 * the bomb count. Driven by `HudView.seat / gunnerSight / bombsight / bombs`.
 */
import { h } from '../dom';
import type { HudBombs, HudBombsight, HudGunnerSight, HudScreenPoint, HudSeat, HudView } from './types';

const NS = 'http://www.w3.org/2000/svg';

export function seatText(s: HudSeat): string {
  return `${s.label.toUpperCase()} ${s.index}/${s.count}${s.aiFlying ? ' · PILOT FLYING' : ''}`;
}

export function bombsText(b: HudBombs): string {
  return `BOMBS ${b.left}/${b.total}${b.next && b.left > 0 ? ` · ${b.next}` : ''}`;
}

/** Below this the run is on the wire: no steering call. */
const STEADY_M = 15;

export function cueText(b: HudBombsight, system: 'metric' | 'imperial'): string {
  switch (b.cue) {
    case 'release':
      return `RELEASE — ${b.releaseKey}`;
    case 'past':
      return 'OVERSHOT — COME ROUND AGAIN';
    case 'none':
      return 'NO TARGET ON THE TRACK';
    case 'run-in': {
      const t = `RUN-IN · ${Math.round(b.timeToRelease ?? 0)} s`;
      const off = Math.abs(b.crossM);
      if (off < STEADY_M) return `${t} · STEADY`;
      const dist = system === 'metric' ? `${Math.round(off / 10) * 10} m` : `${Math.round((off * 3.28084) / 10) * 10} ft`;
      return `${t} · STEER ${b.crossM > 0 ? 'RIGHT' : 'LEFT'} ${dist}`;
    }
  }
}

/** SVG path data for screen polylines (fractions) in a W×H pixel box; single points are dropped. */
export function polylinePath(lines: readonly { x: number; y: number }[][], W: number, H: number): string {
  let d = '';
  for (const l of lines) {
    if (l.length < 2) continue;
    l.forEach((p, i) => (d += `${i === 0 ? 'M' : 'L'}${(p.x * W).toFixed(1)} ${(p.y * H).toFixed(1)}`));
  }
  return d;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function setAttr(e: Element, k: string, v: string): void {
  if (e.getAttribute(k) !== v) e.setAttribute(k, v);
}

function show(e: Element, on: boolean): void {
  if (e.classList.contains('hidden') === on) e.classList.toggle('hidden', !on);
}

export interface CrewOverlay {
  readonly elements: Element[];
  update(v: HudView, W: number, H: number, system: 'metric' | 'imperial'): void;
}

export function createCrewOverlay(): CrewOverlay {
  const seat = h('div', { class: 'hud-seat hidden' });
  const bombs = h('div', { class: 'hud-bombs hidden' });
  const cue = h('div', { class: 'hud-cue hidden' });

  const overlay = el('svg', { class: 'hud-crew', width: '100%', height: '100%' });
  // Gunner: field-of-fire edge, then the ring-and-bead sight.
  const arc = el('path', { class: 'arc' });
  const ring = el('g', { class: 'ring' });
  ring.append(el('circle', { class: 'outer', r: 1 }), el('circle', { class: 'inner', r: 1 }), el('circle', { class: 'bead', r: 2.5 }));
  const spokes = el('path', { class: 'spokes' });
  ring.append(spokes);
  // Bombsight: drift wire through the centre, the impact mark, the target diamond.
  const wire = el('g', { class: 'wire' });
  const wireLine = el('path', { class: 'line' });
  const wireTicks = el('path', { class: 'ticks' });
  wire.append(wireLine, wireTicks);
  const impact = el('g', { class: 'impact' });
  impact.append(el('circle', { r: 9 }), el('path', { d: 'M-16 0H-5M5 0H16M0 -16V-5M0 5V16' }));
  const target = el('path', { class: 'target', d: 'M0 -9L9 0L0 9L-9 0Z' });
  overlay.append(arc, ring, wire, impact, target);

  let seatKey = '';
  let bombsKey = '';

  function place(g: Element, p: HudScreenPoint | null | undefined, W: number, H: number, rot = 0): boolean {
    const on = !!p && p.onScreen;
    show(g, on);
    if (on) setAttr(g, 'transform', `translate(${(p!.x * W).toFixed(1)} ${(p!.y * H).toFixed(1)})${rot ? ` rotate(${((rot * 180) / Math.PI).toFixed(2)})` : ''}`);
    return on;
  }

  function gunner(s: HudGunnerSight | null | undefined, W: number, H: number): void {
    show(arc, !!s);
    if (!s) return show(ring, false);
    setAttr(arc, 'd', polylinePath(s.arcEdges, W, H));
    arc.classList.toggle('limited', s.limited);
    ring.classList.toggle('limited', s.limited);
    // A Lewis ring sight: the outer ring leads a crossing target at about 100 mph at 200 yd.
    const R = Math.min(W, H) * 0.09;
    setAttr(ring.children[0], 'r', R.toFixed(1));
    setAttr(ring.children[1], 'r', (R / 2).toFixed(1));
    setAttr(spokes, 'd', `M${-R} 0H${-R / 2}M${R / 2} 0H${R}M0 ${-R}V${-R / 2}M0 ${R / 2}V${R}`);
    place(ring, s.ring, W, H);
  }

  function bombsight(b: HudBombsight | null | undefined, W: number, H: number, system: 'metric' | 'imperial'): void {
    show(wire, !!b);
    show(cue, !!b);
    if (!b) {
      show(impact, false);
      show(target, false);
      return;
    }
    if (b.wire.length >= 2) {
      // The ground track projected into the sight, with a tick every other point (500 m).
      setAttr(wire, 'transform', '');
      setAttr(wireLine, 'd', polylinePath([b.wire], W, H));
      let ticks = '';
      b.wire.forEach((p, i) => {
        if (i % 2 === 0) ticks += `M${(p.x * W - 6).toFixed(1)} ${(p.y * H).toFixed(1)}h12`;
      });
      setAttr(wireTicks, 'd', ticks);
    } else {
      const L = Math.hypot(W, H);
      setAttr(wire, 'transform', `translate(${(W / 2).toFixed(1)} ${(H / 2).toFixed(1)}) rotate(${((b.driftAngle * 180) / Math.PI).toFixed(2)})`);
      setAttr(wireLine, 'd', `M0 ${-L}V${L}`);
      let ticks = '';
      for (let i = -8; i <= 8; i++) if (i) ticks += `M-6 ${i * H * 0.06}H6`;
      setAttr(wireTicks, 'd', ticks);
    }
    place(impact, b.impact, W, H);
    impact.classList.toggle('on', b.cue === 'release');
    place(target, b.target, W, H);
    const text = cueText(b, system);
    if (cue.textContent !== text) cue.textContent = text;
    cue.className = `hud-cue cue-${b.cue}`;
  }

  return {
    elements: [overlay, seat, bombs, cue],
    update(v, W, H, system) {
      setAttr(overlay, 'viewBox', `0 0 ${Math.round(W)} ${Math.round(H)}`);
      const sk = v.seat ? seatText(v.seat) : '';
      if (sk !== seatKey) {
        seatKey = sk;
        seat.textContent = sk;
        show(seat, !!sk);
        seat.classList.toggle('ai', !!v.seat?.aiFlying);
      }
      const bk = v.bombs ? bombsText(v.bombs) : '';
      if (bk !== bombsKey) {
        bombsKey = bk;
        bombs.textContent = bk;
        show(bombs, !!bk);
      }
      gunner(v.view === 'gunner' ? v.gunnerSight : null, W, H);
      bombsight(v.view === 'bombsight' ? v.bombsight : null, W, H, system);
    },
  };
}
