/**
 * STUB UI: a bare main menu with a quick-mission setup and a text debrief.
 * Replaced by src/ui createUi.
 */
import type { GameServices } from '../../core/interfaces';
import type { AircraftId, MissionResult } from '../../core/types';
import { AIRCRAFT_LIST } from '../../data/aircraft';
import type { UiHandle } from '../moduleTypes';

export function stubCreateUi(root: HTMLElement, services: GameServices): UiHandle {
  const shell = document.createElement('div');
  shell.style.cssText = 'position:fixed;inset:0;background:#1c1a16;color:#efe6cf;font:15px Georgia,serif;display:flex;align-items:center;justify-content:center';
  root.appendChild(shell);
  const flightHost = document.createElement('div');
  flightHost.style.cssText = 'position:fixed;inset:0;display:none';
  root.appendChild(flightHost);

  const flyable = AIRCRAFT_LIST.filter((a) => a.flyable);
  const opt = (sel: string) =>
    AIRCRAFT_LIST.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a.name}</option>`).join('');

  function menu() {
    shell.innerHTML = `
      <div style="max-width:460px;padding:24px">
        <h1 style="font-weight:normal;letter-spacing:.08em;margin:0 0 4px">RED BARON II</h1>
        <div style="opacity:.7;margin-bottom:20px">Reloaded — development build</div>
        <label>Your aircraft<br><select id="pa">${flyable.map((a) => `<option value="${a.id}" ${a.id === 'sopwith_camel' ? 'selected' : ''}>${a.name}</option>`).join('')}</select></label><br><br>
        <label>Enemy aircraft<br><select id="ea">${opt('albatros_dv')}</select></label><br><br>
        <label>Enemies <input id="ec" type="number" min="1" max="8" value="2" style="width:3em"></label>
        <label style="margin-left:12px">Wingmen <input id="wc" type="number" min="0" max="3" value="1" style="width:3em"></label><br><br>
        <button data-testid="quick-mission" style="font:inherit;padding:8px 18px">Quick Mission</button>
      </div>`;
    shell.querySelector('button')!.addEventListener('click', () => {
      services.audio.playUi('confirm');
      const val = (id: string) => (shell.querySelector(`#${id}`) as HTMLInputElement).value;
      const mission = services.campaign.buildQuickMission({
        playerAircraft: val('pa') as AircraftId,
        enemyAircraft: val('ea') as AircraftId,
        enemyCount: Number(val('ec')),
        wingmen: Number(val('wc')),
        enemySkill: 'regular',
        wingmanSkill: 'regular',
        altitudeM: 1500,
        startPosition: 'head-on',
        timeOfDay: 'morning',
        cloudCover: 0.3,
        type: 'dogfight',
      });
      shell.style.display = 'none';
      flightHost.style.display = 'block';
      services.launcher
        .fly(mission, services.getSettings(), flightHost)
        .then(debrief, (err) => {
          console.error(err);
          debrief(null);
        });
    });
  }

  function debrief(r: MissionResult | null) {
    flightHost.style.display = 'none';
    flightHost.innerHTML = '';
    shell.style.display = 'flex';
    shell.innerHTML = r
      ? `<div data-testid="debrief" style="max-width:460px;padding:24px"><h2 style="font-weight:normal">Debriefing</h2>
         <p>Fate: ${r.playerFate}. Mission ${r.missionSuccess ? 'successful' : 'failed'}.</p>
         <p>Claims: ${r.claims.length} (${r.claims.filter((c) => c.witnessed).length} witnessed). Enemy losses: ${r.enemyLosses}.</p>
         <p>Rounds fired: ${r.roundsFired}, hits: ${r.hits}. Flight time ${Math.round(r.flightTimeS)} s.</p>
         <button style="font:inherit;padding:8px 18px">Back</button></div>`
      : `<div style="padding:24px"><p>The flight ended with an error.</p><button>Back</button></div>`;
    shell.querySelector('button')!.addEventListener('click', menu);
  }

  menu();
  return {
    dispose() {
      shell.remove();
      flightHost.remove();
    },
  };
}
