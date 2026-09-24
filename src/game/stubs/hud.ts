/**
 * STUB HUD: plain HTML readouts, gun sight, contact boxes, off-screen arrows,
 * padlock marker, mouse-aim reticle and a radio log. Replaced by src/ui HUD.
 */
import type { GameSettings } from '../../core/types';
import type { HudFrame } from '../hudView';
import type { HudHandle } from '../moduleTypes';

export function stubCreateHud(container: HTMLElement, _settings: GameSettings): HudHandle {
  const root = document.createElement('div');
  root.className = 'rb-hud';
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;font:13px/1.35 ui-monospace,Menlo,monospace;color:#f4ecd8;text-shadow:0 1px 2px #000;overflow:hidden';
  const readout = document.createElement('div');
  readout.style.cssText = 'position:absolute;left:12px;bottom:12px;background:rgba(20,16,10,.55);padding:8px 10px;border-radius:4px;white-space:pre';
  const log = document.createElement('div');
  log.style.cssText = 'position:absolute;left:12px;top:12px;max-width:50%';
  const contacts = document.createElement('div');
  contacts.style.cssText = 'position:absolute;inset:0';
  const sight = document.createElement('div');
  sight.style.cssText = 'position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px;border:1px solid rgba(255,240,200,.6);border-radius:50%';
  const reticle = document.createElement('div');
  reticle.style.cssText = 'position:absolute;width:22px;height:22px;margin:-11px;border:2px solid rgba(255,255,255,.8);border-radius:50%;display:none';
  const nose = document.createElement('div');
  nose.style.cssText = 'position:absolute;width:10px;height:10px;margin:-5px;border:2px solid rgba(255,220,120,.9);display:none';
  const status = document.createElement('div');
  status.style.cssText = 'position:absolute;right:12px;top:12px;text-align:right';
  const vignette = document.createElement('div');
  vignette.style.cssText = 'position:absolute;inset:0;opacity:0';
  root.append(vignette, contacts, sight, reticle, nose, readout, log, status);
  container.appendChild(root);
  const messages: { text: string; t: number }[] = [];
  const pool: HTMLDivElement[] = [];

  const toPx = (x: number, y: number) => ({ left: ((x + 1) / 2) * root.clientWidth, top: ((1 - y) / 2) * root.clientHeight });

  return {
    update(f: HudFrame) {
      const imp = f.units === 'imperial';
      const spd = imp ? `${(f.airspeedKmh / 1.609).toFixed(0)} mph` : `${f.airspeedKmh.toFixed(0)} km/h`;
      const alt = imp ? `${(f.altitudeM * 3.281).toFixed(0)} ft` : `${f.altitudeM.toFixed(0)} m`;
      const guns = f.guns
        .map((g) => `${g.type}:${Number.isFinite(g.rounds) ? g.rounds : '∞'}${g.jammed ? ' JAM' : ''}${g.reloading ? ' DRUM' : ''}`)
        .join('  ');
      readout.textContent =
        `${f.aircraftName}\nSPD ${spd}  ALT ${alt}  HDG ${f.headingDeg.toFixed(0).padStart(3, '0')}\n` +
        `RPM ${f.rpm.toFixed(0)}  THR ${(f.throttle * 100).toFixed(0)}%  G ${f.gLoad.toFixed(1)}${f.stalled ? '  STALL' : ''}${f.blip ? '  BLIP' : ''}\n` +
        `${guns}${f.engineDead ? '\nENGINE DEAD' : ''}${f.onFire ? '\nFIRE!' : ''}${f.pilotWounded ? '\nWOUNDED' : ''}`;
      status.textContent = `${fmtTime(f.missionTime)}  x${f.timeScale}  ${f.cameraMode}${f.paused ? '  PAUSED' : ''}${f.overFriendly ? '' : '  (enemy lines)'}`;
      sight.style.display = f.cameraMode === 'cockpit' || f.cameraMode === 'padlock' ? 'block' : 'none';
      const show = (el: HTMLElement, p: { x: number; y: number } | null) => {
        if (!p) {
          el.style.display = 'none';
          return;
        }
        const px = toPx(p.x, p.y);
        el.style.display = 'block';
        el.style.left = `${px.left}px`;
        el.style.top = `${px.top}px`;
      };
      show(reticle, f.aimReticle);
      show(nose, f.noseMarker);
      let n = 0;
      for (const c of f.contacts) {
        if (c.destroyed || (!f.showLabels && !c.isPadlocked)) continue;
        const el = pool[n] ?? (pool[n] = contacts.appendChild(document.createElement('div')));
        n++;
        const col = c.side === 'central' ? '#ff9a7a' : '#9ad0ff';
        if (c.onScreen) {
          const px = toPx(c.ndcX, c.ndcY);
          el.style.cssText = `position:absolute;left:${px.left}px;top:${px.top}px;transform:translate(-50%,-50%);border:1px solid ${col};padding:10px 10px 0;color:${col};font-size:11px;white-space:nowrap${c.isPadlocked ? ';border-width:2px' : ''}`;
          el.textContent = `${c.label} ${(c.distance / 1000).toFixed(1)}km`;
        } else {
          const r = Math.min(root.clientWidth, root.clientHeight) * 0.42;
          const left = root.clientWidth / 2 + Math.sin(c.arrowAngle) * r;
          const top = root.clientHeight / 2 - Math.cos(c.arrowAngle) * r;
          el.style.cssText = `position:absolute;left:${left}px;top:${top}px;transform:translate(-50%,-50%) rotate(${c.arrowAngle}rad);color:${col};font-size:${c.isPadlocked ? 22 : 14}px`;
          el.textContent = '▲';
        }
      }
      for (let i = n; i < pool.length; i++) pool[i].style.display = 'none';
      const g = f.gEffect;
      vignette.style.background = g >= 0 ? 'radial-gradient(circle, transparent 30%, #000 90%)' : 'radial-gradient(circle, transparent 30%, #900 90%)';
      vignette.style.opacity = String(Math.min(1, Math.abs(g)));
      const now = performance.now();
      while (messages.length && now - messages[0].t > 8000) messages.shift();
      log.innerHTML = '';
      for (const m of messages.slice(-6)) {
        const d = document.createElement('div');
        d.textContent = m.text;
        log.appendChild(d);
      }
      if (f.padlock && f.padlockObstructed) status.textContent += '  [padlock obstructed]';
    },
    showMessage(text, from) {
      messages.push({ text: from ? `${from}: ${text}` : text, t: performance.now() });
    },
    setVisible(v) {
      root.style.display = v ? 'block' : 'none';
    },
    dispose() {
      root.remove();
    },
  };
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
