/**
 * In-flight HUD. Created by the flight session inside its container:
 *
 *   const hud = createHud(container, settings);
 *   every frame: hud.update(view)
 *
 * The HUD never reads game state itself; see ./types.ts for the contract.
 */
import './hud.css';
import type { GameSettings } from '../../core/types';
import { h, setChildren, svg } from '../dom';
import { altitudeValue, formatClock, formatDistance, headingDegrees, resolveUnits, speedLabel, speedValue, altitudeLabel, type UnitPrefs } from '../format';
import { codeLabel } from '../bindings';
import { drawMap, type MapView } from '../map/mapRenderer';
import { compass, dial, type Gauge } from './gauges';
import type { EndFlightPromptOptions, Hud, HudDamage, HudGun, HudMessageOptions, HudScreenPoint, HudView, PauseCallbacks } from './types';

const K_TAPE = 0.3; // em per degree on the heading tape

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function toggleClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

const DAMAGE_SVG = `<svg viewBox="0 0 100 90" aria-hidden="true">
  <g stroke="rgba(0,0,0,.6)" stroke-width="1">
    <path data-zone="leftWing" d="M4,22 H46 V36 H4 Q1,29 4,22 Z"/>
    <path data-zone="rightWing" d="M54,22 H96 Q99,29 96,36 H54 Z"/>
    <path data-zone="engine" d="M44,4 H56 V16 H44 Z"/>
    <path data-zone="fuelTank" d="M45,17 H55 V23 H45 Z"/>
    <path data-zone="fuselage" d="M44,24 H56 L53,70 H47 Z"/>
    <path data-zone="tail" d="M32,70 H68 V80 H32 Z M47,62 H53 V86 H47 Z"/>
  </g>
</svg>`;

function damageColour(v: number): string {
  if (v < 0.08) return 'rgba(243,234,211,.55)';
  if (v < 0.35) return '#ffd27a';
  if (v < 0.7) return '#ff8a4a';
  if (v < 0.99) return '#ff4a3a';
  return '#5a0a05';
}

export function createHud(container: HTMLElement, initialSettings: GameSettings): Hud {
  let settings = initialSettings;
  let units: UnitPrefs = resolveUnits(settings.units, 'britain');
  let unitsKey = '';

  const root = h('div', { class: 'rb-hud' });
  container.append(root);
  let W = root.clientWidth || container.clientWidth || window.innerWidth;
  let H = root.clientHeight || container.clientHeight || window.innerHeight;
  const ro = new ResizeObserver(() => {
    W = root.clientWidth;
    H = root.clientHeight;
  });
  ro.observe(root);

  // ------------------------------------------------------ heading tape
  const tape = h('div', { class: 'hud-tape' });
  const strip = h('div', { class: 'strip' });
  for (let d = -360; d <= 720; d += 5) {
    const x = (d + 360) * K_TAPE;
    const major = d % 15 === 0;
    strip.append(h('div', { class: `tick ${major ? 'major' : ''}`, style: `left:${x}em` }));
    if (d % 30 === 0) {
      const n = ((d % 360) + 360) % 360;
      const card = n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : null;
      strip.append(h('div', { class: `lbl ${card ? 'card' : ''}`, style: `left:${x}em` }, h('span', null, card ?? String(n / 10).padStart(2, '0'))));
    }
  }
  tape.append(strip);
  const headingBox = h('div', { class: 'hud-heading' }, '000°');

  // ------------------------------------------------------ readout strip
  const ro_spd = h('span', { class: 'v' });
  const ro_alt = h('span', { class: 'v' });
  const ro_rpm = h('span', { class: 'v' });
  const ro_g = h('span', { class: 'v' });
  const throttleFill = h('div');
  const blipTag = h('span', { class: 'k blip hidden' }, 'BLIP');
  const r = (k: string, v: HTMLElement) => h('div', { class: 'r' }, h('span', { class: 'k' }, k), v);
  const spdKey = h('span', { class: 'k' }, 'SPEED');
  const altKey = h('span', { class: 'k' }, 'ALT');
  const readout = h(
    'div',
    { class: 'hud-readout' },
    h('div', { class: 'r' }, spdKey, ro_spd),
    h('div', { class: 'r' }, altKey, ro_alt),
    h('div', { class: 'r' }, h('span', { class: 'k' }, 'THR'), h('div', { class: 'hud-throttle' }, throttleFill), blipTag),
    r('RPM', ro_rpm),
    r('G', ro_g),
  );

  // ------------------------------------------------------ gauges (lazy)
  const cluster = h('div', { class: 'hud-cluster hidden' });
  let gAsi: Gauge | null = null;
  let gAlt: Gauge | null = null;
  let gRpm: Gauge | null = null;
  let gCmp: Gauge | null = null;
  let gFuel: Gauge | null = null;
  let rpmMax = 0;
  function buildCluster(maxRpm: number): void {
    const metric = units.system === 'metric';
    gAsi = metric
      ? dial({ label: 'Speed', unit: 'km/h', max: 250, numerals: [50, 100, 150, 200, 250], minorStep: 10 })
      : dial({ label: 'Air speed', unit: 'm.p.h.', max: 160, numerals: [40, 80, 120, 160], minorStep: 10 });
    gAlt = metric
      ? dial({ label: 'Höhe', unit: 'km', max: 7000, numerals: [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000], fmt: (v) => String(v / 1000), minorStep: 250 })
      : dial({ label: 'Altitude', unit: '× 1000 ft', max: 20000, numerals: [0, 5000, 10000, 15000, 20000], fmt: (v) => String(v / 1000), minorStep: 1000 });
    rpmMax = Math.ceil((maxRpm * 1.2) / 200) * 200;
    const step = rpmMax > 1000 ? 400 : 200;
    const nums: number[] = [];
    for (let v = 0; v <= rpmMax; v += step) nums.push(v);
    gRpm = dial({ label: 'R.P.M.', unit: '× 100', max: rpmMax, numerals: nums, fmt: (v) => String(v / 100), minorStep: 100, redline: maxRpm * 1.05 });
    gCmp = compass();
    gFuel = dial({ label: 'Fuel', max: 1, numerals: [0, 0.5, 1], fmt: (v) => (v === 0 ? 'E' : v === 1 ? 'F' : '½'), minorStep: 0.125, sweep: 180, small: true });
    setChildren(cluster, h('div', { class: 'panel' }, gAsi.el, gAlt.el, gRpm.el), h('div', { class: 'panel' }, gCmp.el, gFuel.el));
  }

  // ------------------------------------------------------ guns
  const gunsWrap = h('div', { class: 'hud-guns' });
  let gunEls: { root: HTMLElement; fill: HTMLElement; heat: HTMLElement; n: HTMLElement; state: HTMLElement; clear: HTMLElement; clearFill: HTMLElement }[] = [];
  function buildGuns(guns: HudGun[]): void {
    gunEls = guns.map((g) => {
      const fill = h('div', { class: 'fill' });
      const heat = h('div', { class: 'heat' });
      const n = h('div', { class: 'n' });
      const state = h('div', { class: 'state' });
      const clearFill = h('div');
      const clear = h('div', { class: 'clear hidden' }, clearFill);
      const el = h('div', { class: `hud-gun ${g.observer ? 'observer' : ''}` }, state, clear, h('div', { class: 'bar' }, fill, heat), n, h('div', { class: 'lbl' }, g.label));
      return { root: el, fill, heat, n, state, clear, clearFill };
    });
    setChildren(gunsWrap, ...gunEls.map((g) => g.root));
  }
  let gunsKey = '';

  // ------------------------------------------------------ damage
  const damageSvg = svg(DAMAGE_SVG);
  const damageFlags = h('div', { class: 'flags' });
  const damageWrap = h('div', { class: 'hud-damage' }, damageSvg, damageFlags);
  const zones = new Map<string, SVGElement>();
  damageSvg.querySelectorAll<SVGElement>('[data-zone]').forEach((z) => zones.set(z.dataset.zone!, z));
  let flagsKey = '';

  // ------------------------------------------------------ messages & status
  const messages = h('div', { class: 'hud-messages', 'aria-live': 'polite' });
  const clock = h('div', { class: 'clock' });
  const tc = h('div', { class: 'tc hidden' });
  const wingmenEl = h('div', { class: 'hud-wingmen' });
  let wingKey = '';
  const status = h('div', { class: 'hud-status' }, tc, clock, wingmenEl);

  // ------------------------------------------------------ markers
  const targetMarker = h('div', { class: 'hud-marker hidden' });
  const box = h('div', { class: 'hud-box' });
  const boxInfo = h('div', { class: 'info' });
  const boxHp = h('div', { class: 'hp' }, h('div'));
  box.append(boxInfo, boxHp);
  targetMarker.append(box);
  const targetEdge = h('div', { class: 'hud-marker hidden' }, h('div', { class: 'hud-edge' }));
  const leadMarker = h('div', { class: 'hud-marker hidden' }, h('div', { class: 'hud-lead' }));
  const wpMarker = h('div', { class: 'hud-marker hidden' }, h('div', { class: 'hud-wp' }), h('div', { class: 'hud-wp-label' }));
  const wpEdge = h('div', { class: 'hud-marker hidden' }, h('div', { class: 'hud-edge wp' }));
  const reticle = h('div', { class: 'hud-marker hidden' }, h('div', { class: 'hud-reticle' }));
  const aimMarker = h('div', { class: 'hud-marker hidden' }, h('div', { class: 'hud-aim' }));
  const noseMarker = h('div', { class: 'hud-marker hidden' }, h('div', { class: 'hud-nose' }));
  const threats = h('div', { class: 'hud-threats' });
  const padlockEl = h('div', { class: 'hud-padlock hidden' });
  const alert = h('div', { class: 'hud-alert hidden' });
  const hint = h('div', { class: 'hud-hint hidden' });
  const gFx = h('div', { class: 'hud-g' });
  const flash = h('div', { class: 'hud-flash' });

  root.append(gFx, flash, reticle, aimMarker, noseMarker, leadMarker, wpMarker, wpEdge, targetMarker, targetEdge, threats, tape, headingBox, padlockEl, alert, messages, status, damageWrap, gunsWrap, cluster, readout, hint);

  // ------------------------------------------------------ helpers
  function place(marker: HTMLElement, p: HudScreenPoint | null | undefined, edge?: HTMLElement): void {
    if (!p) {
      toggleClass(marker, 'hidden', true);
      if (edge) toggleClass(edge, 'hidden', true);
      return;
    }
    if (p.onScreen) {
      toggleClass(marker, 'hidden', false);
      marker.style.transform = `translate(${(p.x * W).toFixed(1)}px, ${(p.y * H).toFixed(1)}px)`;
      if (edge) toggleClass(edge, 'hidden', true);
    } else {
      toggleClass(marker, 'hidden', true);
      if (edge && p.edgeAngle !== undefined) {
        toggleClass(edge, 'hidden', false);
        const a = p.edgeAngle;
        const x = W / 2 + Math.sin(a) * W * 0.44;
        const y = H / 2 - Math.cos(a) * H * 0.42;
        edge.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${a.toFixed(3)}rad)`;
      } else if (edge) toggleClass(edge, 'hidden', true);
    }
  }

  function renderDamage(d: HudDamage): void {
    const vals: Record<string, number> = { leftWing: d.leftWing, rightWing: d.rightWing, engine: d.engine, fuelTank: d.fuelTank, fuselage: Math.max(d.fuselage, d.controls * 0.8), tail: d.tail };
    for (const [k, z] of zones) {
      const c = damageColour(vals[k] ?? 0);
      if (z.getAttribute('fill') !== c) z.setAttribute('fill', c);
    }
    const flags = [d.onFire && 'FIRE', d.engineDead && 'ENGINE OUT', d.fuelLeak && 'FUEL LEAK', d.pilotWounded && 'WOUNDED'].filter(Boolean) as string[];
    const key = flags.join('|');
    if (key !== flagsKey) {
      flagsKey = key;
      setChildren(damageFlags, ...flags.map((f) => h('span', null, f)));
    }
  }

  function unitsFor(view: HudView): void {
    const key = `${settings.units}:${view.nation}:${view.maxRpm}`;
    if (key === unitsKey) return;
    unitsKey = key;
    units = resolveUnits(settings.units, view.nation);
    spdKey.textContent = `SPEED ${speedLabel(units.speed).toUpperCase()}`;
    altKey.textContent = `ALT ${altitudeLabel(units.system).toUpperCase()}`;
    buildCluster(view.maxRpm);
  }

  // ------------------------------------------------------ menus
  let backdrop: HTMLElement | null = null;
  let orders: HTMLElement | null = null;
  let mapHost: HTMLElement | null = null;
  let mapCanvas: HTMLCanvasElement | null = null;

  // While a card is open the HUD owns the keyboard (capture phase, so the
  // game's own key handlers never see Escape/Enter/arrows meant for the menu).
  let cardKeys: ((e: KeyboardEvent) => void) | null = null;
  function openCard(card: HTMLElement, onEscape: () => void): void {
    closeCard();
    backdrop = h('div', { class: 'hud-menu-backdrop' }, card);
    cardKeys = (e: KeyboardEvent) => {
      const btns = [...card.querySelectorAll<HTMLButtonElement>('button')];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') onEscape();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') btns[(i + 1) % btns.length]?.focus();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') btns[(i - 1 + btns.length) % btns.length]?.focus();
      else if (e.key === 'Enter' || e.key === ' ') (i >= 0 ? btns[i] : btns.find((b) => b.classList.contains('primary')) ?? btns[0])?.click();
      else if (e.key !== 'Tab') {
        e.stopPropagation();
        return;
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', cardKeys, true);
    root.append(backdrop);
    card.querySelector<HTMLButtonElement>('button.primary, button')?.focus();
  }
  function closeCard(): void {
    if (cardKeys) window.removeEventListener('keydown', cardKeys, true);
    cardKeys = null;
    backdrop?.remove();
    backdrop = null;
  }

  // ------------------------------------------------------ messages
  function showMessage(text: string, o: HudMessageOptions = {}): void {
    const el = h('div', { class: `hud-msg ${o.kind ?? 'info'}` }, o.from ? h('span', { class: 'from' }, `${o.from}:`) : null, text);
    messages.append(el);
    while (messages.children.length > 6) messages.firstElementChild?.remove();
    const dur = (o.duration ?? 6) * 1000;
    setTimeout(() => el.classList.add('fade'), dur);
    setTimeout(() => el.remove(), dur + 700);
  }

  let flashTimer = 0;

  const hud: Hud = {
    element: root,
    get menuOpen() {
      return !!backdrop;
    },

    update(v: HudView) {
      unitsFor(v);
      const hdg = headingDegrees(v.heading);
      strip.style.transform = `translateX(${(13 - (((hdg % 360) + 360) % 360 + 360) * K_TAPE).toFixed(2)}em)`;
      setText(headingBox, `${hdg.toString().padStart(3, '0')}°`);

      const spd = Math.round(speedValue(v.airspeed, units.speed));
      const alt = Math.round(altitudeValue(v.altitude, units.system) / (units.system === 'metric' ? 10 : 50)) * (units.system === 'metric' ? 10 : 50);
      setText(ro_spd, String(spd));
      setText(ro_alt, alt.toLocaleString('en-GB'));
      setText(ro_rpm, String(Math.round(v.rpm / 10) * 10));
      setText(ro_g, v.gLoad.toFixed(1));
      throttleFill.style.height = `${Math.round(v.throttle * 100)}%`;
      toggleClass(blipTag, 'hidden', !v.blip);

      const showCluster = v.showInstruments;
      toggleClass(cluster, 'hidden', !showCluster);
      if (showCluster) {
        gAsi?.set(speedValue(v.airspeed, units.speed));
        gAlt?.set(altitudeValue(v.altitude, units.system));
        gRpm?.set(v.rpm);
        gCmp?.set(hdg);
        gFuel?.set(v.fuelCapacityL > 0 ? v.fuelL / v.fuelCapacityL : 0);
      }

      // Guns
      const gk = v.guns.map((g) => g.label).join('|');
      if (gk !== gunsKey) {
        gunsKey = gk;
        buildGuns(v.guns);
      }
      v.guns.forEach((g, i) => {
        const e = gunEls[i];
        if (!e) return;
        e.fill.style.height = `${Math.round((g.roundsLeft / Math.max(1, g.capacity)) * 100)}%`;
        e.heat.style.height = `${Math.round((g.heat ?? 0) * 100)}%`;
        setText(e.n, g.spares > 0 ? `${g.roundsLeft}+${g.spares}` : String(g.roundsLeft));
        const empty = g.roundsLeft <= 0 && g.spares <= 0;
        toggleClass(e.root, 'jammed', g.jammed);
        toggleClass(e.root, 'reloading', g.reloading > 0);
        toggleClass(e.root, 'empty', empty);
        setText(e.state, g.jammed ? `JAMMED — ${codeLabel(settings.controls.keyBindings.clearJam?.[0] ?? 'KeyU')}` : g.reloading > 0 ? 'NEW DRUM' : empty ? 'EMPTY' : '');
        toggleClass(e.clear, 'hidden', !g.jammed && g.reloading <= 0);
        e.clearFill.style.width = `${Math.round((g.jammed ? g.jamClearProgress : g.reloading) * 100)}%`;
      });

      renderDamage(v.damage);

      // Status
      setText(clock, formatClock(v.missionTime));
      toggleClass(tc, 'hidden', v.timeCompression <= 1);
      if (v.timeCompression > 1) setText(tc, `×${v.timeCompression}`);
      const wk = v.wingmen.map((w) => `${w.name}:${w.status}`).join('|');
      if (wk !== wingKey) {
        wingKey = wk;
        setChildren(wingmenEl, ...v.wingmen.map((w) => h('div', { class: `w ${w.status}` }, w.name)));
      }

      // Target box
      const labels = settings.realism.targetLabels;
      const t = v.target;
      if (t && labels) {
        toggleClass(box, 'friendly', t.friendly);
        toggleClass(box, 'padlocked', v.padlock.active && !v.padlock.lost);
        const info = `${t.name}\u0001${t.type}\u0001${formatDistance(t.range, units.system)}\u0001${Math.round(speedValue(t.closure, units.speed))}\u0001${t.isAce ? 1 : 0}`;
        if (boxInfo.dataset.k !== info) {
          boxInfo.dataset.k = info;
          setChildren(boxInfo, 
            h('div', { class: `nm ${t.isAce ? 'ace' : ''}` }, t.name),
            t.name !== t.type ? h('div', null, t.type) : null,
            h('div', null, `${formatDistance(t.range, units.system)}  ${t.closure >= 0 ? '▼' : '▲'}${Math.abs(Math.round(speedValue(t.closure, units.speed)))}`),
          );
        }
        (boxHp.firstElementChild as HTMLElement).style.width = `${Math.round((1 - (t.damage ?? 0)) * 100)}%`;
        toggleClass(boxHp, 'hidden', t.damage === undefined);
        place(targetMarker, t.screen, targetEdge);
        toggleClass(targetEdge.firstElementChild!, 'friendly', t.friendly);
        place(leadMarker, t.lead && t.lead.onScreen && settings.realism.flightModel === 'relaxed' ? t.lead : null);
      } else {
        place(targetMarker, null, targetEdge);
        place(leadMarker, null);
      }

      // Waypoint
      if (v.waypoint) {
        const lbl = wpMarker.querySelector('.hud-wp-label') as HTMLElement;
        setText(lbl, `${v.waypoint.index + 1}/${v.waypoint.total} ${v.waypoint.label} · ${formatDistance(v.waypoint.distance, units.system)}`);
        place(wpMarker, v.waypoint.screen, wpEdge);
      } else place(wpMarker, null, wpEdge);

      place(reticle, v.gunReticle && v.view !== 'cockpit' ? v.gunReticle : null);
      place(aimMarker, v.mouseAim?.aim ?? null);
      place(noseMarker, v.mouseAim?.nose ?? null);

      // Threat ring
      const ring = Math.min(W, H) * 0.2;
      const thr = labels ? v.threats : v.threats.filter((x) => x.danger);
      while (threats.children.length < thr.length) threats.append(h('div', { class: 'hud-threat' }));
      while (threats.children.length > thr.length) threats.lastElementChild!.remove();
      thr.forEach((x, i) => {
        const el = threats.children[i] as HTMLElement;
        toggleClass(el, 'danger', x.danger);
        el.style.transform = `rotate(${x.angle.toFixed(3)}rad) translateY(${-ring.toFixed(0)}px)`;
      });

      // Padlock & alerts
      toggleClass(padlockEl, 'hidden', !v.padlock.active);
      if (v.padlock.active) {
        toggleClass(padlockEl, 'lost', !!v.padlock.lost);
        setText(padlockEl, v.padlock.lost ? 'PADLOCK LOST' : `PADLOCK · ${v.padlock.name ?? ''}`);
      }
      const alertText = v.damage.onFire ? 'FIRE' : v.stalled && !v.onGround ? 'STALL' : v.damage.engineDead && !v.onGround ? 'ENGINE OUT' : '';
      toggleClass(alert, 'hidden', !alertText);
      toggleClass(alert, 'blink', !!alertText);
      setText(alert, alertText);
      toggleClass(hint, 'hidden', !v.hint || !settings.showTutorialHints);
      if (v.hint) setText(hint, v.hint);
    },

    showMessage,

    showWingmanMenu(open) {
      orders?.remove();
      orders = null;
      if (!open) return;
      const b = settings.controls.keyBindings;
      const row = (label: string, action: string) => h('div', { class: 'o' }, h('span', null, label), h('kbd', null, codeLabel(b[action]?.[0] ?? '?')));
      orders = h(
        'div',
        { class: 'hud-orders' },
        h('h3', null, 'Orders to the flight'),
        row('Attack my target', 'wingmenAttack'),
        row('Engage at will', 'wingmenEngage'),
        row('Form up on me', 'wingmenFormUp'),
        row('Cover me', 'wingmenCover'),
        row('Return to base', 'wingmenHome'),
      );
      root.append(orders);
    },

    showPauseMenu(cb: PauseCallbacks) {
      const card = h(
        'div',
        { class: 'hud-card', role: 'dialog', 'aria-label': 'Paused' },
        h('h2', null, 'Paused'),
        h(
          'div',
          { class: 'menu' },
          h('button', { class: 'primary', onClick: () => (closeCard(), cb.onResume()) }, 'Resume flight'),
          cb.onRestart ? h('button', { onClick: () => (closeCard(), cb.onRestart!()) }, 'Restart mission') : null,
          h('button', { onClick: () => (closeCard(), cb.onEndFlight()) }, 'End flight'),
          h('button', { class: 'danger', onClick: () => (closeCard(), cb.onQuit()) }, 'Abandon mission'),
        ),
      );
      openCard(card, () => (closeCard(), cb.onResume()));
    },
    hidePauseMenu: closeCard,

    showEndFlightPrompt(o: EndFlightPromptOptions) {
      const card = h(
        'div',
        { class: 'hud-card', role: 'dialog', 'aria-label': 'End flight' },
        h('h2', null, 'End the flight?'),
        o.safe
          ? h('p', null, 'You are over friendly ground with no enemy near. The flight will be recorded as returned safely.')
          : h('p', { class: 'warn' }, o.reason ?? 'It is not safe to end the flight here.', ' Ending now may be recorded as a forced landing — or worse.'),
        h('div', { class: 'row' }, h('button', { onClick: () => (closeCard(), o.onCancel()) }, 'Keep flying'), h('button', { class: `primary ${o.safe ? '' : 'danger'}`, onClick: () => (closeCard(), o.onConfirm()) }, 'End flight')),
      );
      openCard(card, () => (closeCard(), o.onCancel()));
    },
    hideEndFlightPrompt: closeCard,

    showMap(view: MapView | null) {
      if (!view) {
        mapHost?.remove();
        mapHost = null;
        mapCanvas = null;
        return;
      }
      if (!mapHost) {
        mapCanvas = document.createElement('canvas');
        const key = codeLabel(settings.controls.keyBindings.map?.[0] ?? 'KeyM');
        mapHost = h('div', { class: 'hud-map' }, mapCanvas, h('div', { class: 'close-hint' }, `${key} — close map`));
        root.append(mapHost);
      }
      drawMap(mapCanvas!, { ...view, style: 'overlay' });
    },

    setGEffect(v) {
      const red = v < 0;
      toggleClass(gFx, 'red', red);
      gFx.style.opacity = String(Math.min(1, Math.abs(v)).toFixed(3));
    },

    setDamageFlash(intensity) {
      flash.style.transition = 'none';
      flash.style.opacity = String(Math.min(1, intensity));
      cancelAnimationFrame(flashTimer);
      flashTimer = requestAnimationFrame(() => {
        flash.style.transition = 'opacity .6s ease-out';
        flash.style.opacity = '0';
      });
    },

    setVisible(visible) {
      root.hidden = !visible;
    },

    setSettings(s) {
      settings = s;
      unitsKey = '';
    },

    dispose() {
      ro.disconnect();
      closeCard();
      root.remove();
    },
  };
  return hud;
}
