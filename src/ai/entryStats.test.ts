import { describe, expect, it } from 'vitest';
import type { AircraftEntity } from '../core/types';
import { EntryTracker, type PassRecord } from './entryStats';
import { makeAircraft } from './testing/testWorld';

function setup() {
  // A Bristol Fighter (fixed Vickers = mount 0, flexible rear Lewis = mount 1) and an Albatros
  // 400 m astern and 300 m above.
  const brisfit = makeAircraft({ id: 1, aircraftId: 'bristol_f2b', side: 'allied', x: 0, z: 0, alt: 2000, heading: 0 });
  const albatros = makeAircraft({ id: 2, aircraftId: 'albatros_dv', side: 'central', x: 0, z: 400, alt: 2300, heading: 0 });
  const world = { time: 0, aircraft: [brisfit, albatros] as AircraftEntity[] };
  const passes: PassRecord[] = [];
  const t = new EntryTracker(world, () => undefined, (a) => String(a.id), undefined, { onPass: (p) => passes.push(p) });
  return { brisfit, albatros, world, passes, t };
}

describe('EntryTracker', () => {
  it("doesn't count a rear gunner's defensive burst as an attack pass", () => {
    const { brisfit, passes, t } = setup();
    t.onFired(brisfit, 1); // the observer's Lewis at the Albatros
    expect(passes).toHaveLength(0);
    expect(t.get('1').passes).toBe(0);
    t.onFired(brisfit, 0); // the pilot's Vickers: a real pass
    expect(passes).toHaveLength(1);
    expect(passes[0].shooter).toBe(brisfit);
  });

  it('records a fixed-gun pass with its height advantage', () => {
    const { albatros, brisfit, passes, t } = setup();
    t.onFired(albatros, 0);
    expect(passes).toHaveLength(1);
    expect(passes[0].target).toBe(brisfit);
    expect(passes[0].above).toBe(true);
    expect(passes[0].heightAdvM).toBeCloseTo(300, 0);
  });
});
