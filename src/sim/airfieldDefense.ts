import { Vector3 } from 'three';
import type {
  DefenseAsset, DefenseAssetId, DefenseBomb, DefenseEvent, DefenseInput, DefenseOptions,
  DefenseProjectile, DefensePurchase, DefenseResult, DefenseSimulation, DefenseState,
  DefenseThreat, DefenseWeapon, DefenseWeaponId,
} from '../core/defense';
import type { DefenseRole } from '../data/airfieldDefense';
import { DEFENSE_FUZE, DEFENSE_GUNS, DEFENSE_RAIDERS, DEFENSE_RAIDS } from '../data/airfieldDefense';
import { createRng } from './rng';

const GRAVITY = 9.81;
const SLICE = 1 / 120;
const WEAPONS: readonly DefenseWeaponId[] = ['mg', 'cannon', 'flak'];
const BOMB_BLAST = 45;

type MutableState = { -readonly [K in keyof DefenseState]: DefenseState[K] };
interface Moving { position: Vector3; previous: Vector3; active: boolean }
interface Raider extends DefenseThreat, Moving {
  role: DefenseRole;
  age: number;
  releaseAt: number;
  exitAt: number;
  bombsLeft: number;
}
interface Shell extends DefenseProjectile, Moving { damage: number }
interface Bomb extends DefenseBomb, Moving { damage: number }
type Contact =
  | { at: number; kind: 'hit-threat'; shell: Shell; target: Raider }
  | { at: number; kind: 'hit-bomb'; shell: Shell; target: Bomb }
  | { at: number; kind: 'shell-end' | 'shell-ground'; shell: Shell }
  | { at: number; kind: 'bomb-ground'; bomb: Bomb }
  | { at: number; kind: 'escape'; target: Raider };

/** Earliest relative-motion sphere entry; no tunnelling through a moving target. */
function contactTime(a: Moving, b: Moving, radius: number): number {
  const x = a.previous.x - b.previous.x;
  const y = a.previous.y - b.previous.y;
  const z = a.previous.z - b.previous.z;
  const dx = a.position.x - b.position.x - x;
  const dy = a.position.y - b.position.y - y;
  const dz = a.position.z - b.position.z - z;
  const c = x * x + y * y + z * z - radius * radius;
  if (c <= 0) return 0;
  const aa = dx * dx + dy * dy + dz * dz;
  const bb = x * dx + y * dy + z * dz;
  const discriminant = bb * bb - aa * c;
  if (aa < 1e-12 || bb >= 0 || discriminant < 0) return Infinity;
  const t = (-bb - Math.sqrt(discriminant)) / aa;
  return t >= 0 && t <= 1 ? t : Infinity;
}

function compact<T extends Moving>(items: T[]): void {
  let write = 0;
  for (const item of items) if (item.active) items[write++] = item;
  items.length = write;
}

/** A local battery simulation: no flight entities, career services, renderer or global RNG. */
export function createAirfieldDefense(options: DefenseOptions): DefenseSimulation {
  const runOptions = Object.freeze({ ...options });
  const random = createRng(runOptions.seed);
  const veteran = runOptions.difficulty === 'veteran';
  const coordination = veteran ? 0.86 : 1;
  const assets: DefenseAsset[] = [
    { id: 'hq', name: 'Headquarters', position: new Vector3(-140, 0, -60), health: 120, maxHealth: 120 },
    { id: 'ammo', name: 'Ammunition depot', position: new Vector3(120, 0, -90), health: 120, maxHealth: 120 },
    { id: 'hospital', name: 'Field hospital', position: new Vector3(0, 0, 90), health: 120, maxHealth: 120 },
  ];
  const assetById: Record<DefenseAssetId, DefenseAsset> = { hq: assets[0], ammo: assets[1], hospital: assets[2] };
  const makeWeapon = (id: DefenseWeaponId): DefenseWeapon => {
    const spec = DEFENSE_GUNS[id];
    return { id, name: spec.name, muzzleSpeed: spec.muzzleSpeed, gravity: spec.gravity,
      capacity: spec.capacity, ammo: spec.capacity, heat: 0, overheated: false, reloadLeft: 0, cooldown: 0 };
  };
  const weapons = { mg: makeWeapon('mg'), cannon: makeWeapon('cannon'), flak: makeWeapon('flak') };
  const upgrades = { power: 0, cooling: 0, reload: 0 };
  const threats: Raider[] = [];
  const projectiles: Shell[] = [];
  const bombs: Bomb[] = [];
  const events: DefenseEvent[] = [];
  const contacts: Contact[] = [];
  const point = new Vector3();
  const targetPoint = new Vector3();
  const state: MutableState = {
    options: runOptions, phase: 'raid', raid: 1, raidTime: 0, time: 0,
    selected: 'mg', fuzeRange: 600, credits: 0, score: 0, kills: 0,
    bombsIntercepted: 0, raidsSurvived: 0, assets, weapons, upgrades, threats, projectiles, bombs,
  };
  let nextId = 1;
  let nextGroup = 0;
  let raidKills = 0;
  let terminalReport: DefenseResult | null = null;

  function finish(outcome: DefenseResult['outcome']): void {
    if (terminalReport) return;
    state.phase = outcome;
    terminalReport = {
      kind: 'airfield-defense', options: { ...runOptions }, outcome,
      raidsSurvived: state.raidsSurvived, time: state.time, kills: state.kills,
      bombsIntercepted: state.bombsIntercepted, score: state.score,
      assets: assets.map(({ id, name, health, maxHealth }) => ({ id, name, health, maxHealth })),
    };
  }

  function spawnGroups(): void {
    const raid = DEFENSE_RAIDS[state.raid - 1];
    while (nextGroup < raid.length && raid[nextGroup].at * coordination <= state.raidTime + 1e-9) {
      const group = raid[nextGroup++];
      const spec = DEFENSE_RAIDERS[group.role];
      const count = veteran ? group.veteranCount : group.count;
      let target = assetById[group.target];
      if (target.health <= 0) target = assets.find(asset => asset.health > 0) ?? target;
      const approach = spec.approach * coordination;
      const height = spec.height + (random() - 0.5) * 12;
      const vx = -group.lane * 12 + (random() - 0.5) * 3;
      const vy = spec.descent;
      const releaseHeight = height + vy * approach;
      const fall = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * releaseHeight)) / GRAVITY;
      for (let member = 0; member < count; member++) {
        const offset = (member - (count - 1) / 2) * 38;
        const position = new Vector3(
          target.position.x - vx * (approach + fall) + offset,
          height,
          target.position.z - spec.speed * (approach + fall),
        );
        threats.push({
          id: nextId++, aircraftId: spec.aircraftId, position, previous: position.clone(),
          velocity: new Vector3(vx, vy, spec.speed), health: spec.health, maxHealth: spec.health,
          radius: spec.radius, targetId: target.id, attackIn: approach, role: group.role,
          age: 0, releaseAt: approach, exitAt: approach + spec.departure, bombsLeft: spec.bombs, active: true,
        });
      }
    }
  }

  function beginReload(weapon: DefenseWeapon): void {
    if (weapon.reloadLeft > 0 || weapon.ammo === weapon.capacity) return;
    weapon.reloadLeft = DEFENSE_GUNS[weapon.id].reload
      * (assetById.ammo.health > 0 ? 0.8 : 1) * Math.pow(0.82, upgrades.reload);
  }

  function fire(input: DefenseInput): void {
    const weapon = weapons[state.selected];
    if (weapon.ammo === 0) beginReload(weapon);
    if (weapon.reloadLeft > 0 || weapon.cooldown > 1e-9 || weapon.overheated) return;
    const length = input.direction.length();
    if (!Number.isFinite(length) || length < 1e-8) return;
    const spec = DEFENSE_GUNS[weapon.id];
    const position = input.origin.clone();
    projectiles.push({
      id: nextId++, owner: 'battery', weapon: weapon.id, position, previous: position.clone(),
      velocity: input.direction.clone().multiplyScalar(spec.muzzleSpeed / length),
      timeLeft: weapon.id === 'flak' ? state.fuzeRange / spec.muzzleSpeed : spec.life,
      damage: spec.damage * (1 + 0.25 * upgrades.power), active: true,
    });
    weapon.ammo--;
    weapon.cooldown = spec.interval;
    weapon.heat = Math.min(1, weapon.heat + spec.heat);
    if (weapon.heat >= 1) weapon.overheated = true;
    events.push({ type: 'shot', weapon: weapon.id, position: position.clone() });
    if (weapon.ammo === 0) beginReload(weapon);
  }

  function hitThreat(target: Raider, damage: number, at: number): void {
    if (!target.active || target.health <= 0) return;
    target.health = Math.max(0, target.health - damage);
    targetPoint.lerpVectors(target.previous, target.position, at);
    events.push({ type: 'hit', position: targetPoint.clone() });
    if (target.health > 0) return;
    target.active = false;
    state.kills++;
    raidKills++;
    state.score += target.role === 'airship' ? 500 : target.role === 'heavy' ? 200 : 100;
    events.push({ type: 'kill', owner: 'battery', threatId: target.id, position: targetPoint.clone() });
  }

  function intercept(bomb: Bomb, at: number): void {
    if (!bomb.active) return;
    bomb.active = false;
    state.bombsIntercepted++;
    state.score += 25;
    events.push({ type: 'bomb-intercepted', owner: 'battery', bombId: bomb.id,
      position: new Vector3().lerpVectors(bomb.previous, bomb.position, at) });
  }

  function burst(shell: Shell, at: number): void {
    const radius = DEFENSE_GUNS.flak.burstRadius;
    point.lerpVectors(shell.previous, shell.position, at);
    events.push({ type: 'burst', position: point.clone(), radius });
    for (const target of threats) {
      if (!target.active) continue;
      targetPoint.lerpVectors(target.previous, target.position, at);
      const distance = Math.max(0, targetPoint.distanceTo(point) - target.radius);
      if (distance <= radius) hitThreat(target, shell.damage * (1 - 0.65 * distance / radius), at);
    }
    for (const bomb of bombs) {
      if (!bomb.active) continue;
      targetPoint.lerpVectors(bomb.previous, bomb.position, at);
      if (targetPoint.distanceToSquared(point) <= (radius + bomb.radius) ** 2) intercept(bomb, at);
    }
  }

  function groundImpact(bomb: Bomb, at: number): void {
    bomb.active = false;
    point.lerpVectors(bomb.previous, bomb.position, at).setY(0);
    // Enemy ground blast affects assets only, never aircraft or player statistics.
    for (const asset of assets) {
      if (asset.health <= 0) continue;
      const distance = point.distanceTo(asset.position);
      if (distance > BOMB_BLAST) continue;
      asset.health = Math.max(0, asset.health - bomb.damage * (1 - 0.65 * distance / BOMB_BLAST));
      events.push({ type: 'asset-hit', ownerId: bomb.ownerId, assetId: asset.id, position: point.clone() });
    }
  }

  function moveAndResolve(dt: number): void {
    contacts.length = 0;
    for (const target of threats) {
      if (target.bombsLeft > 0 && target.age + 1e-9 >= target.releaseAt) {
        const spec = DEFENSE_RAIDERS[target.role];
        const position = target.position.clone();
        bombs.push({ id: nextId++, ownerId: target.id, targetId: target.targetId,
          position, previous: position.clone(), velocity: target.velocity.clone(), radius: 3,
          damage: spec.bombDamage, active: true });
        target.bombsLeft--;
        target.releaseAt += 0.4;
        if (target.role === 'diver') target.velocity.y = 15;
      }
      target.previous.copy(target.position);
      target.position.addScaledVector(target.velocity, dt);
      if (target.age + dt >= target.exitAt) {
        contacts.push({ at: Math.max(0, (target.exitAt - target.age) / dt), kind: 'escape', target });
      }
      target.age += dt;
      target.attackIn = target.bombsLeft > 0 ? Math.max(0, target.releaseAt - target.age) : 0;
    }
    for (const bomb of bombs) {
      bomb.previous.copy(bomb.position);
      bomb.position.addScaledVector(bomb.velocity, dt);
      bomb.position.y -= 0.5 * GRAVITY * dt * dt;
      bomb.velocity.y -= GRAVITY * dt;
      if (bomb.position.y <= 0) {
        contacts.push({ at: Math.max(0, bomb.previous.y / (bomb.previous.y - bomb.position.y)), kind: 'bomb-ground', bomb });
      }
    }
    for (const shell of projectiles) {
      shell.previous.copy(shell.position);
      shell.position.addScaledVector(shell.velocity, dt);
      shell.position.y -= 0.5 * DEFENSE_GUNS[shell.weapon].gravity * dt * dt;
      shell.velocity.y -= DEFENSE_GUNS[shell.weapon].gravity * dt;
      if (shell.position.y <= 0) {
        contacts.push({ at: Math.max(0, shell.previous.y / (shell.previous.y - shell.position.y)), kind: 'shell-ground', shell });
      }
      if (shell.timeLeft <= dt) contacts.push({ at: Math.max(0, shell.timeLeft / dt), kind: 'shell-end', shell });
      shell.timeLeft -= dt;
      for (const target of threats) {
        const at = contactTime(shell, target, target.radius);
        if (at !== Infinity) contacts.push({ at, kind: 'hit-threat', shell, target });
      }
      for (const bomb of bombs) {
        const at = contactTime(shell, bomb, bomb.radius);
        if (at !== Infinity) contacts.push({ at, kind: 'hit-bomb', shell, target: bomb });
      }
    }
    // All contacts share one timeline: a late round cannot intercept an already-landed
    // bomb, hit an escaped raider, or spend itself on an aircraft killed by an earlier shell.
    contacts.sort((a, b) => a.at - b.at);
    for (const contact of contacts) {
      if (contact.kind === 'escape') {
        contact.target.active = false;
      } else if (contact.kind === 'bomb-ground') {
        if (contact.bomb.active) groundImpact(contact.bomb, contact.at);
      } else {
        const shell = contact.shell;
        if (!shell.active) continue;
        if (contact.kind === 'hit-threat' && !contact.target.active) continue;
        if (contact.kind === 'hit-bomb' && !contact.target.active) continue;
        shell.active = false;
        if (shell.weapon === 'flak' && contact.kind !== 'shell-ground') {
          burst(shell, contact.at);
        } else if (contact.kind === 'hit-threat') {
          hitThreat(contact.target, shell.damage, contact.at);
        } else if (contact.kind === 'hit-bomb') {
          intercept(contact.target, contact.at);
        }
      }
    }
    compact(threats);
    compact(projectiles);
    compact(bombs);
  }

  function settleRaid(): void {
    if (!assets.some(asset => asset.health > 0)) { finish('lost'); return; }
    if (nextGroup < DEFENSE_RAIDS[state.raid - 1].length || threats.length || bombs.length || projectiles.length) return;
    state.raidsSurvived++;
    const total = DEFENSE_RAIDS[state.raid - 1].reduce((sum, group) => sum + (veteran ? group.veteranCount : group.count), 0);
    // The same 30-credit performance ceiling on both difficulties prevents extra enemies
    // turning Veteran into an easier upgrade economy. HQ income is binary, not kill-based.
    state.credits += 70 + (assetById.hq.health > 0 ? 30 : 0) + Math.floor(30 * raidKills / total);
    if (assetById.hospital.health > 0) {
      for (const asset of assets) if (asset.health > 0) asset.health = Math.min(asset.maxHealth, asset.health + 12);
    }
    state.score += 250;
    events.push({ type: 'raid-complete', raid: state.raid });
    if (state.raid === DEFENSE_RAIDS.length) finish('won');
    else state.phase = 'resupply';
  }

  function purchaseCost(purchase: DefensePurchase): number | null {
    if (state.phase !== 'resupply') return null;
    if (purchase.kind === 'upgrade') {
      const level = upgrades[purchase.upgradeId];
      return level >= 3 ? null : 70 + 45 * level;
    }
    const asset = assetById[purchase.assetId];
    if (asset.health >= asset.maxHealth) return null;
    return asset.health <= 0 ? 85 : Math.max(15, Math.ceil(Math.min(60, asset.maxHealth - asset.health) * 0.75));
  }

  return {
    state,
    events,
    step(dt, input) {
      events.length = 0;
      if (state.phase !== 'raid' || !Number.isFinite(dt) || dt <= 0) return;
      let remaining = dt;
      while (remaining > 1e-9 && state.phase === 'raid') {
        const slice = Math.min(SLICE, remaining);
        spawnGroups();
        for (const id of WEAPONS) {
          const weapon = weapons[id];
          weapon.cooldown = Math.max(0, weapon.cooldown - slice);
          weapon.heat = Math.max(0, weapon.heat - DEFENSE_GUNS[id].cooling * (1 + upgrades.cooling * 0.35) * slice);
          if (weapon.overheated && weapon.heat <= 0.35) weapon.overheated = false;
          if (weapon.reloadLeft > 0) {
            weapon.reloadLeft = Math.max(0, weapon.reloadLeft - slice);
            if (weapon.reloadLeft === 0) weapon.ammo = weapon.capacity;
          }
        }
        // Once the last threat/bomb is gone, cease new fire so held input cannot keep
        // creating shells forever and prevent the already-fired ordnance settling.
        if (input.fire && (threats.length || bombs.length || nextGroup < DEFENSE_RAIDS[state.raid - 1].length)) fire(input);
        moveAndResolve(slice);
        state.time += slice;
        state.raidTime += slice;
        settleRaid();
        remaining -= slice;
      }
    },
    selectWeapon(id) {
      events.length = 0;
      if (!terminalReport) state.selected = id;
    },
    reload() {
      events.length = 0;
      if (state.phase === 'raid') beginReload(weapons[state.selected]);
    },
    setFuzeRange(metres) {
      events.length = 0;
      if (!terminalReport && Number.isFinite(metres)) state.fuzeRange = Math.max(DEFENSE_FUZE.minimum, Math.min(DEFENSE_FUZE.maximum, metres));
    },
    advance() {
      events.length = 0;
      if (state.phase !== 'resupply') return;
      state.raid++;
      state.raidTime = 0;
      state.phase = 'raid';
      nextGroup = 0;
      raidKills = 0;
      for (const id of WEAPONS) {
        const weapon = weapons[id];
        weapon.ammo = weapon.capacity;
        weapon.heat = weapon.cooldown = weapon.reloadLeft = 0;
        weapon.overheated = false;
      }
    },
    purchaseCost,
    buy(purchase) {
      events.length = 0;
      const cost = purchaseCost(purchase);
      if (cost === null || state.credits < cost) return false;
      state.credits -= cost;
      if (purchase.kind === 'upgrade') upgrades[purchase.upgradeId]++;
      else {
        const asset = assetById[purchase.assetId];
        asset.health = asset.health <= 0 ? 70 : Math.min(asset.maxHealth, asset.health + 60);
      }
      return true;
    },
    abort() {
      events.length = 0;
      if (!terminalReport) finish('aborted');
    },
    result() {
      return terminalReport ? {
        ...terminalReport, options: { ...terminalReport.options },
        assets: terminalReport.assets.map(asset => ({ ...asset })),
      } : null;
    },
  };
}
