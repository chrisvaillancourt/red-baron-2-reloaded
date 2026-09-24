/**
 * SVG artwork generated in code: national insignia, medals and ribbons,
 * squadron badges, pilot portrait silhouettes and aircraft side profiles.
 * All functions return SVG markup strings (use `svg()` from ./dom to mount).
 */
import type { SquadronInfo } from '../core/campaignTypes';
import type { AircraftSpec, Livery, Nation } from '../core/types';
import type { MedalDisplay } from './catalog';

type Insignia = Livery['insignia'];

/** German aircraft switched from the Eisernes Kreuz to the Balkenkreuz in spring 1918. */
export function insigniaFor(nation: Nation, date = '1917-01-01'): Insignia {
  switch (nation) {
    case 'germany':
      return date >= '1918-04-15' ? 'balkenkreuz' : 'iron-cross-patee';
    case 'britain':
      return 'roundel-rfc';
    case 'france':
      return 'roundel-france';
    case 'usa':
      return 'roundel-usa';
  }
}

export function nationalInsignia(style: Insignia, size = 64): string {
  const s = size;
  switch (style) {
    case 'iron-cross-patee':
      return `<svg viewBox="-50 -50 100 100" width="${s}" height="${s}" class="insignia" aria-hidden="true">
        <rect x="-50" y="-50" width="100" height="100" fill="#f2ede0" rx="4"/>
        <path d="M-12,-44 L12,-44 L6,-8 L44,-12 L44,12 L6,8 L12,44 L-12,44 L-6,8 L-44,12 L-44,-12 L-6,-8 Z" fill="#141210"/>
      </svg>`;
    case 'balkenkreuz':
      return `<svg viewBox="-50 -50 100 100" width="${s}" height="${s}" class="insignia" aria-hidden="true">
        <path d="M-15,-48 H15 V-15 H48 V15 H15 V48 H-15 V15 H-48 V-15 H-15 Z" fill="#f2ede0"/>
        <path d="M-9,-42 H9 V-9 H42 V9 H9 V42 H-9 V9 H-42 V-9 H-9 Z" fill="#141210"/>
      </svg>`;
    case 'roundel-rfc':
      return roundel(s, ['#2b3f8f', '#f2ede0', '#b3202a']);
    case 'roundel-france':
      return roundel(s, ['#b3202a', '#f2ede0', '#2b3f8f']);
    case 'roundel-usa':
      return roundel(s, ['#b3202a', '#2b3f8f', '#f2ede0']);
  }
}

function roundel(size: number, [outer, middle, inner]: [string, string, string]): string {
  return `<svg viewBox="-50 -50 100 100" width="${size}" height="${size}" class="insignia" aria-hidden="true">
    <circle r="48" fill="${outer}"/><circle r="32" fill="${middle}"/><circle r="16" fill="${inner}"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Medals
// ---------------------------------------------------------------------------

function ribbonStripes(m: MedalDisplay, x: number, y: number, w: number, hgt: number): string {
  const total = m.ribbon.reduce((a, [, r]) => a + r, 0);
  let cx = x;
  return m.ribbon
    .map(([c, r]) => {
      const sw = (r / total) * w;
      const rect = `<rect x="${cx.toFixed(2)}" y="${y}" width="${(sw + 0.3).toFixed(2)}" height="${hgt}" fill="${c}"/>`;
      cx += sw;
      return rect;
    })
    .join('');
}

/** A single ribbon bar (for the dossier ribbon rack). */
export function ribbonBar(m: MedalDisplay, width = 36, height = 11): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="ribbon-bar" aria-hidden="true">
    ${ribbonStripes(m, 0, 0, width, height)}
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="rgba(0,0,0,.35)"/>
  </svg>`;
}

function medalBody(m: MedalDisplay): string {
  const metal = m.metal;
  const enamel = m.enamel ?? m.metal;
  const rim = 'rgba(40,28,10,.8)';
  switch (m.shape) {
    case 'cross-patee':
      return `<path d="M-10,-38 L10,-38 L5,-6 L38,-10 L38,10 L5,6 L10,38 L-10,38 L-5,6 L-38,10 L-38,-10 L-5,-6 Z" fill="${metal}" stroke="${rim}" stroke-width="1.5"/>
        <path d="M-7,-33 L7,-33 L3.5,-4 L33,-7 L33,7 L3.5,4 L7,33 L-7,33 L-3.5,4 L-33,7 L-33,-7 L-3.5,-4 Z" fill="${enamel}"/>`;
    case 'maltese':
      return `<path d="M0,-4 L-14,-40 L0,-30 L14,-40 Z M4,0 L40,-14 L30,0 L40,14 Z M0,4 L14,40 L0,30 L-14,40 Z M-4,0 L-40,14 L-30,0 L-40,-14 Z" fill="${enamel}" stroke="${metal}" stroke-width="3" stroke-linejoin="round"/>
        <circle r="5" fill="${metal}"/>
        <path d="M-10,-10 l6,3 l-3,-6 z M10,-10 l-6,3 l3,-6 z M10,10 l-6,-3 l3,6 z M-10,10 l6,-3 l-3,6 z" fill="${metal}"/>`;
    case 'cross':
      return `<path d="M-7,-38 H7 V-7 H38 V7 H7 V38 H-7 V7 H-38 V-7 H-7 Z" fill="${metal}" stroke="${rim}" stroke-width="1.5"/>
        <path d="M-4,-33 H4 V-4 H33 V4 H4 V33 H-4 V4 H-33 V-4 H-4 Z" fill="${enamel}" opacity=".85"/>
        <circle r="9" fill="${metal}" stroke="${rim}"/>`;
    case 'cross-flory':
      return `<path d="M-5,-30 Q0,-42 5,-30 V-5 H30 Q42,0 30,5 H5 V30 Q0,42 -5,30 V5 H-30 Q-42,0 -30,-5 H-5 Z" fill="${metal}" stroke="${rim}" stroke-width="1.5"/>
        <path d="M-26,-26 L26,26 M26,-26 L-26,26" stroke="${metal}" stroke-width="4" stroke-linecap="round"/>
        <circle r="8" fill="${metal}" stroke="${rim}"/>`;
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 38 : 16;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
      }
      return `<polygon points="${pts.join(' ')}" fill="${enamel}" stroke="${metal}" stroke-width="3" stroke-linejoin="round"/>
        <circle r="10" fill="${metal}" stroke="${rim}"/>`;
    }
    case 'disc':
      return `<circle r="30" fill="${metal}" stroke="${rim}" stroke-width="2"/>
        <circle r="24" fill="none" stroke="${rim}" stroke-width="1" stroke-dasharray="2 3"/>
        <circle r="14" fill="${enamel}" stroke="${rim}"/>`;
  }
}

/** Full medal: ribbon drape + suspended medal. */
export function medalSvg(m: MedalDisplay, size = 96): string {
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  return `<svg viewBox="-50 -70 100 150" width="${size}" height="${size * 1.5}" class="medal" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/>
      </linearGradient>
      <clipPath id="${id}c"><path d="M-22,-70 H22 V-26 L0,-16 L-22,-26 Z"/></clipPath>
    </defs>
    <g clip-path="url(#${id}c)">${ribbonStripes(m, -22, -70, 44, 60)}</g>
    <path d="M-22,-70 H22 V-26 L0,-16 L-22,-26 Z" fill="url(#${id})" stroke="rgba(0,0,0,.3)"/>
    <circle cx="0" cy="-14" r="4" fill="none" stroke="${m.metal}" stroke-width="2.5"/>
    <g transform="translate(0,28)">${medalBody(m)}<g transform="scale(1)" style="mix-blend-mode:soft-light">${medalBody({ ...m, metal: `url(#${id})`, enamel: `url(#${id})` })}</g></g>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Squadron badge
// ---------------------------------------------------------------------------

export function squadronBadge(sq: Pick<SquadronInfo, 'shortName' | 'nation' | 'livery' | 'id'>, size = 72): string {
  const l = sq.livery;
  const num = (sq.shortName.match(/\d+/)?.[0] ?? sq.shortName.slice(0, 3)).slice(0, 3);
  const label = sq.shortName.replace(/\d+/, '').trim().toUpperCase();
  const clip = `sq${sq.id.replace(/[^a-z0-9]/gi, '')}${Math.random().toString(36).slice(2, 6)}`;
  return `<svg viewBox="-50 -56 100 112" width="${size}" height="${size * 1.12}" class="sq-badge" aria-hidden="true">
    <defs><clipPath id="${clip}"><path d="M-44,-50 H44 V6 C44,34 18,48 0,54 C-18,48 -44,34 -44,6 Z"/></clipPath></defs>
    <g clip-path="url(#${clip})">
      <rect x="-50" y="-56" width="100" height="112" fill="${l.fuselage}"/>
      <path d="M-50,-56 L50,-56 L50,-20 L-50,20 Z" fill="${l.accent}" opacity=".9"/>
      <rect x="-50" y="18" width="100" height="40" fill="${l.tail}" opacity=".55"/>
    </g>
    <path d="M-44,-50 H44 V6 C44,34 18,48 0,54 C-18,48 -44,34 -44,6 Z" fill="none" stroke="#2a2118" stroke-width="3"/>
    <path d="M-39,-45 H39 V6 C39,31 16,43 0,49 C-16,43 -39,31 -39,6 Z" fill="none" stroke="#e8dcc0" stroke-width="1.2" opacity=".8"/>
    <text x="0" y="12" text-anchor="middle" font-family="Georgia, 'Iowan Old Style', serif" font-weight="700" font-size="34" fill="#f5eedb" stroke="#1d1712" stroke-width="1.2" paint-order="stroke">${num}</text>
    <text x="0" y="34" text-anchor="middle" font-family="Georgia, serif" font-size="9" letter-spacing="1.5" fill="#f5eedb" stroke="#1d1712" stroke-width=".6" paint-order="stroke">${label.slice(0, 10)}</text>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Pilot portrait (sepia silhouette in flying kit)
// ---------------------------------------------------------------------------

export function pilotPortrait(nation: Nation, size = 120, variant: 'alive' | 'memorial' = 'alive'): string {
  const coat = nation === 'germany' ? '#4a4638' : nation === 'france' ? '#4b5a6e' : nation === 'usa' ? '#5a5234' : '#5e5236';
  const collar = nation === 'germany' ? '#2f2c24' : '#3b3322';
  const cap = nation === 'france' ? '#3a2b1c' : '#3d2c1a';
  const id = `pp${Math.random().toString(36).slice(2, 7)}`;
  return `<svg viewBox="0 0 100 120" width="${size}" height="${size * 1.2}" class="portrait ${variant}" aria-hidden="true">
    <defs>
      <radialGradient id="${id}" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#d8c7a0"/><stop offset="1" stop-color="#8e7a55"/></radialGradient>
    </defs>
    <rect width="100" height="120" fill="url(#${id})"/>
    <path d="M8,120 C10,92 26,84 50,82 C74,84 90,92 92,120 Z" fill="${coat}"/>
    <path d="M36,84 L50,104 L64,84 L58,82 L50,92 L42,82 Z" fill="${collar}"/>
    <path d="M40,74 L60,74 L58,86 L42,86 Z" fill="#b49872"/>
    <ellipse cx="50" cy="56" rx="17" ry="21" fill="#c6a882"/>
    <path d="M31,52 C31,30 42,26 50,26 C58,26 69,30 69,52 L69,62 C66,60 66,48 50,46 C34,48 34,60 31,62 Z" fill="${cap}"/>
    <path d="M30,56 C28,68 30,76 36,80 L36,60 Z M70,56 C72,68 70,76 64,80 L64,60 Z" fill="${cap}"/>
    <rect x="34" y="38" width="32" height="9" rx="4.5" fill="#6b5a3e" stroke="#2a2016" stroke-width="1.2"/>
    <circle cx="42" cy="42.5" r="5.5" fill="#9fb0b0" stroke="#2a2016" stroke-width="1.5"/>
    <circle cx="58" cy="42.5" r="5.5" fill="#9fb0b0" stroke="#2a2016" stroke-width="1.5"/>
    <path d="M44,68 Q50,71 56,68" stroke="#6e5238" stroke-width="1.4" fill="none"/>
    <path d="M42,60 L44,58 M58,60 L56,58" stroke="#5a4028" stroke-width="1.2"/>
    <path d="M28,98 C40,94 60,94 72,98" stroke="#e8e0cc" stroke-width="3" fill="none" opacity=".75"/>
    <rect width="100" height="120" fill="#704214" opacity=".18" style="mix-blend-mode:multiply"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Aircraft side profile from geometry (technical-drawing style)
// ---------------------------------------------------------------------------

export interface ProfileOptions {
  width?: number;
  livery?: Livery;
  /** Ink drawing (default), painted with livery colours, or a solid silhouette. */
  mode?: 'ink' | 'livery' | 'silhouette';
  /** Silhouette colour. */
  color?: string;
}

export function aircraftProfile(spec: AircraftSpec, opts: ProfileOptions = {}): string {
  const g = spec.geometry;
  const mode = opts.mode ?? (opts.livery ? 'livery' : 'ink');
  const L = g.length;
  const sil = mode === 'silhouette';
  const silC = opts.color ?? '#140c06';
  const ink = sil ? silC : '#2a2118';
  const paper = sil ? silC : mode === 'ink' ? 'rgba(250,240,215,.55)' : opts.livery!.fuselage;
  const wingFill = sil ? silC : mode === 'ink' ? 'rgba(235,222,190,.8)' : opts.livery!.wingTop;
  const tailFill = sil ? silC : mode === 'ink' ? paper : opts.livery!.tail;
  const cowlFill = sil ? silC : mode === 'ink' ? 'rgba(200,190,160,.8)' : opts.livery!.cowling;
  const sw = 0.035; // stroke width in metres

  // Coordinate system: x from nose (0) to tail (L); y up. Draw with nose at right: X = L - x.
  const depth = g.fuselageWidth * 1.15;
  const groundY = -1.25 - (g.crew === 2 ? 0.15 : 0);
  const fusBottom = 0;
  const fusTop = depth;
  const X = (x: number) => L - x;
  const Y = (y: number) => -y; // SVG y down
  const pt = (x: number, y: number) => `${X(x).toFixed(3)},${Y(y).toFixed(3)}`;

  const parts: string[] = [];
  const noseLen = spec.performance.engineType === 'rotary' ? 0.75 : 1.1;
  const cockpitX = g.pusher ? 1.1 : noseLen + 1.25 + (g.crew === 2 ? 0 : 0.2);

  // --- Fuselage / nacelle
  if (g.pusher) {
    const nacEnd = 2.6;
    parts.push(`<path d="M${pt(0.05, 0.45)} Q${pt(0, 0.6)} ${pt(0.3, depth)} L${pt(nacEnd, depth * 0.95)} L${pt(nacEnd, 0.05)} L${pt(0.4, 0.05)} Z" fill="${paper}" stroke="${ink}" stroke-width="${sw}"/>`);
    // engine + prop behind nacelle
    parts.push(`<rect x="${X(nacEnd + 0.45)}" y="${Y(depth * 0.85)}" width="0.45" height="${depth * 0.75}" fill="${cowlFill}" stroke="${ink}" stroke-width="${sw}"/>`);
    parts.push(`<ellipse cx="${X(nacEnd + 0.55)}" cy="${Y(depth * 0.5)}" rx="0.06" ry="1.2" fill="rgba(60,40,20,.25)" stroke="${ink}" stroke-width="${sw * 0.6}"/>`);
    // tail booms
    parts.push(`<path d="M${pt(2.2, 1.9)} L${pt(L - 0.6, 0.7)} M${pt(2.2, -0.15)} L${pt(L - 0.6, 0.45)}" stroke="${ink}" stroke-width="${sw * 1.2}" fill="none"/>`);
  } else {
    const top: string[] = [];
    top.push(pt(noseLen * 0.15, depth * 0.62));
    top.push(pt(noseLen, depth * 0.98));
    top.push(pt(cockpitX - 0.35, fusTop));
    top.push(pt(cockpitX + 0.45, fusTop * 0.96));
    top.push(pt(L - 0.35, depth * 0.55));
    top.push(pt(L, depth * 0.45));
    const bot = [pt(L, depth * 0.3), pt(L - 0.5, depth * 0.28), pt(noseLen + 0.9, fusBottom), pt(noseLen, fusBottom + 0.02), pt(noseLen * 0.15, depth * 0.2)];
    parts.push(`<path d="M${top.join(' L')} L${bot.join(' L')} Z" fill="${paper}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`);
    // cockpit cut-out and pilot head
    parts.push(`<path d="M${pt(cockpitX - 0.3, fusTop)} Q${pt(cockpitX, fusTop - 0.12)} ${pt(cockpitX + 0.35, fusTop * 0.97)}" stroke="${ink}" stroke-width="${sw}" fill="#3a2d1e"/>`);
    parts.push(`<circle cx="${X(cockpitX + 0.05)}" cy="${Y(fusTop + 0.16)}" r="0.16" fill="#4a3826" stroke="${ink}" stroke-width="${sw * 0.7}"/>`);
    if (g.crew === 2) {
      parts.push(`<circle cx="${X(cockpitX + 1.05)}" cy="${Y(fusTop * 0.93 + 0.14)}" r="0.15" fill="#4a3826" stroke="${ink}" stroke-width="${sw * 0.7}"/>`);
      parts.push(`<path d="M${pt(cockpitX + 1.05, fusTop + 0.2)} L${pt(cockpitX + 0.55, fusTop + 0.42)}" stroke="${ink}" stroke-width="${sw * 1.4}"/>`);
    }
    // engine
    if (spec.performance.engineType === 'rotary') {
      parts.push(`<path d="M${pt(noseLen, depth * 0.98)} L${pt(0.12, depth * 0.95)} Q${pt(-0.02, depth * 0.5)} ${pt(0.12, 0.04)} L${pt(noseLen, 0.02)} Z" fill="${cowlFill}" stroke="${ink}" stroke-width="${sw}"/>`);
      parts.push(`<path d="M${pt(noseLen * 0.55, depth * 0.95)} L${pt(noseLen * 0.55, 0.04)}" stroke="${ink}" stroke-width="${sw * 0.5}" opacity=".6"/>`);
    } else {
      parts.push(`<path d="M${pt(noseLen, depth * 0.98)} L${pt(0.25, depth * 0.72)} L${pt(0.25, depth * 0.25)} L${pt(noseLen, 0.02)} Z" fill="${cowlFill}" stroke="${ink}" stroke-width="${sw}"/>`);
      for (let i = 0; i < 3; i++) parts.push(`<rect x="${X(noseLen - 0.05 - i * 0.22)}" y="${Y(depth + 0.1)}" width="0.14" height="0.14" fill="${cowlFill}" stroke="${ink}" stroke-width="${sw * 0.6}"/>`);
      parts.push(`<path d="M${pt(0.25, depth * 0.62)} Q${pt(0.02, depth * 0.5)} ${pt(0.25, depth * 0.35)} Z" fill="${cowlFill}" stroke="${ink}" stroke-width="${sw}"/>`);
    }
    // propeller (edge-on)
    parts.push(`<ellipse cx="${X(0.1)}" cy="${Y(depth * 0.48)}" rx="0.07" ry="1.3" fill="rgba(90,60,30,.35)" stroke="${ink}" stroke-width="${sw * 0.6}"/>`);
    // synchronised gun(s)
    if (spec.guns.some((m) => m.mount === 'fixed-synchronized'))
      parts.push(`<path d="M${pt(noseLen - 0.2, depth + 0.06)} L${pt(cockpitX - 0.45, depth + 0.06)}" stroke="${ink}" stroke-width="${sw * 2.4}" stroke-linecap="round"/>`);
  }

  // --- Wings (sections, stacked)
  const wingX = g.pusher ? 1.2 : noseLen + 0.35;
  const wing = (lead: number, y: number, chord: number, thick: number) =>
    `<path d="M${pt(lead, y)} Q${pt(lead + chord * 0.12, y + thick)} ${pt(lead + chord * 0.4, y + thick)} L${pt(lead + chord, y + thick * 0.15)} L${pt(lead + chord, y)} Z" fill="${wingFill}" stroke="${ink}" stroke-width="${sw}"/>`;
  const thick = spec.id === 'fokker_dvii' || spec.id === 'fokker_dviii' || spec.id === 'fokker_dri' ? 0.16 : 0.09;
  const levels: { lead: number; y: number; chord: number }[] = [];
  if (g.layout === 'monoplane') levels.push({ lead: wingX, y: depth * 0.55, chord: g.chord });
  else if (g.layout === 'parasol') levels.push({ lead: wingX - 0.1, y: depth + g.gap, chord: g.chord });
  else {
    const lowerY = g.pusher ? -0.05 : 0.02;
    const n = g.layout === 'triplane' ? 3 : 2;
    const step = g.gap;
    for (let i = 0; i < n; i++) {
      const isLower = i === 0;
      const chord = isLower ? g.lowerChord : g.chord;
      const lead = wingX - (g.stagger * i) / (n - 1) + (isLower && g.layout === 'sesquiplane' ? 0.12 : 0);
      levels.push({ lead, y: lowerY + step * i, chord });
    }
  }
  // struts
  if (levels.length > 1) {
    const lo = levels[0];
    const hi = levels[levels.length - 1];
    const a = lo.lead + lo.chord * 0.25;
    const b = hi.lead + hi.chord * 0.25;
    const c = lo.lead + lo.chord * 0.75;
    const d = hi.lead + hi.chord * 0.75;
    parts.push(`<path d="M${pt(a, lo.y)} L${pt(b, hi.y)} M${pt(c, lo.y)} L${pt(d, hi.y)}" stroke="${ink}" stroke-width="${sw * 1.3}"/>`);
    parts.push(`<path d="M${pt(a, lo.y + 0.05)} L${pt(d, hi.y)}" stroke="${ink}" stroke-width="${sw * 0.4}" opacity=".7"/>`);
  } else if (g.layout === 'parasol') {
    const w = levels[0];
    parts.push(`<path d="M${pt(w.lead + 0.2, w.y)} L${pt(noseLen + 0.3, depth)} M${pt(w.lead + w.chord * 0.8, w.y)} L${pt(noseLen + 1.0, depth)}" stroke="${ink}" stroke-width="${sw * 1.3}"/>`);
  }
  for (const w of levels) parts.push(wing(w.lead, w.y, w.chord, thick));
  if (g.layout === 'monoplane') {
    // wing-warping pylon and wires
    parts.push(`<path d="M${pt(wingX + 0.3, depth + 0.7)} L${pt(wingX + 0.3, depth)} M${pt(wingX + 0.3, depth + 0.7)} L${pt(wingX + g.chord, depth * 0.6)} M${pt(wingX + 0.3, -0.6)} L${pt(wingX + g.chord, depth * 0.55)}" stroke="${ink}" stroke-width="${sw * 0.6}"/>`);
  }
  // Over-wing Lewis
  if (spec.guns.some((m) => m.mount === 'fixed-overwing')) {
    const top = levels[levels.length - 1];
    parts.push(`<path d="M${pt(top.lead - 0.25, top.y + 0.18)} L${pt(top.lead + 0.9, top.y + 0.18)}" stroke="${ink}" stroke-width="${sw * 2.2}" stroke-linecap="round"/>`);
    parts.push(`<ellipse cx="${X(top.lead + 0.55)}" cy="${Y(top.y + 0.3)}" rx="0.18" ry="0.06" fill="${ink}"/>`);
  }

  // --- Undercarriage
  const gearX = g.pusher ? 1.3 : noseLen + 0.5;
  const wheelR = 0.33;
  parts.push(`<path d="M${pt(gearX - 0.25, fusBottom + 0.02)} L${pt(gearX, groundY + wheelR)} L${pt(gearX + 0.55, fusBottom + 0.02)}" stroke="${ink}" stroke-width="${sw * 1.2}" fill="none"/>`);
  parts.push(`<circle cx="${X(gearX)}" cy="${Y(groundY + wheelR)}" r="${wheelR}" fill="#3a2d1e" stroke="${ink}" stroke-width="${sw}"/>`);
  parts.push(`<circle cx="${X(gearX)}" cy="${Y(groundY + wheelR)}" r="${wheelR * 0.3}" fill="${paper}"/>`);
  // tailskid
  parts.push(`<path d="M${pt(L - 0.7, depth * 0.3)} L${pt(L - 0.4, groundY + 0.95)}" stroke="${ink}" stroke-width="${sw * 1.2}"/>`);

  // --- Tail
  const tx = L;
  const ty = g.pusher ? 0.55 : depth * 0.4;
  let fin = '';
  const fh = 1.05;
  switch (g.tailShape) {
    case 'comma':
      fin = `M${pt(tx - 0.1, ty)} C${pt(tx - 0.35, ty + fh * 0.9)} ${pt(tx + 0.35, ty + fh * 1.1)} ${pt(tx + 0.25, ty + fh * 0.4)} C${pt(tx + 0.25, ty - 0.2)} ${pt(tx, ty - 0.35)} ${pt(tx - 0.1, ty - 0.1)} Z`;
      break;
    case 'triangular':
      fin = `M${pt(tx - 0.9, ty + 0.05)} L${pt(tx - 0.05, ty + fh)} L${pt(tx + 0.2, ty + fh * 0.85)} L${pt(tx + 0.15, ty - 0.3)} L${pt(tx - 0.1, ty - 0.3)} Z`;
      break;
    case 'squared':
      fin = `M${pt(tx - 0.8, ty + 0.05)} L${pt(tx - 0.35, ty + fh * 0.8)} L${pt(tx + 0.2, ty + fh * 0.85)} L${pt(tx + 0.2, ty - 0.25)} L${pt(tx - 0.05, ty - 0.25)} Z`;
      break;
    default:
      fin = `M${pt(tx - 0.8, ty + 0.05)} Q${pt(tx - 0.4, ty + fh)} ${pt(tx + 0.05, ty + fh * 0.95)} Q${pt(tx + 0.35, ty + fh * 0.6)} ${pt(tx + 0.25, ty - 0.2)} L${pt(tx - 0.05, ty - 0.25)} Z`;
  }
  parts.push(`<path d="${fin}" fill="${tailFill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`);
  parts.push(`<path d="M${pt(tx - 0.2, ty + fh * 0.9)} L${pt(tx - 0.1, ty - 0.2)}" stroke="${ink}" stroke-width="${sw * 0.5}" opacity=".6"/>`);
  parts.push(`<path d="M${pt(tx - 1.3, ty + 0.02)} L${pt(tx + 0.1, ty + 0.02)}" stroke="${ink}" stroke-width="${sw * 2}" stroke-linecap="round"/>`);

  // Insignia on fuselage/rudder (livery mode)
  if (mode === 'livery' && opts.livery) {
    const ins = opts.livery.insignia;
    const cx = X(L - 1.4);
    const cy = Y(depth * 0.5);
    if (ins.startsWith('roundel')) {
      const [o, m, i] = ins === 'roundel-rfc' ? ['#2b3f8f', '#f2ede0', '#b3202a'] : ins === 'roundel-france' ? ['#b3202a', '#f2ede0', '#2b3f8f'] : ['#b3202a', '#2b3f8f', '#f2ede0'];
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${depth * 0.4}" fill="${o}"/><circle cx="${cx}" cy="${cy}" r="${depth * 0.27}" fill="${m}"/><circle cx="${cx}" cy="${cy}" r="${depth * 0.13}" fill="${i}"/>`);
    } else {
      const r = depth * 0.38;
      parts.push(`<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="#f2ede0" opacity=".9"/><path d="M${cx - r * 0.3},${cy - r} h${r * 0.6} v${r * 0.7} h${r * 0.7} v${r * 0.6} h-${r * 0.7} v${r * 0.7} h-${r * 0.6} v-${r * 0.7} h-${r * 0.7} v-${r * 0.6} h${r * 0.7} Z" fill="#141210"/>`);
    }
  }

  const minX = -0.2;
  const maxX = L + 0.6;
  const topY = Y(Math.max(depth + (g.layout === 'triplane' ? g.gap * 2 : g.layout === 'monoplane' ? 0.9 : g.gap) + 0.5, 2.1));
  const botY = Y(groundY - 0.05);
  const vw = maxX - minX;
  const vh = botY - topY;
  const width = opts.width ?? 240;
  return `<svg viewBox="${minX} ${topY.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}" width="${width}" height="${((width * vh) / vw).toFixed(0)}" class="ac-profile" aria-hidden="true">
    ${sil ? '' : `<line x1="${minX}" y1="${Y(groundY)}" x2="${maxX}" y2="${Y(groundY)}" stroke="${ink}" stroke-width="${sw * 0.5}" stroke-dasharray="0.15 0.1" opacity=".5"/>`}
    ${parts.join('\n')}
  </svg>`;
}
