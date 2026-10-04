import type { ScreenFactory } from '../context';
import { artBackground, h } from '../dom';
import { ACTION_GROUPS, ACTIONS, codeLabel } from '../bindings';
import { screenShell, withHints } from '../components';
import { showFlyingSchool } from '../flyingSchool';

/** The first key bound to an action, as the Manual prints it. */
const keyOf = (b: Record<string, string[]>, action: string) => (b[action]?.[0] ? codeLabel(b[action][0]) : 'unbound');

const BG = artBackground('art/briefing-desk.jpg', 'radial-gradient(ellipse at 50% 30%, #4a3421, #150e08 80%)');

const tactics = (key: (action: string) => string): [string, string][] => [
  ['Height is life', 'The pilot above chooses when to fight. Climb before you reach the lines, and dive on your foe out of the sun.'],
  ['Get close', 'Guns converge at about 150 metres. Hold fire until the enemy fills the ring — most kills are made from under 100.'],
  ['Short bursts', `Long bursts overheat the gun and invite a jam. If a gun jams, hammer the breech (${key('clearJam')}) until it clears.`],
  ['Watch your tail', `Use padlock view (${key('viewPadlock')}) to keep an enemy in sight while you manoeuvre. Check behind you (${key('lookBack')}) often.`],
  ['Know your machine', 'A Camel turns right like nothing else, a SPAD dives away from anything, an Albatros must not be dived too steeply.'],
  ['Balloons', 'Observation balloons are ringed with anti-aircraft guns. Come in fast and low, fire, and leave.'],
  ['Getting home', `Land at your aerodrome or, when no enemy is near and you are over friendly ground, end the flight (${key('endFlight')}).`],
  [
    'The gunner',
    `In a two-seater, ${key('stationNext')} takes you back to the observer's gun while your pilot flies on. Lead a crossing target by the outer ring of the sight. The dashed line is the edge of your field of fire: the tail, wings and propeller are inside it. ${key('stationPilot')} gives you the controls back.`,
  ],
  [
    'The bomb aimer',
    `${key('viewBombsight')} takes the bomb aimer's seat and looks down the sight line to where a bomb would fall. Your pilot flies the route; the cue counts down the run-in and calls left or right. Release (${key('releaseBomb')}) as the target meets the mark on the wire.`,
  ],
];

export const controlsScreen: ScreenFactory = (ctx) => {
  const shell = screenShell({ id: 'controls', title: 'Flying Manual', kicker: 'Controls & tactics', background: BG, onBack: () => ctx.router.back() });
  const b = ctx.settings().controls.keyBindings;
  const touch = window.matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const touchActionLabels: Record<string, string> = {
    clearJam: 'Menu → Clear gun jam', viewPadlock: 'Menu → Padlock view', lookBack: 'Look pad',
    endFlight: 'Menu → End flight', stationNext: 'Menu → Next crew station', stationPilot: 'Menu → Pilot station',
    viewBombsight: 'Menu → Bombsight', releaseBomb: 'Menu → Release bomb',
  };
  const paper = h(
    'article',
    { class: 'doc-paper paper' },
    h('h2', null, 'Notes for pilots'),
    h('p', { class: 'typed muted' }, 'Current key assignments. Change them under Options → Keys. ', h('button', { class: 'btn small', onClick: () => void showFlyingSchool(ctx) }, 'Flying School primer')),
    ctx.services.defense && h('p', { class: 'typed muted' }, 'Serving the airfield battery? ', h('button', { class: 'btn small', dataset: { action: 'gunner-guide' }, onClick: () => ctx.router.push('gunner-guide') }, "Gunner’s Guide")),
    h('h3', null, 'Touch controls'),
    h('p', { class: 'typed muted' }, 'Touch controls appear for a coarse pointer or touch-capable screen; no phone model is assumed. Use Touch controls / Hide touch controls to choose. The Menu button stays available when the decorative HUD is hidden.'),
    h('div', { class: 'key-grid' }, ...[
      ['Stick / aim', 'Move from the centre to pitch and bank; down pulls back, up pushes forward. At a gun, up raises the aim. Release to centre.'],
      ['Rudder left / right', 'Hold for rudder; simultaneous opposite holds cancel out.'],
      ['Look', 'Hold away from the centre to look around; release to stop turning your head.'],
      ['Fire / Blip', 'Hold Fire for a burst; hold Blip to cut rotary ignition.'],
      ['Throttle slider', 'Set engine power; the displayed percentage follows the flight state.'],
      ['Menu', 'Pauses the flight while the action sheet is open. Scroll for views, targets, map, time, crew, bombs, gun jams, wingmen, HUD and end flight.'],
      ['Return to flight', 'Closes the action sheet without a command, or returns from a pause, map or crew dialog.'],
    ].map(([label, description]) => h('div', { class: 'k' }, h('span', null, description), h('strong', null, label)))),
    h('p', { class: 'typed muted' }, 'At a gun or bombsight your AI pilot flies. Use Menu → Pilot station to take the controls back. Opening a dialog, changing stations, rotating the screen or leaving the app releases held touch gestures; lift your fingers before starting again. Menus and the action sheet scroll normally.'),
    h('h3', null, 'Keyboard assignments'),
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
    // Mirrors InputManager.stationMode in src/game/input.ts; keep the two in step.
    h('h3', null, 'At a gun or the bombsight'),
    h('p', { class: 'typed muted' }, 'Your pilot flies while you work a gun or the bombsight; the throttle and flight keys are his.'),
    h(
      'div',
      { class: 'key-grid' },
      ...[
        ['Move mouse', 'Swing the gun'],
        [`${keyOf(b, 'pitchUp')} ${keyOf(b, 'pitchDown')} ${keyOf(b, 'rollLeft')} ${keyOf(b, 'rollRight')} / left stick`, 'Swing the gun: up, down, left, right'],
        [`Left button / ${keyOf(b, 'fire')} / RT`, 'Fire the gun'],
        [`${keyOf(b, 'clearJam')} / A`, 'Hammer a jam (drums change by themselves)'],
        ['Right button (hold) and drag', 'Look away from the gun, until it swings'],
        [keyOf(b, 'viewCockpit'), 'Look back along the gun'],
        [keyOf(b, 'releaseBomb'), 'Release a bomb (bomb aimer)'],
      ].map(([k, v]) => h('div', { class: 'k' }, h('span', null, v), h('kbd', null, k))),
    ),
    h('h3', null, 'Tactics'),
    ...tactics((a) => touch ? (touchActionLabels[a] ?? keyOf(b, a)) : keyOf(b, a)).map(([t, d]) => h('p', null, h('strong', { class: 'engraved' }, t, '. '), d)),
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
