import '../styles/defense.css';
import type { DefenseOptions, DefenseResult } from '../../core/defense';
import type { ScreenFactory } from '../context';
import { artBackground, h } from '../dom';
import { codeLabel } from '../bindings';
import { formatDuration } from '../format';
import { screenShell, segmented, stamp, statBox, withHints } from '../components';

const FIELD_ART = artBackground('art/menu-aerodrome.jpg', 'radial-gradient(ellipse at 40% 30%, #4a3421, #150e08 80%)');
const DESK_ART = artBackground('art/briefing-desk.jpg', 'radial-gradient(ellipse at 50% 30%, #4a3421, #150e08 80%)');

function freshSeed(previous?: number): number {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  return seed === previous ? (seed + 1) >>> 0 : seed;
}

export const defenseBriefingScreen: ScreenFactory = (ctx, params) => {
  // The router retains this draft only for this briefing, including visits to the guide/options.
  // It never enters settings, a career, or persistent storage.
  const options: DefenseOptions = (params.options as DefenseOptions | undefined) ?? {
    seed: freshSeed(), difficulty: 'regular', aimAssist: true,
  };
  params.options = options;
  let live = true;
  const available = !!ctx.services.defense;
  const shell = screenShell({
    id: 'defense-briefing', title: 'Airfield Defense', kicker: 'Bertangles · 1 September 1917',
    background: FIELD_ART, onBack: () => ctx.router.back(),
  });
  const seedInput = h('input', {
    class: 'input', type: 'number', min: '0', max: '4294967295', step: '1', required: true,
    id: 'defense-seed', 'aria-describedby': 'defense-seed-help',
    onInput: () => {
      if (seedInput.validity.valid) options.seed = Number(seedInput.value);
    },
  });
  seedInput.value = String(options.seed);
  const launch = h('button', {
    class: 'btn primary big', disabled: !available, 'data-autofocus': available || undefined,
    dataset: { action: 'defense-launch' },
    onClick: async () => {
      if (!seedInput.reportValidity()) return;
      options.seed = Number(seedInput.value);
      launch.disabled = true;
      try {
        const result = await ctx.defend({ ...options });
        if (live && result) ctx.router.replace('defense-report', { result });
      } finally {
        if (live) launch.disabled = !available;
      }
    },
  }, 'Man the guns');
  const orders = h('article', { class: 'defense-orders paper', tabIndex: 0 },
    h('div', { class: 'defense-masthead' }, h('div', null, h('div', { class: 'engraved muted' }, 'Royal Flying Corps · Battery orders'), h('h2', null, 'Hold Bertangles')), stamp('Stand to', 'blue')),
    h('p', { class: 'typed' }, 'A five-raid defense exercise at the historical Bertangles aerodrome north of Amiens. These authored attacks are arcade-balanced, not a reenactment of a particular historical raid. Take the ground battery, not a cockpit; defend the field with your guns and your judgment.'),
    h('h3', null, 'Your orders'),
    h('ul', { class: 'objectives' },
      h('li', { class: 'primary' }, 'Keep at least one of the three assets standing until the fifth raid is over.'),
      h('li', null, 'Destroy the raiders and intercept falling bombs. An aircraft brought down may already have released its load.'),
      h('li', null, 'Between raids, spend requisition on repairs or battery upgrades. Take your time: resupply is untimed.'),
    ),
    h('div', { class: 'defense-assets' },
      h('section', null, h('h3', null, 'Headquarters'), h('p', null, 'Protects your requisition income. Without it, buying your way back to strength becomes harder.')),
      h('section', null, h('h3', null, 'Ammo depot'), h('p', null, 'Keeps the guns reloading quickly. Losing it slows the battery.')),
      h('section', null, h('h3', null, 'Hospital'), h('p', null, 'Repairs surviving assets after each raid. Destroyed assets require requisition to rebuild.')),
    ),
    h('h3', null, 'Three guns, three jobs'),
    h('p', null, h('strong', null, '1 · Machine gun. '), 'Fast close threats and falling bombs. ', h('strong', null, '2 · Cannon. '), 'Direct hits on heavier targets. ', h('strong', null, '3 · Timed flak. '), 'Range-set bursts against formations and heavy raiders.'),
    h('p', null, 'Ammunition, reload time and heat matter. Rounds take time to arrive; machine-gun and cannon fire falls under gravity. Switch weapons while a hot gun cools; set the flak fuze to the target’s range.'),
    h('h3', null, 'Requisition is a choice'),
    h('p', null, 'Repair or rebuild the field, or improve firepower, cooling and reload speed. A destroyed asset can be rebuilt only while another survives. If all three fall, the defense is lost. Upgrades and requisition reset for every new run.'),
    h('p', { class: 'typed muted' }, 'About 3–5 minutes of combat, plus resupply decisions. No pilot record, career result or flight report is written.'),
  );
  const choices = h('aside', { class: 'defense-choices paper' },
    h('h2', null, 'This attack'),
    h('div', { class: 'field' }, h('div', { class: 'field-label', id: 'defense-difficulty-label' }, 'Difficulty'),
      segmented<DefenseOptions['difficulty']>([{ value: 'regular', label: 'Regular' }, { value: 'veteran', label: 'Veteran' }], options.difficulty, value => { options.difficulty = value; })),
    h('p', { class: 'muted' }, 'Regular introduces the tools before overlapping threats. Veteran adds coordinated pressure, not tougher aircraft or extra upgrade money.'),
    h('div', { class: 'field' }, h('div', { class: 'field-label', id: 'defense-assistance-label' }, 'Lead assistance'),
      segmented([{ value: 'hint', label: 'Visual hint' }, { value: 'none', label: 'None' }], options.aimAssist ? 'hint' : 'none', value => { options.aimAssist = value === 'hint'; })),
    h('p', { class: 'muted' }, 'The gold lead suggestion is visual only. It never aims the gun or changes damage; you must still lead, range and fire.'),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'defense-seed' }, 'Attack seed'), seedInput),
    h('p', { class: 'typed muted', id: 'defense-seed-help' }, 'A whole number from 0 to 4294967295. The same seed, difficulty and assistance replay the same attack.'),
    h('button', { class: 'btn small', dataset: { action: 'defense-fresh-seed' }, onClick: () => { options.seed = freshSeed(options.seed); seedInput.value = String(options.seed); } }, 'Fresh seed'),
    h('hr', { class: 'rule' }),
    h('div', { class: 'defense-links' },
      h('button', { class: 'btn', dataset: { action: 'gunner-guide' }, onClick: () => ctx.router.push('gunner-guide') }, 'Gunner’s Guide'),
      h('button', { class: 'btn', onClick: () => ctx.router.push('options') }, 'Options'),
    ),
    h('p', { class: 'muted' }, 'Graphics, sound and shared controls remain in ordinary Options. These defense choices apply only to this briefing.'),
    !available && h('p', { class: 'typed', role: 'status' }, 'Airfield Defense is not available in this flight-only developer tool.'),
  );
  choices.querySelectorAll('.seg')[0].setAttribute('aria-labelledby', 'defense-difficulty-label');
  choices.querySelectorAll('.seg')[1].setAttribute('aria-labelledby', 'defense-assistance-label');
  shell.content.append(h('div', { class: 'defense-brief-layout' }, orders, choices), h('div', { class: 'defense-foot' }, h('span', { class: 'typed' }, 'Man the guns. Hold the line.'), launch));
  withHints(shell);
  return { el: shell.el, music: 'briefing', dispose() { live = false; } };
};

export const defenseReportScreen: ScreenFactory = (ctx, params) => {
  const result = params.result as DefenseResult;
  if (!result || result.kind !== 'airfield-defense') throw new Error('Defense report requires a battery result');
  const options = { ...result.options };
  let live = true;
  const mainMenu = () => ctx.router.reset('title');
  const outcome = { won: 'Won', lost: 'Lost', aborted: 'Aborted' }[result.outcome];
  const shell = screenShell({ id: 'defense-report', title: 'Defense Report', kicker: 'Bertangles · Battery action', background: DESK_ART, onBack: mainMenu, backLabel: 'Main menu' });
  const surviving = result.assets.filter(asset => asset.health > 0).length;
  const health = result.assets.reduce((total, asset) => total + asset.health, 0);
  const maxHealth = result.assets.reduce((total, asset) => total + asset.maxHealth, 0);
  const replay = h('button', {
    class: 'btn primary', 'data-autofocus': '', dataset: { action: 'defense-replay' }, disabled: !ctx.services.defense,
    onClick: async () => {
      replay.disabled = true;
      try {
        const next = await ctx.defend({ ...options });
        if (live && next) ctx.router.replace('defense-report', { result: next });
      } finally {
        if (live) replay.disabled = !ctx.services.defense;
      }
    },
  }, 'Replay same attack');
  const paper = h('article', { class: 'defense-report-paper paper', tabIndex: 0, dataset: { outcome: result.outcome } },
    h('div', { class: 'defense-masthead' }, h('div', null, h('div', { class: 'engraved muted' }, 'Independent battery action'), h('h2', null, 'The defense of Bertangles')), stamp(outcome, result.outcome === 'won' ? 'green' : result.outcome === 'aborted' ? 'blue' : '')),
    h('p', { class: 'typed', role: 'status' }, result.outcome === 'won' ? 'All five raids have settled. The airfield still stands.' : result.outcome === 'lost' ? 'All three defended assets were destroyed. The battery could not hold the field.' : 'You left the battery before the defense was decided. This is an aborted action, not a defeat.'),
    h('div', { class: 'defense-stats' },
      statBox(`${result.raidsSurvived} / 5`, 'Raids survived'), statBox(`${surviving} / ${result.assets.length}`, 'Assets standing'),
      statBox(`${Math.round(health)} / ${Math.round(maxHealth)}`, 'Objective health'), statBox(result.kills, 'Aircraft & airships down'),
      statBox(result.bombsIntercepted, 'Bombs intercepted'), statBox(result.score, 'Score'), statBox(formatDuration(result.time), 'Combat time'),
    ),
    h('h3', null, 'State of the field'),
    h('table', { class: 'defense-asset-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Asset'), h('th', { scope: 'col' }, 'Health'), h('th', { scope: 'col' }, 'Condition'))),
      h('tbody', null, ...result.assets.map(asset => h('tr', { dataset: { asset: asset.id } }, h('th', { scope: 'row' }, asset.name), h('td', null, `${Math.round(asset.health)} / ${Math.round(asset.maxHealth)}`), h('td', null, asset.health <= 0 ? 'Destroyed' : asset.health < asset.maxHealth ? 'Damaged' : 'Intact')))),
    ),
    h('h3', null, 'Attack details'),
    h('dl', { class: 'defense-details typed' },
      h('dt', null, 'Seed'), h('dd', { dataset: { defenseSeed: String(options.seed) } }, options.seed),
      h('dt', null, 'Difficulty'), h('dd', null, options.difficulty === 'regular' ? 'Regular' : 'Veteran'),
      h('dt', null, 'Lead assistance'), h('dd', null, options.aimAssist ? 'Visual hint only' : 'None'),
    ),
    h('p', { class: 'typed muted' }, 'Only this battery’s kills and interceptions are credited. This action has no effect on any pilot or career, and is not saved as a flight report.'),
  );
  shell.content.append(paper, h('div', { class: 'defense-foot defense-report-actions' }, replay,
    h('button', { class: 'btn light', dataset: { action: 'defense-new' }, onClick: () => ctx.router.replace('defense-briefing', { options: { ...options, seed: freshSeed(options.seed) } }) }, 'New defense'),
    h('button', { class: 'btn light', dataset: { action: 'defense-main-menu' }, onClick: mainMenu }, 'Main menu')));
  withHints(shell);
  return { el: shell.el, music: result.outcome === 'won' ? 'victory' : result.outcome === 'lost' ? 'defeat' : 'briefing', onBack() { mainMenu(); return true; }, dispose() { live = false; } };
};

export const gunnerGuideScreen: ScreenFactory = (ctx) => {
  const shell = screenShell({ id: 'gunner-guide', title: 'Gunner’s Guide', kicker: 'Airfield Defense · Instructions for the battery', background: DESK_ART, onBack: () => ctx.router.back() });
  const bindings = ctx.settings().controls.keyBindings;
  const fireKeys = [...new Set(bindings.fire ?? ['Space'])].map(codeLabel).join(' / ');
  const pauseKeys = [...new Set(['Escape', ...(bindings.pause ?? [])])].map(codeLabel).join(' / ');
  const controls: [string, string][] = [
    ['Mouse / ↑ ↓ ← →', 'Traverse and elevate the gun. Mouse sensitivity and inversion follow Options.'],
    [`Left mouse / ${fireKeys}`, 'Hold to fire continuously. Cooldown, ammunition, reload and heat limit each gun.'],
    ['Right mouse (hold)', 'Focus the sight. You may focus and fire together.'],
    ['1 / 2 / 3', 'Select machine gun / cannon / timed flak.'],
    ['R', 'Reload the selected gun. Watch the ammunition and reload indicators.'],
    ['Mouse wheel', 'Adjust the timed-flak fuze range.'],
    ['F', 'Set the flak range to the tracked target. Update it as the target approaches or turns.'],
    [pauseKeys, 'Pause. Use Return to the guns to recapture the mouse; use Abandon defense to end an aborted action.'],
  ];
  const paper = h('article', { class: 'doc-paper paper defense-guide', tabIndex: 0, 'data-autofocus': '' },
    h('h2', null, 'Stand to at Bertangles'),
    h('p', { class: 'typed' }, 'You command a ground battery defending headquarters, an ammunition depot and a hospital on 1 September 1917. Survive five raids with at least one asset standing. All three destroyed means defeat; leaving the battery means an aborted action.'),
    h('h3', null, 'Controls'),
    h('p', { class: 'muted' }, 'Click into the battery to capture the mouse. The shared fire and pause bindings shown below reflect your current Options; the battery-specific keys are fixed.'),
    h('div', { class: 'key-grid' }, ...controls.map(([key, description]) => h('div', { class: 'k' }, h('span', null, description), h('kbd', null, key)))),
    h('h3', null, 'Read the sight'),
    h('p', null, 'Your sight points along the gun’s aim. Rounds have travel time; machine-gun and cannon rounds drop under gravity. Aim ahead of a crossing aircraft and above distant targets. Focus helps you place the sight, but does not steer the gun.'),
    h('p', null, 'The tracked threat supplies range information. With visual assistance enabled in the briefing, a gold lead suggestion shows an estimated interception point. It is a suggestion, not a lock: it never aims, fires or changes damage. A turn or change in speed can spoil the solution. Assistance can be removed in the briefing.'),
    h('h3', null, 'Choose the right gun'),
    h('p', null, h('strong', null, 'Machine gun — '), 'Use quick bursts against close, fast threats and falling bombs. Follow the target through the burst. Watch heat; changing weapons lets a gun cool.'),
    h('p', null, h('strong', null, 'Cannon — '), 'Place direct hits on heavier aircraft. Its shells still need lead and elevation: firing at where a distant aircraft is now will miss.'),
    h('p', null, h('strong', null, 'Timed flak — '), 'Set range before firing. The shell bursts after its timed flight at the selected fuze range; useful against formations and heavy raiders, including the final airship. Wheel changes range; F ranges the tracked threat. A good bearing with the wrong fuze can burst short or beyond the target.'),
    h('h3', null, 'Do not forget the bombs'),
    h('p', null, 'Killing the last raider does not cancel bombs already falling. Intercept bombs with your machine gun to protect the assets. A raid completes only after remaining bombs and battery shells have settled; keep watch until resupply opens.'),
    h('h3', null, 'Protect what keeps you fighting'),
    h('p', null, h('strong', null, 'Headquarters '), 'protects requisition income. ', h('strong', null, 'The ammo depot '), 'speeds reloads. ', h('strong', null, 'The hospital '), 'repairs surviving assets after each raid. Losing any one weakens the defense, even while the others keep the field alive.'),
    h('h3', null, 'Resupply between raids'),
    h('p', null, 'Combat stops during resupply. Spend available requisition on repairs, rebuilding destroyed assets or upgrades to firepower, cooling and reload speed. Read the displayed prices and current levels before purchasing. Repairs preserve asset benefits; upgrades improve the guns, but will not save a field that has already lost all three assets.'),
    h('p', null, 'Rebuilding is possible only if at least one asset survived. The hospital’s automatic work is for surviving assets, not destroyed buildings. Requisition and upgrades belong to this action alone and start over on replay or a new defense. Choose the next raid only when ready.'),
    h('h3', null, 'Pause and return safely'),
    h('p', null, 'Pause, leaving the window, hiding the page or losing mouse capture freezes combat and releases held fire. Click Return to the guns to recapture the mouse, or choose Use keyboard controls. The resupply panel is also untimed. Abandon defense returns an Aborted report; it does not count as a loss or affect a pilot.'),
    h('h3', null, 'Difficulty, settings and replay'),
    h('p', null, 'Regular teaches the three weapons before mixing threats. Veteran increases coordination, numbers and pressure without inflating enemy health or handing out extra upgrade money. Unlimited ammunition in flight realism does not remove the battery’s ammunition, heat or reload mechanics.'),
    h('p', null, 'Use ordinary Options for graphics, audio volumes and shared mouse/fire/pause controls. Difficulty, visual lead assistance and seed are separate choices in each defense briefing; nothing is added to persistent settings.'),
    h('p', null, 'The Defense Report shows Won, Lost or Aborted; raids survived; asset health; aircraft and airships down; bombs intercepted; score; and the attack options. Replay same attack immediately uses the exact seed, difficulty and assistance. New defense opens the briefing with a fresh seed and lets you change the choices. Main menu clears defense navigation.'),
    h('p', { class: 'typed muted' }, 'This is an independent battery action. No career query or pilot tally is used, and no mission result or flight record is fabricated.'),
  );
  shell.content.append(paper);
  withHints(shell);
  return { el: shell.el, music: 'menu' };
};
