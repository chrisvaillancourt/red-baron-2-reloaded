import type { CareerDifficulty, SquadronInfo } from '../../core/campaignTypes';
import type { Nation } from '../../core/types';
import type { ScreenFactory } from '../context';
import { artBackground, h, setChildren, svg } from '../dom';
import { addDays, daysBetween, formatDate } from '../format';
import { aceDisplay, FIRST_NAMES, LAST_NAMES, NATION_INFO, warPeriodFor } from '../catalog';
import { insigniaFor, nationalInsignia, squadronBadge } from '../insignia';
import { rangeInput, screenShell, withHints } from '../components';
import { AIRCRAFT } from '../../data/aircraft';
import { ACES } from '../../data/aces';

const MIN_DATE = '1915-07-01';
const MAX_DATE = '1918-10-01';
const NATIONS: Nation[] = ['germany', 'britain', 'france', 'usa'];

const DIFFICULTIES: { id: CareerDifficulty; title: string; text: string }[] = [
  { id: 'recruit', title: 'Recruit', text: 'Forgiving: generous confirmations, lighter wounds, gentler foes.' },
  { id: 'pilot', title: 'Pilot', text: 'The war as it was fought. Recommended.' },
  { id: 'ace', title: 'Ace', text: 'Unforgiving: strict confirmation, deadly enemies, one life.' },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function equipmentOn(sq: SquadronInfo, date: string): string[] {
  const e = sq.equipment.find((r) => r.from <= date && date <= r.to) ?? sq.equipment[sq.equipment.length - 1];
  return (e?.aircraft ?? []).map((id) => AIRCRAFT[id]?.shortName ?? id);
}

export const createPilotScreen: ScreenFactory = (ctx) => {
  const campaign = ctx.services.campaign;
  let nation: Nation = 'germany';
  let date = '1917-04-01';
  let difficulty: CareerDifficulty = 'pilot';
  let squadronId: string | undefined;
  let first = pick(FIRST_NAMES[nation]);
  let last = pick(LAST_NAMES[nation]);

  const shell = screenShell({
    id: 'create-pilot',
    title: 'Enlistment',
    kicker: 'New career',
    background: artBackground('art/briefing-desk.jpg', 'radial-gradient(ellipse at 60% 30%, #4a3421, #1a110a 75%)'),
    onBack: () => ctx.router.back(),
  });

  // --- Left: the form
  const firstIn = h('input', { class: 'input', value: first, maxlength: '24', 'aria-label': 'First name', onInput: (e: Event) => ((first = (e.target as HTMLInputElement).value), validate()) });
  const lastIn = h('input', { class: 'input', value: last, maxlength: '28', 'aria-label': 'Surname', onInput: (e: Event) => ((last = (e.target as HTMLInputElement).value), validate()) });

  const nationWrap = h('div', { class: 'nations', role: 'radiogroup', 'aria-label': 'Service' });
  const renderNations = () =>
    setChildren(nationWrap, 
      ...NATIONS.map((n) =>
        h(
          'button',
          {
            type: 'button',
            class: 'choice',
            'aria-pressed': String(n === nation),
            onClick: () => {
              if (n === nation) return;
              const wasRandom = FIRST_NAMES[nation].includes(first) && LAST_NAMES[nation].includes(last);
              nation = n;
              if (wasRandom) {
                first = firstIn.value = pick(FIRST_NAMES[n]);
                last = lastIn.value = pick(LAST_NAMES[n]);
              }
              if (n === 'usa' && date < '1918-02-15') setDate('1918-03-01');
              squadronId = undefined;
              renderNations();
              renderPeriod();
              renderSquadrons();
            },
          },
          svg(nationalInsignia(insigniaFor(n, date), 48)),
          h('div', { class: 'n-name' }, NATION_INFO[n].short),
          h('div', { class: 'n-service' }, NATION_INFO[n].service),
        ),
      ),
    );

  const dateReadout = h('div', { class: 'date-readout' });
  const totalDays = daysBetween(MIN_DATE, MAX_DATE);
  let sqTimer = 0;
  const slider = rangeInput({
    min: 0,
    max: totalDays,
    step: 1,
    value: daysBetween(MIN_DATE, date),
    label: 'Career start date',
    onInput: (v) => {
      date = addDays(MIN_DATE, v);
      dateReadout.textContent = formatDate(date);
      renderPeriod();
      clearTimeout(sqTimer);
      sqTimer = window.setTimeout(() => {
        squadronId = undefined;
        renderSquadrons();
        renderNations();
      }, 150);
    },
  });
  function setDate(d: string): void {
    date = d;
    slider.value = String(daysBetween(MIN_DATE, d));
    slider.dispatchEvent(new Event('input'));
  }
  dateReadout.textContent = formatDate(date);

  const periodCard = h('div', { class: 'period-card' });
  const renderPeriod = () => {
    const p = warPeriodFor(date);
    setChildren(periodCard, h('h4', null, p.title), h('p', null, p.text), h('p', { class: 'muted', style: 'margin-top:.4em;font-size:.8em' }, NATION_INFO[nation].blurb));
  };

  const diffWrap = h('div', { class: 'difficulty' });
  const renderDiff = () =>
    setChildren(diffWrap, 
      ...DIFFICULTIES.map((d) =>
        h(
          'button',
          { type: 'button', class: 'choice', 'aria-pressed': String(d.id === difficulty), onClick: () => ((difficulty = d.id), renderDiff()) },
          h('h4', null, d.title),
          h('p', null, d.text),
        ),
      ),
    );

  const form = h(
    'div',
    { class: 'paper tilt-l' },
    h('div', { class: 'form-sub' }, 'Form A.F.W. 3121 · Application for flying duties'),
    h('h2', { class: 'form-title' }, 'Particulars of the Applicant'),
    h('hr', { class: 'rule double' }),
    h(
      'div',
      { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', null, 'Christian name'), firstIn),
      h('div', { class: 'field' }, h('label', null, 'Surname'), lastIn),
      h(
        'div',
        { class: 'field full' },
        h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'field-label' }, 'Service'),
          h('button', {
            type: 'button',
            class: 'btn small',
            onClick: () => {
              first = firstIn.value = pick(FIRST_NAMES[nation]);
              last = lastIn.value = pick(LAST_NAMES[nation]);
              validate();
            },
          }, 'Random name')),
        nationWrap,
      ),
      h('div', { class: 'field full' }, h('span', { class: 'field-label' }, 'Report to the front on'), dateReadout, slider, periodCard),
    ),
  );

  // --- Right: squadron picker
  const sqList = h('div', { class: 'squadron-list' });
  function renderSquadrons(): void {
    let squadrons: SquadronInfo[] = [];
    try {
      squadrons = campaign.squadronsFor(nation, date);
    } catch (e) {
      console.warn('[ui] squadronsFor failed', e);
    }
    const auto = h(
      'button',
      { type: 'button', class: 'choice', 'aria-pressed': String(!squadronId), onClick: () => ((squadronId = undefined), renderSquadrons()) },
      h('div', { class: 'sq-badge', style: 'display:grid;place-items:center;font-size:2em' }, '?'),
      h('div', { class: 'sq-name' }, 'Assignment by headquarters'),
      h('div', { class: 'sq-meta' }, 'Let the service decide where you are needed.'),
    );
    setChildren(sqList, 
      auto,
      ...squadrons.map((sq) =>
        h(
          'button',
          { type: 'button', class: 'choice', 'aria-pressed': String(sq.id === squadronId), onClick: () => ((squadronId = sq.id), renderSquadrons()) },
          svg(squadronBadge(sq, 56)),
          h('div', { class: 'sq-name' }, sq.name, sq.motto ? h('span', { class: 'muted', style: 'font-weight:400;font-style:italic;font-size:.8em' }, `  “${sq.motto}”`) : null),
          h('div', { class: 'sq-meta' }, `Flying ${equipmentOn(sq, date).join(', ') || '—'}`, acesLine(sq, date)),
          h('div', { class: 'sq-desc' }, sq.description),
        ),
      ),
      squadrons.length === 0 ? h('p', { class: 'typed muted' }, `No ${NATION_INFO[nation].adjective} fighter squadrons were at this part of the front on ${formatDate(date)}. Choose a later date.`) : null,
    );
    enlistBtn.disabled = squadrons.length === 0 || !valid();
    warn.textContent = squadrons.length === 0 ? 'No squadron available on this date.' : '';
  }

  const squadronsPaper = h(
    'div',
    { class: 'paper tilt-r' },
    h('div', { class: 'form-sub' }, 'Posting preference'),
    h('h2', { class: 'form-title' }, 'Squadron'),
    h('hr', { class: 'rule double' }),
    sqList,
    h('div', { class: 'field', style: 'margin-top:1.2em' }, h('span', { class: 'field-label' }, 'Difficulty'), diffWrap),
  );

  const warn = h('span', { class: 'warn' });
  const valid = () => first.trim().length > 0 && last.trim().length > 0;
  const validate = () => {
    enlistBtn.disabled = !valid() || sqList.querySelectorAll('.choice').length <= 1;
  };
  const enlistBtn = h(
    'button',
    {
      class: 'btn light primary big',
      onClick: () => {
        if (!valid()) return;
        try {
          const p = campaign.createPilot({ firstName: first.trim(), lastName: last.trim(), nation, startDate: date, squadronId, difficulty });
          ctx.services.audio.playUi('stamp');
          ctx.router.replace('hq', { pilotId: p.id, welcome: true });
        } catch (e) {
          console.error(e);
          ctx.toast('The adjutant could not process your papers.');
        }
      },
    },
    'Sign & enlist',
  );

  renderNations();
  renderPeriod();
  renderDiff();
  renderSquadrons();
  firstIn.setAttribute('data-autofocus', '');

  shell.content.append(h('div', { class: 'enlist' }, form, squadronsPaper), h('div', { class: 'enlist-foot' }, warn, enlistBtn));
  withHints(shell);
  return { el: shell.el, music: 'menu' };
};

/** " · with Voss, Richthofen" for aces serving on the date; otherwise the squadron's famous names as history. */
function acesLine(sq: SquadronInfo, date: string): string {
  const serving = ACES.filter((a) => a.service.some((s) => s.squadronId === sq.id && s.from <= date && date <= s.to)).map((a) => a.id);
  if (serving.length) return ` · with ${serving.slice(0, 3).map(prettyAce).join(', ')}`;
  if (sq.notableAces.length) return ` · home of ${sq.notableAces.slice(0, 3).map(prettyAce).join(', ')}`;
  return '';
}

function prettyAce(id: string): string {
  const a = aceDisplay(id);
  if (a) return a.name.split(' ').slice(-1)[0];
  return id
    .split(/[-_]/)
    .map((w) => (w === 'von' ? w : w[0]?.toUpperCase() + w.slice(1)))
    .join(' ');
}
