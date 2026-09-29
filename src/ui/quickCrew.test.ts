import { describe, expect, it } from 'vitest';
import { buildQuickMission } from '../campaign/quickMission';
import { QUICK_DEFAULTS } from '../data/quickDefaults';
import { quickPlayerAircraft, sanitizeQuickOptions } from './quickCrew';

const me = (m: ReturnType<typeof buildQuickMission>) => m.flights.flatMap((f) => f.members.map((x) => ({ f, x }))).find((e) => e.x.isPlayer)!;

describe('quick mission crew options', () => {
  it('offers bomb carriers for a raid and flyable types for everything else', () => {
    const raid = quickPlayerAircraft('bombing');
    expect(raid.map((s) => s.id)).toContain('dh4');
    expect(raid.every((s) => !!s.bombs?.length)).toBe(true);
    const fight = quickPlayerAircraft('dogfight');
    expect(fight.every((s) => s.flyable)).toBe(true);
    expect(fight.map((s) => s.id)).not.toContain('dh4');
  });

  it('switches to a bomber for a raid and back to a fighter after one, and drops a seat the aircraft lacks', () => {
    expect(sanitizeQuickOptions({ ...QUICK_DEFAULTS, type: 'bombing' }).playerAircraft).toBe('dh4');
    const back = sanitizeQuickOptions({ ...QUICK_DEFAULTS, playerAircraft: 'dh4', playerStation: 'observer', type: 'dogfight' });
    expect(back.playerAircraft).toBe(QUICK_DEFAULTS.playerAircraft);
    expect(back.playerStation).toBeUndefined(); // the default fighter has one seat
    expect(sanitizeQuickOptions({ ...QUICK_DEFAULTS, type: 'bombing', playerAircraft: 'dh4', playerStation: 'observer' }).playerStation).toBe('observer');
    expect(sanitizeQuickOptions({ ...QUICK_DEFAULTS, playerStation: 'observer' }).playerStation).toBeUndefined(); // a Camel
    expect(sanitizeQuickOptions({ ...QUICK_DEFAULTS, playerAircraft: 'bristol_f2b', playerStation: 'observer' }).playerStation).toBe('observer');
  });

  it('the builder puts the player at the chosen seat, leaving the pilot seat unmarked', () => {
    const o = { ...QUICK_DEFAULTS, playerAircraft: 'bristol_f2b' as const };
    expect(me(buildQuickMission({ ...o, playerStation: 'observer' }, 1)).x.station).toBe('observer');
    expect(me(buildQuickMission({ ...o, playerStation: 'pilot' }, 1)).x.station).toBeUndefined();
  });

  it('the builder makes the raid: task bomb, a bomb waypoint over targets, the seat kept', () => {
    const m = buildQuickMission(sanitizeQuickOptions({ ...QUICK_DEFAULTS, type: 'bombing', playerStation: 'observer' }), 7);
    const { f, x } = me(m);
    expect(m.type).toBe('bombing');
    expect(f.task).toBe('bomb');
    expect(f.waypoints.some((w) => w.action === 'bomb' && !!w.targetIds?.length)).toBe(true);
    expect(m.groundTargets.length).toBeGreaterThan(0);
    expect(x.station).toBe('observer');
  });
});
