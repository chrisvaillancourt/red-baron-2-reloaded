import type { ScreenFactory } from '../context';
import { assetUrl, h, svg } from '../dom';
import { aircraftProfile } from '../insignia';
import { AIRCRAFT } from '../../data/aircraft';
import { hintBar } from '../components';

const QUOTES: [string, string][] = [
  ['The duty of the fighter pilot is to patrol his area of the sky, and shoot down any enemy fighters in that area. Anything else is rubbish.', 'Manfred von Richthofen'],
  ['Always above; seldom on the same level; never underneath.', 'Edward "Mick" Mannock'],
  ['Always carry through an attack when you have started it.', 'Oswald Boelcke, Dicta Boelcke'],
  ['Fighting in the air is not sport. It is scientific murder.', 'Eddie Rickenbacker'],
  ['Until one has given all, one has given nothing.', 'Georges Guynemer'],
];

export const titleScreen: ScreenFactory = (ctx) => {
  const pilots = ctx.services.campaign.listPilots();
  const active = pilots.filter((p) => p.status === 'active' || p.status === 'hospital');
  const [quote, who] = QUOTES[Math.floor(Math.random() * QUOTES.length)];

  const item = (ord: string, label: string, sub: string, onClick: () => void, auto = false) =>
    h('button', { class: 'plaque', onClick, 'data-autofocus': auto || undefined }, h('span', { class: 'ord' }, ord), label, h('span', { class: 'sub' }, sub));

  const menu = h(
    'nav',
    { class: 'title-menu', 'aria-label': 'Main menu' },
    h('div', { class: 'menu-head' }, '— Order of Battle —'),
    item('I', 'Career', active.length ? `${active.length} pilot${active.length > 1 ? 's' : ''} on file` : 'Enlist', () => ctx.router.push('roster'), true),
    item('II', 'Quick Mission', 'Instant action', () => ctx.router.push('quick')),
    item('III', 'Hall of Fame', 'Aces of the war', () => ctx.router.push('aces')),
    item('IV', 'Options', 'Realism · controls', () => ctx.router.push('options')),
    item('V', 'Flying Manual', 'Keys & tactics', () => ctx.router.push('controls')),
    item('VI', 'Credits', '', () => ctx.router.push('credits')),
    h('div', { class: 'quote' }, `“${quote}”`, h('cite', null, `— ${who}`)),
  );

  const planes = h('div', { class: 'title-silhouettes' });
  const addPlane = (id: keyof typeof AIRCRAFT, left: string, top: string, width: string, rot: number, delay: number) => {
    const el = svg(aircraftProfile(AIRCRAFT[id], { mode: 'silhouette', width: 300 }), 'plane') as SVGElement;
    el.setAttribute('style', `left:${left};top:${top};width:${width};height:auto;--r:${rot}deg;animation-delay:${delay}s`);
    planes.append(el);
  };
  addPlane('fokker_dri', '52%', '18%', '17vw', -8, 0);
  addPlane('sopwith_camel', '68%', '30%', '12vw', 12, -7);
  addPlane('albatros_dv', '40%', '40%', '7vw', -4, -13);

  const ground = h('div', { class: 'title-ground' });
  ground.append(
    svg(`<svg viewBox="0 0 1600 200" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,140 C120,120 220,150 340,132 C420,120 470,135 520,128 L540,90 L548,128 C640,120 700,140 820,126 C900,118 960,138 1040,130 L1060,110 L1100,110 L1120,128 C1240,120 1340,142 1460,126 C1520,120 1560,130 1600,126 L1600,200 L0,200 Z" fill="#0d0805"/>
      <g fill="#0d0805">
        <path d="M200,138 l6,-30 l6,30 z M216,136 l5,-22 l5,22 z M760,130 l7,-34 l7,34 z M778,130 l5,-24 l5,24 z M1300,132 l6,-28 l6,28 z"/>
        <path d="M1180,128 q30,-26 60,0 z"/>
      </g>
      <path d="M0,160 C300,150 600,170 900,158 C1200,148 1400,166 1600,156" stroke="rgba(230,190,120,.15)" stroke-width="2" fill="none"/>
    </svg>`),
  );

  const logo = h(
    'div',
    { class: 'logo' },
    h('div', { class: 'pre' }, 'The Great War in the Air · 1915–1918'),
    h('h1', { class: 'main' }, 'Red Baron ', h('span', { class: 'ii' }, 'II')),
    h('div', { class: 'reloaded' }, 'Reloaded'),
    h('div', { class: 'tagline' }, 'Fly for the Kaiser, the King, the Republic or Uncle Sam over the Western Front.'),
  );

  const left = h(
    'div',
    { class: 'title-left' },
    logo,
    h(
      'div',
      { class: 'title-foot' },
      'A non-commercial fan rebuild honouring Dynamix’s Red Baron II (1997).',
      h('br'),
      'All artwork, models and sound are generated in code. v0.1',
    ),
  );

  const bg = h('div', { class: 'rb-bg' });
  const el = h(
    'section',
    { class: 'rb-screen scr-title', dataset: { screen: 'title' } },
    bg,
    h('div', { class: 'title-sun' }),
    planes,
    ground,
    h('div', { class: 'rb-content' }, left, menu),
    h('div', { style: 'position:absolute;right:3em;bottom:1.2em;z-index:2' }, hintBar([['↑↓', 'Choose'], ['Enter', 'Select']])),
  );

  // Use the Blender key art if it exists; hide the procedural scene then.
  const art = assetUrl('art/title.jpg');
  const img = new Image();
  img.onload = () => {
    el.style.setProperty('--title-art', `url("${art}")`);
    el.classList.add('has-art');
  };
  img.src = art;

  return { el, music: 'menu' };
};
