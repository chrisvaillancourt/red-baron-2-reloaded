/** Shared fixtures for sim tests (not used at runtime). */
import type { AircraftId, RealismSettings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/settings';
import { getAircraft } from '../data/aircraft';
import { createFlightEnvironment } from './atmosphere';
import { createAircraftEntity } from './entity';

export const flatEnv = (h = 50) => createFlightEnvironment(() => h, { wind: [0, 0, 0], turbulence: 0 });

export function realism(over: Partial<RealismSettings> = {}): RealismSettings {
  return { ...DEFAULT_SETTINGS.realism, ...over };
}

export function makeAircraft(
  id: AircraftId,
  opts: { entityId?: number; x?: number; z?: number; altitude?: number; heading?: number; airspeed?: number; onGround?: boolean; groundH?: number } = {},
) {
  const env = flatEnv(opts.groundH ?? 50);
  const spec = getAircraft(id);
  const ac = createAircraftEntity({
    id: opts.entityId ?? 1,
    spec,
    env,
    onGround: opts.onGround,
    start: { x: opts.x ?? 0, z: opts.z ?? 0, altitude: opts.altitude ?? 1000, heading: opts.heading ?? 0, airspeed: opts.airspeed ?? 45 },
  });
  return { ac, env, spec };
}
