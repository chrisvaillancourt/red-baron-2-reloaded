/** Reusable UI building blocks. */
import { h, type Child } from './dom';

export interface ShellOptions {
  id: string;
  title: string;
  kicker?: string;
  /** Background CSS (use artBackground()). */
  background?: string;
  onBack?: () => void;
  backLabel?: string;
  headerExtra?: Child;
  hints?: [string, string][];
}

/** Standard screen frame: background, header with back button, content area and hint bar. */
export function screenShell(o: ShellOptions): { el: HTMLElement; content: HTMLElement } {
  const content = h('div', { class: 'rb-content' });
  const header = h(
    'header',
    { class: 'rb-header' },
    o.onBack && h('button', { class: 'btn light small', onClick: o.onBack, 'aria-label': 'Back' }, '← ', o.backLabel ?? 'Back'),
    h('div', null, o.kicker && h('div', { class: 'kicker' }, o.kicker), h('h1', null, o.title)),
    h('div', { class: 'spacer' }),
    o.headerExtra ?? null,
  );
  content.append(header);
  const el = h(
    'section',
    { class: `rb-screen scr-${o.id}`, dataset: { screen: o.id } },
    h('div', { class: 'rb-bg', style: o.background ? { background: o.background } : undefined }),
    content,
  );
  const hints = o.hints ?? [
    ['↑↓←→', 'Navigate'],
    ['Enter', 'Select'],
    ['Esc', 'Back'],
  ];
  // Appended by the caller after content via `withHints` so it sits at the bottom.
  (el as HTMLElement & { _hints?: HTMLElement })._hints = hintBar(hints);
  return { el, content };
}

export function withHints(shell: { el: HTMLElement; content: HTMLElement }): void {
  const hb = (shell.el as HTMLElement & { _hints?: HTMLElement })._hints;
  if (hb) shell.content.append(hb);
}

export function hintBar(hints: [string, string][]): HTMLElement {
  return h('footer', { class: 'rb-hints' }, ...hints.map(([k, v]) => h('span', null, h('kbd', null, k), v)));
}

export interface TabsSpec {
  id: string;
  label: string;
  render: () => HTMLElement;
}

/** Folder tabs over a paper panel. Returns the element and a `select` function. */
export function folderTabs(tabs: TabsSpec[], initial = 0, onChange?: (id: string) => void) {
  let index = Math.max(0, Math.min(initial, tabs.length - 1));
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { class: 'tab-panel', role: 'tabpanel' });
  const buttons = tabs.map((t, i) =>
    h('button', { class: 'tab', role: 'tab', 'aria-selected': String(i === index), onClick: () => select(i) }, t.label),
  );
  bar.append(...buttons);
  function select(i: number): void {
    index = (i + tabs.length) % tabs.length;
    buttons.forEach((b, j) => b.setAttribute('aria-selected', String(j === index)));
    panel.replaceChildren(tabs[index].render());
    panel.scrollTop = 0;
    onChange?.(tabs[index].id);
  }
  select(index);
  return {
    bar,
    panel,
    select,
    step(dir: -1 | 1) {
      select(index + dir);
      buttons[index].focus();
    },
    get current() {
      return tabs[index].id;
    },
    refresh() {
      select(index);
    },
  };
}

export function segmented<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const el = h('div', { class: 'seg', role: 'group' });
  const btns = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': String(o.value === value),
        onClick: () => {
          btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === o.value)));
          onChange(o.value);
        },
      },
      o.label,
    ),
  );
  el.append(...btns);
  return el;
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, label?: string): HTMLInputElement {
  return h('input', {
    type: 'checkbox',
    class: 'toggle',
    checked,
    'aria-label': label,
    onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
  });
}

export function rangeInput(opts: {
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (v: number) => void;
  label?: string;
}): HTMLInputElement {
  const el = h('input', {
    type: 'range',
    class: 'range',
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step),
    'aria-label': opts.label,
  });
  el.value = String(opts.value);
  const paint = () => el.style.setProperty('--p', `${((Number(el.value) - opts.min) / (opts.max - opts.min)) * 100}%`);
  paint();
  el.addEventListener('input', () => {
    paint();
    opts.onInput(Number(el.value));
  });
  return el;
}

export function optRow(name: string, desc: string | null, control: Child): HTMLElement {
  return h('div', { class: 'opt-row' }, h('div', { class: 'o-name' }, name), desc && h('div', { class: 'o-desc' }, desc), h('div', { class: 'o-ctl' }, control));
}

export function selectInput<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void, label?: string): HTMLSelectElement {
  const el = h('select', { class: 'input', 'aria-label': label, onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value as T) });
  for (const o of options) el.append(h('option', { value: o.value }, o.label));
  el.value = value;
  return el;
}

export function stamp(text: string, variant: '' | 'blue' | 'green' = '', extra = ''): HTMLElement {
  return h('span', { class: `stamp ${variant} ${extra}`.trim() }, text);
}

export function statBox(value: Child, key: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'v' }, value), h('div', { class: 'k' }, key));
}
