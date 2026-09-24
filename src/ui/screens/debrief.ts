import type { CareerPilot, DebriefReport, MedalAward } from '../../core/campaignTypes';
import type { MissionDefinition, MissionResult, Nation, VictoryClaim } from '../../core/types';
import { AIRCRAFT } from '../../data/aircraft';
import type { ScreenFactory } from '../context';
import { artBackground, h, setChildren, svg } from '../dom';
import { formatDate, formatDuration, percent } from '../format';
import { medalDisplay, NATION_INFO, rankDisplay } from '../catalog';
import { medalSvg, pilotPortrait } from '../insignia';
import { screenShell, stamp, statBox, withHints } from '../components';
import { FATE_LABEL, MISSION_TYPE_LABEL } from '../labels';

type Page = { kind: string; render: () => HTMLElement; music?: 'victory' | 'defeat' | 'medal' };

const MASTHEAD: Record<Nation, string> = {
  britain: 'The Morning Gazette',
  germany: 'Berliner Kriegsbote',
  france: "L'Écho du Front",
  usa: 'The Doughboy Courier',
};

const PRICE: Record<Nation, string> = { britain: 'One Penny', germany: '10 Pfennig', france: '10 Centimes', usa: 'Two Cents' };
const TELEGRAPH: Record<Nation, string> = { britain: 'Post Office Telegraphs', germany: 'Reichstelegraph', france: 'Télégramme officiel', usa: 'Telegram' };

const MINISTRY: Record<Nation, string> = {
  britain: 'War Office, London',
  germany: 'Kriegsministerium, Berlin',
  france: 'Ministère de la Guerre, Paris',
  usa: 'War Department, Washington',
};

const EPITAPH: Record<Nation, [string, string]> = {
  britain: ['They shall grow not old, as we that are left grow old: age shall not weary them, nor the years condemn.', 'Laurence Binyon, 1914'],
  germany: ['Getreu bis in den Tod.', 'Faithful unto death'],
  france: ['Mort pour la France.', 'Died for France'],
  usa: ['Take up our quarrel with the foe: to you from failing hands we throw the torch; be yours to hold it high.', 'John McCrae, 1915'],
};

function newspaperBody(report: DebriefReport): string {
  const conf = report.claims.filter((c) => c.confirmed);
  const balloons = conf.filter((c) => c.victimAircraftId === 'balloon').length;
  const planes = conf.length - balloons;
  const parts: string[] = [];
  if (planes) parts.push(`${planes === 1 ? 'an enemy machine' : `${planes} enemy machines`}`);
  if (balloons) parts.push(`${balloons === 1 ? 'an observation balloon' : `${balloons} observation balloons`}`);
  const what = parts.length ? `destroyed ${parts.join(' and ')}` : 'fought a sharp engagement';
  const ace = conf.find((c) => c.victimAceId);
  return `Witnesses on the ground report that the patrol ${what} in the course of the action${ace ? `, among them the machine of a celebrated enemy ace` : ''}. ${report.missionSuccess ? 'Headquarters describes the operation as a complete success.' : 'The fighting was costly, but the spirit of the squadron is unbroken.'}`;
}

function victimName(c: VictoryClaim): string {
  if (c.victimAircraftId === 'balloon') return 'Observation balloon';
  const ac = AIRCRAFT[c.victimAircraftId as keyof typeof AIRCRAFT];
  return c.victimName || ac?.name || String(c.victimAircraftId).replace(/-/g, ' ');
}

export const debriefScreen: ScreenFactory = (ctx, params) => {
  const mission = params.mission as MissionDefinition;
  const result = params.result as MissionResult;
  const report = params.report as DebriefReport | undefined;
  const pilotId = params.pilotId as string | undefined;
  const pilot: CareerPilot | null = pilotId ? ctx.services.campaign.loadPilot(pilotId) : null;
  const nation: Nation = pilot?.nation ?? mission.flights.find((f) => f.role === 'player-flight')?.nation ?? 'britain';
  const squadron = pilot ? ctx.services.campaign.getSquadron(pilot.squadronId) : undefined;
  const fate = report?.pilotFate ?? result.playerFate;
  const success = report?.missionSuccess ?? result.missionSuccess;
  const name = pilot ? `${rankDisplay(pilot.rankId).title} ${pilot.firstName} ${pilot.lastName}` : 'The pilot';

  const shell = screenShell({
    id: 'debrief',
    title: 'Debriefing',
    kicker: `${MISSION_TYPE_LABEL[mission.type]} · ${formatDate(mission.date)}`,
    background: artBackground('art/debrief-sky.jpg', 'radial-gradient(ellipse at 50% 30%, #4a3a2a, #120c07 80%)'),
    hints: [
      ['Enter', 'Continue'],
      ['Esc', 'Skip'],
    ],
  });

  const pages: Page[] = [];

  // 1. Telegram for bad news.
  if (report && (fate === 'wounded' || fate === 'captured' || fate === 'killed')) {
    pages.push({
      kind: 'telegram',
      music: fate === 'wounded' ? undefined : 'defeat',
      render: () => {
        const line =
          fate === 'killed'
            ? `DEEPLY REGRET TO INFORM YOU THAT ${name.toUpperCase()} ${squadron ? squadron.shortName.toUpperCase() + ' ' : ''}WAS KILLED IN ACTION ON ${formatDate(mission.date).toUpperCase()} STOP`
            : fate === 'captured'
              ? `REGRET TO INFORM YOU THAT ${name.toUpperCase()} IS REPORTED MISSING BELIEVED PRISONER OF WAR AFTER AIR COMBAT ${formatDate(mission.date).toUpperCase()} STOP`
              : `REGRET TO INFORM YOU THAT ${name.toUpperCase()} WAS WOUNDED IN ACTION ${formatDate(mission.date).toUpperCase()} STOP ADMITTED TO HOSPITAL STOP FURTHER NEWS FOLLOWS STOP`;
        return h(
          'div',
          { class: 'telegram' },
          h('div', { class: 't-head' }, h('span', null, TELEGRAPH[nation]), h('span', null, formatDate(mission.date))),
          h('div', { class: 't-body' }, h('span', { class: 'strip' }, line), h('br'), h('br'), h('span', { class: 'strip' }, `— ${MINISTRY[nation].toUpperCase()}`)),
        );
      },
    });
  }

  // 2. Combat report.
  pages.push({
    kind: 'report',
    music: success && fate !== 'killed' ? 'victory' : undefined,
    render: () => {
      const claims = report?.claims ?? result.claims.map((c) => ({ ...c, confirmed: false }));
      const acc = result.roundsFired > 0 ? result.hits / result.roundsFired : 0;
      return h(
        'article',
        { class: 'report paper' },
        h(
          'div',
          { class: 'hdr' },
          h('div', null, h('div', { class: 'engraved muted', style: 'font-size:.8em' }, 'Combat Report'), h('h2', null, mission.title), h('div', { class: 'typed muted' }, `${FATE_LABEL[fate]} · ${formatDate(mission.date)}`)),
          stamp(success ? 'Mission Successful' : 'Mission Failed', success ? 'green' : '', 'big slam outcome'),
        ),
        h('hr', { class: 'rule double' }),
        h('div', { class: 'field-label' }, 'Claims'),
        h(
          'div',
          { class: 'claims' },
          ...(claims.length
            ? claims.map((c) =>
                h(
                  'div',
                  { class: 'claim' },
                  h('span', null, `${victimName(c)}${c.victimAceId ? ' — a famous ace!' : ''}${c.shared ? ' (shared)' : ''}`),
                  report ? stamp(c.confirmed ? 'Confirmed' : 'Unconfirmed', c.confirmed ? '' : 'blue', 'slam') : stamp('Claimed', 'blue'),
                ),
              )
            : [h('div', { class: 'typed muted' }, 'No claims submitted.')]),
        ),
        h(
          'div',
          { class: 'report-stats' },
          statBox(formatDuration(result.flightTimeS), 'Time aloft'),
          statBox(result.roundsFired, 'Rounds fired'),
          statBox(result.hits, 'Hits'),
          statBox(percent(acc), 'Accuracy'),
        ),
        mission.objectives.length
          ? h(
              'ul',
              { class: 'objectives' },
              ...mission.objectives.map((o) => {
                const done = result.objectives.find((r) => r.id === o.id)?.completed;
                return h('li', { class: `${o.primary ? 'primary' : ''} ${done ? 'done' : ''}` }, o.description);
              }),
            )
          : null,
        result.friendlyLosses.length
          ? h('div', null, h('div', { class: 'field-label' }, 'Losses'), h('div', { class: 'typed', style: 'font-size:.9em' }, result.friendlyLosses.map((l) => `${l.name} — ${FATE_LABEL[l.fate].toLowerCase()}`).join('; ')))
          : null,
        report?.narrative.length ? h('div', { class: 'narrative', style: 'margin-top:.8em' }, ...report.narrative.map((t) => h('p', null, t))) : null,
        h('div', { class: 'report-foot' }, continueBtn()),
      );
    },
  });

  // 3. Newspaper.
  if (report?.newspaperHeadline) {
    pages.push({
      kind: 'newspaper',
      render: () =>
        h(
          'div',
          { class: 'newspaper' },
          h('div', { class: 'masthead' }, MASTHEAD[nation]),
          h('div', { class: 'dateline' }, h('span', null, formatDate(mission.date)), h('span', null, 'Special War Edition'), h('span', null, PRICE[nation])),
          h('div', { class: 'headline' }, report.newspaperHeadline!),
          h(
            'div',
            { class: 'cols' },
            h('p', null, `From our correspondent at the front. — ${name}${squadron ? ` of ${squadron.name}` : ''} was in action again this week in the skies above the lines.`),
            h('p', null, newspaperBody(report)),
            h('p', null, `The ${NATION_INFO[nation].service} continues to hold the upper hand, and the public may take heart from the daring of these young men of the air.`),
          ),
          h('div', { style: 'text-align:right;margin-top:1em' }, continueBtn()),
        ),
    });
  }

  // 4. Promotion.
  if (report?.promotion) {
    const { fromRankId, toRankId } = report.promotion;
    pages.push({
      kind: 'promotion',
      music: 'medal',
      render: () =>
        h(
          'div',
          { class: 'ceremony' },
          h('div', { class: 'c-kicker' }, 'By order of the General Staff'),
          h('h2', null, 'Promotion'),
          h('div', { class: 'photo' }, svg(pilotPortrait(nation, 140))),
          h('div', { class: 'rank-insignia' }, h('span', { class: 'from' }, rankDisplay(fromRankId).title), '→', h('span', null, rankDisplay(toRankId).title)),
          h('p', { class: 'typed', style: 'max-width:30em' }, `${pilot ? `${pilot.firstName} ${pilot.lastName}` : 'You'} is promoted to the rank of ${rankDisplay(toRankId).title}, with effect from ${formatDate(mission.date)}.`),
          continueBtn(true),
        ),
    });
  }

  // 5. Medals.
  for (const m of report?.medals ?? []) pages.push(medalPage(m, nation));

  // 6. Career over.
  if (report?.careerEnded) {
    pages.push({
      kind: 'memorial',
      music: fate === 'killed' ? 'defeat' : undefined,
      render: () => {
        const confirmed = pilot?.victories.filter((v) => v.confirmed).length ?? 0;
        const [ep, by] = EPITAPH[nation];
        const cross = `<svg viewBox="0 0 60 90" class="cross" aria-hidden="true"><path d="M24,0 H36 V24 H60 V36 H36 V90 H24 V36 H0 V24 H24 Z" fill="#d8c9a6"/></svg>`;
        return h(
          'div',
          { class: 'memorial' },
          fate === 'killed' ? svg(cross) : svg(pilotPortrait(nation, 110, 'memorial')),
          h('div', { class: 'c-kicker engraved', style: 'color:var(--brass-hi)' }, fate === 'killed' ? 'In memoriam' : fate === 'captured' ? 'Prisoner of War' : 'The war is over'),
          h('h2', null, pilot ? `${pilot.firstName} ${pilot.lastName}` : name),
          h('div', { class: 'typed' }, `${pilot ? rankDisplay(pilot.rankId).title : ''}${squadron ? `, ${squadron.name}` : ''}`),
          h('div', { class: 'typed' }, `${pilot?.missionsFlown ?? 0} sorties · ${confirmed} confirmed victories · ${pilot?.medals.length ?? 0} decorations`),
          fate === 'killed' ? h('p', { class: 'epitaph' }, `“${ep}”`, h('br'), h('small', null, `— ${by}`)) : h('p', { class: 'epitaph' }, fate === 'captured' ? 'Held in captivity until the Armistice. The skies went on without you.' : 'You survived the war in the air — few can say the same.'),
          continueBtn(true, 'Close the record'),
        );
      },
    });
  }

  let index = 0;
  const stage = h('div', { class: 'debrief' });
  const glow = h('div', { class: 'glow-rays' });

  function continueBtn(light = false, label?: string): HTMLButtonElement {
    const last = index >= pages.length - 1;
    return h(
      'button',
      { class: `btn primary ${light ? 'light' : ''}`, 'data-autofocus': '', onClick: () => next() },
      label ?? (last ? (report ? 'Return to the squadron' : 'Done') : 'Continue →'),
    );
  }

  function show(): void {
    const page = pages[index];
    setChildren(stage, page.render());
    glow.hidden = !(page.kind === 'promotion' || page.kind === 'medal');
    if (page.music) ctx.services.audio.playMusic(page.music);
    if (page.kind === 'report' || page.kind === 'medal') ctx.services.audio.playUi('stamp');
    if (page.kind === 'telegram') ctx.services.audio.playUi('typewriter');
    // Telegram and newspaper have no in-page button: add one below.
    if (page.kind === 'telegram') stage.append(h('div', { style: 'margin-top:1.4em' }, continueBtn(true)));
    requestAnimationFrame(() => (stage.querySelector('[data-autofocus]') as HTMLElement | null)?.focus());
  }

  function finish(): void {
    if (pilotId) ctx.router.replace('hq', { pilotId });
    else ctx.router.back();
  }

  function next(): void {
    if (index >= pages.length - 1) return finish();
    index++;
    show();
  }

  shell.content.append(stage);
  shell.el.querySelector('.rb-bg')!.after(glow);
  withHints(shell);
  show();

  return {
    el: shell.el,
    onBack: () => {
      next();
      return true;
    },
  };

  function medalPage(m: MedalAward, n: Nation): Page {
    const d = medalDisplay(m.medalId, n);
    return {
      kind: 'medal',
      music: 'medal',
      render: () => {
        const medal = svg(medalSvg(d, 180));
        medal.classList.add('medal-big');
        return h(
          'div',
          { class: 'ceremony' },
          h('div', { class: 'c-kicker' }, 'Awarded'),
          h('h2', null, d.name),
          medal,
          h('div', { class: 'citation paper' }, m.citation || d.description || `For conspicuous gallantry and devotion to duty in the air.`),
          continueBtn(true),
        );
      },
    };
  }
};
