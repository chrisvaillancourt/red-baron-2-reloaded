import type { CareerPilot, SquadronInfo } from '../../core/campaignTypes';
import type { AircraftId, MissionDefinition } from '../../core/types';
import { AIRCRAFT } from '../../data/aircraft';
import { getAerodrome } from '../../data/aerodromes';
import type { ScreenFactory } from '../context';
import { artBackground, h, svg } from '../dom';
import { formatDate, formatDateShort, resolveUnits } from '../format';
import { aceDisplay, medalDisplay, NATION_INFO, rankDisplay, serviceName } from '../catalog';
import { aircraftProfile, medalSvg, pilotPortrait, ribbonBar, squadronBadge } from '../insignia';
import { folderTabs, screenShell, stamp, statBox, withHints } from '../components';
import { aircraftCard, specSheet } from '../aircraftCards';
import { FATE_LABEL, MISSION_TYPE_LABEL, TIME_LABEL, weatherSummary } from '../labels';
import { equipmentOn } from './createPilot';

const CLOSED = new Set(['killed', 'captured', 'retired', 'war-over']);

export const hqScreen: ScreenFactory = (ctx, params) => {
  const campaign = ctx.services.campaign;
  const pilotId = String(params.pilotId ?? '');
  const loaded = campaign.loadPilot(pilotId);
  if (!loaded) {
    queueMicrotask(() => {
      ctx.toast('That service record could not be found.');
      ctx.router.reset('title');
    });
    return { el: document.createElement('section') };
  }
  const p: CareerPilot = loaded;
  const sq = campaign.getSquadron(p.squadronId);
  const rank = rankDisplay(p.rankId);
  const units = resolveUnits(ctx.settings().units, p.nation);
  const closed = CLOSED.has(p.status);

  let aircraftChoices: AircraftId[] = [];
  try {
    aircraftChoices = campaign.availableAircraft(p);
  } catch (e) {
    console.warn('[ui] availableAircraft failed', e);
  }
  let aircraft: AircraftId | undefined =
    p.preferredAircraft && aircraftChoices.includes(p.preferredAircraft) ? p.preferredAircraft : aircraftChoices[0];
  let mission: MissionDefinition | null = null;
  let missionError = '';
  const generate = () => {
    if (closed || p.status === 'hospital') return;
    try {
      mission = campaign.generateMission(p, aircraft);
      missionError = '';
    } catch (e) {
      console.error('[ui] generateMission failed', e);
      mission = null;
      missionError = 'Headquarters has not issued orders. (Mission generation failed.)';
    }
  };
  generate();

  const shell = screenShell({
    id: 'hq',
    title: sq?.name ?? 'Squadron Office',
    kicker: `${serviceName(p.nation, p.date, p.squadronId)} · ${formatDate(p.date)}`,
    background: artBackground('art/menu-aerodrome.jpg', 'radial-gradient(ellipse at 70% 20%, #4f3a24, #1b120b 75%)'),
    onBack: () => ctx.router.reset('title'),
    backLabel: 'Main menu',
    headerExtra: h('button', { class: 'btn light small', onClick: () => ctx.router.push('options') }, 'Options'),
  });

  // ---------------------------------------------------------------- dossier
  const medals = [...p.medals].sort((a, b) => medalDisplay(b.medalId, p.nation).precedence - medalDisplay(a.medalId, p.nation).precedence);
  const dossier = h(
    'aside',
    { class: 'hq-dossier paper tilt-l' },
    h('div', { class: 'portrait-frame' }, svg(pilotPortrait(p.nation, 120, p.status === 'killed' ? 'memorial' : 'alive')), h('div', { class: 'caption' }, `${p.firstName[0]}. ${p.lastName}`)),
    h('h2', null, `${p.firstName} ${p.lastName}`),
    h('div', { class: 'rank' }, rank.title, sq ? ` · ${sq.shortName}` : ''),
    medals.length ? h('div', { class: 'ribbon-rack' }, ...medals.map((m) => svg(ribbonBar(medalDisplay(m.medalId, p.nation))))) : null,
    h(
      'div',
      { class: 'stat-grid' },
      statBox(p.victories.filter((v) => v.confirmed).length, 'Victories'),
      statBox(p.missionsFlown, 'Sorties'),
      statBox(p.unconfirmedClaims, 'Unconfirmed'),
      statBox(p.medals.length, 'Decorations'),
    ),
    h('div', { class: 'field-label', style: 'margin-top:.4em' }, 'Renown'),
    h('div', { class: 'fame-bar' }, h('div', { style: { width: `${Math.max(0, Math.min(100, p.fame))}%` } })),
    closed ? h('div', { style: 'text-align:center;margin-top:.8em' }, stamp(p.status === 'killed' ? 'Killed in Action' : p.status === 'captured' ? 'Prisoner of War' : 'Record Closed', p.status === 'killed' ? '' : 'blue', 'big')) : null,
  );

  // ------------------------------------------------------------------ tabs
  const orders = () => {
    if (closed) {
      return h(
        'div',
        null,
        h('h3', { class: 'panel-h' }, 'Service record closed'),
        h('p', { class: 'typed' }, p.status === 'killed' ? `${rank.title} ${p.lastName} fell in the service of ${NATION_INFO[p.nation].short} and is entered in the Roll of Honour.` : p.status === 'captured' ? `${rank.title} ${p.lastName} is held as a prisoner of war for the duration.` : `${rank.title} ${p.lastName}'s war is over.`),
        h('button', { class: 'btn primary', 'data-autofocus': '', onClick: () => ctx.router.push('create-pilot') }, 'Enlist a new pilot'),
      );
    }
    if (p.status === 'hospital') {
      return h(
        'div',
        { class: 'hospital-note' },
        h('h3', { class: 'panel-h' }, 'Convalescing'),
        h('p', { class: 'typed' }, `After ${p.hospitalDays} day${p.hospitalDays === 1 ? '' : 's'} in hospital the medical officer passes you fit for flying duties.`),
        h(
          'button',
          {
            class: 'btn primary',
            'data-autofocus': '',
            onClick: () => {
              campaign.returnToDuty(p);
              ctx.router.replace('hq', { pilotId: p.id });
            },
          },
          'Return to duty',
        ),
      );
    }
    const card = mission
      ? h(
          'div',
          { class: 'mission-card' },
          stamp('Secret', '', ''),
          h('div', { class: 'm-type' }, MISSION_TYPE_LABEL[mission.type]),
          h('div', { class: 'm-title' }, mission.title),
          h(
            'div',
            { class: 'm-meta' },
            h('span', null, formatDate(mission.date)),
            h('span', null, TIME_LABEL[mission.timeOfDay]),
            h('span', null, weatherSummary(mission.weather)),
          ),
          h('p', { class: 'typed', style: 'font-size:.88em;margin:.8em 0 0' }, mission.objectives.find((o) => o.primary)?.description ?? ''),
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              { class: 'btn primary', 'data-autofocus': '', onClick: () => ctx.router.push('briefing', { mission, pilotId: p.id }) },
              'Proceed to briefing →',
            ),
          ),
        )
      : h('div', { class: 'mission-card' }, h('p', { class: 'typed' }, missionError || 'No orders today.'));

    const specHost = h('div');
    const renderSpec = () => specHost.replaceChildren(aircraft ? specSheet(AIRCRAFT[aircraft], units, sq?.livery) : h('p', { class: 'muted' }, 'No aircraft on strength.'));
    const picker = h('div', { class: 'ac-picker' });
    const renderPicker = () =>
      picker.replaceChildren(
        ...aircraftChoices.map((id) =>
          aircraftCard(AIRCRAFT[id], id === aircraft, () => {
            if (id === aircraft) return;
            aircraft = id;
            p.preferredAircraft = id;
            campaign.savePilot(p);
            generate();
            tabs.refresh();
          }),
        ),
      );
    renderPicker();
    renderSpec();
    return h(
      'div',
      { class: 'orders' },
      h('div', null, h('h3', null, "Today's orders"), card, h('h3', { style: 'margin-top:1.2em' }, 'Machine'), picker),
      h('div', null, h('h3', null, aircraft ? AIRCRAFT[aircraft].name : 'Aircraft'), specHost),
    );
  };

  const logbook = () =>
    p.log.length
      ? h(
          'table',
          { class: 'ledger' },
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Duty'), h('th', null, 'Machine'), h('th', { class: 'num' }, 'Claims'), h('th', null, 'Result'), h('th', null, 'Remarks'))),
          h(
            'tbody',
            null,
            ...[...p.log].reverse().map((e) =>
              h(
                'tr',
                null,
                h('td', null, formatDateShort(e.date)),
                h('td', null, e.missionTitle || MISSION_TYPE_LABEL[e.missionType]),
                h('td', null, AIRCRAFT[e.aircraftId]?.shortName ?? e.aircraftId),
                h('td', { class: 'num' }, e.claims ? `${e.confirmed}/${e.claims}` : '—'),
                h('td', null, FATE_LABEL[e.outcome]),
                h('td', null, e.notes),
              ),
            ),
          ),
        )
      : h('p', { class: 'typed muted' }, 'The logbook is empty. Your first sortie awaits.');

  const victories = () =>
    p.victories.length
      ? h(
          'div',
          { class: 'victory-list' },
          ...p.victories.map((v) =>
            h(
              'div',
              { class: `v ${v.confirmed ? '' : 'unconf'}` },
              h('span', { class: 'n' }, v.confirmed ? `#${v.number}` : '—'),
              h('span', null, v.victim, h('br'), h('small', { class: 'muted' }, v.location)),
              h('span', null, formatDateShort(v.date)),
            ),
          ),
        )
      : h('p', { class: 'typed muted' }, 'No victories yet. Five confirmed and they will call you an ace.');

  const medalCase = () =>
    h(
      'div',
      { class: 'medal-case' },
      ...(medals.length
        ? medals.map((m) => {
            const d = medalDisplay(m.medalId, p.nation);
            return h('div', { class: 'm', title: m.citation }, svg(medalSvg(d, 80)), h('div', null, d.name), h('div', { class: 'date' }, formatDateShort(m.date)));
          })
        : [h('div', { class: 'empty' }, 'The case is empty — for now.')]),
    );

  const aces = () => {
    let standings: ReturnType<typeof campaign.aceStandings> = [];
    try {
      standings = campaign.aceStandings(p);
    } catch (e) {
      console.warn(e);
    }
    return h(
      'table',
      { class: 'ledger' },
      h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Pilot'), h('th', null, 'Service'), h('th', { class: 'num' }, 'Victories'), h('th', null, 'Status'))),
      h(
        'tbody',
        null,
        ...standings.map((a, i) =>
          h(
            'tr',
            { class: `${a.isPlayer ? 'me' : ''} ${a.status === 'killed' ? 'fallen' : ''}` },
            h('td', { class: 'num' }, String(i + 1)),
            h('td', null, a.name),
            h('td', null, NATION_INFO[a.nation].adjective),
            h('td', { class: 'num' }, String(a.victories)),
            h('td', null, a.status === 'active' ? 'Flying' : a.status === 'killed' ? '✝ Killed' : a.status === 'captured' ? 'P.O.W.' : 'Survived'),
          ),
        ),
      ),
    );
  };

  const squadron = () => (sq ? squadronPanel(sq, p.date) : h('p', null, 'Unknown squadron.'));

  const tabs = folderTabs(
    [
      { id: 'orders', label: 'Orders', render: orders },
      { id: 'log', label: 'Logbook', render: logbook },
      { id: 'victories', label: 'Victories', render: victories },
      { id: 'medals', label: 'Decorations', render: medalCase },
      { id: 'aces', label: 'Ace Standings', render: aces },
      { id: 'squadron', label: 'Squadron', render: squadron },
    ],
    0,
  );

  const main = h('div', { class: 'hq-main' }, tabs.bar, h('div', { class: 'paper' }, tabs.panel));
  shell.content.append(h('div', { class: 'hq' }, dossier, main));
  withHints(shell);
  if (params.welcome && sq) queueMicrotask(() => ctx.toast(`${rankDisplay(p.rankId).title} ${p.lastName}, reporting to ${sq.name}.`));

  return {
    el: shell.el,
    music: 'briefing',
    onTab: (dir) => tabs.step(dir),
  };
};

function squadronPanel(sq: SquadronInfo, date: string): HTMLElement {
  const base = sq.bases.find((b) => b.from <= date && date <= b.to) ?? sq.bases[sq.bases.length - 1];
  const field = base ? getAerodrome(base.aerodromeId) : undefined;
  return h(
    'div',
    { class: 'squadron-info' },
    svg(squadronBadge(sq, 120)),
    h(
      'div',
      null,
      h('h3', { class: 'panel-h' }, sq.name, sq.motto ? h('span', { class: 'muted', style: 'font-style:italic;font-weight:400;font-size:.75em' }, ` — “${sq.motto}”`) : null),
      h('p', null, sq.description),
      h(
        'div',
        { class: 'typed', style: 'font-size:.88em;line-height:1.8' },
        h('div', null, 'Aerodrome: ', field?.name ?? '—'),
        h('div', null, 'Establishment: ', equipmentOn(sq, date).join(', ') || '—'),
        h('div', null, 'Formed: ', formatDate(sq.formed)),
        sq.notableAces.length ? h('div', null, 'Notable pilots: ', sq.notableAces.map((id) => aceDisplay(id)?.name ?? id).join(', ')) : null,
      ),
      (() => {
        const eq = (sq.equipment.find((e) => e.from <= date && date <= e.to) ?? sq.equipment[sq.equipment.length - 1])?.aircraft[0];
        return eq
          ? h('div', { class: 'livery-profile' }, svg(aircraftProfile(AIRCRAFT[eq], { livery: sq.livery, width: 520 })), h('div', { class: 'cap' }, `${AIRCRAFT[eq].name} in ${sq.shortName} markings`))
          : null;
      })(),
      h('h3', { class: 'panel-h', style: 'margin-top:1em;font-size:1em' }, 'Equipment history'),
      h(
        'table',
        { class: 'ledger' },
        h('tbody', null, ...sq.equipment.map((e) => h('tr', null, h('td', null, `${formatDateShort(e.from)} – ${formatDateShort(e.to)}`), h('td', null, e.aircraft.map((a) => AIRCRAFT[a]?.shortName ?? a).join(', '))))),
      ),
    ),
  );
}
