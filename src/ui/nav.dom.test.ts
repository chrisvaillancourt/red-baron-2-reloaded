import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createNav, focusables, type Nav } from './nav';

let root: HTMLElement | null = null;
let nav: Nav | null = null;

function mount(html: string): HTMLElement {
  root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  nav?.dispose();
  nav = null;
  root?.remove();
  root = null;
});

describe('nav in a real layout engine', () => {
  it('lists only controls that are laid out, visible and enabled', () => {
    const scope = mount(`
      <button id="shown">Shown</button>
      <button id="hidden" hidden>Hidden</button>
      <button id="zero" style="display:inline-block;width:0;height:0;padding:0;border:0">Zero</button>
      <button id="invisible" style="visibility:hidden">Invisible</button>
      <button id="disabled" disabled>Disabled</button>
      <div id="skip" tabindex="-1">Skipped</div>
      <div id="tabbable" tabindex="0">Tabbable</div>`);
    expect(focusables(scope).map(e => e.id)).toEqual(['shown', 'tabbable']);
  });

  it('moves focus spatially with the arrow keys', async () => {
    const scope = mount(`
      <div style="display:grid;grid-template-columns:120px 120px;gap:20px">
        <button id="a">A</button><button id="b">B</button>
        <button id="c">C</button><button id="d">D</button>
      </div>`);
    nav = createNav({ scope: () => scope, onBack: () => {}, onTab: () => {} });
    scope.querySelector<HTMLButtonElement>('#a')!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement?.id).toBe('b');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.id).toBe('d');
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement?.id).toBe('c');
  });
});
