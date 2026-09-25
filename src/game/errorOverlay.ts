/**
 * Error surfaces (docs/game.md "Robustness"):
 *  - showFatalError: an unexpected error outside a flight. Offers "Return to
 *    menu" (remounts the UI via the registered recovery hook) and "Reload".
 *  - showFlightInterrupted: a flight stopped by an error. The session has
 *    already torn itself down and the UI is back; this card explains that the
 *    career was not changed.
 * Plain DOM with inline styles so it works even if the UI stylesheet failed.
 */

let recoverHook: (() => void) | null = null;

/** The app registers how to get back to a usable main menu. */
export function setRecoveryHandler(fn: (() => void) | null): void {
  recoverHook = fn;
}

function describe(err: unknown): { summary: string; details: string } {
  if (err instanceof Error) return { summary: err.message || err.name, details: err.stack ?? String(err) };
  return { summary: String(err), details: String(err) };
}

/** Browser noise that fires window 'error' but is not a failure of ours. */
export function isBenignError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/.test(msg);
}

const PANEL =
  'max-width:640px;margin:12vh auto 0;background:#f1e7cf;color:#2a2118;border:1px solid #6b5a3e;box-shadow:0 20px 60px rgba(0,0,0,.6);padding:28px 32px;font:15px/1.5 Georgia,"Iowan Old Style",serif';
const BTN =
  'font:600 14px Georgia,serif;padding:8px 18px;margin:18px 12px 0 0;border:1px solid #3b3022;background:#3b3022;color:#f1e7cf;cursor:pointer';
const BTN2 = BTN.replace('background:#3b3022;color:#f1e7cf', 'background:transparent;color:#3b3022');

function card(id: string, title: string, body: string, err: unknown, buttons: { label: string; primary?: boolean; onClick: (close: () => void) => void }[]): HTMLElement {
  document.getElementById(id)?.remove();
  const { summary, details } = describe(err);
  const root = document.createElement('div');
  root.id = id;
  root.setAttribute('role', 'alertdialog');
  root.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(12,8,6,.78);overflow:auto';
  const panel = document.createElement('div');
  panel.style.cssText = PANEL;
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.cssText = 'margin:0 0 10px;font:600 24px Georgia,serif;letter-spacing:.02em';
  const p = document.createElement('p');
  p.textContent = body;
  p.style.margin = '0 0 12px';
  const d = document.createElement('details');
  const s = document.createElement('summary');
  s.textContent = `Technical details: ${summary}`;
  s.style.cssText = 'cursor:pointer;font-size:13px;color:#5a4a34';
  const pre = document.createElement('pre');
  pre.textContent = details;
  pre.style.cssText = 'white-space:pre-wrap;font:12px ui-monospace,Menlo,monospace;max-height:30vh;overflow:auto;background:#e6dabd;padding:10px';
  d.append(s, pre);
  panel.append(h, p, d);
  const close = () => root.remove();
  for (const b of buttons) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = b.label;
    el.style.cssText = b.primary ? BTN : BTN2;
    el.addEventListener('click', () => b.onClick(close));
    panel.append(el);
  }
  root.append(panel);
  document.body.append(root);
  (panel.querySelector('button') as HTMLButtonElement | null)?.focus();
  return root;
}

export function showFatalError(err: unknown): void {
  console.error('[rb2] fatal', err);
  const buttons: { label: string; primary?: boolean; onClick: (close: () => void) => void }[] = [];
  if (recoverHook) {
    const hook = recoverHook;
    buttons.push({
      label: 'Return to menu',
      primary: true,
      onClick: (close) => {
        close();
        try {
          hook();
        } catch (e) {
          // Recovery itself failed: only a reload is left.
          card('rb-fatal', 'Something went badly wrong', 'The game could not recover. Reload the page to continue; saved careers are kept.', e, [
            { label: 'Reload', primary: true, onClick: () => location.reload() },
          ]);
        }
      },
    });
  }
  buttons.push({ label: 'Reload', primary: !recoverHook, onClick: () => location.reload() });
  card(
    'rb-fatal',
    'Red Baron II: Reloaded hit an error',
    'Something unexpected went wrong. Saved careers are kept: a career only changes when a debrief is recorded.',
    err,
    buttons,
  );
}

/** `phase` 'setup': the flight failed before take-off; 'flight': an error stopped it in the air. */
export function showFlightInterrupted(err: unknown, phase: 'setup' | 'flight' = 'flight'): void {
  card(
    'rb-flight-error',
    phase === 'setup' ? 'The flight could not start' : 'Flight interrupted',
    phase === 'setup'
      ? 'An error stopped the flight while it was being prepared. Nothing was recorded: your career is exactly as it was, and you can try the mission again.'
      : 'An error stopped the flight. Nothing was recorded: your career is exactly as it was before take-off, and you can fly the mission again.',
    err,
    [{ label: 'Return to menu', primary: true, onClick: (close) => close() }],
  );
}
