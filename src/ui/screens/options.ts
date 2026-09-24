import { DEFAULT_KEY_BINDINGS, DEFAULT_SETTINGS } from '../../core/settings';
import type { GameSettings, RealismSettings } from '../../core/types';
import type { ScreenFactory } from '../context';
import { artBackground, h, setChildren } from '../dom';
import { ACTION_GROUPS, ACTIONS, actionLabel, codeLabel, findConflicts, rebind, RESERVED_CODES, unbind } from '../bindings';
import { folderTabs, optRow, rangeInput, screenShell, segmented, selectInput, toggle, withHints } from '../components';

export const REALISM_PRESETS: Record<'novice' | 'standard' | 'authentic', RealismSettings> = {
  novice: {
    flightModel: 'relaxed',
    engineTorque: false,
    gunJams: false,
    limitedAmmo: false,
    limitedFuel: false,
    midairCollisions: false,
    invulnerable: false,
    autoRudder: true,
    gEffects: false,
    targetLabels: true,
    enemySkillBias: -0.5,
  },
  standard: { ...DEFAULT_SETTINGS.realism },
  authentic: {
    flightModel: 'authentic',
    engineTorque: true,
    gunJams: true,
    limitedAmmo: true,
    limitedFuel: true,
    midairCollisions: true,
    invulnerable: false,
    autoRudder: false,
    gEffects: true,
    targetLabels: false,
    enemySkillBias: 0.3,
  },
};

export function matchPreset(r: RealismSettings): keyof typeof REALISM_PRESETS | 'custom' {
  for (const [k, p] of Object.entries(REALISM_PRESETS) as [keyof typeof REALISM_PRESETS, RealismSettings][]) {
    if ((Object.keys(p) as (keyof RealismSettings)[]).every((key) => p[key] === r[key])) return k;
  }
  return 'custom';
}

const REALISM_ROWS: { key: keyof RealismSettings; name: string; desc: string }[] = [
  { key: 'engineTorque', name: 'Engine torque', desc: 'Rotary engines pull the aeroplane into turns (the Camel’s famous snap to the right).' },
  { key: 'gunJams', name: 'Gun jams', desc: 'Hot guns jam. Hammer the breech to clear them.' },
  { key: 'limitedAmmo', name: 'Limited ammunition', desc: 'Belts run out; Lewis drums must be changed.' },
  { key: 'limitedFuel', name: 'Limited fuel', desc: 'Keep an eye on the gauge on long patrols.' },
  { key: 'midairCollisions', name: 'Mid-air collisions', desc: 'Getting too close is fatal for both machines.' },
  { key: 'autoRudder', name: 'Automatic rudder', desc: 'Co-ordinates the rudder with your ailerons.' },
  { key: 'gEffects', name: 'Blackouts', desc: 'The world greys at the edges under sustained high g.' },
  { key: 'targetLabels', name: 'Target labels', desc: 'Names, ranges and cues on enemy aircraft.' },
  { key: 'invulnerable', name: 'Invulnerability', desc: 'Your machine cannot be damaged. Career victories still count.' },
];

export const optionsScreen: ScreenFactory = (ctx) => {
  const shell = screenShell({
    id: 'options',
    title: 'Options',
    kicker: 'Settings',
    background: artBackground('art/menu-aerodrome.jpg', 'radial-gradient(ellipse at 50% 30%, #4a3421, #150e08 80%)'),
    onBack: () => ctx.router.back(),
    hints: [
      ['↑↓', 'Navigate'],
      ['[ ]', 'Tabs'],
      ['Esc', 'Back'],
    ],
  });
  const s = () => ctx.settings();
  const set = (fn: (g: GameSettings) => void) => ctx.updateSettings(fn);

  const realism = () => {
    const presetHost = h('div', { class: 'presets' });
    const paintPreset = () => {
      const cur = matchPreset(s().realism);
      setChildren(
        presetHost,
        h('span', { class: 'field-label' }, 'Preset'),
        segmented(
          [
            { value: 'novice', label: 'Novice' },
            { value: 'standard', label: 'Standard' },
            { value: 'authentic', label: 'Authentic' },
            ...(cur === 'custom' ? [{ value: 'custom' as const, label: 'Custom' }] : []),
          ],
          cur,
          (v) => {
            if (v === 'custom') return;
            set((g) => (g.realism = { ...REALISM_PRESETS[v] }));
            tabs.refresh();
          },
        ),
      );
    };
    paintPreset();
    const skillVal = h('span', { class: 'val' });
    const paintSkill = () => {
      const b = s().realism.enemySkillBias;
      skillVal.textContent = b < -0.25 ? 'Easier' : b > 0.25 ? 'Harder' : 'Normal';
    };
    paintSkill();
    return h(
      'div',
      null,
      presetHost,
      optRow(
        'Flight model',
        'Relaxed forgives stalls and spins; Authentic flies like the real thing.',
        segmented(
          [
            { value: 'relaxed', label: 'Relaxed' },
            { value: 'standard', label: 'Standard' },
            { value: 'authentic', label: 'Authentic' },
          ],
          s().realism.flightModel,
          (v) => (set((g) => (g.realism.flightModel = v)), paintPreset()),
        ),
      ),
      ...REALISM_ROWS.map((r) =>
        optRow(r.name, r.desc, toggle(s().realism[r.key] as boolean, (v) => (set((g) => ((g.realism[r.key] as boolean) = v)), paintPreset()), r.name)),
      ),
      optRow(
        'Enemy skill',
        'Adjusts the skill of every enemy pilot.',
        [
          rangeInput({ min: -1, max: 1, step: 0.1, value: s().realism.enemySkillBias, label: 'Enemy skill', onInput: (v) => (set((g) => (g.realism.enemySkillBias = v)), paintSkill(), paintPreset()) }),
          skillVal,
        ],
      ),
    );
  };

  const graphics = () => {
    const fovVal = h('span', { class: 'val' }, `${s().fov}°`);
    return h(
      'div',
      null,
      optRow(
        'Graphics quality',
        'Terrain detail, shadows, clouds and draw distance.',
        segmented(
          [
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'ultra', label: 'Ultra' },
          ],
          s().graphics,
          (v) => set((g) => (g.graphics = v)),
        ),
      ),
      optRow('Field of view', 'Vertical field of view in the cockpit.', [
        rangeInput({ min: 50, max: 100, step: 1, value: s().fov, label: 'Field of view', onInput: (v) => (set((g) => (g.fov = v)), (fovVal.textContent = `${v}°`)) }),
        fovVal,
      ]),
      optRow(
        'Units',
        'Automatic uses your service’s instruments: mph & feet for British and American pilots, km/h & metres otherwise.',
        segmented(
          [
            { value: 'auto', label: 'Automatic' },
            { value: 'metric', label: 'Metric' },
            { value: 'imperial', label: 'Imperial' },
          ],
          s().units,
          (v) => set((g) => (g.units = v)),
        ),
      ),
      optRow('Tutorial hints', 'Show tips during your first flights.', toggle(s().showTutorialHints, (v) => set((g) => (g.showTutorialHints = v)), 'Tutorial hints')),
    );
  };

  const audio = () => {
    const vol = (name: string, key: 'masterVolume' | 'musicVolume' | 'effectsVolume') => {
      const val = h('span', { class: 'val' }, `${Math.round(s()[key] * 100)}%`);
      return optRow(name, null, [
        rangeInput({
          min: 0,
          max: 1,
          step: 0.05,
          value: s()[key],
          label: name,
          onInput: (v) => {
            set((g) => (g[key] = v));
            val.textContent = `${Math.round(v * 100)}%`;
          },
        }),
        val,
      ]);
    };
    return h(
      'div',
      null,
      vol('Master volume', 'masterVolume'),
      vol('Music', 'musicVolume'),
      vol('Effects', 'effectsVolume'),
      optRow('Test', 'Play a sample sound.', h('button', { class: 'btn small', onClick: () => ctx.services.audio.playUi('stamp') }, 'Play')),
    );
  };

  const controls = () => {
    const sensVal = h('span', { class: 'val' }, s().controls.mouseSensitivity.toFixed(1));
    const dzVal = h('span', { class: 'val' }, `${Math.round(s().controls.gamepadDeadzone * 100)}%`);
    return h(
      'div',
      null,
      optRow(
        'Mouse flying',
        'Mouse-aim: point where you want to go and the pilot follows. Direct: the mouse is the stick.',
        selectInput(
          [
            { value: 'mouse-aim', label: 'Mouse-aim' },
            { value: 'direct-stick', label: 'Direct stick' },
            { value: 'off', label: 'Off (keyboard / gamepad)' },
          ],
          s().controls.mouseMode,
          (v) => set((g) => (g.controls.mouseMode = v)),
          'Mouse flying',
        ),
      ),
      optRow('Invert pitch', 'Push forward to climb.', toggle(s().controls.invertPitch, (v) => set((g) => (g.controls.invertPitch = v)), 'Invert pitch')),
      optRow('Mouse sensitivity', null, [
        rangeInput({ min: 0.1, max: 3, step: 0.1, value: s().controls.mouseSensitivity, label: 'Mouse sensitivity', onInput: (v) => (set((g) => (g.controls.mouseSensitivity = v)), (sensVal.textContent = v.toFixed(1))) }),
        sensVal,
      ]),
      optRow('Gamepad', 'Use a connected controller in flight.', toggle(s().controls.gamepadEnabled, (v) => set((g) => (g.controls.gamepadEnabled = v)), 'Gamepad')),
      optRow('Stick dead zone', null, [
        rangeInput({ min: 0, max: 0.4, step: 0.01, value: s().controls.gamepadDeadzone, label: 'Dead zone', onInput: (v) => (set((g) => (g.controls.gamepadDeadzone = v)), (dzVal.textContent = `${Math.round(v * 100)}%`)) }),
        dzVal,
      ]),
    );
  };

  let stopListening: (() => void) | null = null;
  const keys = () => {
    const table = h('table', { class: 'ledger binding-table' });
    const paint = () => {
      const b = s().controls.keyBindings;
      const rows: HTMLElement[] = [];
      for (const g of ACTION_GROUPS) {
        rows.push(h('tr', null, h('td', { class: 'group-h', colspan: '3' }, g)));
        for (const a of ACTIONS.filter((x) => x.group === g)) {
          const codes = b[a.id] ?? [];
          const cap = (slot: number) => {
            const code = codes[slot];
            const dup = code ? findConflicts(b, code, a.id).length > 0 : false;
            return h(
              'button',
              {
                type: 'button',
                class: `keycap ${code ? '' : 'empty'} ${dup ? 'conflict' : ''}`,
                title: dup ? 'Also bound to another action' : 'Click, then press a key. Delete clears.',
                onClick: (e: Event) => listen(e.currentTarget as HTMLButtonElement, a.id, slot),
              },
              code ? codeLabel(code) : '—',
            );
          };
          rows.push(h('tr', null, h('td', null, a.label), h('td', null, cap(0)), h('td', null, cap(1))));
        }
      }
      setChildren(table, h('thead', null, h('tr', null, h('th', null, 'Action'), h('th', null, 'Primary'), h('th', null, 'Secondary'))), h('tbody', null, ...rows));
    };
    const listen = (btn: HTMLButtonElement, action: string, slot: number) => {
      stopListening?.();
      btn.classList.add('listening');
      btn.textContent = 'Press a key…';
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        finish();
        if (e.code === 'Escape') return paint();
        if (e.code === 'Delete' || e.code === 'Backspace') {
          set((g) => (g.controls.keyBindings = unbind(g.controls.keyBindings, action, slot)));
          return paint();
        }
        if (RESERVED_CODES.has(e.code)) {
          ctx.toast(`${codeLabel(e.code)} is reserved by the browser.`);
          return paint();
        }
        const conflicts = findConflicts(s().controls.keyBindings, e.code, action);
        set((g) => (g.controls.keyBindings = rebind(g.controls.keyBindings, action, slot, e.code, 'swap')));
        if (conflicts.length) ctx.toast(`${codeLabel(e.code)} moved from “${actionLabel(conflicts[0])}”.`);
        paint();
        requestAnimationFrame(() => (table.querySelectorAll('.keycap')[ACTIONS.findIndex((x) => x.id === action) * 2 + slot] as HTMLElement | undefined)?.focus());
      };
      const onDown = (e: MouseEvent) => {
        if (e.target !== btn) {
          finish();
          paint();
        }
      };
      const finish = () => {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('mousedown', onDown, true);
        stopListening = null;
      };
      stopListening = finish;
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onDown, true);
    };
    paint();
    return h(
      'div',
      null,
      h(
        'div',
        { class: 'presets' },
        h('span', { class: 'typed muted', style: 'font-size:.85em;flex:1' }, 'Click a key, then press the new key. Delete clears a slot; Esc cancels. Keys that collide are swapped.'),
        h(
          'button',
          {
            class: 'btn small',
            onClick: async () => {
              if (await ctx.confirm({ title: 'Restore default keys?', body: 'All key bindings return to the standard layout.', confirmLabel: 'Restore' })) {
                set((g) => (g.controls.keyBindings = structuredClone(DEFAULT_KEY_BINDINGS)));
                paint();
              }
            },
          },
          'Restore defaults',
        ),
      ),
      table,
    );
  };

  const tabs = folderTabs(
    [
      { id: 'realism', label: 'Realism', render: realism },
      { id: 'graphics', label: 'Graphics', render: graphics },
      { id: 'audio', label: 'Sound', render: audio },
      { id: 'controls', label: 'Controls', render: controls },
      { id: 'keys', label: 'Keys', render: keys },
    ],
    0,
    () => stopListening?.(),
  );
  shell.content.append(h('div', { class: 'options' }, tabs.bar, h('div', { class: 'paper' }, tabs.panel)));
  withHints(shell);
  return {
    el: shell.el,
    music: 'menu',
    onTab: (d) => tabs.step(d),
    dispose: () => stopListening?.(),
  };
};
