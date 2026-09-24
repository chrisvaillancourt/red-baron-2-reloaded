import type { ScreenFactory } from '../context';
import { artBackground, h } from '../dom';
import { formatDate } from '../format';
import { getUiCatalog, NATION_INFO } from '../catalog';
import { folderTabs, screenShell, withHints } from '../components';
import type { Nation } from '../../core/types';

export const acesScreen: ScreenFactory = (ctx) => {
  const shell = screenShell({
    id: 'aces',
    title: 'Hall of Fame',
    kicker: 'Aces of the Great War',
    background: artBackground('art/debrief-sky.jpg', 'radial-gradient(ellipse at 50% 30%, #4a3421, #150e08 80%)'),
    onBack: () => ctx.router.back(),
  });

  const pilots = ctx.services.campaign.listPilots().sort((a, b) => b.victories - a.victories);
  const yours = h(
    'div',
    { class: 'paper tilt-l' },
    h('h3', { class: 'panel-h' }, 'Your pilots'),
    pilots.length
      ? h(
          'table',
          { class: 'ledger' },
          h('thead', null, h('tr', null, h('th', null, 'Pilot'), h('th', null, 'Squadron'), h('th', null, 'Last entry'), h('th', { class: 'num' }, 'Victories'))),
          h(
            'tbody',
            null,
            ...pilots.map((p) =>
              h(
                'tr',
                { class: p.status === 'killed' ? 'fallen' : '' },
                h('td', null, `${p.rankAbbrev} ${p.name}`),
                h('td', null, p.squadronName),
                h('td', null, formatDate(p.date)),
                h('td', { class: 'num' }, String(p.victories)),
              ),
            ),
          ),
        )
      : h('p', { class: 'typed muted' }, 'No pilots yet. Their names will be written here.'),
  );

  const byNation = (n: Nation | 'all') => () => {
    const aces = getUiCatalog()
      .aces.filter((a) => n === 'all' || a.nation === n)
      .sort((a, b) => b.victories - a.victories);
    return h(
      'table',
      { class: 'ledger' },
      h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Ace'), h('th', null, 'Service'), h('th', null, 'Machine'), h('th', { class: 'num' }, 'Victories'))),
      h(
        'tbody',
        null,
        ...aces.map((a, i) =>
          h(
            'tr',
            null,
            h('td', { class: 'num' }, String(i + 1)),
            h('td', null, a.name, a.epithet ? h('div', { class: 'muted', style: 'font-size:.85em;font-style:italic' }, a.epithet) : null),
            h('td', null, NATION_INFO[a.nation].adjective),
            h('td', null, a.aircraft ?? ''),
            h('td', { class: 'num' }, String(a.victories)),
          ),
        ),
      ),
    );
  };
  const tabs = folderTabs([
    { id: 'all', label: 'All', render: byNation('all') },
    { id: 'germany', label: 'German', render: byNation('germany') },
    { id: 'britain', label: 'British', render: byNation('britain') },
    { id: 'france', label: 'French', render: byNation('france') },
    { id: 'usa', label: 'American', render: byNation('usa') },
  ]);
  const hist = h('div', { style: 'display:flex;flex-direction:column;min-height:0' }, tabs.bar, h('div', { class: 'paper tilt-r', style: 'flex:1;min-height:0;display:flex;flex-direction:column' }, tabs.panel));

  shell.content.append(h('div', { class: 'fame' }, yours, hist));
  withHints(shell);
  return { el: shell.el, music: 'menu', onTab: (d) => tabs.step(d) };
};
