import { describe, expect, it } from 'vitest';
import { positiveIntEnv } from './env';

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
