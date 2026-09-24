/**
 * Game-owned in-flight overlays: pause menu (resume / end flight / abandon)
 * and a tactical map. Kept in src/game so flight control never depends on
 * the HUD implementation.
 */
import type { AircraftEntity } from '../core/types';
import { worldToLatLon } from '../core/geo';
import { aerodromesActiveOn } from '../data/aerodromes';
import { TOWNS } from '../data/geography';
import { latLonToWorld } from '../core/geo';
import { frontLineAt } from '../world/frontline';
import type { SessionWorld } from './world';

export interface PauseMenuHandlers {
  onResume(): void;
  onEndFlight(): void;
  onAbandon(): void;
}

export class PauseOverlay {
  readonly el: HTMLDivElement;
  private note: HTMLDivElement;

  constructor(parent: HTMLElement, h: PauseMenuHandlers) {
    this.el = document.createElement('div');
    this.el.className = 'rb-pause';
    this.el.style.cssText =
      'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(10,8,5,.55);font:16px Georgia,serif;color:#efe6cf;z-index:10';
    this.el.innerHTML = `
      <div style="background:#2a241a;border:1px solid #6b5a3a;padding:22px 28px;min-width:280px;text-align:center">
        <div style="letter-spacing:.1em;margin-bottom:14px">PAUSED</div>
        <button data-act="resume">Resume</button><br>
        <button data-act="end">End flight</button><br>
        <button data-act="abandon">Abandon mission</button>
        <div class="note" style="font-size:13px;opacity:.8;margin-top:10px;max-width:260px"></div>
        <div style="font-size:12px;opacity:.6;margin-top:12px">Esc resume · N end flight · M map · F1–F5 views · T target · P padlock</div>
      </div>`;
    this.el.querySelectorAll('button').forEach((b) => {
      b.style.cssText = 'font:inherit;margin:4px;padding:6px 14px;min-width:180px;background:#3b3224;color:#efe6cf;border:1px solid #6b5a3a;cursor:pointer';
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'resume') h.onResume();
        else if (act === 'end') h.onEndFlight();
        else h.onAbandon();
      });
    });
    this.note = this.el.querySelector('.note')!;
    parent.appendChild(this.el);
  }

  show(visible: boolean, note = ''): void {
    this.el.style.display = visible ? 'flex' : 'none';
    this.note.textContent = note;
  }

  setNote(note: string): void {
    this.note.textContent = note;
  }

  dispose(): void {
    this.el.remove();
  }
}

/** Simple top-down tactical map around the player. */
export class MapOverlay {
  readonly canvas: HTMLCanvasElement;
  visible = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 640;
    this.canvas.style.cssText =
      'position:absolute;left:50%;top:50%;width:min(80vmin,640px);height:min(80vmin,640px);transform:translate(-50%,-50%);display:none;border:2px solid #6b5a3a;z-index:5;pointer-events:none';
    parent.appendChild(this.canvas);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
  }

  draw(world: SessionWorld, player: AircraftEntity | null): void {
    if (!this.visible) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const W = this.canvas.width;
    const range = 30000; // metres from centre to edge
    const cx = player?.state.position.x ?? 0;
    const cz = player?.state.position.z ?? 0;
    const sx = (x: number) => W / 2 + ((x - cx) / range) * (W / 2);
    const sz = (z: number) => W / 2 + ((z - cz) / range) * (W / 2);
    ctx.fillStyle = '#d9cba6';
    ctx.fillRect(0, 0, W, W);
    ctx.font = '11px Georgia';
    ctx.fillStyle = '#5a4a30';
    for (const t of TOWNS) {
      const p = latLonToWorld(t.lat, t.lon);
      ctx.fillRect(sx(p.x) - 2, sz(p.z) - 2, 4, 4);
      ctx.fillText(t.name, sx(p.x) + 4, sz(p.z) - 3);
    }
    for (const a of aerodromesActiveOn(world.date)) {
      ctx.strokeStyle = a.side === 'allied' ? '#2a4a8a' : '#8a2a2a';
      ctx.strokeRect(sx(a.x) - 4, sz(a.z) - 4, 8, 8);
    }
    ctx.strokeStyle = '#7a3a2a';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    frontLineAt(world.date).points.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sz(p.z)) : ctx.moveTo(sx(p.x), sz(p.z))));
    ctx.stroke();
    ctx.setLineDash([]);
    if (player) {
      const f = world.getFlight(player.flightId);
      if (f) {
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx(cx), sz(cz));
        for (const wp of f.waypoints) ctx.lineTo(sx(wp.x), sz(wp.z));
        ctx.stroke();
      }
    }
    for (const a of world.aircraft) {
      if (a.outcome !== null) continue;
      const friendly = player && a.side === player.side;
      const near = player && a.state.position.distanceTo(player.state.position) < 6000;
      if (!friendly && !near) continue;
      ctx.fillStyle = a === player ? '#000' : friendly ? '#2a4a8a' : '#aa2a2a';
      ctx.beginPath();
      ctx.arc(sx(a.state.position.x), sz(a.state.position.z), a === player ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of world.balloons) {
      ctx.fillStyle = b.destroyed ? '#777' : b.side === 'central' ? '#aa2a2a' : '#2a4a8a';
      ctx.fillText('◉', sx(b.position.x) - 4, sz(b.position.z) + 4);
    }
    const ll = worldToLatLon(cx, cz);
    ctx.fillStyle = '#333';
    ctx.fillText(`${ll.lat.toFixed(3)}°N ${ll.lon.toFixed(3)}°E · ${world.date}`, 8, W - 8);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
