import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import { headlessModules } from './autoplay';
import { SimCore } from './simCore';
import { bristolFight, dh4BombRun, playerMember } from './testing/crewMissions';
import { sortieCarriesBombs } from './world';

const realism = () => DEFAULT_SETTINGS.realism;

describe('bomb loads', () => {
  it('loads the D.H.4 for a bombing sortie and nothing on a fighter sortie', () => {
    const bomber = new SimCore(headlessModules, dh4BombRun(), realism);
    const p = bomber.world.player!;
    expect(p.bombs).toEqual(p.spec.bombs!.map((b) => b.count));
    const fighter = new SimCore(headlessModules, bristolFight(), realism);
    expect(fighter.world.player!.bombs).toBeUndefined();
  });

  it('loads a flight tasked to bomb, and the player\'s flight on a bombing raid, but not escorts', () => {
    const m = dh4BombRun();
    const { flight } = playerMember(m);
    expect(sortieCarriesBombs(m, flight)).toBe(true);
    expect(sortieCarriesBombs(m, { ...flight, task: 'escort', role: 'friendly' })).toBe(false);
    expect(sortieCarriesBombs({ ...m, type: 'patrol' }, { ...flight, task: 'fighter-sweep' })).toBe(false);
  });

  it('leaves a D.H.4 without bombs when it flies a mission other than bombing', () => {
    const m = dh4BombRun();
    m.type = 'patrol';
    playerMember(m).flight.task = 'fighter-sweep';
    expect(new SimCore(headlessModules, m, realism).world.player!.bombs).toBeUndefined();
  });
});
