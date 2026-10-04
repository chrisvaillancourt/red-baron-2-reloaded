/** Airfield Defense is a battery session, never a flight or a career sortie.
 * Coordinates are local metres: +Y up, gunner at (0, 4, 0), looking down -Z.
 * Views are live, read-only to consumers. Events last until the next step/command.
 */
import type { Vector3 } from 'three';
import type { AircraftId, GameSettings } from './types';

export type DefenseWeaponId = 'mg' | 'cannon' | 'flak';
export type DefenseAssetId = 'hq' | 'ammo' | 'hospital';
export type DefenseUpgradeId = 'power' | 'cooling' | 'reload';
export type DefensePhase = 'raid' | 'resupply' | 'won' | 'lost' | 'aborted';

export interface DefenseOptions {
  seed: number;
  difficulty: 'regular' | 'veteran';
  /** Only a visual lead suggestion. Never steers the gun or changes damage. */
  aimAssist: boolean;
}
export interface DefenseAsset {
  id: DefenseAssetId;
  name: string;
  position: Vector3;
  health: number;
  maxHealth: number;
}
export interface DefenseWeapon {
  id: DefenseWeaponId;
  name: string;
  muzzleSpeed: number;
  gravity: number;
  capacity: number;
  ammo: number;
  heat: number;
  overheated: boolean;
  reloadLeft: number;
  cooldown: number;
}
export interface DefenseThreat {
  id: number;
  aircraftId: AircraftId | 'airship';
  position: Vector3;
  velocity: Vector3;
  health: number;
  maxHealth: number;
  radius: number;
  targetId: DefenseAssetId;
  /** Seconds until this raider begins its telegraphed attack. */
  attackIn: number;
}
export interface DefenseProjectile {
  id: number;
  owner: 'battery';
  weapon: DefenseWeaponId;
  position: Vector3;
  velocity: Vector3;
  /** Time left before a timed flak burst, otherwise remaining flight life. */
  timeLeft: number;
}
export interface DefenseBomb {
  id: number;
  /** The enemy that released it; never credited as the player's weapon. */
  ownerId: number;
  targetId: DefenseAssetId;
  position: Vector3;
  velocity: Vector3;
  radius: number;
}
export type DefenseEvent =
  | { type: 'shot'; weapon: DefenseWeaponId; position: Vector3 }
  | { type: 'hit'; position: Vector3 }
  | { type: 'burst'; position: Vector3; radius: number }
  | { type: 'kill'; owner: 'battery'; threatId: number; position: Vector3 }
  | { type: 'bomb-intercepted'; owner: 'battery'; bombId: number; position: Vector3 }
  | { type: 'asset-hit'; ownerId: number; assetId: DefenseAssetId; position: Vector3 }
  | { type: 'raid-complete'; raid: number };
export interface DefenseState {
  readonly options: Readonly<DefenseOptions>;
  readonly phase: DefensePhase;
  /** 1-based, five authored raids. */
  readonly raid: number;
  readonly raidTime: number;
  readonly time: number;
  readonly selected: DefenseWeaponId;
  readonly fuzeRange: number;
  readonly credits: number;
  readonly score: number;
  readonly kills: number;
  readonly bombsIntercepted: number;
  readonly raidsSurvived: number;
  readonly assets: readonly DefenseAsset[];
  readonly weapons: Readonly<Record<DefenseWeaponId, DefenseWeapon>>;
  readonly upgrades: Readonly<Record<DefenseUpgradeId, number>>;
  readonly threats: readonly DefenseThreat[];
  readonly projectiles: readonly DefenseProjectile[];
  readonly bombs: readonly DefenseBomb[];
}
export interface DefenseInput {
  /** World-local muzzle, not the old camera origin. */
  origin: Vector3;
  /** Unit vector along the visible barrel; physical projectiles use this ray. */
  direction: Vector3;
  fire: boolean;
}
export type DefensePurchase =
  | { kind: 'repair'; assetId: DefenseAssetId }
  | { kind: 'upgrade'; upgradeId: DefenseUpgradeId };
export interface DefenseResult {
  kind: 'airfield-defense';
  options: DefenseOptions;
  outcome: 'won' | 'lost' | 'aborted';
  raidsSurvived: number;
  time: number;
  kills: number;
  bombsIntercepted: number;
  score: number;
  assets: { id: DefenseAssetId; name: string; health: number; maxHealth: number }[];
}
export interface DefenseSimulation {
  readonly state: DefenseState;
  readonly events: readonly DefenseEvent[];
  /** Caller supplies fixed, positive steps (session: 1/60 s). No campaign/event-bus writes. */
  step(dt: number, input: DefenseInput): void;
  selectWeapon(id: DefenseWeaponId): void;
  reload(): void;
  setFuzeRange(metres: number): void;
  /** Advances resupply to the next raid; no effect during combat or after terminal results. */
  advance(): void;
  /** Costs and availability are authoritative in the simulation, not duplicated by the UI. */
  purchaseCost(purchase: DefensePurchase): number | null;
  buy(purchase: DefensePurchase): boolean;
  abort(): void;
  /** Returns an immutable-by-value report only at a terminal phase. */
  result(): DefenseResult | null;
}
export interface DefenseLauncher {
  defend(options: DefenseOptions, settings: GameSettings, container: HTMLElement): Promise<DefenseResult>;
}
