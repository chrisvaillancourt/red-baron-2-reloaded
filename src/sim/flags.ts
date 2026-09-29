/**
 * Sim-side switches for A/B measurement, like src/ai/tactics.ts TACTICS_FLAGS. Each is off by
 * default. Tests set them directly; Node runs read them from the environment when this module
 * loads, so `node tools/dev/ab.mjs --a SIM_DAMAGE_PATH=0 --b SIM_DAMAGE_PATH=1` switches one for
 * every soak. The browser has no `process`, so the game always flies the defaults.
 */
export const SIM_FLAGS = {
  /**
   * Single-engined types: a round damages every zone it passes through, in order along its
   * path, until the engine block stops it (as twins already do). Off: the older cut by
   * zone-list order, in which a tractor's engine shields everything else on the path, the
   * pilot and fuel tank included (docs/sim.md "Hit boxes"; measured, not shipped, D-089).
   */
  damagePath: false,
};

export type SimFlag = keyof typeof SIM_FLAGS;

/** The environment variable that sets each flag ("1" / "true" on, "0" / "false" off). */
export const SIM_FLAG_ENV: Record<SimFlag, string> = { damagePath: 'SIM_DAMAGE_PATH' };

export function applySimFlagsFromEnv(env: Record<string, string | undefined>): void {
  for (const k of Object.keys(SIM_FLAGS) as SimFlag[]) {
    const v = env[SIM_FLAG_ENV[k]];
    if (v === undefined || v === '') continue;
    SIM_FLAGS[k] = v !== '0' && v !== 'false';
  }
}

const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
if (nodeEnv) applySimFlagsFromEnv(nodeEnv);
