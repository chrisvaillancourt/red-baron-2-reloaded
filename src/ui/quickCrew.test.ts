import { describe, expect, it } from 'vitest';
import { buildQuickMission } from '../campaign/quickMission';
import { QUICK_DEFAULTS } from '../data/quickDefaults';
import { applyPlayerStation, bombingRaidsOffered, devBombingRaid, sanitizeQuickOptions } from './quickCrew';

const me = (m: ReturnType<typeof buildQuickMission>) => m.flights.flatMap((f) => f.members.map((x) => ({ f, x }))).find((e) => e.x.isPlayer)!;

describe('quick mission crew options', () => {
  it('offers bombing raids only on a dev server asked for them', () => {
    expect(bombingRaidsOffered(true, '?bombing')).toBe(true);
    expect(bombingRaidsOffered(true, '?bombing=1&x=2')).toBe(true);
    expect(bombingRaidsOffered(true, '')).toBe(false);
    expect(bombingRaidsOffered(false, '?bombing')).toBe(false);
  });

  it('drops a saved raid while raids are hidden, and a seat the aircraft lacks', () => {
    expect(sanitizeQuickOptions({ ...QUICK_DEFAULTS, type: 'bombing' }, false).type).toBe('dogfight');
    expect(sanitizeQuickOptions({ ...QUICK_DEFAULTS, type: 'bombing' }, true).type).toBe('bombing');
    expect(sanitizeQuickOptions({ ...QUICK_DEFAULTS, playerStation: 'observer' }, false).playerStation).toBeUndefined(); // a Camel
    expect(sanitizeQuickOptions({ ...QUICK_DEFAULTS, playerAircraft: 'bristol_f2b', playerStation: 'observer' }, false).playerStation).toBe('observer');
  });

  it('puts the player at the chosen seat, leaving the pilot seat unmarked', () => {
    const o = { ...QUICK_DEFAULTS, playerAircraft: 'bristol_f2b' as const };
    expect(me(applyPlayerStation(buildQuickMission(o, 1), 'observer')).x.station).toBe('observer');
    expect(me(applyPlayerStation(buildQuickMission(o, 1), 'pilot')).x.station).toBeUndefined();
  });

  it('builds a dev bomb run: task bomb, a bomb waypoint, a bombing mission', () => {
    const m = devBombingRaid((x) => buildQuickMission(x, 7), { ...QUICK_DEFAULTS, playerAircraft: 'dh4', type: 'bombing' });
    const { f } = me(m);
    expect(m.type).toBe('bombing');
    expect(f.task).toBe('bomb');
    expect(f.waypoints.some((w) => w.action === 'bomb')).toBe(true);
    expect(f.waypoints.some((w) => w.action === 'attack-ground')).toBe(false);
    expect(m.groundTargets.length).toBeGreaterThan(0);
  });
});
