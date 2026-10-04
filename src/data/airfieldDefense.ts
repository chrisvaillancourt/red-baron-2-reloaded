import type { DefenseAssetId, DefenseThreat, DefenseWeaponId } from '../core/defense';

export type DefenseRole = 'scout' | 'diver' | 'formation' | 'heavy' | 'airship';

/** Battery balance is deliberately separate from flight damage and aircraft performance. */
export const DEFENSE_RAIDERS: Record<DefenseRole, {
  aircraftId: DefenseThreat['aircraftId']; health: number; radius: number;
  height: number; descent: number; speed: number; approach: number;
  departure: number; bombs: number; bombDamage: number;
}> = {
  scout: { aircraftId: 'albatros_dv', health: 36, radius: 5, height: 150, descent: 0, speed: 42, approach: 14, departure: 18, bombs: 1, bombDamage: 22 },
  diver: { aircraftId: 'halberstadt_clii', health: 54, radius: 6, height: 330, descent: -13, speed: 60, approach: 18, departure: 18, bombs: 1, bombDamage: 34 },
  formation: { aircraftId: 'rumpler_civ', health: 110, radius: 7, height: 300, descent: 0, speed: 38, approach: 20, departure: 22, bombs: 2, bombDamage: 40 },
  heavy: { aircraftId: 'gotha_gv', health: 190, radius: 13, height: 420, descent: 0, speed: 32, approach: 24, departure: 24, bombs: 2, bombDamage: 55 },
  airship: { aircraftId: 'airship', health: 520, radius: 32, height: 480, descent: 0, speed: 20, approach: 32, departure: 28, bombs: 5, bombDamage: 45 },
};

interface AttackGroup {
  at: number;
  role: DefenseRole;
  count: number;
  veteranCount: number;
  /** Approach side: -1 left, +1 right, 0 straight in. */
  lane: number;
  target: DefenseAssetId;
}

/** Five distinct attacks; formation members spawn together, 38 m apart. */
export const DEFENSE_RAIDS: readonly (readonly AttackGroup[])[] = [
  [
    { at: 0, role: 'scout', count: 1, veteranCount: 1, lane: -1, target: 'hq' },
    { at: 10, role: 'scout', count: 1, veteranCount: 2, lane: 1, target: 'ammo' },
    { at: 21, role: 'scout', count: 1, veteranCount: 2, lane: -1, target: 'hospital' },
    { at: 32, role: 'scout', count: 1, veteranCount: 1, lane: 1, target: 'hq' },
  ],
  [
    { at: 0, role: 'diver', count: 2, veteranCount: 3, lane: -1, target: 'ammo' },
    { at: 13, role: 'diver', count: 2, veteranCount: 3, lane: 1, target: 'hospital' },
    { at: 34, role: 'diver', count: 2, veteranCount: 2, lane: 0, target: 'hq' },
  ],
  [
    { at: 0, role: 'formation', count: 3, veteranCount: 3, lane: -1, target: 'hq' },
    { at: 18, role: 'formation', count: 2, veteranCount: 3, lane: 1, target: 'ammo' },
    { at: 38, role: 'formation', count: 1, veteranCount: 2, lane: 0, target: 'hospital' },
  ],
  [
    { at: 0, role: 'heavy', count: 2, veteranCount: 3, lane: 1, target: 'hospital' },
    { at: 20, role: 'heavy', count: 2, veteranCount: 2, lane: -1, target: 'hq' },
    { at: 42, role: 'heavy', count: 1, veteranCount: 2, lane: 0, target: 'ammo' },
  ],
  [
    { at: 0, role: 'airship', count: 1, veteranCount: 1, lane: 0, target: 'hq' },
    { at: 12, role: 'diver', count: 2, veteranCount: 3, lane: -1, target: 'ammo' },
    { at: 24, role: 'scout', count: 2, veteranCount: 3, lane: 1, target: 'hospital' },
    { at: 34, role: 'heavy', count: 1, veteranCount: 2, lane: -1, target: 'hq' },
    { at: 46, role: 'formation', count: 2, veteranCount: 2, lane: 1, target: 'ammo' },
  ],
];

export const DEFENSE_GUNS: Record<DefenseWeaponId, {
  name: string; muzzleSpeed: number; gravity: number; capacity: number;
  interval: number; reload: number; heat: number; cooling: number;
  damage: number; life: number; burstRadius: number;
}> = {
  mg: { name: 'Vickers machine gun', muzzleSpeed: 780, gravity: 9.81, capacity: 100, interval: 0.09, reload: 3.2, heat: 0.045, cooling: 0.22, damage: 9, life: 2.5, burstRadius: 0 },
  cannon: { name: '37 mm cannon', muzzleSpeed: 650, gravity: 9.81, capacity: 8, interval: 0.8, reload: 4.2, heat: 0.18, cooling: 0.15, damage: 65, life: 4, burstRadius: 0 },
  flak: { name: '75 mm timed flak', muzzleSpeed: 350, gravity: 0, capacity: 4, interval: 1.8, reload: 5.2, heat: 0.3, cooling: 0.12, damage: 120, life: 0, burstRadius: 65 },
};

/** Shared by the physical fuze and its controls; F may choose any range between the bounds. */
export const DEFENSE_FUZE = { minimum: 100, maximum: 2200, step: 25 } as const;
