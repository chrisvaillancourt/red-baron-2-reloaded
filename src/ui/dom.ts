/** Tiny DOM helpers: `h('div', { class: 'x', onClick }, ...children)`. */

export type Child = Node | string | number | null | undefined | false | Child[];

export interface Props {
  class?: string;
  style?: string | Record<string, string>;
  dataset?: Record<string, string>;
  [key: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

export function applyProps(el: HTMLElement, props: Props): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'style') {
      if (typeof value === 'string') el.style.cssText = value;
      else
        for (const [k, v] of Object.entries(value as Record<string, string>)) {
          if (k.startsWith('--')) el.style.setProperty(k, v);
          else (el.style as unknown as Record<string, string>)[k] = v;
        }
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'html') el.innerHTML = String(value);
    else if (value === true) el.setAttribute(key, '');
    else if (key in el && typeof value !== 'string') (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, String(value));
  }
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Parse an SVG/HTML string into an element. */
export function svg(markup: string, className?: string): Element {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  const el = tpl.content.firstElementChild!;
  if (className) el.setAttribute('class', `${el.getAttribute('class') ?? ''} ${className}`.trim());
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Base-URL-aware public asset path (vite `base: './'`). */
export function assetUrl(path: string): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? './';
  return `${base.endsWith('/') ? base : base + '/'}${path.replace(/^\//, '')}`;
}

/** Background layers: art image over a CSS fallback (a missing image leaves the fallback visible). */
export function artBackground(path: string, fallback: string): string {
  return `url("${assetUrl(path)}") center / cover no-repeat, ${fallback}`;
}

/** Replace an element's children (accepts the same children as `h`). */
export function setChildren(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, children);
}
