import { describe, expect, it } from 'vitest';
import { finiteEnv, nonNegativeIntEnv, positiveIntEnv, selectSets } from './env';

describe('positiveIntEnv', () => {
  it('reads positive integers and falls back when unset', () => {
    expect(positiveIntEnv('REPLAY_REPS', undefined, 8)).toBe(8);
    expect(positiveIntEnv('REPLAY_REPS', '', 8)).toBe(8);
    expect(positiveIntEnv('REPLAY_REPS', ' 12 ', 8)).toBe(12);
  });

  it('rejects anything else, naming the variable', () => {
    for (const bad of ['0', '-3', '2.5', 'abc', '1e3', 'NaN', '8x']) {
      expect(() => positiveIntEnv('REPLAY_MAXTIME', bad, 2400)).toThrow(/REPLAY_MAXTIME must be a positive integer/);
    }
  });
});

describe('nonNegativeIntEnv', () => {
  it('accepts zero and positive integers, falling back when unset', () => {
    expect(nonNegativeIntEnv('AUTOPLAY_SEED_BASE', '0', 7)).toBe(0);
    expect(nonNegativeIntEnv('AUTOPLAY_SEED_BASE', '1000', 7)).toBe(1000);
    expect(nonNegativeIntEnv('AUTOPLAY_SEED_BASE', '', 7)).toBe(7);
  });

  it('rejects negatives, fractions and words', () => {
    for (const bad of ['-1', '1.5', 'abc']) {
      expect(() => nonNegativeIntEnv('AI_GD_TRACE', bad, 0)).toThrow(/AI_GD_TRACE must be a non-negative integer/);
    }
  });
});

describe('finiteEnv', () => {
  it('keeps fractional and negative values legal', () => {
    expect(finiteEnv('AI_TH_MAXTIME', '600.5', 600)).toBe(600.5);
    expect(finiteEnv('AI_BANK', '-30', 65)).toBe(-30);
    expect(finiteEnv('SIM_ZONES_SIGMA', '.6', 1)).toBe(0.6);
    expect(finiteEnv('AI_TH_MAXTIME', '', 600)).toBe(600);
    expect(finiteEnv('AI_TH_MAXTIME', undefined, 600)).toBe(600);
  });

  it('rejects words and infinities', () => {
    for (const bad of ['abc', 'Infinity', 'NaN', '1e', '6OO']) {
      expect(() => finiteEnv('AI_TH_MAXTIME', bad, 600)).toThrow(/AI_TH_MAXTIME must be a finite number/);
    }
  });
});

describe('selectSets', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  const table = { mirror: [a, b], low: [c] };

  it('keeps CSV order and returns the table objects themselves', () => {
    const got = selectSets('AI_TH_SET', 'low,mirror', table);
    expect(got).toEqual([c, a, b]);
    expect(got[0]).toBe(c);
    expect(got[1]).toBe(a);
  });

  it('throws on an unknown name, naming the variable and the choices', () => {
    expect(() => selectSets('AI_TH_SET', 'mirorr', table)).toThrow('AI_TH_SET has unknown set "mirorr"; use mirror, low.');
    expect(() => selectSets('AI_TH_SET', '', table)).toThrow(/unknown set ""/);
    expect(() => selectSets('AI_TH_SET', 'toString', table)).toThrow(/unknown set "toString"/);
  });
});
