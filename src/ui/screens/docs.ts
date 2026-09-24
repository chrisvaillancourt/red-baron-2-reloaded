import type { ScreenFactory } from '../context';
import { artBackground, h } from '../dom';
import { ACTION_GROUPS, ACTIONS, codeLabel } from '../bindings';
import { screenShell, withHints } from '../components';
import { showFlyingSchool } from '../flyingSchool';

const BG = artBackground('art/briefing-desk.jpg', 'radial-gradient(ellipse at 50% 30%, #4a3421, #150e08 80%)');

const tactics = (key: (action: string) => string): [string, string][] => [
  ['Height is life', 'The pilot above chooses when to fight. Climb before you reach the lines, and dive on your foe out of the sun.'],
  ['Get close', 'Guns converge at about 150 metres. Hold fire until the enemy fills the ring — most kills are made from under 100.'],
  ['Short bursts', `Long bursts overheat the gun and invite a jam. If a gun jams, hammer the breech (${key('clearJam')}) until it clears.`],
  ['Watch your tail', `Use padlock view (${key('viewPadlock')}) to keep an enemy in sight while you manoeuvre. Check behind you (${key('lookBack')}) often.`],
  ['Know your machine', 'A Camel turns right like nothing else, a SPAD dives away from anything, an Albatros must not be dived too steeply.'],
  ['Balloons', 'Observation balloons are ringed with anti-aircraft guns. Come in fast and low, fire, and leave.'],
  ['Getting home', `Land at your aerodrome or, when no enemy is near and you are over friendly ground, end the flight (${key('endFlight')}).`],
];

export const controlsScreen: ScreenFactory = (ctx) => {
  const shell = screenShell({ id: 'controls', title: 'Flying Manual', kicker: 'Controls & tactics', background: BG, onBack: () => ctx.router.back() });
  const b = ctx.settings().controls.keyBindings;
  const paper = h(
    'article',
    { class: 'doc-paper paper' },
    h('h2', null, 'Notes for pilots'),
    h('p', { class: 'typed muted' }, 'Current key assignments. Change them under Options → Keys. ', h('button', { class: 'btn small', onClick: () => void showFlyingSchool(ctx) }, 'Flying School primer')),
    ...ACTION_GROUPS.flatMap((g) => [
      h('h3', null, g),
      h(
        'div',
        { class: 'key-grid' },
        ...ACTIONS.filter((a) => a.group === g).map((a) =>
          h('div', { class: 'k' }, h('span', null, a.label), h('span', null, ...(b[a.id] ?? []).flatMap((c, i) => [i ? ' / ' : '', h('kbd', null, codeLabel(c))]))),
        ),
      ),
    ]),
    // Mirrors src/game/input.ts (standard gamepad mapping); keep the two in step.
    h('h3', null, 'Mouse'),
    h(
      'div',
      { class: 'key-grid' },
      ...[
        ['Move mouse', 'Mouse-aim: point, and the aeroplane follows'],
        ['Left button', 'Fire guns'],
        ['Right button (hold)', 'Look around'],
        ['Wheel', 'Throttle'],
      ].map(([k, v]) => h('div', { class: 'k' }, h('span', null, v), h('kbd', null, k))),
    ),
    h('h3', null, 'Gamepad'),
    h(
      'div',
      { class: 'key-grid' },
      ...[
        ['Left stick', 'Pitch & roll'],
        ['Right stick', 'Look around'],
        ['LB / RB', 'Left / right rudder'],
        ['RT', 'Fire guns'],
        ['LT', 'Blip switch'],
        ['D-pad ↑ / ↓', 'Throttle up / down'],
        ['D-pad ← / →', 'Normal time / compress'],
        ['A', 'Hammer jammed gun'],
        ['X', 'Cycle target'],
        ['Y', 'Padlock view'],
        ['R3', 'Padlock nearest enemy'],
        ['B', 'Chase view'],
        ['L3', 'Cockpit view'],
        ['View / Back', 'Map'],
        ['Menu / Start', 'Pause'],
      ].map(([k, v]) => h('div', { class: 'k' }, h('span', null, v), h('kbd', null, k))),
    ),
    h('h3', null, 'Tactics'),
    ...tactics((a) => (b[a]?.[0] ? codeLabel(b[a][0]) : 'unbound')).map(([t, d]) => h('p', null, h('strong', { class: 'engraved' }, t, '. '), d)),
  );
  shell.content.append(paper);
  withHints(shell);
  paper.tabIndex = 0;
  paper.setAttribute('data-autofocus', '');
  return { el: shell.el, music: 'menu' };
};

export const creditsScreen: ScreenFactory = (ctx) => {
  const shell = screenShell({ id: 'credits', title: 'Credits', background: BG, onBack: () => ctx.router.back() });
  const role = (r: string, ...names: string[]) => [h('div', { class: 'role' }, r), ...names.map((n) => h('div', null, n))];
  const paper = h(
    'article',
    { class: 'doc-paper paper credits' },
    h('h2', null, 'Red Baron II: Reloaded'),
    h('p', { class: 'muted' }, 'A non-commercial fan rebuild, made with admiration for Dynamix’s Red Baron II (1997) and its designers.'),
    ...role('Built by', 'A crew of Claude agents, directed by Chris Vaillancourt'),
    ...role('Engine', 'TypeScript · Three.js · Vite'),
    ...role('Aircraft', 'Parametric models generated in Blender from historical specifications'),
    ...role('Sound & music', 'Synthesised live in the Web Audio API'),
    ...role('Historical sources', 'Standard aircraft performance references; the published victory lists of the aces'),
    h('p', { class: 'muted', style: 'margin-top:2em;font-size:.8em' }, 'No original Dynamix or Sierra assets or code are used. “Red Baron” is used here only as an homage.'),
    h('p', { style: 'margin-top:1.5em;font-style:italic' }, 'To the airmen of all nations, 1914–1918.'),
  );
  paper.tabIndex = 0;
  paper.setAttribute('data-autofocus', '');
  shell.content.append(paper);
  withHints(shell);
  return { el: shell.el, music: 'menu' };
};
