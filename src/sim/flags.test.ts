import { afterEach, describe, expect, it } from 'vitest';
import { SIM_FLAGS, applySimFlagsFromEnv } from './flags';

describe('sim flags', () => {
  const saved = { ...SIM_FLAGS };
  afterEach(() => Object.assign(SIM_FLAGS, saved));

  it('SIM_DAMAGE_PATH switches damagePath; unset or empty leaves it alone', () => {
    SIM_FLAGS.damagePath = false;
    applySimFlagsFromEnv({ SIM_DAMAGE_PATH: '1' });
    expect(SIM_FLAGS.damagePath).toBe(true);
    applySimFlagsFromEnv({});
    applySimFlagsFromEnv({ SIM_DAMAGE_PATH: '' });
    expect(SIM_FLAGS.damagePath).toBe(true);
    applySimFlagsFromEnv({ SIM_DAMAGE_PATH: '0' });
    expect(SIM_FLAGS.damagePath).toBe(false);
    applySimFlagsFromEnv({ SIM_DAMAGE_PATH: 'true' });
    expect(SIM_FLAGS.damagePath).toBe(true);
    applySimFlagsFromEnv({ SIM_DAMAGE_PATH: 'false' });
    expect(SIM_FLAGS.damagePath).toBe(false);
  });
});
