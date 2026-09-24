import type { PilotSummary } from '../../core/campaignTypes';
import type { ScreenFactory } from '../context';
import { artBackground, h, setChildren, svg } from '../dom';
import { formatDate } from '../format';
import { insigniaFor, nationalInsignia } from '../insignia';
import { NATION_INFO } from '../catalog';
import { screenShell, stamp, withHints } from '../components';

const STATUS_STAMP: Record<PilotSummary['status'], [string, '' | 'blue' | 'green'] | null> = {
  active: null,
  hospital: ['In Hospital', 'blue'],
  captured: ['Prisoner of War', 'blue'],
  killed: ['Killed in Action', ''],
  retired: ['Retired', 'green'],
  'war-over': ['Armistice', 'green'],
};

export const rosterScreen: ScreenFactory = (ctx) => {
  const campaign = ctx.services.campaign;
  let pilots = campaign.listPilots();
  let selected: string | null = pilots.find((p) => p.status === 'active')?.id ?? pilots[0]?.id ?? null;

  const shell = screenShell({
    id: 'roster',
    title: 'Pilot Records',
    kicker: 'Career',
    background: artBackground('art/menu-aerodrome.jpg', 'radial-gradient(ellipse at 30% 20%, #4a3421, #1a110a 75%)'),
    onBack: () => ctx.router.back(),
  });

  const list = h('div', { class: 'roster-list', role: 'list' });
  const side = h('aside', { class: 'roster-side paper tilt-r clip' });

  function renderSide(): void {
    const p = pilots.find((x) => x.id === selected);
    if (!p) {
      setChildren(side, 
        h('h2', null, 'No pilot selected'),
        h('p', { class: 'typed muted' }, 'Every career begins with an enlistment form. Create a pilot to report to your squadron.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onClick: () => ctx.router.push('create-pilot') }, 'Enlist a new pilot')),
      );
      return;
    }
    const alive = p.status === 'active' || p.status === 'hospital';
    setChildren(side, 
      h('div', { class: 'engraved muted' }, NATION_INFO[p.nation].service),
      h('h2', null, `${p.rankAbbrev} ${p.name}`),
      h('div', { class: 'typed' }, p.squadronName),
      h('hr', { class: 'rule' }),
      h(
        'div',
        { class: 'typed', style: 'font-size:.9em;line-height:1.7' },
        h('div', null, 'Date: ', formatDate(p.date)),
        h('div', null, 'Confirmed victories: ', String(p.victories)),
        h('div', null, 'Status: ', p.status === 'active' ? 'On active service' : (STATUS_STAMP[p.status]?.[0] ?? p.status)),
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { class: 'btn primary', 'data-autofocus': '', onClick: () => ctx.router.push('hq', { pilotId: p.id }) },
          alive ? 'Report for duty' : 'Open service record',
        ),
        h(
          'button',
          {
            class: 'btn danger small',
            onClick: async () => {
              const ok = await ctx.confirm({
                title: 'Destroy this record?',
                body: `The service record of ${p.name} will be burned. This cannot be undone.`,
                confirmLabel: 'Burn the file',
                danger: true,
              });
              if (!ok) return;
              campaign.deletePilot(p.id);
              pilots = campaign.listPilots();
              selected = pilots[0]?.id ?? null;
              render();
            },
          },
          'Delete record',
        ),
      ),
    );
  }

  function render(): void {
    setChildren(list, 
      ...pilots.map((p) => {
        const st = STATUS_STAMP[p.status];
        const card = h(
          'button',
          {
            class: 'dossier',
            role: 'listitem',
            'aria-pressed': String(p.id === selected),
            dataset: { tab: `FILE ${p.id.slice(-4).toUpperCase()}` },
            onClick: () => {
              if (selected === p.id) {
                ctx.router.push('hq', { pilotId: p.id });
                return;
              }
              selected = p.id;
              list.querySelectorAll('.dossier').forEach((d) => d.setAttribute('aria-pressed', 'false'));
              card.setAttribute('aria-pressed', 'true');
              renderSide();
            },
            onFocus: () => {
              selected = p.id;
              list.querySelectorAll('.dossier').forEach((d) => d.setAttribute('aria-pressed', String(d === card)));
              renderSide();
            },
          },
          svg(nationalInsignia(insigniaFor(p.nation, p.date), 40)),
          h('div', { class: 'd-name' }, p.name),
          h('div', { class: 'd-meta' }, `${p.rankAbbrev} · ${p.squadronName}`, h('br'), formatDate(p.date)),
          h('div', { class: 'd-kills' }, String(p.victories), h('small', null, 'victories')),
          st && stamp(st[0], st[1]),
        );
        return card;
      }),
      h('button', { class: 'dossier new', onClick: () => ctx.router.push('create-pilot') }, h('div', null, h('div', { class: 'plus' }, '+'), h('div', { class: 'engraved' }, 'Enlist a new pilot'))),
      pilots.length === 0 ? h('p', { class: 'empty-note' }, 'The filing cabinet is empty. No pilots have yet reported for duty.') : null,
    );
    renderSide();
  }

  render();
  shell.content.append(h('div', { class: 'roster-wrap' }, list, side));
  withHints(shell);
  return { el: shell.el, music: 'menu' };
};
