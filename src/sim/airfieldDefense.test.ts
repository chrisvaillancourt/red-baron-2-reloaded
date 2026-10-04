import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import type { DefenseInput, DefenseSimulation, DefenseThreat, DefenseWeaponId } from '../core/defense';
import { createAirfieldDefense } from './airfieldDefense';

// This public-seam regression was observed red by the integration owner before implementation.
test('an abandoned battery produces a defense report and cannot keep fighting', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: true });
  expect(defense.result()).toBeNull();
  defense.abort();
  const result = defense.result()!;
  expect(result.kind).toBe('airfield-defense');
  expect(result.outcome).toBe('aborted');
  const time = defense.state.time;
  defense.step(1 / 60, { origin: new Vector3(0, 4, 0), direction: new Vector3(0, 0, -1), fire: true });
  defense.advance();
  expect(defense.state.time).toBe(time);
  expect(defense.state.projectiles).toEqual([]);
  expect(defense.result()).toEqual(result);
});

const DT = 1 / 60;
const idle: DefenseInput = { origin: new Vector3(0, 4, 0), direction: new Vector3(0, 0, -1), fire: false };

/** Competent manual sighting: a ballistic intercept from the actual battery origin. */
function aim(defense: DefenseSimulation, target: Pick<DefenseThreat, 'position' | 'velocity'>, weapon: DefenseWeaponId, falling = false): DefenseInput {
  if (defense.state.selected !== weapon) defense.selectWeapon(weapon);
  const gun = defense.state.weapons[weapon];
  const direction = new Vector3();
  let flight = target.position.distanceTo(idle.origin) / gun.muzzleSpeed;
  for (let i = 0; i < 8; i++) {
    direction.copy(target.position).addScaledVector(target.velocity, flight).sub(idle.origin);
    direction.y += 0.5 * (gun.gravity - (falling ? 9.81 : 0)) * flight * flight;
    flight = direction.length() / gun.muzzleSpeed;
  }
  if (weapon === 'flak') defense.setFuzeRange(direction.length());
  return { origin: idle.origin, direction: direction.normalize(), fire: true };
}

function until(defense: DefenseSimulation, reached: () => boolean, control: () => DefenseInput = () => idle, seconds = 100): void {
  for (let frame = 0; frame < seconds / DT && !reached(); frame++) defense.step(DT, control());
  expect(reached(), 'expected observable state was not reached within the combat window').toBe(true);
}

test('idle defense loses without enemy explosions or escaped raiders earning credit', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: false });
  let impacts = 0;
  for (let frame = 0; frame < 600 / DT && !defense.result(); frame++) {
    if (defense.state.phase === 'resupply') defense.advance();
    defense.step(DT, idle);
    for (const event of defense.events) {
      if (event.type === 'asset-hit') impacts++;
      expect(event.type).not.toBe('kill');
      expect(event.type).not.toBe('bomb-intercepted');
    }
  }
  expect(impacts).toBeGreaterThan(0);
  expect(defense.result()?.outcome).toBe('lost');
  expect(defense.state.kills).toBe(0);
  expect(defense.state.bombsIntercepted).toBe(0);
  expect(defense.state.assets.every(asset => asset.health === 0)).toBe(true);
});

test('combat and terminal commands cannot purchase; resupply prices, repairs and upgrades are authoritative', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: false });
  const power = { kind: 'upgrade', upgradeId: 'power' } as const;
  expect(defense.purchaseCost(power)).toBeNull();
  expect(defense.buy(power)).toBe(false);
  until(defense, () => defense.state.phase === 'resupply');
  const repair = { kind: 'repair', assetId: 'hq' } as const;
  const hq = defense.state.assets.find(asset => asset.id === 'hq')!;
  const previousHealth = hq.health;
  const repairCost = defense.purchaseCost(repair)!;
  const credits = defense.state.credits;
  expect(previousHealth).toBeLessThan(hq.maxHealth);
  expect(repairCost).toBeGreaterThan(0);
  expect(defense.buy(repair)).toBe(true);
  expect(defense.state.credits).toBe(credits - repairCost);
  expect(hq.health).toBeGreaterThan(previousHealth);
  expect(defense.purchaseCost(repair)).toBeNull();
  const upgradeCost = defense.purchaseCost(power)!;
  expect(defense.buy(power)).toBe(true);
  expect(defense.state.credits).toBe(credits - repairCost - upgradeCost);
  expect(defense.state.upgrades.power).toBe(1);
  expect(defense.buy(power)).toBe(false);
  const time = defense.state.time;
  defense.step(30, idle);
  expect(defense.state.time).toBe(time);
  defense.advance();
  expect(defense.purchaseCost(repair)).toBeNull();
  expect(defense.buy(power)).toBe(false);
  defense.abort();
  expect(defense.purchaseCost(power)).toBeNull();
  expect(defense.buy(repair)).toBe(false);
  expect(createAirfieldDefense(defense.state.options).state.upgrades).toEqual({ power: 0, cooling: 0, reload: 0 });
});

test('terminal reports and their options/assets are independent value snapshots', () => {
  const options = { seed: 27, difficulty: 'regular', aimAssist: true } as const;
  const defense = createAirfieldDefense(options);
  defense.step(2, idle);
  defense.abort();
  const original = defense.result()!;
  const edited = defense.result()!;
  edited.assets[0].health = -100;
  edited.assets.length = 0;
  edited.options.seed = 99;
  edited.kills = 999;
  defense.selectWeapon('flak');
  defense.setFuzeRange(2000);
  defense.reload();
  defense.advance();
  defense.step(100, { ...idle, fire: true });
  defense.abort();
  expect(defense.result()).toEqual(original);
  expect(defense.state.assets[0].health).toBe(original.assets[0].health);
});

test('same seed and commands replay exactly, and lead assistance cannot affect combat', () => {
  const a = createAirfieldDefense({ seed: 456, difficulty: 'veteran', aimAssist: true });
  const b = createAirfieldDefense({ seed: 456, difficulty: 'veteran', aimAssist: true });
  const unaided = createAirfieldDefense({ seed: 456, difficulty: 'veteran', aimAssist: false });
  for (let frame = 0; frame < 35 / DT; frame++) {
    const target = a.state.threats[0];
    const input = target ? aim(a, target, 'mg') : idle;
    a.step(DT, input);
    b.step(DT, input);
    unaided.step(DT, input);
    expect(b.events).toEqual(a.events);
    expect(unaided.events).toEqual(a.events);
  }
  expect(b.state).toEqual(a.state);
  expect({ ...unaided.state, options: a.state.options }).toEqual(a.state);
});

test('a final aircraft kill cannot erase its falling bomb or finish a raid with shells airborne', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: false });
  // Engage the first three scouts; let the last one release its visible bomb.
  until(defense, () => defense.state.raidTime > 33 && defense.state.threats.length === 1, () => {
    const target = defense.state.threats[0];
    return target && defense.state.raidTime < 31 ? aim(defense, target, 'cannon') : idle;
  });
  expect(defense.state.kills).toBe(3);
  until(defense, () => defense.state.bombs.length > 0);
  const owner = defense.state.bombs[0].ownerId;
  until(defense, () => defense.state.threats.length === 0, () => aim(defense, defense.state.threats[0], 'cannon'));
  expect(defense.state.phase).toBe('raid');
  expect(defense.state.bombs.some(bomb => bomb.ownerId === owner)).toBe(true);
  expect(defense.state.kills).toBe(4);
  let bombLanded = false;
  until(defense, () => defense.state.phase === 'resupply', () => {
    for (const event of defense.events) if (event.type === 'asset-hit' && event.ownerId === owner) bombLanded = true;
    return idle;
  });
  for (const event of defense.events) if (event.type === 'asset-hit' && event.ownerId === owner) bombLanded = true;
  expect(bombLanded).toBe(true);
  expect(defense.state.bombs).toHaveLength(0);
  expect(defense.state.projectiles).toHaveLength(0);
  expect(defense.state.kills).toBe(4);
  expect(defense.state.bombsIntercepted).toBe(0);
});

test('a ground impact and last target kill in one command both resolve before resupply', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: false });
  until(defense, () => defense.state.raidTime > 33 && defense.state.threats.length === 1, () => {
    const target = defense.state.threats[0];
    return target && defense.state.raidTime < 31 ? aim(defense, target, 'cannon') : idle;
  });
  until(defense, () => defense.state.bombs.some(bomb => bomb.position.y < 35));
  const last = defense.state.threats[0];
  const owner = last.id;
  defense.step(2, aim(defense, last, 'cannon'));
  expect(defense.events.some(event => event.type === 'kill' && event.threatId === owner)).toBe(true);
  expect(defense.events.some(event => event.type === 'asset-hit' && event.ownerId === owner)).toBe(true);
  until(defense, () => defense.state.phase === 'resupply');
  expect(defense.state.kills).toBe(4);
  const hq = defense.state.assets.find(asset => asset.id === 'hq')!;
  expect(hq.health).toBeLessThan(hq.maxHealth);
});

test('a burst of fast rounds intercepts a moving falling bomb only once', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: false });
  until(defense, () => defense.state.bombs.length > 0);
  const bomb = defense.state.bombs[0];
  const bombId = bomb.id;
  const owner = bomb.ownerId;
  let intercepted = 0;
  let landed = false;
  for (let frame = 0; frame < 8 / DT; frame++) {
    const input = defense.state.bombs.find(item => item.id === bombId)
      ? aim(defense, bomb, 'mg', true) : idle;
    defense.step(DT, input);
    for (const event of defense.events) {
      if (event.type === 'bomb-intercepted' && event.bombId === bombId) intercepted++;
      if (event.type === 'asset-hit' && event.ownerId === owner) landed = true;
    }
  }
  expect(intercepted).toBe(1);
  expect(defense.state.bombsIntercepted).toBe(1);
  expect(landed).toBe(false);
});

test('all five authored raids are winnable through aiming, resupply and weapon commands', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: true });
  const killed = new Set<number>();
  const intercepted = new Set<number>();
  const aircraft = new Set<string>();
  let duplicateCredit = false;
  for (let frame = 0; frame < 600 / DT && !defense.result(); frame++) {
    if (defense.state.phase === 'resupply') {
      for (const asset of defense.state.assets) {
        if (asset.health < 80) defense.buy({ kind: 'repair', assetId: asset.id });
      }
      defense.buy({ kind: 'upgrade', upgradeId: 'power' });
      defense.advance();
    }
    for (const target of defense.state.threats) aircraft.add(target.aircraftId);
    const target = defense.state.threats[0];
    const weapon = target && target.maxHealth >= 110 ? 'flak' : 'cannon';
    defense.step(DT, target ? aim(defense, target, weapon) : idle);
    for (const event of defense.events) {
      if (event.type === 'kill') {
        duplicateCredit ||= killed.has(event.threatId);
        killed.add(event.threatId);
      } else if (event.type === 'bomb-intercepted') {
        duplicateCredit ||= intercepted.has(event.bombId);
        intercepted.add(event.bombId);
      }
    }
  }
  const report = defense.result();
  expect(report?.outcome).toBe('won');
  expect(report?.raidsSurvived).toBe(5);
  expect(report?.kills).toBe(killed.size);
  expect(report?.bombsIntercepted).toBe(intercepted.size);
  expect(duplicateCredit).toBe(false);
  expect(aircraft).toEqual(new Set(['albatros_dv', 'halberstadt_clii', 'rumpler_civ', 'gotha_gv', 'airship']));
  expect(defense.state.threats).toHaveLength(0);
  expect(defense.state.projectiles).toHaveLength(0);
  expect(defense.state.bombs).toHaveLength(0);
  expect(report!.assets.some(asset => asset.health > 0)).toBe(true);
});

test('magazines, cooling, cooldowns and reloads continue while changing stations', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: false });
  const skyward: DefenseInput = { ...idle, direction: new Vector3(0, 1, 0), fire: true };
  defense.step(DT, skyward);
  const mg = defense.state.weapons.mg;
  const ammoAfterShot = mg.ammo;
  const round = defense.state.projectiles[0];
  expect(round.owner).toBe('battery');
  expect(round.position.y).toBeGreaterThan(idle.origin.y);
  expect(round.velocity.y).toBeLessThan(mg.muzzleSpeed);
  defense.step(DT, skyward);
  expect(mg.ammo).toBe(ammoAfterShot);
  defense.reload();
  expect(mg.reloadLeft).toBeGreaterThan(0);
  defense.selectWeapon('cannon');
  until(defense, () => mg.reloadLeft === 0);
  expect(mg.ammo).toBe(mg.capacity);
  defense.selectWeapon('mg');
  until(defense, () => mg.overheated, () => skyward, 8);
  const hotAmmo = mg.ammo;
  defense.step(0.2, skyward);
  expect(mg.ammo).toBe(hotAmmo);
  until(defense, () => !mg.overheated);
  defense.step(DT, skyward);
  expect(mg.ammo).toBeLessThan(hotAmmo);
});

test('flak travels to its selected range before its timed burst', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: false });
  defense.selectWeapon('flak');
  const range = defense.state.weapons.flak.muzzleSpeed;
  defense.setFuzeRange(range);
  defense.step(DT, { ...idle, direction: new Vector3(0, 1, 0), fire: true });
  expect(defense.state.projectiles).toHaveLength(1);
  const shell = defense.state.projectiles[0];
  expect(shell.owner).toBe('battery');
  expect(shell.timeLeft).toBeGreaterThan(0.9);
  defense.step(0.5, idle);
  expect(defense.events.some(event => event.type === 'burst')).toBe(false);
  expect(defense.state.projectiles).toHaveLength(1);
  defense.step(0.6, idle);
  const burst = defense.events.find(event => event.type === 'burst');
  expect(burst?.type).toBe('burst');
  if (burst?.type === 'burst') {
    expect(burst.position.distanceTo(idle.origin)).toBeCloseTo(range, 5);
  }
  expect(defense.state.projectiles).toHaveLength(0);
});

test('surviving infrastructure permits rebuilding a destroyed asset but not combat purchases', () => {
  const defense = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: false });
  for (let frame = 0; frame < 300 / DT; frame++) {
    if (defense.state.phase === 'resupply') {
      if (defense.state.assets.some(asset => asset.health === 0)) break;
      defense.advance();
    }
    if (defense.result()) break;
    defense.step(DT, idle);
  }
  expect(defense.state.phase).toBe('resupply');
  const destroyed = defense.state.assets.find(asset => asset.health === 0)!;
  expect(destroyed).toBeDefined();
  const purchase = { kind: 'repair', assetId: destroyed.id } as const;
  const cost = defense.purchaseCost(purchase)!;
  const credits = defense.state.credits;
  expect(defense.buy(purchase)).toBe(true);
  expect(destroyed.health).toBeGreaterThan(0);
  expect(destroyed.health).toBeLessThan(destroyed.maxHealth);
  expect(defense.state.credits).toBe(credits - cost);
  defense.advance();
  expect(defense.buy(purchase)).toBe(false);
});

test('Veteran adds coordinated enemies without inflating their health or requisition income', () => {
  const regular = createAirfieldDefense({ seed: 1917, difficulty: 'regular', aimAssist: false });
  const veteran = createAirfieldDefense({ seed: 1917, difficulty: 'veteran', aimAssist: false });
  regular.step(DT, idle);
  veteran.step(DT, idle);
  const scoutHealth = regular.state.threats[0].maxHealth;
  const regularSeen = new Set<number>();
  const veteranSeen = new Set<number>();
  for (const [defense, seen] of [[regular, regularSeen], [veteran, veteranSeen]] as const) {
    until(defense, () => defense.state.phase === 'resupply', () => {
      for (const target of defense.state.threats) {
        seen.add(target.id);
        expect(target.maxHealth).toBe(scoutHealth);
      }
      return idle;
    });
  }
  expect(veteranSeen.size).toBeGreaterThan(regularSeen.size);
  expect(veteran.state.credits).toBe(regular.state.credits);
  expect(veteran.state.raidTime).toBeLessThan(regular.state.raidTime);
});
