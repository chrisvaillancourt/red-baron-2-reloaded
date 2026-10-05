import { Vector3 } from 'three';
import type { AudioEngine } from '../core/interfaces';
import type { DefenseEvent, DefenseInput, DefenseLauncher, DefenseOptions, DefensePurchase, DefenseResult, DefenseSimulation, DefenseState, DefenseThreat, DefenseWeaponId } from '../core/defense';
import type { GameSettings } from '../core/types';
import type { DefensePresentation } from '../render/defensePresentation';
import { DEFENSE_FUZE } from '../data/airfieldDefense';
import { createDefenseScene } from '../render/airfieldDefense';
import { createAirfieldDefense } from '../sim/airfieldDefense';
import { h } from '../ui/dom';
import { createNav, type Nav } from '../ui/nav';
import { getActiveFlight } from './activeFlight';
import { getActiveDefense, setActiveDefense } from './activeDefense';
import { DefenseGamepad } from './defenseGamepad';
import './defenseSession.css';
import { getErrorOverlay } from './errorOverlay';

const STEP = 1 / 60;
const WEAPONS: readonly DefenseWeaponId[] = ['mg', 'cannon', 'flak'];
const NO_PADS: readonly (Gamepad | null)[] = [];
const RAID_NAMES = ['First contact', 'Low-level attack', 'Bomber formation', 'Heavy raid', 'Hold the line'];
const setText = (el: HTMLElement, text: string) => { if (el.textContent !== text) el.textContent = text; };

export interface DefenseDebug {
  readonly state: DefenseState;
  readonly paused: boolean;
  readonly aim: DefenseInput;
  readonly scene: DefensePresentation | null;
}
declare global { interface Window { __rb2Defense?: DefenseDebug; } }

export function createDefenseLauncher(audio: AudioEngine): DefenseLauncher {
  return {
    defend(options, settings, container) {
      if (getActiveDefense() || getActiveFlight()) return Promise.reject(new Error('Another combat session is active'));
      return new BatterySession(options, settings, container, audio).run();
    },
  };
}

class BatterySession implements DefenseDebug {
  private readonly simulation: DefenseSimulation;
  readonly aim: DefenseInput = { origin: new Vector3(0, 4, 0), direction: new Vector3(0, 0, -1), fire: false };
  scene: DefensePresentation | null = null;
  paused = true;
  private disposed = false;
  private raf = 0;
  private previousTime = 0;
  private accumulator = 0;
  private yaw = 0;
  private pitch = 0.18;
  private focused = false;
  private mouseFire = false;
  private pointerCaptured = false;
  private readonly keys = new Set<string>();
  private readonly fireKeys: readonly string[];
  private readonly pauseKeys: readonly string[];
  private readonly gamepad = new DefenseGamepad();
  private readonly commandNav: Nav;
  private controllerResume: HTMLButtonElement | null = null;
  private target: DefenseThreat | null = null;
  private readonly point = new Vector3();
  private readonly lead = new Vector3();
  private readonly audioPosition = new Vector3();
  private readonly reticlePoint = new Vector3();
  private readonly direction = new Vector3();
  private resolve!: (result: DefenseResult) => void;
  private reject!: (error: unknown) => void;
  private readonly events = new AbortController();
  private observer: ResizeObserver | null = null;
  private readonly canvas = h('canvas', { class: 'defense-canvas', tabIndex: 0, 'aria-label': 'Airfield defense gun station. Mouse or left stick turns gun, left button or RT fires, right button or LT focuses.' }) as HTMLCanvasElement;
  private readonly headline = h('strong');
  private readonly score = h('span');
  private readonly targetInfo = h('span', { class: 'defense-target-info' });
  private readonly fuzeLabel = h('output');
  private readonly fuzeInput: HTMLInputElement;
  private readonly leadMarker = h('div', { class: 'defense-lead', 'aria-hidden': 'true', hidden: true });
  private readonly targetMarker = h('div', { class: 'defense-target', 'aria-hidden': 'true', hidden: true });
  private readonly overlay = h('section', { class: 'defense-overlay', 'aria-label': 'Battery command' });
  private readonly assetViews: { label: HTMLElement; meter: HTMLMeterElement }[] = [];
  private readonly weaponViews: { button: HTMLButtonElement; status: HTMLElement; meter: HTMLMeterElement }[] = [];
  private readonly root: HTMLElement;
  private lastOverlay = '';
  private hitUntil = 0;
  private readonly hitMarker = h('div', { class: 'defense-hit-marker', 'aria-hidden': 'true', hidden: true }, '×');

  get state(): DefenseState { return this.simulation.state; }

  constructor(options: DefenseOptions, private readonly settings: GameSettings, private readonly container: HTMLElement, private readonly audio: AudioEngine) {
    this.simulation = createAirfieldDefense(options);
    this.fireKeys = settings.controls.keyBindings.fire ?? ['Space'];
    this.pauseKeys = settings.controls.keyBindings.pause ?? ['Escape'];
    const pause = h('button', { type: 'button', class: 'btn light small', onClick: () => this.pause() }, 'Pause · Esc / Menu');
    const header = h('header', { class: 'defense-header' }, h('div', null, h('small', null, 'AIRFIELD DEFENSE · BERTANGLES'), this.headline), this.score, pause);
    const assets = h('div', { class: 'defense-objectives' });
    for (const asset of this.state.assets) {
      const label = h('span');
      const meter = h('meter', { min: 0, max: asset.maxHealth, value: asset.health, 'aria-label': `${asset.name} condition` }) as HTMLMeterElement;
      assets.append(h('div', null, label, meter));
      this.assetViews.push({ label, meter });
    }
    const stations = h('div', { class: 'defense-stations' });
    WEAPONS.forEach((id, index) => {
      const gun = this.state.weapons[id];
      const status = h('span', { class: 'defense-weapon-status' });
      const meter = h('meter', { min: 0, max: 1, value: 0, 'aria-label': `${gun.name} barrel heat` }) as HTMLMeterElement;
      const button = h('button', { class: 'defense-station', type: 'button', 'aria-pressed': 'false', onClick: () => this.select(id) }, h('strong', null, `${index + 1} · ${gun.name}`), status, meter) as HTMLButtonElement;
      stations.append(button);
      this.weaponViews.push({ button, status, meter });
    });
    this.fuzeInput = h('input', { type: 'range', min: DEFENSE_FUZE.minimum, max: DEFENSE_FUZE.maximum, step: DEFENSE_FUZE.step, value: this.state.fuzeRange, 'aria-label': 'Flak airburst distance', onInput: (event: Event) => this.simulation.setFuzeRange(Number((event.target as HTMLInputElement).value)) });
    const reload = h('button', { type: 'button', class: 'btn light small', onClick: () => this.simulation.reload() }, 'Reload · R / X');
    const range = h('button', { type: 'button', class: 'btn light small', onClick: () => this.rangeTarget() }, 'Range target · F / R3');
    this.root = h('div', { class: 'rb-ui defense-session' }, this.canvas, header, assets,
      h('div', { class: 'defense-reticle', 'aria-hidden': 'true' }), this.leadMarker, this.targetMarker, this.hitMarker,
      h('div', { class: 'defense-bottom' }, this.targetInfo, h('label', { class: 'defense-fuze' }, 'Flak fuze ', this.fuzeLabel, this.fuzeInput, range, reload), stations,
        h('small', null, 'Mouse / Arrows: aim · Left / fire binding: fire · Right: focus · 1 / 2 / 3: station · R: reload · Wheel / F: fuze · Esc: pause'),
        h('small', null, 'Xbox: left stick aim · RT fire · LT focus · LB / RB stations · X reload · R3 range · D-pad ↑ / ↓ fuze · Menu pause / return · A select · B close pause')),
      this.overlay);
    this.commandNav = createNav({
      scope: () => getErrorOverlay() ?? (this.overlay.hidden ? null : this.overlay),
      onBack: () => { if (this.paused) this.resume(true); },
      onTab: () => {},
      gamepadEnabled: () => this.settings.controls.gamepadEnabled,
      gamepadAllowed: pad => pad.mapping === 'standard' && (!this.scene || this.gamepad.owns(pad)),
      keyboardBack: false,
    });
    this.commandNav.setActive(false);
  }

  run(): Promise<DefenseResult> {
    const promise = new Promise<DefenseResult>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    setActiveDefense(this);
    this.container.append(this.root);
    if (import.meta.env.DEV) window.__rb2Defense = this;
    this.showPause('Preparing the airfield…', true);
    void this.prepare().catch((error: unknown) => this.abort(error));
    return promise;
  }

  private async prepare(): Promise<void> {
    const scene = await createDefenseScene(this.canvas, this.settings, this.events.signal);
    if (this.disposed) { scene.dispose(); return; }
    this.scene = scene;
    this.bindInput();
    const resize = () => {
      const { width, height } = this.root.getBoundingClientRect();
      scene.resize(Math.max(1, width), Math.max(1, height));
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(this.root);
    resize();
    scene.setView(this.yaw, this.pitch, false, this.state.selected, this.state.fuzeRange);
    scene.getAim(this.aim);
    scene.update(this.state, [], 0);
    this.updateHud();
    this.gamepad.update(this.readGamepads(), this.settings.controls, 0);
    this.showPause('Battery ready. Man the guns.');
    this.raf = requestAnimationFrame(this.frame);
  }

  private bindInput(): void {
    const signal = this.events.signal;
    const listen = <K extends keyof WindowEventMap>(type: K, fn: (event: WindowEventMap[K]) => void) => window.addEventListener(type, fn, { signal });
    listen('keydown', (event) => {
      if (this.disposed || event.defaultPrevented) return;
      if (event.code === 'Escape' || this.pauseKeys.includes(event.code)) { event.preventDefault(); this.pause(); return; }
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) return;
      if (this.paused || this.state.phase !== 'raid' || getErrorOverlay()) return;
      if (event.code.startsWith('Arrow') || this.fireKeys.includes(event.code)) event.preventDefault();
      if (!event.repeat) {
        const weapon = ({ Digit1: 'mg', Digit2: 'cannon', Digit3: 'flak' } as const)[event.code as 'Digit1' | 'Digit2' | 'Digit3'];
        if (weapon) this.select(weapon);
        if (event.code === 'KeyR') this.simulation.reload();
        if (event.code === 'KeyF') this.rangeTarget();
      }
      // Station changes clear old held input, not this newly pressed fire binding.
      this.keys.add(event.code);
    });
    listen('keyup', (event) => this.keys.delete(event.code));
    listen('blur', () => this.pause());
    listen('gamepaddisconnected', event => { if (this.gamepad.owns(event.gamepad)) this.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }, { signal });
    document.addEventListener('pointerlockchange', () => {
      const captured = document.pointerLockElement === this.canvas;
      if (captured) {
        this.pointerCaptured = true;
        this.paused = false;
        this.commandNav.setActive(false);
        this.gamepad.reset();
        this.lastOverlay = '';
        this.overlay.hidden = true;
        this.accumulator = 0;
        this.canvas.focus();
      } else if (this.pointerCaptured) {
        this.pointerCaptured = false;
        this.pause();
      }
    }, { signal });
    this.canvas.addEventListener('mousemove', (event) => {
      if (this.paused || document.pointerLockElement !== this.canvas) return;
      this.turn(event.movementX, event.movementY);
    }, { signal });
    // Each edge of a mouse-button chord is reported by mouse events, not pointer events.
    this.canvas.addEventListener('mousedown', (event) => {
      if (this.paused || this.state.phase !== 'raid') return;
      if (event.button === 0) this.mouseFire = true;
      if (event.button === 2) this.focused = true;
      event.preventDefault();
    }, { signal });
    listen('mouseup', (event) => {
      if (event.button === 0) this.mouseFire = false;
      if (event.button === 2) this.focused = false;
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    this.canvas.addEventListener('wheel', (event) => {
      if (this.paused || this.state.phase !== 'raid') return;
      event.preventDefault();
      this.simulation.setFuzeRange(this.state.fuzeRange + (event.deltaY > 0 ? DEFENSE_FUZE.step : -DEFENSE_FUZE.step));
    }, { passive: false, signal });
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.abort(new Error('Graphics context lost during airfield defense. Please start a new defense.'));
    }, { signal });
  }

  private turn(x: number, y: number): void {
    const sensitivity = this.settings.controls.mouseSensitivity * (this.focused || this.gamepad.frame.focus ? 0.0013 : 0.0022);
    this.yaw -= x * sensitivity;
    this.pitch = Math.max(-0.12, Math.min(1.42, this.pitch - y * sensitivity * (this.settings.controls.invertPitch ? -1 : 1)));
  }

  private select(id: DefenseWeaponId): void {
    this.mouseFire = false;
    this.keys.clear();
    this.gamepad.reset();
    this.simulation.selectWeapon(id);
    this.updateHud();
  }

  private rangeTarget(): void {
    if (this.target) this.simulation.setFuzeRange(this.target.position.distanceTo(this.aim.origin));
    this.updateHud();
  }

  private releaseMouse(): void {
    this.pointerCaptured = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private clearInput(): void {
    this.keys.clear();
    this.mouseFire = false;
    this.focused = false;
    this.aim.fire = false;
    this.accumulator = 0;
    this.gamepad.reset();
  }

  private pause(): void {
    if (this.disposed || this.state.phase !== 'raid') return;
    this.paused = true;
    this.clearInput();
    this.releaseMouse();
    this.audio.stopFlight();
    this.showPause('Cease fire. The raid is paused.');
  }

  private resume(withoutMouse = false): void {
    if (this.disposed || !this.scene || this.state.phase !== 'raid' || getErrorOverlay()) return;
    this.clearInput();
    void this.audio.resume();
    this.audio.playMusic('flight');
    if (withoutMouse) {
      this.releaseMouse();
      this.commandNav.setActive(false);
      this.paused = false;
      this.overlay.hidden = true;
      this.lastOverlay = '';
      this.canvas.focus();
    } else {
      void this.canvas.requestPointerLock?.()?.catch?.(() => {
        if (!this.disposed) {
          this.paused = true;
          this.clearInput();
          this.showPause('Mouse capture failed. Click Return to the guns to retry, or use keyboard controls.');
        }
      });
    }
  }

  private showPause(message: string, preparing = false): void {
    this.overlay.hidden = false;
    if (this.lastOverlay === message) return;
    this.lastOverlay = message;
    this.controllerResume = h('button', { class: 'btn', type: 'button', disabled: preparing || !this.gamepad.frame.connected, onClick: () => this.resume(true) }, 'Use controller') as HTMLButtonElement;
    const resume = h('button', { class: 'btn primary', type: 'button', disabled: preparing, onClick: () => this.resume() }, 'Return to the guns');
    const keyboard = h('button', { class: 'btn', type: 'button', disabled: preparing, onClick: () => this.resume(true) }, 'Use keyboard controls');
    const leave = h('button', { class: 'btn', type: 'button', onClick: () => { this.simulation.abort(); this.finish(); } }, 'Abandon defense');
    this.overlay.replaceChildren(h('div', { class: 'paper defense-command' }, h('div', { class: 'kicker' }, 'BATTERY COMMAND'), h('h1', null, preparing ? 'Preparing the airfield' : 'Man the guns'), h('p', null, message),
      h('p', null, 'Mouse turns the gun and view together. Left button fires; right button focuses. Arrows turn the gun in keyboard mode; your fire binding shoots.'),
      h('p', { class: 'muted' }, 'Changing stations: 1 / 2 / 3. Reload: R. Timed flak: wheel / F. Escape pauses and releases the mouse.'),
      h('p', { class: 'muted' }, 'Xbox: left stick aims, RT fires, LT focuses, LB / RB change guns, X reloads, clicking the right stick ranges, D-pad up / down adjusts fuze. Menu pauses / returns. A selects; B closes pause. Release controls after handoffs.'),
      h('div', { class: 'actions' }, resume, keyboard, this.controllerResume, leave)));
    this.commandNav.setActive(false);
    this.commandNav.setActive(true);
    if (!preparing) this.commandNav.focusFirst(this.gamepad.frame.connected ? this.controllerResume : resume);
  }

  private showResupply(): void {
    this.paused = true;
    this.clearInput();
    this.releaseMouse();
    this.audio.stopFlight();
    this.audio.playMusic('briefing');
    this.overlay.hidden = false;
    this.lastOverlay = 'resupply';
    this.controllerResume = null;
    const panel = h('div', { class: 'paper defense-command' }, h('div', { class: 'kicker' }, 'BATTERY COMMAND · RESUPPLY'), h('h1', null, `Raid ${this.state.raid} survived`),
      h('p', null, `${Math.floor(this.state.credits)} requisition. Repair the airfield or improve the battery before the next attack.`));
    const purchases = h('div', { class: 'defense-purchases' });
    const add = (purchase: DefensePurchase, label: string) => {
      const cost = this.simulation.purchaseCost(purchase);
      purchases.append(h('button', { class: 'btn', type: 'button', disabled: cost === null || this.state.credits < cost, onClick: () => {
        this.simulation.buy(purchase);
        this.updateHud();
        this.showResupply();
      } }, label, cost === null ? ' · complete' : ` · ${cost} req`));
    };
    for (const asset of this.state.assets) add({ kind: 'repair', assetId: asset.id }, `${asset.health <= 0 ? 'Rebuild' : 'Repair'} ${asset.name} (${Math.round(asset.health / asset.maxHealth * 100)}%)`);
    for (const [id, name] of [['power', 'Gun power'], ['cooling', 'Barrel cooling'], ['reload', 'Reload drill']] as const) add({ kind: 'upgrade', upgradeId: id }, `${name} · level ${this.state.upgrades[id]}`);
    const advance = h('button', { type: 'button', class: 'btn primary', onClick: () => {
      this.simulation.advance();
      this.updateHud();
      this.showPause('The next raid is approaching. Return to your gun station.');
    } }, 'Next raid');
    const abandon = h('button', { type: 'button', class: 'btn', onClick: () => { this.simulation.abort(); this.finish(); } }, 'Abandon defense');
    panel.append(purchases, h('p', { class: 'muted' }, 'HQ protects requisition income. The depot speeds reloads. The hospital repairs surviving assets after raids. Repairs can rebuild a destroyed asset.'), h('div', { class: 'actions' }, advance, abandon));
    this.overlay.replaceChildren(panel);
    this.commandNav.setActive(false);
    this.commandNav.setActive(true);
    this.commandNav.focusFirst(advance);
  }

  private readGamepads(): readonly (Gamepad | null)[] {
    return !document.hidden && document.hasFocus() ? navigator.getGamepads?.() ?? NO_PADS : NO_PADS;
  }

  private readonly frame = (now: number): void => {
    if (this.disposed || !this.scene) return;
    try {
      const dt = this.previousTime ? Math.min(0.1, Math.max(0, (now - this.previousTime) / 1000)) : 0;
      this.previousTime = now;
      const wasConnected = this.gamepad.frame.connected;
      const pad = this.gamepad.update(this.readGamepads(), this.settings.controls, dt);
      const errorOverlay = getErrorOverlay();
      if (this.controllerResume) {
        this.controllerResume.disabled = !pad.connected;
        if (pad.connected && !wasConnected && this.paused) this.commandNav.focusFirst(this.controllerResume);
      }
      if ((pad.lost || errorOverlay) && !this.paused) this.pause();
      else if (pad.pause && this.state.phase === 'raid' && !errorOverlay) {
        if (this.paused) this.resume(true);
        else this.pause();
      }
      if (!this.paused && this.state.phase === 'raid') {
        if (pad.station) this.select(WEAPONS[(WEAPONS.indexOf(this.state.selected) + pad.station + WEAPONS.length) % WEAPONS.length]);
        if (pad.reload) this.simulation.reload();
        if (pad.range) this.rangeTarget();
        if (pad.fuze) this.simulation.setFuzeRange(this.state.fuzeRange + pad.fuze);
      }
      const focused = this.focused || pad.focus;
      const running = !this.paused && this.state.phase === 'raid';
      if (running) {
        const speed = (focused ? 0.35 : 0.75) * dt;
        this.yaw += pad.yaw + (Number(this.keys.has('ArrowLeft')) - Number(this.keys.has('ArrowRight'))) * speed;
        this.pitch = Math.max(-0.12, Math.min(1.42, this.pitch + pad.pitch + (Number(this.keys.has('ArrowUp')) - Number(this.keys.has('ArrowDown'))) * speed));
      }
      this.scene.setView(this.yaw, this.pitch, focused, this.state.selected, this.state.fuzeRange);
      this.scene.getAim(this.aim);
      this.aim.fire = running && (pad.fire || this.mouseFire || this.fireKeys.some((code) => this.keys.has(code)));
      if (running) {
        this.accumulator += dt;
        while (this.accumulator >= STEP && this.state.phase === 'raid') {
          this.simulation.step(STEP, this.aim);
          this.scene.update(this.state, this.simulation.events, STEP);
          this.handleAudio(this.simulation.events);
          this.accumulator -= STEP;
        }
        if (this.simulation.state.phase === 'resupply') this.showResupply();
        else if (this.simulation.state.phase !== 'raid') { this.finish(); return; }
        if (!this.paused) this.audio.updateFlight(this.scene.camera, null, this.scene.world, dt, false);
      } else {
        this.scene.update(this.state, [], 0);
      }
      this.updateHud();
      this.scene.render();
      this.raf = requestAnimationFrame(this.frame);
    } catch (error) { this.abort(error); }
  };

  private handleAudio(events: readonly DefenseEvent[]): void {
    if (!this.scene) return;
    for (const event of events) {
      if ('position' in event) this.audioPosition.copy(event.position).add(this.scene.origin);
      if (event.type === 'shot') {
        if (event.weapon === 'mg') this.audio.handleEvent({ type: 'gun-fired', shooterId: -1, gun: 'vickers', position: this.audioPosition }, this.scene.camera.position);
        else this.audio.handleEvent({ type: 'explosion', position: this.audioPosition, size: event.weapon === 'flak' ? 0.45 : 0.25 }, this.scene.camera.position);
      } else if (event.type === 'burst') this.audio.handleEvent({ type: 'flak-burst', position: this.audioPosition }, this.scene.camera.position);
      else if (event.type === 'kill' || event.type === 'bomb-intercepted' || event.type === 'asset-hit') this.audio.handleEvent({ type: 'explosion', position: this.audioPosition, size: event.type === 'asset-hit' ? 4 : 2 }, this.scene.camera.position);
      if (event.type === 'hit' || event.type === 'kill' || event.type === 'bomb-intercepted') this.hitUntil = this.state.time + 0.16;
    }
  }

  private updateHud(): void {
    const state = this.state;
    setText(this.headline, `Raid ${state.raid} / 5 · ${RAID_NAMES[state.raid - 1]}`);
    setText(this.score, `${state.score} points · ${state.kills} down · ${state.bombsIntercepted} bombs stopped`);
    state.assets.forEach((asset, i) => {
      setText(this.assetViews[i].label, `${asset.name} · ${Math.round(asset.health / asset.maxHealth * 100)}%`);
      this.assetViews[i].meter.value = asset.health;
    });
    WEAPONS.forEach((id, i) => {
      const gun = state.weapons[id];
      this.weaponViews[i].button.setAttribute('aria-pressed', String(state.selected === id));
      setText(this.weaponViews[i].status, gun.reloadLeft > 0 ? `Reloading · ${gun.reloadLeft.toFixed(1)} s` : gun.overheated ? 'Cooling barrel' : `${gun.ammo} / ${gun.capacity} rounds`);
      this.weaponViews[i].meter.value = gun.heat;
    });
    setText(this.fuzeLabel, `${Math.round(state.fuzeRange)} m`);
    if (Number(this.fuzeInput.value) !== state.fuzeRange) this.fuzeInput.value = String(state.fuzeRange);
    this.target = null;
    let bestDot = 0.83;
    for (const threat of state.threats) {
      if (threat.health <= 0) continue;
      this.direction.copy(threat.position).sub(this.aim.origin).normalize();
      const dot = this.direction.dot(this.aim.direction);
      if (dot > bestDot) { bestDot = dot; this.target = threat; }
    }
    this.leadMarker.hidden = true;
    this.targetMarker.hidden = true;
    this.hitMarker.hidden = state.time >= this.hitUntil;
    if (!this.target || !this.scene) { setText(this.targetInfo, 'Scan the sky. Protect the airfield; falling bombs can be intercepted.'); return; }
    const range = this.target.position.distanceTo(this.aim.origin);
    const name = this.target.aircraftId === 'airship' ? 'Zeppelin' : this.target.aircraftId.replaceAll('_', ' ');
    setText(this.targetInfo, `${name} · ${Math.round(range)} m · ${Math.round(this.target.health / this.target.maxHealth * 100)}% · ${this.target.attackIn <= 3 ? 'ATTACKING' : `attack in ${Math.ceil(this.target.attackIn)} s`}`);
    if (this.scene.project(this.target.position, this.point)) {
      this.targetMarker.hidden = false;
      this.targetMarker.style.left = `${(this.point.x + 1) * 50}%`;
      this.targetMarker.style.top = `${(1 - this.point.y) * 50}%`;
    }
    if (state.options.aimAssist) {
      const weapon = state.weapons[state.selected];
      let t = range / weapon.muzzleSpeed;
      for (let i = 0; i < 5; i++) {
        this.lead.copy(this.target.position).addScaledVector(this.target.velocity, t);
        this.lead.y += 0.5 * weapon.gravity * t * t;
        t = this.lead.distanceTo(this.aim.origin) / weapon.muzzleSpeed;
      }
      if (this.scene.project(this.lead, this.reticlePoint)) {
        this.leadMarker.hidden = false;
        this.leadMarker.style.left = `${(this.reticlePoint.x + 1) * 50}%`;
        this.leadMarker.style.top = `${(1 - this.reticlePoint.y) * 50}%`;
      }
    }
  }

  private finish(): void {
    const result = this.simulation.result();
    if (!result || this.disposed) return;
    this.dispose();
    this.resolve(result);
  }

  abort(error: unknown): void {
    if (this.disposed) return;
    this.dispose();
    this.reject(error);
  }

  private dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clearInput();
    this.releaseMouse();
    this.events.abort();
    this.commandNav.dispose();
    this.observer?.disconnect();
    this.scene?.dispose();
    this.scene = null;
    this.audio.stopFlight();
    this.root.remove();
    if (getActiveDefense() === this) setActiveDefense(null);
    if (window.__rb2Defense === this) delete window.__rb2Defense;
  }
}
