import type { ControlSettings } from '../core/types';
import { DEFENSE_FUZE } from '../data/airfieldDefense';
import { applyDeadzone, expo } from './input';
import type { PadLike } from './input';

export type DefensePad = PadLike & { index: number; id: string; connected: boolean; mapping: string };

function heldButtons(pad: PadLike): number {
  let held = 0;
  for (let i = 0; i < pad.buttons.length && i < 32; i++) {
    if (pad.buttons[i].pressed || pad.buttons[i].value > 0.4) held |= 1 << i;
  }
  return held;
}

/** One standard-mapping controller owns the battery until it disconnects.
 * Reuses its frame; held controls must return to neutral after ownership changes.
 */
export class DefenseGamepad {
  readonly frame = { connected: false, lost: false, fire: false, focus: false, yaw: 0, pitch: 0, station: 0, reload: false, range: false, pause: false, fuze: 0 };
  private index = -1;
  private id = '';
  private armed = false;
  private previous = 0;

  private clearFrame(): void {
    this.frame.fire = this.frame.focus = this.frame.reload = this.frame.range = this.frame.pause = false;
    this.frame.yaw = this.frame.pitch = this.frame.station = this.frame.fuze = 0;
  }

  reset(pad?: DefensePad): void {
    this.armed = false;
    this.clearFrame();
    // Overlay/connection callbacks can run before our RAF; consume their buttons.
    if (pad && this.owns(pad)) this.previous = heldButtons(pad);
  }

  owns(pad: Pick<DefensePad, 'index' | 'id'>): boolean {
    return pad.index === this.index && pad.id === this.id;
  }

  update(pads: readonly (DefensePad | null)[], controls: ControlSettings, dt: number): typeof this.frame {
    this.clearFrame();
    let pad: DefensePad | null = null;
    if (controls.gamepadEnabled) {
      for (const candidate of pads) {
        if (!candidate?.connected || candidate.mapping !== 'standard') continue;
        if (candidate.index === this.index && candidate.id === this.id) { pad = candidate; break; }
        if (!pad) pad = candidate;
      }
    }
    const changed = this.index !== (pad?.index ?? -1) || this.id !== (pad?.id ?? '');
    this.frame.lost = this.index >= 0 && changed;
    this.frame.connected = pad !== null;
    if (changed) {
      this.reset();
      this.index = pad?.index ?? -1;
      this.id = pad?.id ?? '';
    }
    if (!pad) return this.frame;
    const held = heldButtons(pad);
    const edges = changed ? 0 : held & ~this.previous;
    this.previous = held;
    // A fresh Menu press always works, including while fire awaits neutral.
    this.frame.pause = !!(edges & (1 << 9));
    if (!this.armed) {
      if (!held && Math.abs(pad.axes[0] ?? 0) <= controls.gamepadDeadzone && Math.abs(pad.axes[1] ?? 0) <= controls.gamepadDeadzone) this.armed = true;
      return this.frame;
    }
    this.frame.fire = !!(held & (1 << 7));
    this.frame.focus = !!(held & (1 << 6));
    const rate = 1.8 * dt * (this.frame.focus ? 0.35 : 1);
    this.frame.yaw = -expo(applyDeadzone(pad.axes[0] ?? 0, controls.gamepadDeadzone)) * rate;
    this.frame.pitch = -expo(applyDeadzone(pad.axes[1] ?? 0, controls.gamepadDeadzone)) * rate * (controls.invertPitch ? -1 : 1);
    this.frame.station = Number(!!(edges & (1 << 5))) - Number(!!(edges & (1 << 4)));
    this.frame.reload = !!(edges & (1 << 2));
    this.frame.range = !!(edges & (1 << 11));
    this.frame.fuze = (Number(!!(held & (1 << 12))) - Number(!!(held & (1 << 13)))) * DEFENSE_FUZE.step * 8 * dt;
    return this.frame;
  }
}
