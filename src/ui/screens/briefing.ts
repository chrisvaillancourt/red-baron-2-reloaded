import type { MissionDefinition } from '../../core/types';
import { AIRCRAFT } from '../../data/aircraft';
import { getAerodrome } from '../../data/aerodromes';
import type { ScreenFactory } from '../context';
import { artBackground, h } from '../dom';
import { formatAltitude, formatDate, resolveUnits } from '../format';
import { createMapCanvas, missionMapView } from '../map/mapRenderer';
import { screenShell, stamp, withHints } from '../components';
import { MISSION_TYPE_LABEL, SKILL_LABEL, TIME_LABEL, weatherSummary, windFrom } from '../labels';
import { rankDisplay } from '../catalog';

export const briefingScreen: ScreenFactory = (ctx, params) => {
  const mission = params.mission as MissionDefinition;
  const pilotId = params.pilotId as string | undefined;
  const campaign = ctx.services.campaign;
  const player = mission.flights.find((f) => f.role === 'player-flight') ?? mission.flights[0];
  const units = resolveUnits(ctx.settings().units, player?.nation ?? 'britain');

  const shell = screenShell({
    id: 'briefing',
    title: 'Briefing',
    kicker: `${MISSION_TYPE_LABEL[mission.type]} · ${formatDate(mission.date)}`,
    background: artBackground('art/briefing-desk.jpg', 'radial-gradient(ellipse at 40% 30%, #4a3421, #150e08 80%)'),
    onBack: () => ctx.router.back(),
    hints: [
      ['Enter', 'Take off'],
      ['Esc', 'Back'],
    ],
  });

  const map = createMapCanvas(missionMapView(mission, units.system));
  const legend = h(
    'div',
    { class: 'map-legend paper' },
    h('i', { style: 'border-top:2px dashed #1d1813' }),
    'Route',
    h('i', { style: 'background:repeating-linear-gradient(45deg,#6b5236 0 2px,transparent 2px 5px);height:.8em' }),
    "No man's land",
    h('i', { style: 'border-top:2px solid #2f4a86' }),
    'Allied trenches',
    h('i', { style: 'border-top:2px solid #9a2a22' }),
    'German trenches',
  );
  const mapFrame = h('div', { class: 'map-frame' }, map.canvas, legend);

  const altitudes = player?.waypoints.map((w) => w.altitude) ?? [];
  const patrolAlt = altitudes.length ? Math.max(...altitudes) : (player?.start.altitude ?? 0);
  const home = getAerodrome(mission.homeAerodromeId);

  const fact = (k: string, v: string) => h('div', { class: 'f' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));

  const members = player?.members ?? [];
  const pilot = pilotId ? campaign.loadPilot(pilotId) : null;

  const takeOff = h(
    'button',
    {
      class: 'btn primary big',
      'data-autofocus': '',
      onClick: async () => {
        takeOff.disabled = true;
        const result = await ctx.fly(mission);
        takeOff.disabled = false;
        if (!result) return;
        if (mission.isCareer && pilotId) {
          const p = campaign.loadPilot(pilotId);
          if (!p) return ctx.router.reset('roster');
          try {
            const report = campaign.applyMissionResult(p, mission, result);
            ctx.router.replace('debrief', { report, result, mission, pilotId });
          } catch (e) {
            console.error('[ui] applyMissionResult failed', e);
            ctx.router.replace('debrief', { result, mission, pilotId });
          }
        } else {
          ctx.router.replace('debrief', { result, mission, quick: true });
        }
      },
    },
    'Take off',
  );

  const paper = h(
    'div',
    { class: 'brief-paper paper tilt-r pinned' },
    h(
      'div',
      { class: 'hdr' },
      h('div', null, h('div', { class: 'engraved muted', style: 'font-size:.8em' }, MISSION_TYPE_LABEL[mission.type]), h('h2', null, mission.title)),
      stamp(mission.isCareer ? 'Secret' : 'Exercise', mission.isCareer ? '' : 'blue', 'secret'),
    ),
    h(
      'div',
      { class: 'brief-facts' },
      fact('Date', formatDate(mission.date)),
      fact('Time', TIME_LABEL[mission.timeOfDay]),
      fact('Machine', player ? AIRCRAFT[player.aircraftId].shortName : '—'),
      fact('Weather', weatherSummary(mission.weather)),
      fact('Wind', windFrom(mission.weather)),
      fact('Cloud base', mission.weather.cloudCover > 0.1 ? formatAltitude(mission.weather.cloudBaseM, units.system) : 'none'),
      fact('Patrol height', formatAltitude(patrolAlt, units.system)),
      fact('Home field', home?.name ?? '—'),
      fact('Flight', `${members.length} machine${members.length === 1 ? '' : 's'}`),
    ),
    h('hr', { class: 'rule' }),
    h('div', { class: 'brief-text' }, ...mission.briefing.split(/\n\s*\n/).map((para) => h('p', null, para.trim()))),
    h('div', { class: 'field-label' }, 'Objectives'),
    h('ul', { class: 'objectives' }, ...mission.objectives.map((o) => h('li', { class: o.primary ? 'primary' : '' }, o.description + (o.primary ? '' : ' (secondary)')))),
    h('div', { class: 'field-label', style: 'margin-top:.4em' }, 'Your flight'),
    h(
      'div',
      { class: 'flight-roster' },
      ...members.map((m, i) =>
        h(
          'div',
          { class: m.isPlayer ? 'me' : '' },
          `${i === 0 ? 'Leader' : `No. ${i + 1}`}: `,
          m.isPlayer && pilot ? `${rankDisplay(pilot.rankId).abbrev} ${pilot.firstName} ${pilot.lastName} (you)` : m.isPlayer ? 'You' : (m.pilotName ?? 'Squadron pilot'),
          m.isPlayer ? '' : ` — ${SKILL_LABEL[m.skill]}`,
        ),
      ),
    ),
  );

  shell.content.append(h('div', { class: 'briefing' }, mapFrame, paper), h('div', { class: 'brief-foot' }, h('span', { class: 'typed', style: 'color:rgba(235,224,198,.7);font-size:.8em' }, 'Study the map. Once aloft, press M for the map and N to end the flight when safe.'), takeOff));
  withHints(shell);

  return {
    el: shell.el,
    music: 'briefing',
    dispose: () => map.dispose(),
  };
};
