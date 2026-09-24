/** Period-style round instruments (SVG): black enamel faces, cream numerals, brass bezels. */

const NS = 'http://www.w3.org/2000/svg';

export interface Gauge {
  el: SVGSVGElement;
  set(v: number): void;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

function face(small: boolean): SVGSVGElement {
  const svg = el('svg', { viewBox: '0 0 100 100', class: `gauge${small ? ' small' : ''}` });
  const id = `gz${Math.random().toString(36).slice(2, 7)}`;
  const defs = el('defs', {}, svg);
  const g = el('radialGradient', { id: `${id}b`, cx: '35%', cy: '30%', r: '75%' }, defs);
  el('stop', { offset: '0', 'stop-color': '#f0d8a0' }, g);
  el('stop', { offset: '.55', 'stop-color': '#a8823e' }, g);
  el('stop', { offset: '1', 'stop-color': '#4e3616' }, g);
  const f = el('radialGradient', { id: `${id}f`, cx: '50%', cy: '40%', r: '65%' }, defs);
  el('stop', { offset: '0', 'stop-color': '#2b2620' }, f);
  el('stop', { offset: '1', 'stop-color': '#0e0c0a' }, f);
  const glass = el('linearGradient', { id: `${id}g`, x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
  el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.18' }, glass);
  el('stop', { offset: '.45', 'stop-color': '#fff', 'stop-opacity': '0' }, glass);
  el('circle', { cx: 50, cy: 50, r: 49, fill: `url(#${id}b)` }, svg);
  el('circle', { cx: 50, cy: 50, r: 44, fill: `url(#${id}f)`, stroke: '#1a120a', 'stroke-width': 1.5 }, svg);
  svg.dataset.glass = `url(#${id}g)`;
  return svg;
}

function glassOver(svg: SVGSVGElement): void {
  el('circle', { cx: 50, cy: 50, r: 44, fill: svg.dataset.glass ?? 'none', 'pointer-events': 'none' }, svg);
  el('circle', { cx: 50, cy: 50, r: 4, fill: '#b08d57', stroke: '#2a1c10' }, svg);
}

export interface DialOptions {
  label: string;
  unit?: string;
  max: number;
  /** Values at which to print numerals. */
  numerals: number[];
  /** Format a numeral value. */
  fmt?: (v: number) => string;
  minorStep: number;
  /** Sweep in degrees (default 300), centred on straight up. */
  sweep?: number;
  small?: boolean;
  /** Red-line value (optional). */
  redline?: number;
}

export function dial(o: DialOptions): Gauge {
  const svg = face(!!o.small);
  const sweep = o.sweep ?? 300;
  const a0 = -sweep / 2;
  const ang = (v: number) => a0 + (Math.max(0, Math.min(o.max, v)) / o.max) * sweep;
  const ticks = el('g', { stroke: '#e9dcc0' }, svg);
  for (let v = 0; v <= o.max + 1e-6; v += o.minorStep) {
    const major = o.numerals.some((n) => Math.abs(n - v) < 1e-6);
    const a = (ang(v) * Math.PI) / 180;
    const r1 = 41;
    const r2 = major ? 33 : 37;
    el('line', { x1: 50 + Math.sin(a) * r1, y1: 50 - Math.cos(a) * r1, x2: 50 + Math.sin(a) * r2, y2: 50 - Math.cos(a) * r2, 'stroke-width': major ? 2 : 1 }, ticks);
  }
  if (o.redline !== undefined) {
    const a1 = (ang(o.redline) * Math.PI) / 180;
    const a2 = (ang(o.max) * Math.PI) / 180;
    const r = 39;
    el('path', { d: `M${50 + Math.sin(a1) * r},${50 - Math.cos(a1) * r} A${r},${r} 0 0 1 ${50 + Math.sin(a2) * r},${50 - Math.cos(a2) * r}`, stroke: '#c0392b', 'stroke-width': 3, fill: 'none' }, svg);
  }
  for (const n of o.numerals) {
    const a = (ang(n) * Math.PI) / 180;
    const t = el('text', { x: 50 + Math.sin(a) * 26, y: 50 - Math.cos(a) * 26 + 3.5, 'text-anchor': 'middle', fill: '#f3e7c8', 'font-size': o.small ? 11 : 10, 'font-family': 'Georgia, serif' }, svg);
    t.textContent = o.fmt ? o.fmt(n) : String(n);
  }
  const lbl = el('text', { x: 50, y: 70, 'text-anchor': 'middle', fill: '#c9b58a', 'font-size': 7, 'font-family': 'Georgia, serif', 'letter-spacing': 1 }, svg);
  lbl.textContent = o.label.toUpperCase();
  if (o.unit) {
    const u = el('text', { x: 50, y: 78, 'text-anchor': 'middle', fill: '#8f7f60', 'font-size': 5.5, 'font-family': 'Georgia, serif' }, svg);
    u.textContent = o.unit;
  }
  const needle = el('g', { class: 'needle' }, svg);
  el('path', { d: 'M48.6,56 L49.4,12 L50,9 L50.6,12 L51.4,56 Z', fill: '#f5ecd2', stroke: '#1a120a', 'stroke-width': 0.5 }, needle);
  el('path', { d: 'M48.5,58 L51.5,58 L51,64 L49,64 Z', fill: '#f5ecd2' }, needle);
  glassOver(svg);
  let last = NaN;
  return {
    el: svg,
    set(v) {
      const a = ang(v);
      if (Math.abs(a - last) < 0.2) return;
      last = a;
      needle.setAttribute('transform', `rotate(${a.toFixed(1)} 50 50)`);
    },
  };
}

/** Aircraft compass: a rotating card behind a fixed lubber line. */
export function compass(small = false): Gauge {
  const svg = face(small);
  const card = el('g', { class: 'card' }, svg);
  for (let d = 0; d < 360; d += 10) {
    const a = (d * Math.PI) / 180;
    const major = d % 30 === 0;
    el('line', { x1: 50 + Math.sin(a) * 41, y1: 50 - Math.cos(a) * 41, x2: 50 + Math.sin(a) * (major ? 34 : 38), y2: 50 - Math.cos(a) * (major ? 34 : 38), stroke: '#e9dcc0', 'stroke-width': major ? 1.8 : 0.9 }, card);
  }
  const letters: [number, string][] = [
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
    [30, '3'],
    [60, '6'],
    [120, '12'],
    [150, '15'],
    [210, '21'],
    [240, '24'],
    [300, '30'],
    [330, '33'],
  ];
  for (const [d, s] of letters) {
    const a = (d * Math.PI) / 180;
    const t = el('text', { x: 50 + Math.sin(a) * 26, y: 50 - Math.cos(a) * 26 + 3.5, 'text-anchor': 'middle', fill: d === 0 ? '#ff7a5a' : '#f3e7c8', 'font-size': s.length === 1 ? 11 : 7, 'font-family': 'Georgia, serif', transform: `rotate(${d} ${50 + Math.sin(a) * 26} ${50 - Math.cos(a) * 26})` }, card);
    t.textContent = s;
  }
  el('path', { d: 'M50,5 L53,13 L47,13 Z', fill: '#e8b04a', stroke: '#1a120a', 'stroke-width': 0.6 }, svg);
  el('path', { d: 'M50,20 L50,80 M20,50 L80,50', stroke: 'rgba(233,220,192,.25)', 'stroke-width': 0.6 }, svg);
  glassOver(svg);
  let last = NaN;
  return {
    el: svg,
    set(headingDeg) {
      if (Math.abs(headingDeg - last) < 0.3) return;
      last = headingDeg;
      card.setAttribute('transform', `rotate(${(-headingDeg).toFixed(1)} 50 50)`);
    },
  };
}
