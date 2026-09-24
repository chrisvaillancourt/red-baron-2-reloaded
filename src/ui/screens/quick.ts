import type { QuickMissionOptions } from '../../core/campaignTypes';
import type { AircraftId, AircraftSpec, SkillLevel } from '../../core/types';
import { AIRCRAFT, AIRCRAFT_LIST } from '../../data/aircraft';
import type { ScreenFactory } from '../context';
import { artBackground, h, setChildren, svg } from '../dom';
import { formatAltitude, resolveUnits } from '../format';
import { getUiCatalog } from '../catalog';
import { insigniaFor, nationalInsignia } from '../insignia';
import { rangeInput, screenShell, segmented, withHints } from '../components';
import { specSheet } from '../aircraftCards';
import { SKILL_LABEL } from '../labels';

const STORE = 'rb2r.quick.v1';
const SKILLS: SkillLevel[] = ['novice', 'regular', 'veteran', 'ace'];

const sideOf = (s: AircraftSpec) => (s.nation === 'germany' ? 'central' : 'allied');

function defaults(): QuickMissionOptions {
  return {
    playerAircraft: 'sopwith_camel',
    enemyAircraft: 'albatros_dv',
    enemyCount: 3,
    wingmen: 1,
    enemySkill: 'regular',
    wingmanSkill: 'regular',
    altitudeM: 2500,
    startPosition: 'head-on',
    timeOfDay: 'afternoon',
    cloudCover: 0.35,
    type: 'dogfight',
  };
}

function load(): QuickMissionOptions {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const o = { ...defaults(), ...(JSON.parse(raw) as Partial<QuickMissionOptions>) };
      if (AIRCRAFT[o.playerAircraft] && AIRCRAFT[o.enemyAircraft]) return o;
    }
  } catch {
    /* ignore */
  }
  return defaults();
}

function aircraftSelect(list: AircraftSpec[], value: AircraftId, onChange: (id: AircraftId) => void, label: string): HTMLSelectElement {
  const sel = h('select', { class: 'input', 'aria-label': label, onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value as AircraftId) });
  const groups: [string, AircraftSpec[]][] = [
    ['Central Powers', list.filter((s) => sideOf(s) === 'central')],
    ['Allies', list.filter((s) => sideOf(s) === 'allied')],
  ];
  for (const [g, specs] of groups) {
    if (!specs.length) continue;
    const og = h('optgroup', { label: g });
    for (const s of specs) og.append(h('option', { value: s.id }, `${s.name} (${s.introduced.slice(0, 4)})`));
    sel.append(og);
  }
  sel.value = value;
  return sel;
}

export const quickScreen: ScreenFactory = (ctx) => {
  const o = load();
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch {
      /* ignore */
    }
  };

  const shell = screenShell({
    id: 'quick',
    title: 'Quick Mission',
    kicker: 'Instant action',
    background: artBackground('art/debrief-sky.jpg', 'radial-gradient(ellipse at 50% 20%, #56402a, #150e08 80%)'),
    onBack: () => ctx.router.back(),
  });

  const units = () => resolveUnits(ctx.settings().units, AIRCRAFT[o.playerAircraft].nation);
  const flyable = AIRCRAFT_LIST.filter((s) => s.flyable);

  // --- Player column
  const playerHead = h('h3');
  const playerSpec = h('div');
  const renderPlayer = () => {
    const s = AIRCRAFT[o.playerAircraft];
    setChildren(playerHead, svg(nationalInsignia(insigniaFor(s.nation, s.introduced), 28)), 'Your flight');
    setChildren(playerSpec, specSheet(s, units()));
  };
  const playerSel = aircraftSelect(flyable, o.playerAircraft, (id) => {
    const wasSide = sideOf(AIRCRAFT[o.playerAircraft]);
    o.playerAircraft = id;
    if (sideOf(AIRCRAFT[id]) !== wasSide) {
      // Pick a contemporary enemy from the other side.
      const mine = AIRCRAFT[id];
      const foes = AIRCRAFT_LIST.filter((s) => sideOf(s) !== sideOf(mine) && s.role === 'fighter');
      foes.sort((a, b) => Math.abs(Date.parse(a.introduced) - Date.parse(mine.introduced)) - Math.abs(Date.parse(b.introduced) - Date.parse(mine.introduced)));
      o.enemyAircraft = foes[0]?.id ?? o.enemyAircraft;
      o.enemyAceId = undefined;
      rebuildEnemySelect();
    }
    renderPlayer();
    renderEnemy();
    save();
  }, 'Your aircraft');
  playerSel.setAttribute('data-autofocus', '');

  const countSeg = (value: number, max: number, min: number, onChange: (n: number) => void) =>
    segmented(
      Array.from({ length: max - min + 1 }, (_, i) => ({ value: String(i + min), label: String(i + min) })),
      String(value),
      (v) => (onChange(Number(v)), save()),
    );
  const skillSeg = (value: SkillLevel, onChange: (s: SkillLevel) => void) =>
    segmented(
      SKILLS.map((s) => ({ value: s, label: SKILL_LABEL[s] })),
      value,
      (v) => (onChange(v), save()),
    );

  const playerCol = h(
    'div',
    { class: 'paper tilt-l' },
    playerHead,
    h('div', { class: 'field' }, h('label', null, 'Aircraft'), playerSel),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Wingmen'), countSeg(o.wingmen, 3, 0, (n) => (o.wingmen = n))),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Wingman skill'), skillSeg(o.wingmanSkill, (s) => (o.wingmanSkill = s))),
    playerSpec,
  );

  const acePick = h('div', { class: 'ace-pick' });

  // --- Mission column
  const altVal = h('span', { class: 'typed' });
  const paintAlt = () => (altVal.textContent = formatAltitude(o.altitudeM, units().system));
  const cloudVal = h('span', { class: 'typed' });
  const paintCloud = () => (cloudVal.textContent = o.cloudCover < 0.15 ? 'Clear' : o.cloudCover < 0.45 ? 'Scattered' : o.cloudCover < 0.75 ? 'Broken' : 'Overcast');
  paintAlt();
  paintCloud();
  const missionCol = h(
    'div',
    { class: 'paper' },
    h('h3', null, 'The engagement'),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Mission'),
      segmented(
        [
          { value: 'dogfight', label: 'Dogfight' },
          { value: 'intercept', label: 'Intercept' },
          { value: 'escort', label: 'Escort' },
          { value: 'balloon-attack', label: 'Balloons' },
          { value: 'ground-attack', label: 'Strafe' },
        ],
        o.type,
        (v) => ((o.type = v), save()),
      ),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Starting position'),
      segmented(
        [
          { value: 'head-on', label: 'Head-on' },
          { value: 'advantage', label: 'Advantage' },
          { value: 'disadvantage', label: 'Bounced' },
          { value: 'random', label: 'Random' },
        ],
        o.startPosition,
        (v) => ((o.startPosition = v), save()),
      ),
    ),
    h(
      'div',
      { class: 'field' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'field-label' }, 'Altitude'), altVal),
      rangeInput({ min: 300, max: 5500, step: 100, value: o.altitudeM, label: 'Altitude', onInput: (v) => ((o.altitudeM = v), paintAlt(), save()) }),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Time of day'),
      segmented(
        [
          { value: 'dawn', label: 'Dawn' },
          { value: 'morning', label: 'Morning' },
          { value: 'midday', label: 'Noon' },
          { value: 'afternoon', label: 'Afternoon' },
          { value: 'dusk', label: 'Dusk' },
        ],
        o.timeOfDay,
        (v) => ((o.timeOfDay = v), save()),
      ),
    ),
    h(
      'div',
      { class: 'field' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'field-label' }, 'Cloud'), cloudVal),
      rangeInput({ min: 0, max: 1, step: 0.05, value: o.cloudCover, label: 'Cloud cover', onInput: (v) => ((o.cloudCover = v), paintCloud(), save()) }),
    ),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Face a famous ace (leads the enemy flight)'), acePick),
  );

  // --- Enemy column
  const enemyHead = h('h3');
  const enemySelHost = h('div', { class: 'field' });
  const enemySpec = h('div');
  function rebuildEnemySelect(): void {
    const mySide = sideOf(AIRCRAFT[o.playerAircraft]);
    const foes = AIRCRAFT_LIST.filter((s) => sideOf(s) !== mySide);
    if (!foes.some((f) => f.id === o.enemyAircraft)) o.enemyAircraft = foes[0].id;
    setChildren(
      enemySelHost,
      h('label', null, 'Enemy aircraft'),
      aircraftSelect(foes, o.enemyAircraft, (id) => ((o.enemyAircraft = id), renderEnemy(), save()), 'Enemy aircraft'),
    );
  }
  function renderEnemy(): void {
    const s = AIRCRAFT[o.enemyAircraft];
    setChildren(enemyHead, svg(nationalInsignia(insigniaFor(s.nation, s.introduced), 28)), 'The enemy');
    setChildren(enemySpec, specSheet(s, units()));
    const enemyGerman = s.nation === 'germany';
    const aces = getUiCatalog().aces.filter((a) => (a.nation === 'germany') === enemyGerman);
    setChildren(
      acePick,
      h('button', { type: 'button', class: 'choice', 'aria-pressed': String(!o.enemyAceId), onClick: () => ((o.enemyAceId = undefined), renderEnemy(), save()) }, h('span', null, 'No named ace'), h('span', { class: 'muted' }, '')),
      ...aces.map((a) =>
        h(
          'button',
          { type: 'button', class: 'choice', 'aria-pressed': String(o.enemyAceId === a.id), onClick: () => ((o.enemyAceId = a.id), renderEnemy(), save()) },
          h('span', null, a.name),
          h('span', { class: 'muted typed' }, `${a.victories} victories`),
        ),
      ),
    );
  }
  rebuildEnemySelect();
  const enemyCol = h(
    'div',
    { class: 'paper tilt-r' },
    enemyHead,
    enemySelHost,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Number of enemies'), countSeg(o.enemyCount, 8, 1, (n) => (o.enemyCount = n))),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Enemy skill'), skillSeg(o.enemySkill, (s) => (o.enemySkill = s))),
    enemySpec,
  );

  renderPlayer();
  renderEnemy();

  const fly = h(
    'button',
    {
      class: 'btn light primary big',
      onClick: () => {
        try {
          const mission = ctx.services.campaign.buildQuickMission({ ...o });
          ctx.router.push('briefing', { mission });
        } catch (e) {
          console.error('[ui] buildQuickMission failed', e);
          ctx.toast('Could not build that mission.');
        }
      },
    },
    'To the briefing →',
  );

  shell.content.append(h('div', { class: 'quick' }, playerCol, missionCol, enemyCol), h('div', { class: 'quick-foot' }, fly));
  withHints(shell);
  return { el: shell.el, music: 'menu' };
};
