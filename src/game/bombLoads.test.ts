import { describe, expect, it } from 'vitest';
import type { SimModule } from '../core/interfaces';
import { DEFAULT_SETTINGS } from '../core/settings';
import { effectiveMass, getCoefficients } from '../sim';
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

  it('trims each aircraft for the bombs it carries', () => {
    const masses = new Map<string, number | undefined>();
    const sim: SimModule = {
      ...headlessModules.sim,
      createFlightState: (spec, start, env, onGround, massKg) => {
        masses.set(spec.id, massKg);
        return headlessModules.sim.createFlightState(spec, start, env, onGround, massKg);
      },
    };
    const m = dh4BombRun();
    m.type = 'patrol';
    playerMember(m).flight.task = 'fighter-sweep';
    const p = new SimCore({ ...headlessModules, sim }, m, realism).world.player!;
    const full = getCoefficients(p.spec).mass;
    expect(effectiveMass(p)).toBeLessThan(full);
    expect(masses.get(p.spec.id)).toBe(effectiveMass(p));
    const loaded = new SimCore({ ...headlessModules, sim }, dh4BombRun(), realism).world.player!;
    expect(effectiveMass(loaded)).toBe(full);
  });
});
